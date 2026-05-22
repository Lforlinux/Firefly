import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../../lib/vercel-auth.js'

type Range = '1M' | '3M' | '6M' | '1Y'
const YAHOO_RANGE: Record<Range, string> = { '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // ?ticker=ACWI.L&history=3M → price history sub-resource
    if (req.query.ticker && req.query.history) return getPriceHistory(req, res)
    return getHoldings(req, res)
  } else if (req.method === 'POST') {
    return createHolding(req, res)
  } else if (req.method === 'PUT') {
    return updateHolding(req, res)
  } else if (req.method === 'DELETE') {
    return deleteHolding(req, res)
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getHoldings(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const db = await getDbClient()

    const holdings = await db.query(
      'SELECT id, ticker, name, type, sector, shares, avg_cost, currency, notes, created_at, updated_at FROM holdings WHERE user_id = $1 ORDER BY created_at DESC',
      [user.userId]
    )

    return res.status(200).json({ holdings: holdings.rows || [] })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error fetching holdings:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function createHolding(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { ticker, name, type, sector, shares, avg_cost, currency, notes } = req.body

    if (!ticker || !name || !type || shares === undefined || avg_cost === undefined) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const db = await getDbClient()
    const result = await db.query(
      `INSERT INTO holdings (user_id, ticker, name, type, sector, shares, avg_cost, currency, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, ticker, name, type, sector, shares, avg_cost, currency, notes, created_at, updated_at`,
      [user.userId, ticker, name, type, sector || null, shares, avg_cost, currency || 'GBP', notes || null]
    )

    const holding = result.rows?.[0]
    return res.status(201).json({ holding })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error creating holding:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function updateHolding(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { id, ticker, name, type, sector, shares, avg_cost, currency, notes } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Holding ID required' })
    }

    const db = await getDbClient()

    // Verify holding belongs to user
    const verify = await db.query('SELECT id FROM holdings WHERE id = $1 AND user_id = $2', [id, user.userId])
    if (!verify.rows || verify.rows.length === 0) {
      return res.status(404).json({ error: 'Holding not found' })
    }

    const result = await db.query(
      `UPDATE holdings
       SET ticker = COALESCE($2, ticker),
           name = COALESCE($3, name),
           type = COALESCE($4, type),
           sector = COALESCE($5, sector),
           shares = COALESCE($6, shares),
           avg_cost = COALESCE($7, avg_cost),
           currency = COALESCE($8, currency),
           notes = COALESCE($9, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $10
       RETURNING id, ticker, name, type, sector, shares, avg_cost, currency, notes, created_at, updated_at`,
      [id, ticker, name, type, sector, shares, avg_cost, currency, notes, user.userId]
    )

    const holding = result.rows?.[0]
    return res.status(200).json({ holding })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error updating holding:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function deleteHolding(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { id } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Holding ID required' })
    }

    const db = await getDbClient()

    // Verify holding belongs to user
    const verify = await db.query('SELECT id FROM holdings WHERE id = $1 AND user_id = $2', [id, user.userId])
    if (!verify.rows || verify.rows.length === 0) {
      return res.status(404).json({ error: 'Holding not found' })
    }

    await db.query('DELETE FROM holdings WHERE id = $1 AND user_id = $2', [id, user.userId])
    return res.status(200).json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error deleting holding:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function getPriceHistory(req: VercelRequest, res: VercelResponse) {
  const user = requireAuth(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const ticker = String(req.query.ticker).trim()
  const rangeParam = String(req.query.history).toUpperCase() as Range
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
