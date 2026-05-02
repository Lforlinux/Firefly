import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../_lib/vercel-auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return getTransactions(req, res)
  } else if (req.method === 'POST') {
    return createTransaction(req, res)
  } else if (req.method === 'PUT') {
    return updateTransaction(req, res)
  } else if (req.method === 'DELETE') {
    return deleteTransaction(req, res)
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getTransactions(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    const db = await getDbClient()

    const transactions = await db.query(
      `SELECT t.id, t.holding_id, t.transaction_type, t.shares, t.price, t.currency, t.transaction_date, t.notes, t.created_at
       FROM transactions t
       JOIN holdings h ON t.holding_id = h.id
       WHERE h.user_id = $1
       ORDER BY t.transaction_date DESC`,
      [user.userId]
    )

    return res.status(200).json({ transactions: transactions.rows || [] })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error fetching transactions:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function createTransaction(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    const { holding_id, transaction_type, shares, price, currency, transaction_date, notes } = req.body

    if (!holding_id || !transaction_type || shares === undefined || price === undefined || !transaction_date) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const db = await getDbClient()

    // Verify holding belongs to user
    const holdingVerify = await db.query(
      'SELECT id FROM holdings WHERE id = $1 AND user_id = $2',
      [holding_id, user.userId]
    )
    if (!holdingVerify.rows || holdingVerify.rows.length === 0) {
      return res.status(404).json({ error: 'Holding not found' })
    }

    const result = await db.query(
      `INSERT INTO transactions (user_id, holding_id, transaction_type, shares, price, currency, transaction_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, holding_id, transaction_type, shares, price, currency, transaction_date, notes, created_at`,
      [user.userId, holding_id, transaction_type, shares, price, currency || 'GBP', transaction_date, notes || null]
    )

    const transaction = result.rows?.[0]
    return res.status(201).json({ transaction })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error creating transaction:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function updateTransaction(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    const { id, transaction_type, shares, price, currency, transaction_date, notes } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Transaction ID required' })
    }

    const db = await getDbClient()

    // Verify transaction belongs to user
    const verify = await db.query(
      `SELECT t.id FROM transactions t
       JOIN holdings h ON t.holding_id = h.id
       WHERE t.id = $1 AND h.user_id = $2`,
      [id, user.userId]
    )
    if (!verify.rows || verify.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' })
    }

    const result = await db.query(
      `UPDATE transactions
       SET transaction_type = COALESCE($2, transaction_type),
           shares = COALESCE($3, shares),
           price = COALESCE($4, price),
           currency = COALESCE($5, currency),
           transaction_date = COALESCE($6, transaction_date),
           notes = COALESCE($7, notes)
       WHERE id = $1
       RETURNING id, holding_id, transaction_type, shares, price, currency, transaction_date, notes, created_at`,
      [id, transaction_type, shares, price, currency, transaction_date, notes]
    )

    const transaction = result.rows?.[0]
    return res.status(200).json({ transaction })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error updating transaction:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function deleteTransaction(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuth(req)
    const { id } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Transaction ID required' })
    }

    const db = await getDbClient()

    // Verify transaction belongs to user
    const verify = await db.query(
      `SELECT t.id FROM transactions t
       JOIN holdings h ON t.holding_id = h.id
       WHERE t.id = $1 AND h.user_id = $2`,
      [id, user.userId]
    )
    if (!verify.rows || verify.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' })
    }

    await db.query(
      `DELETE FROM transactions t
       WHERE t.id = $1 AND EXISTS (
         SELECT 1 FROM holdings h
         WHERE h.id = t.holding_id AND h.user_id = $2
       )`,
      [id, user.userId]
    )
    return res.status(200).json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Error deleting transaction:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
