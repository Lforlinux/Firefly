import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

/**
 * Stooq (https://stooq.com) — free, no API key, no Vercel IP blocking.
 * Batch fetch: comma-separated symbols in ?s= param.
 * US stocks: ticker.us  (e.g. nvda.us)
 * UK stocks: ticker.uk  (e.g. vuag.uk)
 */
async function stooqPrices(tickers: string[]): Promise<Record<string, { price: number; currency: string }>> {
  if (tickers.length === 0) return {}
  // Map ticker → stooq symbol. Yahoo uses VUAG.L for LSE; Stooq uses VUAG.UK.
  const symbolMap: Record<string, string> = {}
  for (const t of tickers) {
    if (t.endsWith('.L')) {
      symbolMap[t] = t.replace(/\.L$/, '.UK').toLowerCase()
    } else {
      symbolMap[t] = `${t.toLowerCase()}.us`
    }
  }
  const stooqSymbols = Object.values(symbolMap).join(',')
  const url = `https://stooq.com/q/l/?s=${stooqSymbols}&f=s,c&h&e=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`)
  const body = await res.json()

  const reverseMap: Record<string, string> = {}
  for (const [orig, stooq] of Object.entries(symbolMap)) reverseMap[stooq.toUpperCase()] = orig

  const out: Record<string, { price: number; currency: string }> = {}
  for (const item of body?.symbols || []) {
    const stooqSym = String(item.symbol || '').toUpperCase()
    const orig = reverseMap[stooqSym] || stooqSym.replace(/\.(US|UK)$/, '')
    const price = parseFloat(item.close)
    if (!Number.isFinite(price) || price <= 0) continue
    const currency = stooqSym.endsWith('.UK') ? 'GBP' : 'USD'
    out[orig] = { price, currency }
  }
  return out
}

/**
 * Frankfurter (https://api.frankfurter.app) — free, no API key, CORS-friendly.
 * Returns rates relative to `from` currency.
 */
async function frankfurterRates(from: string, tos: string[]): Promise<Record<string, number>> {
  if (tos.length === 0) return {}
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${[...new Set(tos)].join(',')}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`)
  const body = await res.json()
  return body?.rates || {}
}

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

    // Fetch all stock prices in one request
    try {
      const quotes = await stooqPrices(tickers)
      for (const [ticker, q] of Object.entries(quotes)) {
        pricesMap[ticker] = { ...q, asOf }
      }
      for (const ticker of tickers.filter((t) => !pricesMap[t])) {
        errors.push({ ticker, error: 'No quote from Stooq' })
      }
    } catch (e) {
      errors.push({ error: `Stooq fetch failed: ${e instanceof Error ? e.message : 'unknown'}` } as any)
    }

    // Write prices: delete-then-insert avoids any ON CONFLICT constraint issues
    for (const [ticker, q] of Object.entries(pricesMap)) {
      await db.query(`DELETE FROM price_cache WHERE ticker = $1`, [ticker])
      await db.query(
        `INSERT INTO price_cache (ticker, price, currency, as_of, updated_at) VALUES ($1,$2,$3,$4,NOW())`,
        [ticker, q.price, q.currency, q.asOf]
      )
    }

    // Determine needed FX conversions
    const neededCurrencies = new Set<string>()
    for (const h of holdings) {
      const c = h.currency?.toUpperCase()
      if (c && c !== base) neededCurrencies.add(c)
    }
    for (const q of Object.values(pricesMap)) {
      const c = q.currency?.toUpperCase()
      if (c && c !== base) neededCurrencies.add(c)
    }

    const fxRatesMap: Record<string, { rate: number; asOf: string }> = {}

    // Fetch FX: group by "from" currency to minimise requests
    const fromCurrencies = new Set([...neededCurrencies, base === 'GBP' ? 'GBP' : base])
    for (const from of fromCurrencies) {
      const toList = from === base
        ? [...neededCurrencies, 'INR'].filter((c) => c !== base)
        : [base]
      if (toList.length === 0) continue
      try {
        const rates = await frankfurterRates(from, toList)
        for (const [to, rate] of Object.entries(rates)) {
          if (Number.isFinite(rate) && rate > 0) {
            fxRatesMap[`${from}_${to}`] = { rate, asOf }
          }
        }
      } catch (e) {
        errors.push({ pair: `${from}_${base}`, error: e instanceof Error ? e.message : 'FX failed' })
      }
    }

    // Self-pair always 1
    fxRatesMap[`${base}_${base}`] = { rate: 1, asOf }

    // Write FX rates: delete-then-insert (include from/to columns required by schema)
    for (const [pair, { rate, asOf: pAsOf }] of Object.entries(fxRatesMap)) {
      const [fromCcy, toCcy] = pair.split('_')
      await db.query(`DELETE FROM fx_cache WHERE pair = $1`, [pair])
      await db.query(
        `INSERT INTO fx_cache (pair, from_currency, to_currency, rate, as_of, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())`,
        [pair, fromCcy, toCcy, rate, pAsOf]
      )
    }

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
