import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

/**
 * Price sources (in priority order):
 * 1. T212 REST API — if T212_API_KEY env var is set (recommended)
 * 2. Stooq — free, no key, but blocks Vercel IPs in practice
 *
 * FX rates: Frankfurter.app — always free, no key, works from any IP.
 */

// Old ticker → current ticker mapping for renamed companies
const TICKER_ALIASES: Record<string, string> = {
  FB:   'META',  // Meta Platforms (rebranded Oct 2021)
  AAXN: 'AXON', // Axon Enterprise (rebranded Apr 2021)
  TWTR: 'X',    // X Corp (formerly Twitter)
}

// ---------------------------------------------------------------------------
// T212 REST API
// ---------------------------------------------------------------------------
async function fetchT212Prices(
  apiKey: string,
  tickers: string[],
  asOf: string,
): Promise<Record<string, { price: number; currency: string; asOf: string }>> {
  const res = await fetch('https://live.trading212.com/api/v0/equity/portfolio', {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`T212 API HTTP ${res.status}`)
  const positions: any[] = await res.json()

  const out: Record<string, { price: number; currency: string; asOf: string }> = {}
  const tickerSet = new Set(tickers.map((t) => t.toUpperCase()))

  for (const pos of positions) {
    // T212 ticker format: NVDA_US_EQ → strip suffix to get NVDA
    const raw = String(pos.ticker || '')
    const ticker = raw.replace(/_[A-Z]+_EQ$/, '').replace(/_EQ$/, '').toUpperCase()
    if (!tickerSet.has(ticker)) continue
    const price = Number(pos.currentPrice ?? pos.averagePrice)
    if (!Number.isFinite(price) || price <= 0) continue
    out[ticker] = { price, currency: 'USD', asOf }
  }
  return out
}

// ---------------------------------------------------------------------------
// Stooq fallback (works from residential/non-cloud IPs; often blocked on Vercel)
// ---------------------------------------------------------------------------
async function stooqPrice(ticker: string): Promise<{ price: number; currency: string } | { error: string }> {
  const lookupTicker = TICKER_ALIASES[ticker.toUpperCase()] || ticker
  const stooqSym = lookupTicker.endsWith('.L')
    ? lookupTicker.replace(/\.L$/, '.UK').toLowerCase()
    : `${lookupTicker.toLowerCase()}.us`
  const isUK = stooqSym.endsWith('.uk')
  try {
    const url = `https://stooq.com/q/l/?s=${stooqSym}&f=s,c&e=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const text = await res.text()
    let body: any
    try { body = JSON.parse(text) } catch { return { error: `Bad JSON: ${text.slice(0, 80)}` } }
    const item = body?.symbols?.[0]
    const price = parseFloat(item?.close)
    if (!Number.isFinite(price) || price <= 0) return { error: `No price in: ${JSON.stringify(item)}` }
    return { price: isUK ? price / 100 : price, currency: isUK ? 'GBP' : 'USD' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'fetch failed' }
  }
}

// ---------------------------------------------------------------------------
// Yahoo Finance — works server-side for UK (.L) ETFs (GBp → GBP conversion)
// ---------------------------------------------------------------------------
async function yahooPrice(ticker: string): Promise<{ price: number; currency: string } | { error: string }> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { error: `Yahoo HTTP ${res.status}` }
    const body = await res.json()
    const meta = body?.chart?.result?.[0]?.meta
    const rawPrice = meta?.regularMarketPrice
    const rawCcy = String(meta?.currency || '')
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) return { error: 'No price from Yahoo' }
    // Yahoo returns GBp (pence) for LSE-listed securities — convert to GBP
    const isGBp = rawCcy === 'GBp'
    return { price: isGBp ? rawPrice / 100 : rawPrice, currency: isGBp ? 'GBP' : rawCcy }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'fetch failed' }
  }
}

// ---------------------------------------------------------------------------
// Frankfurter FX (always works)
// ---------------------------------------------------------------------------
async function frankfurterRates(from: string, tos: string[]): Promise<Record<string, number>> {
  if (tos.length === 0) return {}
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${[...new Set(tos)].join(',')}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`)
  const body = await res.json()
  return body?.rates || {}
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const db = await getDbClient()
    const settingsRes = await db.query(`SELECT base_currency FROM settings WHERE user_id = $1 LIMIT 1`, [auth.userId])
    const base = String(settingsRes.rows?.[0]?.base_currency || 'GBP').toUpperCase()

    const holdingsRes = await db.query(`SELECT ticker, type, currency FROM holdings WHERE user_id = $1`, [auth.userId])
    const holdings: { ticker: string; type: string; currency: string }[] = holdingsRes.rows || []

    const tickers = [...new Set(
      holdings
        .filter((h) => h.type !== 'cash' && h.ticker && !h.ticker.startsWith('CASH:'))
        .map((h) => h.ticker)
    )]

    const errors: { ticker?: string; pair?: string; error: string }[] = []
    const asOf = new Date().toISOString()
    const pricesMap: Record<string, { price: number; currency: string; asOf: string }> = {}
    const t212Key = process.env.T212_API_KEY

    if (t212Key) {
      // Primary: T212 REST API — works from any IP, returns live prices for T212 holdings
      try {
        const t212Prices = await fetchT212Prices(t212Key, tickers, asOf)
        Object.assign(pricesMap, t212Prices)
      } catch (e) {
        errors.push({ error: `T212 API: ${e instanceof Error ? e.message : 'failed'}` } as any)
      }
    }

    // Fallback for tickers not yet priced (InvestEngine ETFs, or when T212 key missing/invalid)
    // UK (.L) ETFs → Yahoo Finance (works server-side, returns GBp which we convert)
    // US stocks    → Stooq
    const unpricedTickers = tickers.filter((t) => !pricesMap[t])
    if (unpricedTickers.length > 0) {
      await Promise.all(unpricedTickers.map(async (ticker) => {
        const isUK = ticker.endsWith('.L')
        const q = isUK ? await yahooPrice(ticker) : await stooqPrice(ticker)
        if ('error' in q) errors.push({ ticker, error: q.error })
        else pricesMap[ticker] = { ...q, asOf }
      }))
    }

    // Fetch existing prices before updating so we can roll prev_close on a new trading day
    const today = new Date().toISOString().slice(0, 10)
    const existingRes = await db.query(
      `SELECT ticker, price, as_of, prev_close, prev_close_as_of FROM price_cache`
    )
    const existingByTicker = new Map<string, {
      price: number; asOf: string
      prevClose: number | null; prevCloseAsOf: string | null
    }>()
    for (const row of existingRes.rows || []) {
      existingByTicker.set(row.ticker, {
        price: Number(row.price),
        asOf: row.as_of,
        prevClose: row.prev_close != null ? Number(row.prev_close) : null,
        prevCloseAsOf: row.prev_close_as_of || null,
      })
    }

    // Write prices to DB (delete-then-insert avoids ON CONFLICT constraint issues)
    // Roll prev_close when this is the first refresh of a new calendar day (UTC)
    for (const [ticker, q] of Object.entries(pricesMap)) {
      const existing = existingByTicker.get(ticker)
      let prevClose: number | null = null
      let prevCloseAsOf: string | null = null

      if (existing?.asOf) {
        const existingDate = new Date(existing.asOf).toISOString().slice(0, 10)
        if (existingDate < today) {
          // First refresh of a new day — yesterday's price becomes prev_close
          prevClose = existing.price
          prevCloseAsOf = existing.asOf
        } else {
          // Same-day refresh — carry forward existing prev_close
          prevClose = existing.prevClose
          prevCloseAsOf = existing.prevCloseAsOf
        }
      }

      await db.query(`DELETE FROM price_cache WHERE ticker = $1`, [ticker])
      await db.query(
        `INSERT INTO price_cache (ticker, price, currency, as_of, updated_at, prev_close, prev_close_as_of)
         VALUES ($1,$2,$3,$4,NOW(),$5,$6)`,
        [ticker, q.price, q.currency, q.asOf, prevClose, prevCloseAsOf]
      )
    }

    // FX rates (GBX = pence, not ISO — skip it)
    const ISO_ONLY = (c: string) => c && c !== 'GBX' && c.length === 3
    const neededCurrencies = new Set<string>()
    for (const h of holdings) {
      const c = h.currency?.toUpperCase()
      if (ISO_ONLY(c) && c !== base) neededCurrencies.add(c)
    }
    for (const q of Object.values(pricesMap)) {
      const c = q.currency?.toUpperCase()
      if (ISO_ONLY(c) && c !== base) neededCurrencies.add(c)
    }

    const fxRatesMap: Record<string, { rate: number; asOf: string }> = {}
    const fromCurrencies = new Set([...neededCurrencies, base])
    for (const from of fromCurrencies) {
      const toList = from === base
        ? [...neededCurrencies, 'INR'].filter((c) => c !== base)
        : [base]
      if (toList.length === 0) continue
      try {
        const rates = await frankfurterRates(from, toList)
        for (const [to, rate] of Object.entries(rates)) {
          if (Number.isFinite(rate) && rate > 0) fxRatesMap[`${from}_${to}`] = { rate, asOf }
        }
      } catch (e) {
        errors.push({ pair: `${from}_${base}`, error: e instanceof Error ? e.message : 'FX failed' })
      }
    }
    fxRatesMap[`${base}_${base}`] = { rate: 1, asOf }

    for (const [pair, { rate, asOf: pAsOf }] of Object.entries(fxRatesMap)) {
      const [fromCcy, toCcy] = pair.split('_')
      await db.query(`DELETE FROM fx_cache WHERE from_currency = $1 AND to_currency = $2`, [fromCcy, toCcy])
      await db.query(
        `INSERT INTO fx_cache (pair, from_currency, to_currency, rate, as_of, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())`,
        [pair, fromCcy, toCcy, rate, pAsOf]
      )
    }

    const source = t212Key ? 'trading212' : 'stooq'
    const lastRefresh = new Date().toISOString()
    return res.status(200).json({
      ok: true,
      source,
      lastRefresh,
      tickersRefreshed: Object.keys(pricesMap).length,
      fxPairs: Object.keys(fxRatesMap).length,
      errors,
      cache: { prices: pricesMap, fxRates: fxRatesMap, lastRefresh },
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}
