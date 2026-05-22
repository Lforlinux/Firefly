import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../../lib/vercel-auth.js'

type Range = '1M' | '3M' | '6M' | '1Y'
const YAHOO_RANGE: Record<Range, string> = { '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const ticker = String(req.query.ticker || '').trim()
  const rangeParam = String(req.query.range || '3M').toUpperCase() as Range
  if (!ticker) return res.status(400).json({ error: 'ticker is required' })

  const yahooRange = YAHOO_RANGE[rangeParam] || '3mo'

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${yahooRange}`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return res.status(502).json({ error: `Yahoo Finance returned HTTP ${r.status} for ${ticker}` })

    const body = await r.json()
    const result = body?.chart?.result?.[0]
    if (!result) return res.status(502).json({ error: `No price data available for ${ticker}` })

    const timestamps: number[] = result.timestamp || []
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || []
    const rawCcy: string = result.meta?.currency || 'USD'
    const isGBp = rawCcy === 'GBp'
    const currency = isGBp ? 'GBP' : rawCcy

    const data = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        close: closes[i] != null ? (isGBp ? closes[i]! / 100 : closes[i]!) : null,
      }))
      .filter((d): d is { date: string; close: number } => d.close != null && d.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date))

    return res.status(200).json({ data, currency, ticker })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch price history' })
  }
}
