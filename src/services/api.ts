/**
 * Thin fetch wrappers for the Firefly API. The hooks live in AppContext;
 * this file is just the typed network layer.
 *
 * All requests include credentials: 'include' to send HTTP-only JWT cookies
 * with every request for user authentication.
 */
import type { Portfolio, PriceCache, Holding, Transaction, Snapshot, Settings } from '@/types'

export async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: 'include', // Send HTTP-only JWT cookie
  })
  const text = await res.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).error)
      : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as T
}

// Legacy endpoints (may still be used elsewhere)
export function getPortfolio(): Promise<Portfolio> {
  return jsonFetch<Portfolio>('/api/portfolio')
}

export function savePortfolio(next: Pick<Portfolio, 'holdings' | 'snapshots' | 'transactions' | 'settings'>): Promise<{ ok: true; settings: Portfolio['settings'] }> {
  return jsonFetch('/api/portfolio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
}

// Phase 7 API endpoints (user-scoped)
export function fetchHoldings(): Promise<{ holdings: Holding[] }> {
  return jsonFetch<{ holdings: Holding[] }>('/api/portfolio/holdings')
}

export function createHolding(holding: Omit<Holding, 'id'>): Promise<{ holding: Holding }> {
  return jsonFetch('/api/portfolio/holdings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(holding),
  })
}

