import type { Currency, Exchange, AssetCategory } from '@/types'

/** One row from a trades CSV (after normalizing headers) */
export interface TradeRow {
  date: string       // YYYY-MM-DD
  symbol: string
  name: string
  action: 'Buy' | 'Sell'
  quantity: number
  price: number
  currency: Currency
  exchange?: Exchange
  owner?: 'KLN' | 'Priya'
  category?: AssetCategory
}

const HEADER_ALIASES: Record<string, string> = {
  date: 'date',
  'trade date': 'date',
  'trade date/time': 'date',
  'settlement date': 'date',
  symbol: 'symbol',
  ticker: 'symbol',
  instrument: 'symbol',
  'security / isin': 'symbol',
  'security': 'symbol',
  name: 'name',
  description: 'name',
  action: 'action',
  side: 'action',
  type: 'action',
  'transaction type': 'action',
  'buy/sell': 'action',
  quantity: 'quantity',
  qty: 'quantity',
  units: 'quantity',
  shares: 'quantity',
  amount: 'quantity',
  price: 'price',
  'unit price': 'price',
  'share price': 'price',
  rate: 'price',
  'price per share': 'price',
  currency: 'currency',
  ccy: 'currency',
  exchange: 'exchange',
  venue: 'exchange',
  owner: 'owner',
  account: 'owner',
  holder: 'owner',
  category: 'category',
  'asset type': 'category',
}

function normalizeHeader(h: string): string {
  const key = h.trim().toLowerCase().replace(/\s+/g, ' ')
  return HEADER_ALIASES[key] ?? key
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
    } else if (inQuotes) {
      cur += c
    } else if (c === ',') {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur.trim())
  return out
}

