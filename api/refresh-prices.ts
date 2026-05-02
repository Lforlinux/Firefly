import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth'

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Firefly/1.0)' }

type Quote = { price: number; currency: string; asOf: string }

function normalizeQuote(meta: any): Quote | null {
  let price = meta?.regularMarketPrice
  let currency = meta?.currency || ''
  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  if (currency === 'GBp') {
    price = price / 100
    currency = 'GBP'
  }
  return { price, currency, asOf: new Date().toISOString() }
}

async function yahooQuote(ticker: string): Promise<Quote> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=1d`
  const res = await fetch(url, { headers: YAHOO_HEADERS })
  if (!res.ok) throw new Error(`yahoo ${ticker}: HTTP ${res.status}`)
  const body = await res.json()
  const meta = body?.chart?.result?.[0]?.meta
  const q = normalizeQuote(meta)
  if (!q) throw new Error(`yahoo ${ticker}: no quote`)
  return q
}

function fxPair(from: string, to: string) {
  return `${from.toUpperCase()}_${to.toUpperCase()}`
}

async function yahooFx(from: string, to: string): Promise<{ pair: string; rate: number; asOf: string }> {
  const f = from.toUpperCase()
  const t = to.toUpperCase()
  if (f === t) return { pair: fxPair(f, t), rate: 1, asOf: new Date().toISOString() }
  const q = await yahooQuote(`${f}${t}=X`)
  return { pair: fxPair(f, t), rate: q.price, asOf: q.asOf }
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
    const pricesMap: Record<string, { price: number; currency: string; asOf: string }> = {}
    for (const ticker of tickers) {
      try {
        const q = await yahooQuote(ticker)
        pricesMap[ticker] = { price: q.price, currency: q.currency, asOf: q.asOf }
        await db.query(
          `INSERT INTO price_cache (ticker, price, currency, as_of, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (ticker) DO UPDATE
           SET price = EXCLUDED.price, currency = EXCLUDED.currency, as_of = EXCLUDED.as_of, updated_at = NOW()`,
          [ticker, q.price, q.currency, q.asOf]
        )
      } catch (e) {
        errors.push({ ticker, error: e instanceof Error ? e.message : 'Quote failed' })
      }
      await new Promise((r) => setTimeout(r, 100))
    }

    const neededCurrencies = new Set<string>()
    for (const h of holdings) {
      const c = String(h.currency || '').toUpperCase()
      if (c && c !== base) neededCurrencies.add(c)
    }
    for (const p of Object.values(pricesMap)) {
      const c = String(p.currency || '').toUpperCase()
      if (c && c !== base) neededCurrencies.add(c)
    }
    // Keep GBP<->INR available for dashboard conversion card regardless of holdings mix.
    if (base === 'GBP') neededCurrencies.add('INR')

    const fxRatesMap: Record<string, { rate: number; asOf: string }> = {}
    for (const ccy of neededCurrencies) {
      try {
        const fx = await yahooFx(ccy, base)
        fxRatesMap[fx.pair] = { rate: fx.rate, asOf: fx.asOf }
        await db.query(
          `INSERT INTO fx_cache (pair, rate, as_of, updated_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT (pair) DO UPDATE
           SET rate = EXCLUDED.rate, as_of = EXCLUDED.as_of, updated_at = NOW()`,
          [fx.pair, fx.rate, fx.asOf]
        )
      } catch (e) {
        errors.push({ pair: `${ccy}_${base}`, error: e instanceof Error ? e.message : 'FX failed' })
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    // Ensure direct GBP_INR also exists for display consumers.
    try {
      const gbpInr = await yahooFx('GBP', 'INR')
      fxRatesMap[gbpInr.pair] = { rate: gbpInr.rate, asOf: gbpInr.asOf }
      await db.query(
        `INSERT INTO fx_cache (pair, rate, as_of, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (pair) DO UPDATE
         SET rate = EXCLUDED.rate, as_of = EXCLUDED.as_of, updated_at = NOW()`,
        [gbpInr.pair, gbpInr.rate, gbpInr.asOf]
      )
    } catch (e) {
      errors.push({ pair: 'GBP_INR', error: e instanceof Error ? e.message : 'FX failed' })
    }
    const selfPair = `${base}_${base}`
    fxRatesMap[selfPair] = { rate: 1, asOf: new Date().toISOString() }
    await db.query(
      `INSERT INTO fx_cache (pair, rate, as_of, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (pair) DO UPDATE SET rate = EXCLUDED.rate, as_of = EXCLUDED.as_of, updated_at = NOW()`,
      [selfPair, 1, fxRatesMap[selfPair].asOf]
    )

    const lastRefresh = new Date().toISOString()
    return res.status(200).json({
      ok: true,
      lastRefresh,
      tickersRefreshed: tickers.length - errors.filter((e) => e.ticker).length,
      fxPairs: neededCurrencies.size - errors.filter((e) => e.pair).length,
      errors,
      cache: {
        prices: pricesMap,
        fxRates: fxRatesMap,
        lastRefresh,
      },
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

