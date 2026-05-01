import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return getSettings(req, res)
  } else if (req.method === 'PUT') {
    return updateSettings(req, res)
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getSettings(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    const db = await getDbClient()

    const result = await db.query(
      `SELECT id, base_currency, theme, last_updated, created_at
       FROM settings
       WHERE user_id = $1`,
      [user.userId]
    )

    const settings = result.rows?.[0]
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' })
    }

    return res.status(200).json({ settings })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error fetching settings:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function updateSettings(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    const { base_currency, theme } = req.body

    const db = await getDbClient()

    // Verify settings exist for user
    const verify = await db.query('SELECT id FROM settings WHERE user_id = $1', [user.userId])
    if (!verify.rows || verify.rows.length === 0) {
      return res.status(404).json({ error: 'Settings not found' })
    }

    const result = await db.query(
      `UPDATE settings
       SET base_currency = COALESCE($2, base_currency),
           theme = COALESCE($3, theme),
           last_updated = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING id, base_currency, theme, last_updated, created_at`,
      [user.userId, base_currency, theme]
    )

    const settings = result.rows?.[0]
    return res.status(200).json({ settings })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error updating settings:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
