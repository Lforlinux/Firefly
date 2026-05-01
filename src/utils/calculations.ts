/**
 * Portfolio calculations. All public functions take and return numbers
 * in the portfolio's base currency unless explicitly stated otherwise.
 */
import type {
  CurrencyCode,
  FxRate,
  Holding,
  HoldingRow,
  PriceQuote,
} from '@/types'

/**
 * Convert `amount` from `from` currency to `base` currency.
 * Looks up `fxRates[`${from}_${base}`]`. Returns null if no rate is available
 * (and the two currencies aren't equal) — callers decide how to render that.
 */
export function convertToBase(
  amount: number,
  from: CurrencyCode,
  fxRates: Record<string, FxRate>,
  base: CurrencyCode,
): number | null {
  if (!Number.isFinite(amount)) return null
  if (!from || from.toUpperCase() === base.toUpperCase()) return amount
  const rate = fxRates[`${from.toUpperCase()}_${base.toUpperCase()}`]?.rate
  if (!Number.isFinite(rate)) return null
  return amount * (rate as number)
}

/** Pull `Owner: <name>` out of the holding's notes string. */
export function ownerFromNotes(notes: string | undefined): string | undefined {
  if (!notes) return undefined
  const m = notes.match(/Owner:\s*([A-Za-z][A-Za-z0-9 _'-]*)/)
  return m ? m[1].trim() : undefined
}

/** Distinct, sorted owners across the holdings list. */
export function listOwners(holdings: Holding[]): string[] {
  const set = new Set<string>()
  for (const h of holdings) {
    const o = ownerFromNotes(h.notes)
    if (o) set.add(o)
  }
  return [...set].sort()
}

/**
 * Build a HoldingRow from a Holding + the current price/fx caches.
 * `weight` is set to 0 here — the consumer fills it after summing the portfolio.
 */
export function buildRow(
  h: Holding,
  prices: Record<string, PriceQuote>,
  fxRates: Record<string, FxRate>,
  base: CurrencyCode,
): HoldingRow {
  const owner = ownerFromNotes(h.notes)

  // Cost basis in base currency: shares × avgCost (in holding.currency) × FX → base.
  const costNative = h.shares * h.avgCost
  const costBase = convertToBase(costNative, h.currency, fxRates, base) ?? costNative

  // Cash holdings: avgCost is the balance; their "value" equals cost (no market price).
  if (h.type === 'cash' || h.ticker.startsWith('CASH:')) {
    return {
      ...h,
      owner,
      livePrice: null,
      livePriceCcy: null,
      livePriceAt: null,
      valueBase: costBase,
      valueIsCost: true,
      costBase,
      gainLoss: 0,
      gainLossPct: 0,
      weight: 0,
    }
  }

  const quote = prices[h.ticker]
  if (!quote || !Number.isFinite(quote.price)) {
    return {
      ...h,
      owner,
      livePrice: null,
      livePriceCcy: null,
      livePriceAt: null,
      valueBase: costBase,
      valueIsCost: true,
      costBase,
      gainLoss: 0,
      gainLossPct: 0,
      weight: 0,
    }
  }

  const valueNative = h.shares * quote.price
  const valueBase = convertToBase(valueNative, quote.currency, fxRates, base)
  if (valueBase === null) {
    return {
      ...h,
      owner,
      livePrice: quote.price,
      livePriceCcy: quote.currency,
      livePriceAt: quote.asOf,
      valueBase: costBase,
      valueIsCost: true,
      costBase,
      gainLoss: 0,
      gainLossPct: 0,
      weight: 0,
    }
  }

  const gainLoss = valueBase - costBase
  const gainLossPct = costBase === 0 ? 0 : (gainLoss / costBase) * 100
  return {
    ...h,
    owner,
    livePrice: quote.price,
    livePriceCcy: quote.currency,
    livePriceAt: quote.asOf,
    valueBase,
    valueIsCost: false,
    costBase,
    gainLoss,
    gainLossPct,
    weight: 0,
  }
}

export interface BuildRowsResult {
  rows: HoldingRow[]
  totalValueBase: number
  totalCostBase: number
  totalGainLoss: number
  totalGainLossPct: number
  /** Subset of rows with type !== 'cash'. */
  investedRows: HoldingRow[]
  cashRows: HoldingRow[]
  cashValueBase: number
}

/**
 * One-shot: build all rows, sum totals, compute weights (including cash so weights add to 100).
 */
export function buildPortfolio(
  holdings: Holding[],
  prices: Record<string, PriceQuote>,
  fxRates: Record<string, FxRate>,
  base: CurrencyCode,
): BuildRowsResult {
  const rows = holdings.map((h) => buildRow(h, prices, fxRates, base))

  const totalValueBase = rows.reduce((a, r) => a + r.valueBase, 0)
  const totalCostBase = rows.reduce((a, r) => a + r.costBase, 0)
  const totalGainLoss = totalValueBase - totalCostBase
  const totalGainLossPct = totalCostBase === 0 ? 0 : (totalGainLoss / totalCostBase) * 100

  if (totalValueBase > 0) {
    for (const r of rows) r.weight = r.valueBase / totalValueBase
  }

  const investedRows = rows.filter((r) => r.type !== 'cash')
  const cashRows = rows.filter((r) => r.type === 'cash')
  const cashValueBase = cashRows.reduce((a, r) => a + r.valueBase, 0)

  return { rows, totalValueBase, totalCostBase, totalGainLoss, totalGainLossPct, investedRows, cashRows, cashValueBase }
}

export interface GroupedSlice {
  key: string
  valueBase: number
  weight: number  // share of the input set's total value
  count: number
}

function inferSector(row: HoldingRow): string {
  const raw = (row.sector || '').trim()
  if (raw) return raw

  const ticker = (row.ticker || '').toUpperCase()
  const name = (row.name || '').toUpperCase()

  // Common ETF/index mappings used by imported holdings.
  if (ticker === 'SGLN.L' || ticker === 'IE00B4ND3602' || name.includes('GOLD')) return 'Gold'
  if (ticker === 'VUAG.L' || ticker === 'IE00BFMXXD54' || name.includes('S&P 500')) return 'US Large Cap'
  if (ticker === 'EQQQ.L' || ticker === 'IE0032077012' || name.includes('NASDAQ')) return 'US Growth'
  if (ticker === 'EMIM.L' || ticker === 'IE00BKM4GZ66' || name.includes('EMERGING MARKETS')) return 'Emerging Markets'
  if (ticker === 'CSJP.L' || ticker === 'IE00B53QDK08' || name.includes('JAPAN')) return 'Japan'
  if (ticker === 'VEUA.L' || ticker === 'IE00BK5BQX27' || name.includes('EUROPE')) return 'Europe'
  if (ticker === 'VDPG.L' || ticker === 'IE00BK5BQZ41' || name.includes('ASIA PACIFIC')) return 'Asia Pacific'

  if (row.type === 'etf') return 'Global ETF'
  if (row.type === 'stock') return 'Equity'
  if (row.type === 'cash') return 'Cash'
  if (row.type === 'commodity') return 'Commodity'
  if (row.type === 'crypto') return 'Crypto'
  if (row.type === 'bond') return 'Bond'

  return 'Unclassified'
}

function groupBy(rows: HoldingRow[], pick: (r: HoldingRow) => string, totalForWeight?: number): GroupedSlice[] {
  const map = new Map<string, GroupedSlice>()
  for (const r of rows) {
    const k = pick(r) || '—'
    const e = map.get(k)
    if (e) {
      e.valueBase += r.valueBase
      e.count++
    } else {
      map.set(k, { key: k, valueBase: r.valueBase, weight: 0, count: 1 })
    }
  }
  const total = totalForWeight ?? rows.reduce((a, r) => a + r.valueBase, 0)
  const slices = [...map.values()]
  if (total > 0) for (const s of slices) s.weight = s.valueBase / total
  return slices.sort((a, b) => b.valueBase - a.valueBase)
}

export function byType(rows: HoldingRow[], totalForWeight?: number): GroupedSlice[] {
  return groupBy(rows, (r) => r.type, totalForWeight)
}

export function bySector(rows: HoldingRow[], totalForWeight?: number): GroupedSlice[] {
  return groupBy(rows, inferSector, totalForWeight)
}

export function byOwner(rows: HoldingRow[], totalForWeight?: number): GroupedSlice[] {
  return groupBy(rows, (r) => r.owner || 'Unassigned', totalForWeight)
}

export function topN(rows: HoldingRow[], n = 5): HoldingRow[] {
  return [...rows].sort((a, b) => b.valueBase - a.valueBase).slice(0, n)
}
