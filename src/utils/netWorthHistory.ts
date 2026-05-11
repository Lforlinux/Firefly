import type { Portfolio, Transaction } from '@/types'
import { buildPortfolio, convertToBase, ownerFromNotes } from '@/utils/calculations'

export type NetWorthHistoryPoint = {
  date: string
  estimatedNetWorth: number
  snapshotNetWorth: number | null
  netWorth: number
  contributions: number
}

function ownerMatches(notes: string | undefined, selectedOwner: string) {
  if (selectedOwner === 'all') return true
  const owner = ownerFromNotes(notes)
  return !!owner && owner.toLowerCase() === selectedOwner.toLowerCase()
}

function txAmountBase(tx: Transaction, base: string, fxRates: Portfolio['fxRates']) {
  const amount = (Number(tx.shares) || 0) * (Number(tx.price) || 0)
  if (!Number.isFinite(amount) || amount === 0) return 0
  return convertToBase(amount, tx.currency, fxRates, base) ?? amount
}

export function deriveNetWorthHistory(
  data: Portfolio,
  selectedOwner: string,
  liabilitiesBase: number,
  selectedCountry?: string,
): {
  base: string
  currentNetWorth: number
  currentContributions: number
  series: NetWorthHistoryPoint[]
} {
  const base = selectedCountry === 'India' ? 'INR' : (data.settings.baseCurrency || 'GBP')
  let filteredHoldings = selectedOwner === 'all'
    ? data.holdings
    : data.holdings.filter((h) => ownerMatches(h.notes, selectedOwner))
  if (selectedCountry === 'UK') filteredHoldings = filteredHoldings.filter((h) => h.currency !== 'INR')
  else if (selectedCountry === 'India') filteredHoldings = filteredHoldings.filter((h) => h.currency === 'INR')

  const built = buildPortfolio(filteredHoldings, data.prices, data.fxRates, base)
  const currentNetWorth = built.totalValueBase - liabilitiesBase

  // Only keep transactions that carry real position/contribution data.
  // Rows with zero shares×price (e.g. bad imports) would create fake start dates
  // and a misleading diagonal from £0 to today's value.
  const filteredTx = (data.transactions || [])
    .filter((tx) => ownerMatches(tx.notes, selectedOwner))
    .filter((tx) => {
      if (selectedCountry === 'UK') return (tx.currency || '').toUpperCase() !== 'INR'
      if (selectedCountry === 'India') return (tx.currency || '').toUpperCase() === 'INR'
      return true
    })
    .filter((tx) => {
      const side = String(tx.side || '').toLowerCase()
      const shares = Number(tx.shares) || 0
      const price = Number(tx.price) || 0
      if (side === 'buy' || side === 'sell') return shares > 0 && price > 0
      if (side === 'split') return shares > 0
      return true // fee / dividend are always meaningful
    })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))

  if (filteredTx.length === 0) {
    const today = new Date().toISOString().slice(0, 10)
    const snapshotToday = (data.snapshots || []).find((s) => s.date === today)
    return {
      base,
      currentNetWorth,
      currentContributions: 0,
      series: [{
        date: today,
        estimatedNetWorth: currentNetWorth,
        snapshotNetWorth: snapshotToday ? Number(snapshotToday.valueGBP) || 0 : null,
        netWorth: snapshotToday ? Number(snapshotToday.valueGBP) || currentNetWorth : currentNetWorth,
        contributions: 0,
      }],
    }
  }

  const txByDate = new Map<string, Transaction[]>()
  for (const tx of filteredTx) {
    const rows = txByDate.get(tx.date)
    if (rows) rows.push(tx)
    else txByDate.set(tx.date, [tx])
  }

  const snapshotByDate = new Map<string, number>()
  for (const s of data.snapshots || []) snapshotByDate.set(s.date, Number(s.valueGBP) || 0)

  const txTickers = new Set(filteredTx.map((tx) => tx.ticker).filter(Boolean))
  const staticRows = built.rows.filter((r) => r.type !== 'cash' && !txTickers.has(r.ticker))
  const staticInvestedValueBase = staticRows.reduce((sum, r) => sum + r.valueBase, 0)
  const currentCashValueBase = built.cashValueBase

  const positions = new Map<string, { shares: number; currency: string; lastTxPrice: number }>()
  let contributions = 0

  const today = new Date().toISOString().slice(0, 10)
  // Snapshots are posted from the "all" view and represent the combined portfolio.
  // Including their dates in a per-owner chart adds spurious data points valued at £0
  // (no per-person tx on those dates), so only include them for the "all" view.
  const allDates = [...new Set([
    ...txByDate.keys(),
    ...(selectedOwner === 'all' ? snapshotByDate.keys() : []),
    today,
  ])].sort()

  const series: NetWorthHistoryPoint[] = allDates.map((date) => {
    const todaysTx = txByDate.get(date) || []
    for (const tx of todaysTx) {
      const side = String(tx.side || '').toLowerCase()
      const shares = Number(tx.shares) || 0
      const amountBase = txAmountBase(tx, base, data.fxRates)

      const prev = positions.get(tx.ticker) || { shares: 0, currency: tx.currency, lastTxPrice: Number(tx.price) || 0 }
      if (side === 'buy') {
        prev.shares += shares
        contributions += amountBase
      } else if (side === 'sell') {
        prev.shares = Math.max(0, prev.shares - shares)
        contributions -= amountBase
      } else if (side === 'fee') {
        contributions += amountBase
      } else if (side === 'dividend') {
        contributions -= amountBase
      } else if (side === 'split') {
        prev.shares += shares
      }

      if (Number.isFinite(tx.price) && Number(tx.price) > 0) prev.lastTxPrice = Number(tx.price)
      if (tx.currency) prev.currency = tx.currency
      positions.set(tx.ticker, prev)
    }

    let txDrivenInvestedValueBase = 0
    for (const [ticker, pos] of positions.entries()) {
      if (pos.shares <= 0) continue
      const quote = data.prices[ticker]
      if (quote && Number.isFinite(quote.price)) {
        const native = pos.shares * quote.price
        const asBase = convertToBase(native, quote.currency, data.fxRates, base) ?? native
        txDrivenInvestedValueBase += asBase
      } else {
        const native = pos.shares * (Number(pos.lastTxPrice) || 0)
        const asBase = convertToBase(native, pos.currency, data.fxRates, base) ?? native
        txDrivenInvestedValueBase += asBase
      }
    }

    // Static holdings (no transaction records) and current cash are only meaningful
    // for today's value — adding them to historical dates would inflate past net worth
    // using today's prices/balances, which makes history look wrong.
    const estimatedNetWorth = txDrivenInvestedValueBase
      + (date === today ? staticInvestedValueBase + currentCashValueBase : 0)
      - liabilitiesBase
    const snapshotNetWorth = snapshotByDate.has(date) ? snapshotByDate.get(date) || 0 : null
    return {
      date,
      estimatedNetWorth,
      snapshotNetWorth,
      netWorth: snapshotNetWorth ?? estimatedNetWorth,
      contributions,
    }
  })

  const currentContributions = series.length ? series[series.length - 1].contributions : 0
  return { base, currentNetWorth, currentContributions, series }
}
