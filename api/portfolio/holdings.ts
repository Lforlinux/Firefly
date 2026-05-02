import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../../lib/vercel-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
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