function parseDate(s: string): string | null {
  const v = s.trim()
  if (!v) return null
  // ISO YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})/
  let m = v.match(iso)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // DD/MM/YYYY or DD-MM-YYYY
  m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // DD/MM/YY or DD-MM-YY (e.g. 10/03/25 or 06/03/25 15:18:33)
  m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?:\s|$)/)
  if (m) {
    const yy = parseInt(m[3], 10)
    const yyyy = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy
    return `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

function parseNum(s: string): number {
  const v = String(s).replace(/,/g, '').replace(/[^\d.-]/g, '')
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function toCurrency(_s: string): Currency {
  return 'GBP'
}

function toExchange(s: string): Exchange {
  const v = (s || '').trim().toUpperCase()
  if (v === 'NASDAQ' || v === 'NAS') return 'NASDAQ'
  if (v === 'LSE' || v === 'LON' || v === 'L') return 'LSE'
  return 'LSE'
}

function toAction(s: string): 'Buy' | 'Sell' {
  const v = (s || '').trim().toLowerCase()
  if (v === 'sell' || v === 's' || v === 'withdrawal') return 'Sell'
  return 'Buy'
}

function toOwner(s: string): 'KLN' | 'Priya' | undefined {
  const v = (s || '').trim().toUpperCase()
  if (v === 'KLN' || v === 'K') return 'KLN'
  if (v === 'PRIYA' || v === 'P') return 'Priya'
  return undefined
}

function toCategory(s: string): AssetCategory {
  const v = (s || '').trim().toLowerCase()
  if (v === 'etf') return 'ETF'
  if (v === 'gold') return 'Gold'
  if (v === 'debt' || v === 'fixed income') return 'Debt'
  if (v === 'cash') return 'Cash'
  if (v === 'mf' || v === 'mutual fund' || v === 'fund') return 'Equity'
  return 'Equity'
}

export interface ParseResult {
  rows: TradeRow[]
  errors: string[]
}

/** Parse Trading 212 CSV export (Action, Time, Ticker, Name, No. of shares, Total, Currency (Total), etc.) */
export function parseTradesCsvTrading212(csvText: string): ParseResult {
  const errors: string[] = []
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must have a header row and at least one data row.'] }
  }
  const headerLine = lines[0]
  const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase())
  const col = (name: string) => {
    const n = name.toLowerCase()
    const i = headers.findIndex((h) => h === n || h.replace(/\s+/g, ' ').includes(n))
    return i >= 0 ? i : -1
  }
  const actionIdx = col('action')
  const timeIdx = col('time')
  const tickerIdx = col('ticker')
  const nameIdx = col('name')
  const sharesIdx = headers.findIndex((h) => h.includes('no. of shares') || h === 'no. of shares')
  const totalIdx = col('total')
  const currencyTotalIdx = headers.findIndex((h) => h.includes('currency (total)'))
  const currencyPriceIdx = headers.findIndex((h) => h.includes('currency (price'))
  const exchangeRateIdx = col('exchange rate')

  if (actionIdx < 0 || timeIdx < 0 || sharesIdx < 0 || totalIdx < 0) {
    return {
      rows: [],
      errors: ['Missing required columns: Action, Time, No. of shares, Total. Is this a Trading 212 CSV?'],
    }
  }

  const rows: TradeRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const actionRaw = (cells[actionIdx] ?? '').trim().toLowerCase()
    let action: 'Buy' | 'Sell' | null = null
    if (actionRaw === 'market buy') action = 'Buy'
    else if (actionRaw === 'market sell') action = 'Sell'
    if (action === null) continue

    const date = parseDate(cells[timeIdx] ?? '')
    const symbol = (cells[tickerIdx] ?? '').trim() || (cells[nameIdx] ?? '').trim()
    const name = (cells[nameIdx] ?? '').trim() || symbol
    const quantity = parseNum(cells[sharesIdx] ?? '')
    const total = parseNum(cells[totalIdx] ?? '')
    const currencyTotal = (cells[currencyTotalIdx] ?? 'GBP').trim().toUpperCase()
    const currencyPrice = (cells[currencyPriceIdx] ?? 'GBP').trim().toUpperCase()
    const exchangeRate = parseNum(cells[exchangeRateIdx] ?? '1')
    if (!date || !symbol || quantity <= 0) continue

    let priceGbp: number
    if (currencyTotal === 'GBP') {
      priceGbp = total / quantity
    } else if (currencyTotal === 'USD' && exchangeRate > 0) {
      priceGbp = total / exchangeRate / quantity
    } else {
      continue
    }
    const exchange: Exchange = currencyPrice === 'USD' ? 'NASDAQ' : 'LSE'
    rows.push({
      date,
      symbol,
      name,
      action,
      quantity,
      price: priceGbp,
      currency: 'GBP',
      exchange,
    })
  }
  return { rows, errors }
}

/**
 * Parse a CSV string of trades.
 * Expected columns (case-insensitive, common aliases supported):
 * - date, symbol, action (Buy/Sell), quantity, price; currency optional (default GBP)
 * - name, exchange, owner (KLN/Priya), category (optional)
 * Supports ISA/trading statements where line 1 may be a title and line 2 is the header.
 */
export function parseTradesCsv(csvText: string): ParseResult {
  const errors: string[] = []
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must have a header row and at least one data row.'] }
  }

  // Find header row (some CSVs have a title on line 0, e.g. "Transaction Statement: ...")
  let headerRowIdx = 0
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const headers = parseCsvLine(lines[i]).map(normalizeHeader)
    if (headers.indexOf('quantity') >= 0 && headers.indexOf('date') >= 0 && headers.indexOf('action') >= 0 &&
        headers.indexOf('price') >= 0 && headers.indexOf('symbol') >= 0) {
      headerRowIdx = i
      break
    }
  }

  const headerLine = lines[headerRowIdx]
  const headers = parseCsvLine(headerLine).map(normalizeHeader)
  const dateIdx = headers.indexOf('date')
  const symbolIdx = headers.indexOf('symbol')
  const actionIdx = headers.indexOf('action')
  const qtyIdx = headers.indexOf('quantity')
  const priceIdx = headers.indexOf('price')
  const currencyIdx = headers.indexOf('currency')

  if (dateIdx === -1) errors.push('Missing column: date (or Trade Date / Settlement Date)')
  if (symbolIdx === -1) errors.push('Missing column: symbol (or Security / ISIN / Ticker)')
  if (actionIdx === -1) errors.push('Missing column: action (or Transaction Type / Buy/Sell)')
  if (qtyIdx === -1) errors.push('Missing column: quantity (or Qty / Shares)')
  if (priceIdx === -1) errors.push('Missing column: price (or Share Price / Unit Price)')
  if (errors.length > 0) return { rows: [], errors }

  const nameIdx = headers.indexOf('name')
  const exchangeIdx = headers.indexOf('exchange')
  const ownerIdx = headers.indexOf('owner')
  const categoryIdx = headers.indexOf('category')

  const rows: TradeRow[] = []
  for (let i = headerRowIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const date = parseDate(cells[dateIdx] ?? '')
    let symbolRaw = (cells[symbolIdx] ?? '').trim()
    // "Security / ISIN ..." → use part before " / ISIN" as name and symbol
    const securityName = symbolRaw.includes(' / ISIN') ? symbolRaw.split(' / ISIN')[0].trim() : symbolRaw
    const symbol = securityName || undefined
    const action = toAction(cells[actionIdx] ?? '')
    const quantity = parseNum(cells[qtyIdx] ?? '')
    const price = parseNum(cells[priceIdx] ?? '')
    const currency = currencyIdx >= 0 ? toCurrency(cells[currencyIdx] ?? 'GBP') : 'GBP'

    if (!date || !symbol || quantity <= 0 || price <= 0) {
      if (symbol || quantity || price) errors.push(`Row ${i + 1}: skipped (invalid date/symbol/qty/price)`)
      continue
    }
    const exchange = exchangeIdx >= 0 && cells[exchangeIdx] ? toExchange(cells[exchangeIdx]) : 'LSE'
    rows.push({
      date,
      symbol,
      name: (nameIdx >= 0 && cells[nameIdx] ? cells[nameIdx] : securityName).trim(),
      action,
      quantity,
      price,
      currency,
      exchange: exchange as Exchange,
      owner: ownerIdx >= 0 && cells[ownerIdx] ? toOwner(cells[ownerIdx]) : undefined,
      category: categoryIdx >= 0 && cells[categoryIdx] ? toCategory(cells[categoryIdx]) : undefined,
    })
  }
  return { rows, errors }
}

/** Holding without id (for import) */
export interface HoldingFromTrades {
  name: string
  symbol: string
  exchange: Exchange
  category: AssetCategory
  unitPrice: number
  units: number
  averageCost: number
  currency: Currency
  owner?: 'KLN' | 'Priya'
}

/**
 * Aggregate trade rows into open positions (holdings).
 * Uses defaultOwner when a row has no owner column.
 */
export function aggregateTradesToHoldings(
  rows: TradeRow[],
  defaultOwner?: 'KLN' | 'Priya'
): HoldingFromTrades[] {
  const key = (r: TradeRow) => `${r.owner ?? defaultOwner ?? ''}|${r.symbol}|${r.exchange ?? ''}|${r.currency}`
  const byKey = new Map<string, { buyQty: number; buyValue: number; sellQty: number; sellValue: number; name: string; category: AssetCategory }>()

  for (const r of rows) {
    const k = key(r)
    const cur = byKey.get(k) ?? {
      buyQty: 0,
      buyValue: 0,
      sellQty: 0,
      sellValue: 0,
      name: r.name,
      category: r.category ?? 'Equity',
    }
    const q = r.quantity
    const v = q * r.price
    if (r.action === 'Buy') {
      cur.buyQty += q
      cur.buyValue += v
    } else {
      cur.sellQty += q
      cur.sellValue += v
    }
    byKey.set(k, cur)
  }

  const holdings: HoldingFromTrades[] = []
  for (const [k, v] of byKey) {
    const units = v.buyQty - v.sellQty
    if (units <= 0) continue
    const totalCost = v.buyValue - v.sellValue
    const averageCost = totalCost / units
    const [ownerStr, symbol, exchangeStr, currencyStr] = k.split('|')
    const currency = currencyStr as Currency
    const exchange = (exchangeStr || 'LSE') as Exchange
    holdings.push({
      name: v.name,
      symbol,
      exchange,
      category: v.category,
      unitPrice: averageCost, // will be overwritten when user fetches live price
      units,
      averageCost,
      currency,
      owner: ownerStr ? (ownerStr as 'KLN' | 'Priya') : defaultOwner,
    })
  }
  return holdings.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

/** Snapshot for growth chart (date + value in GBP) */
export interface PortfolioSnapshot {
  date: string
  valueGBP: number
}

function costBasisAtDate(gbpRows: TradeRow[], key: (r: TradeRow) => string, asOfDate: string): number {
  const byKey = new Map<string, { buyQty: number; buyValue: number; sellQty: number; sellValue: number }>()
  for (const r of gbpRows) {
    if (r.date > asOfDate) continue
    const k = key(r)
    const cur = byKey.get(k) ?? { buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0 }
    const q = r.quantity
    const v = q * r.price
    if (r.action === 'Buy') {
      cur.buyQty += q
      cur.buyValue += v
    } else {
      cur.sellQty += q
      cur.sellValue += v
    }
    byKey.set(k, cur)
  }
  let valueGBP = 0
  for (const v of byKey.values()) {
    const units = v.buyQty - v.sellQty
    if (units > 0) valueGBP += v.buyValue - v.sellValue
  }
  return Math.round(valueGBP)
}

/**
 * Build UK portfolio value over time from trade history (cost basis at each month-end).
 * Use this to seed the dashboard growth chart from a trading statement CSV.
 */
export function buildUkPortfolioHistoryFromTrades(rows: TradeRow[]): PortfolioSnapshot[] {
  const gbpRows = rows.filter((r) => r.currency === 'GBP')
  if (gbpRows.length === 0) return []

  const key = (r: TradeRow) => `${r.owner ?? ''}|${r.symbol}|${r.exchange ?? ''}|${r.currency}`
  const dates = gbpRows.map((r) => r.date).filter(Boolean)
  if (dates.length === 0) return []

  const sortedDates = [...dates].sort()
  const first = sortedDates[0]
  const last = sortedDates[sortedDates.length - 1]
  const monthEnds: string[] = []
  const [fy, fm] = first.split('-').map(Number)
  const [ly, lm] = last.split('-').map(Number)
  for (let y = fy; y <= ly; y++) {
    const startM = y === fy ? fm : 1
    const endM = y === ly ? lm : 12
    for (let m = startM; m <= endM; m++) {
      const lastDay = new Date(y, m, 0)
      const d = lastDay.toISOString().slice(0, 10)
      if (d >= first && d <= last) monthEnds.push(d)
    }
  }

  const snapshots: PortfolioSnapshot[] = []
  for (const monthEnd of monthEnds) {
    snapshots.push({ date: monthEnd, valueGBP: costBasisAtDate(gbpRows, key, monthEnd) })
  }
  return snapshots.sort((a, b) => a.date.localeCompare(b.date))
}

/** All calendar days from start to end (inclusive), YYYY-MM-DD */
function daysBetween(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(start + 'T12:00:00Z')
  const endDate = new Date(end + 'T12:00:00Z')
  while (d.getTime() <= endDate.getTime()) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/**
 * Build daily cost-basis history from trade history so the growth chart steps on
 * actual investment dates instead of showing a single spike in the last month.
 * Optional valueToday (e.g. current cost from holdings) is used for today's date.
 */
export function buildUkPortfolioHistoryDailyFromTrades(
  rows: TradeRow[],
  today: string,
  valueToday?: number
): PortfolioSnapshot[] {
  const gbpRows = rows.filter((r) => r.currency === 'GBP')
  if (gbpRows.length === 0) return []

  const key = (r: TradeRow) => `${r.owner ?? ''}|${r.symbol}|${r.exchange ?? ''}|${r.currency}`
  const dates = gbpRows.map((r) => r.date).filter(Boolean)
  if (dates.length === 0) return []

  const sortedDates = [...dates].sort()
  const first = sortedDates[0]
  const last = sortedDates[sortedDates.length - 1]
  const toDate = last > today ? today : today > last ? today : last
  const allDays = daysBetween(first, toDate)
  const snapshots: PortfolioSnapshot[] = []
  let lastValue = 0
  for (const d of allDays) {
    if (d <= last) {
      lastValue = costBasisAtDate(gbpRows, key, d)
      snapshots.push({ date: d, valueGBP: lastValue })
    } else if (d === today && valueToday !== undefined) {
      snapshots.push({ date: d, valueGBP: Math.round(valueToday) })
    } else {
      snapshots.push({ date: d, valueGBP: lastValue })
    }
  }
  return snapshots.sort((a, b) => a.date.localeCompare(b.date))
}
