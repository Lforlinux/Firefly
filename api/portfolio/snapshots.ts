import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../../lib/vercel-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return getSnapshots(req, res)
  } else if (req.method === 'POST') {
    return createSnapshot(req, res)
  } else if (req.method === 'PUT') {
    return updateSnapshot(req, res)
  } else if (req.method === 'DELETE') {
    return deleteSnapshot(req, res)
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getSnapshots(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const db = await getDbClient()

    const snapshots = await db.query(
      `SELECT id, snapshot_date, total_value, notes, created_at
       FROM snapshots
       WHERE user_id = $1
       ORDER BY snapshot_date DESC`,
      [user.userId]
    )

    return res.status(200).json({ snapshots: snapshots.rows || [] })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error fetching snapshots:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function createSnapshot(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { snapshot_date, total_value, notes } = req.body

    if (!snapshot_date) {
      return res.status(400).json({ error: 'snapshot_date is required' })
    }

    const db = await getDbClient()

    const result = await db.query(
      `INSERT INTO snapshots (user_id, snapshot_date, total_value, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, snapshot_date, total_value, notes, created_at`,
      [user.userId, snapshot_date, total_value || null, notes || null]
    )

    const snapshot = result.rows?.[0]
    return res.status(201).json({ snapshot })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    if (err instanceof Error && err.message.includes('unique constraint')) {
      return res.status(409).json({ error: 'Snapshot already exists for this date' })
    }
    console.error('Error creating snapshot:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function updateSnapshot(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { id, total_value, notes } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Snapshot ID required' })
    }

    const db = await getDbClient()

    // Verify snapshot belongs to user
    const verify = await db.query('SELECT id FROM snapshots WHERE id = $1 AND user_id = $2', [id, user.userId])
    if (!verify.rows || verify.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found' })
    }

    const result = await db.query(
      `UPDATE snapshots
       SET total_value = COALESCE($2, total_value),
           notes = COALESCE($3, notes)
       WHERE id = $1 AND user_id = $4
       RETURNING id, snapshot_date, total_value, notes, created_at`,
      [id, total_value, notes, user.userId]
    )

    const snapshot = result.rows?.[0]
    return res.status(200).json({ snapshot })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error updating snapshot:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function deleteSnapshot(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { id } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Snapshot ID required' })
    }

    const db = await getDbClient()

    // Verify snapshot belongs to user
    const verify = await db.query('SELECT id FROM snapshots WHERE id = $1 AND user_id = $2', [id, user.userId])
    if (!verify.rows || verify.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found' })
    }

    await db.query('DELETE FROM snapshots WHERE id = $1 AND user_id = $2', [id, user.userId])
    return res.status(200).json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error deleting snapshot:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