export function updateHolding(id: string, updates: Partial<Omit<Holding, 'id'>>): Promise<{ holding: Holding }> {
  return jsonFetch('/api/portfolio/holdings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  })
}

export function deleteHolding(id: string): Promise<{ ok: true }> {
  return jsonFetch('/api/portfolio/holdings', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export function fetchTransactions(): Promise<{ transactions: Transaction[] }> {
  return jsonFetch<{ transactions: Transaction[] }>('/api/portfolio/transactions')
}

export function createTransaction(transaction: Omit<Transaction, 'id'>): Promise<{ transaction: Transaction }> {
  return jsonFetch('/api/portfolio/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transaction),
  })
}

export function updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<{ transaction: Transaction }> {
  return jsonFetch('/api/portfolio/transactions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  })
}

export function deleteTransaction(id: string): Promise<{ ok: true }> {
  return jsonFetch('/api/portfolio/transactions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export function fetchSnapshots(): Promise<{ snapshots: Snapshot[] }> {
  return jsonFetch<{ snapshots: Snapshot[] }>('/api/portfolio/snapshots')
}

export function createSnapshot(snapshot: Omit<Snapshot, 'id'>): Promise<{ snapshot: Snapshot }> {
  return jsonFetch('/api/portfolio/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
}

export function updateSnapshot(id: string, updates: Partial<Omit<Snapshot, 'id'>>): Promise<{ snapshot: Snapshot }> {
  return jsonFetch('/api/portfolio/snapshots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  })
}

export function deleteSnapshot(id: string): Promise<{ ok: true }> {
  return jsonFetch('/api/portfolio/snapshots', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export function fetchSettings(): Promise<{ settings: Settings }> {
  return jsonFetch<{ settings: Settings }>('/api/portfolio/settings')
}

export function updateSettings(updates: Partial<Settings>): Promise<{ settings: Settings }> {
  return jsonFetch('/api/portfolio/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export interface RefreshResult {
  ok: true
  lastRefresh: string
  tickersRefreshed: number
  fxPairs: number
  errors: { ticker?: string; pair?: string; error: string }[]
  cache: PriceCache
}

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart'
const YAHOO_BATCH = 'https://query2.finance.yahoo.com/v7/finance/quote'

async function yahooChart(symbol: string): Promise<{ price: number; currency: string } | null> {
  try {
    const res = await fetch(`${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=1d`)
    if (!res.ok) return null
    const body = await res.json()
    const meta = body?.chart?.result?.[0]?.meta
    let price = meta?.regularMarketPrice
    let currency = meta?.currency || 'USD'
    if (typeof price !== 'number' || !Number.isFinite(price)) return null
    if (currency === 'GBp') { price = price / 100; currency = 'GBP' }
    return { price, currency }
  } catch { return null }
}

async function yahooBatchQuotes(symbols: string[]): Promise<Record<string, { price: number; currency: string }>> {
  if (symbols.length === 0) return {}
  try {
    const url = `${YAHOO_BATCH}?symbols=${symbols.map(encodeURIComponent).join(',')}&fields=regularMarketPrice,currency`
    const res = await fetch(url)
    if (!res.ok) return {}
    const body = await res.json()
    const out: Record<string, { price: number; currency: string }> = {}
    for (const item of body?.quoteResponse?.result || []) {
      let price = item?.regularMarketPrice
      let currency = item?.currency || 'USD'
      if (typeof price !== 'number' || !Number.isFinite(price)) continue
      if (currency === 'GBp') { price = price / 100; currency = 'GBP' }
      out[item.symbol] = { price, currency }
    }
    return out
  } catch { return {} }
}

export async function refreshPrices(): Promise<RefreshResult> {
  const asOf = new Date().toISOString()
  const errors: RefreshResult['errors'] = []

  // Load current holdings to know what tickers/currencies we need
  const portfolio = await getPortfolio()
  const holdings = portfolio.holdings || []
  const base = (portfolio.settings?.baseCurrency || 'GBP').toUpperCase()

  const tickers = [...new Set(
    holdings
      .filter((h) => h.type !== 'cash' && h.ticker && !h.ticker.startsWith('CASH:'))
      .map((h) => h.ticker)
  )]

  // Fetch all prices in one batch request (browser-side, no IP blocking)
  const prices: Record<string, { price: number; currency: string; asOf: string }> = {}
  const batch = await yahooBatchQuotes(tickers)
  for (const [sym, q] of Object.entries(batch)) {
    prices[sym] = { ...q, asOf }
  }
  // Fall back to chart API for any missing tickers
  for (const ticker of tickers.filter((t) => !prices[t])) {
    const q = await yahooChart(ticker)
    if (q) prices[ticker] = { ...q, asOf }
    else errors.push({ ticker, error: 'No quote available' })
  }

  // Determine FX pairs needed
  const neededCurrencies = new Set<string>()
  for (const h of holdings) {
    const c = h.currency?.toUpperCase()
    if (c && c !== base) neededCurrencies.add(c)
  }
  for (const q of Object.values(prices)) {
    const c = q.currency?.toUpperCase()
    if (c && c !== base) neededCurrencies.add(c)
  }

  // Fetch all FX pairs in one batch
  const fxSymbols = [...neededCurrencies].map((c) => `${c}${base}=X`)
  fxSymbols.push('GBPINR=X')
  const fxBatch = await yahooBatchQuotes([...new Set(fxSymbols)])

  const fxRates: Record<string, { rate: number; asOf: string }> = {}
  for (const ccy of neededCurrencies) {
    const sym = `${ccy}${base}=X`
    const q = fxBatch[sym]
    if (q) fxRates[`${ccy}_${base}`] = { rate: q.price, asOf }
    else {
      // Try chart API fallback
      const fq = await yahooChart(sym)
      if (fq) fxRates[`${ccy}_${base}`] = { rate: fq.price, asOf }
      else errors.push({ pair: `${ccy}_${base}`, error: 'No FX rate available' })
    }
  }
  const gbpInr = fxBatch['GBPINR=X']
  if (gbpInr) fxRates['GBP_INR'] = { rate: gbpInr.price, asOf }
  fxRates[`${base}_${base}`] = { rate: 1, asOf }

  // POST prices + FX to backend for storage
  await jsonFetch('/api/prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prices, fxRates }),
  })

  return {
    ok: true,
    lastRefresh: asOf,
    tickersRefreshed: Object.keys(prices).length,
    fxPairs: Object.keys(fxRates).length,
    errors,
    cache: { prices, fxRates, lastRefresh: asOf },
  }
}

export function postSnapshot(date: string, valueGBP: number): Promise<{ ok: true; count: number }> {
  return jsonFetch('/api/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, valueGBP }),
  })
}
