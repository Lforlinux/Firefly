import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const { prices = {}, fxRates = {} } = req.body || {}

  try {
    const db = await getDbClient()
    const asOf = new Date().toISOString()

    for (const [ticker, quote] of Object.entries(prices as Record<string, { price: number; currency: string; asOf?: string }>)) {
      if (!ticker || !Number.isFinite(quote?.price)) continue
      await db.query(
        `INSERT INTO price_cache (ticker, price, currency, as_of, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (ticker, currency) DO UPDATE
         SET price = EXCLUDED.price, as_of = EXCLUDED.as_of, updated_at = NOW()`,
        [ticker, quote.price, quote.currency || 'USD', quote.asOf || asOf]
      )
    }

    for (const [pair, fx] of Object.entries(fxRates as Record<string, { rate: number; asOf?: string }>)) {
      if (!pair || !Number.isFinite(fx?.rate)) continue
      await db.query(
        `INSERT INTO fx_cache (pair, rate, as_of, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (pair) DO UPDATE
         SET rate = EXCLUDED.rate, as_of = EXCLUDED.as_of, updated_at = NOW()`,
        [pair, fx.rate, fx.asOf || asOf]
      )
    }

    return res.status(200).json({ ok: true, stored: { prices: Object.keys(prices).length, fxRates: Object.keys(fxRates).length } })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}
