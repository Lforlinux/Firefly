import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

// Use query2 + v7 batch endpoint — one request for all tickers, avoids per-ticker timeouts.
const YAHOO_BATCH = 'https://query2.finance.yahoo.com/v7/finance/quote'
const YAHOO_CHART = 'https://query2.finance.yahoo.com/v8/finance/chart'
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
}

type Quote = { price: number; currency: string; asOf: string }

function normalizePrice(price: number, currency: string): { price: number; currency: string } {
  if (currency === 'GBp') return { price: price / 100, currency: 'GBP' }
  return { price, currency }
}

async function yahooBatch(symbols: string[]): Promise<Record<string, Quote>> {
  if (symbols.length === 0) return {}
  const url = `${YAHOO_BATCH}?symbols=${symbols.map(encodeURIComponent).join(',')}&fields=regularMarketPrice,currency`
  const res = await fetch(url, { headers: YAHOO_HEADERS })
  if (!res.ok) throw new Error(`Yahoo batch HTTP ${res.status}`)
  const body = await res.json()
  const results: Record<string, Quote> = {}
  const asOf = new Date().toISOString()
  for (const item of body?.quoteResponse?.result || []) {
    const raw = item?.regularMarketPrice
    const ccy = item?.currency || ''
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    const { price, currency } = normalizePrice(raw, ccy)
    results[item.symbol] = { price, currency, asOf }
  }
  return results
}

async function yahooSingle(symbol: string): Promise<Quote> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=1d`
  const res = await fetch(url, { headers: YAHOO_HEADERS })
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`)
  const body = await res.json()
  const meta = body?.chart?.result?.[0]?.meta
  const raw = meta?.regularMarketPrice
  const ccy = meta?.currency || ''
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`Yahoo ${symbol}: no quote`)
  const { price, currency } = normalizePrice(raw, ccy)
  return { price, currency, asOf: new Date().toISOString() }
}

function fxPair(from: string, to: string) {
  return `${from.toUpperCase()}_${to.toUpperCase()}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const db = await getDbClient()
    const settingsRes = await db.query(`SELECT base_currency FROM settings WHERE user_id = $1 LIMIT 1`, [auth.userId])
    const base = String(settingsRes.rows?.[0]?.base_currency || 'GBP').toUpperCase()

    const holdingsRes = await db.query(
      `SELECT ticker, type, currency FROM holdings WHERE user_id = $1`,
      [auth.userId]
    )
    const holdings = holdingsRes.rows || []

    const tickers = [...new Set(
      holdings
        .filter((h: any) => h.type !== 'cash' && h.ticker && !String(h.ticker).startsWith('CASH:'))
        .map((h: any) => String(h.ticker))
    )]

    const errors: Array<{ ticker?: string; pair?: string; error: string }> = []
    const pricesMap: Record<string, Quote> = {}

    // Single batch request for all tickers
    try {
      const batch = await yahooBatch(tickers)
      for (const [sym, q] of Object.entries(batch)) {
        pricesMap[sym] = q
      }
      // Fall back to individual requests for any tickers missing from batch
      const missing = tickers.filter((t) => !pricesMap[t])
      for (const ticker of missing) {
        try {
          pricesMap[ticker] = await yahooSingle(ticker)
        } catch (e) {
          errors.push({ ticker, error: e instanceof Error ? e.message : 'Quote failed' })
        }
      }
    } catch (e) {
      errors.push({ error: `Batch fetch failed: ${e instanceof Error ? e.message : 'unknown'}` } as any)
      // Fall back to individual requests
      for (const ticker of tickers) {
        try {
          pricesMap[ticker] = await yahooSingle(ticker)
        } catch (e2) {
          errors.push({ ticker, error: e2 instanceof Error ? e2.message : 'Quote failed' })
        }
      }
    }

    // Upsert prices into DB
    for (const [ticker, q] of Object.entries(pricesMap)) {
      await db.query(
        `INSERT INTO price_cache (ticker, price, currency, as_of, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (ticker, currency) DO UPDATE
         SET price = EXCLUDED.price, as_of = EXCLUDED.as_of, updated_at = NOW()`,
        [ticker, q.price, q.currency, q.asOf]
      )
    }

    // Determine needed FX pairs
    const neededCurrencies = new Set<string>()
    for (const h of holdings) {
      const c = String(h.currency || '').toUpperCase()
      if (c && c !== base) neededCurrencies.add(c)
    }
    for (const q of Object.values(pricesMap)) {
      const c = String(q.currency || '').toUpperCase()
      if (c && c !== base) neededCurrencies.add(c)
    }
    if (base === 'GBP') neededCurrencies.add('INR')

    // Build FX symbols list and batch-fetch
    const fxSymbols = [...neededCurrencies].map((c) => `${c}${base}=X`)
    fxSymbols.push(`GBP${base === 'GBP' ? 'INR' : base}=X`)
    const fxRatesMap: Record<string, { rate: number; asOf: string }> = {}

    try {
      const fxBatch = await yahooBatch([...new Set(fxSymbols)])
      const asOf = new Date().toISOString()
      for (const ccy of neededCurrencies) {
        const sym = `${ccy}${base}=X`
        const q = fxBatch[sym]
        if (q && Number.isFinite(q.price)) {
          fxRatesMap[fxPair(ccy, base)] = { rate: q.price, asOf }
        } else {
          errors.push({ pair: fxPair(ccy, base), error: `No rate in batch for ${sym}` })
        }
      }
      // GBP_INR
      const gbpInrSym = 'GBPINR=X'
      const gbpInrQ = fxBatch[gbpInrSym]
      if (gbpInrQ && Number.isFinite(gbpInrQ.price)) {
        fxRatesMap['GBP_INR'] = { rate: gbpInrQ.price, asOf }
      }
    } catch (e) {
      errors.push({ error: `FX batch failed: ${e instanceof Error ? e.message : 'unknown'}` } as any)
      // Fall back to individual FX requests
      for (const ccy of neededCurrencies) {
        try {
          const q = await yahooSingle(`${ccy}${base}=X`)
          fxRatesMap[fxPair(ccy, base)] = { rate: q.price, asOf: q.asOf }
        } catch (e2) {
          errors.push({ pair: fxPair(ccy, base), error: e2 instanceof Error ? e2.message : 'FX failed' })
        }
      }
      try {
        const q = await yahooSingle('GBPINR=X')
        fxRatesMap['GBP_INR'] = { rate: q.price, asOf: q.asOf }
      } catch (e2) {
        errors.push({ pair: 'GBP_INR', error: e2 instanceof Error ? e2.message : 'FX failed' })
      }
    }

    // Upsert FX rates into DB
    for (const [pair, { rate, asOf }] of Object.entries(fxRatesMap)) {
      await db.query(
        `INSERT INTO fx_cache (pair, rate, as_of, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (pair) DO UPDATE
         SET rate = EXCLUDED.rate, as_of = EXCLUDED.as_of, updated_at = NOW()`,
        [pair, rate, asOf]
      )
    }

    // Always store self-pair
    const selfPair = `${base}_${base}`
    const selfAsOf = new Date().toISOString()
    fxRatesMap[selfPair] = { rate: 1, asOf: selfAsOf }
    await db.query(
      `INSERT INTO fx_cache (pair, rate, as_of, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (pair) DO UPDATE SET rate = EXCLUDED.rate, as_of = EXCLUDED.as_of, updated_at = NOW()`,
      [selfPair, 1, selfAsOf]
    )

    const lastRefresh = new Date().toISOString()
    return res.status(200).json({
      ok: true,
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
