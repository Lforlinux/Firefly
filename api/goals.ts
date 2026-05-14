import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return getGoals(req, res)
  if (req.method === 'POST') return postGoals(req, res)
  if (req.method === 'PATCH') return patchGoal(req, res)
  if (req.method === 'DELETE') return deleteGoal(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getGoals(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const country = String(req.query.country || 'UK')

  try {
    const db = await getDbClient()
    const [goalsRes, fireRes] = await Promise.all([
      db.query(
        `SELECT id, title, target_amount AS "targetAmount", country, include_india AS "includeIndia", created_at
         FROM goals WHERE user_id = $1 AND country = $2
         ORDER BY created_at ASC`,
        [auth.userId, country]
      ),
      db.query(
        `SELECT monthly_expense, fire_multiple, monthly_contribution, annual_return_pct
         FROM fire_planner WHERE user_id = $1 AND country = $2`,
        [auth.userId, country]
      ),
    ])

    const goals = goalsRes.rows.map((g: any) => ({
      id: String(g.id),
      title: String(g.title),
      targetAmount: Number(g.targetAmount),
      country: String(g.country),
      includeIndia: Boolean(g.includeIndia),
    }))

    const fp = fireRes.rows[0]
    const firePlanner = fp
      ? {
          monthlyExpense: Number(fp.monthly_expense),
          fireMultiple: Number(fp.fire_multiple),
          monthlyContribution: Number(fp.monthly_contribution),
          annualReturnPct: Number(fp.annual_return_pct),
        }
      : null

    return res.status(200).json({ goals, firePlanner })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

async function postGoals(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const body = req.body || {}
  const country = String(body.country || 'UK')

  try {
    const db = await getDbClient()

    // Upsert fire planner settings
    if (body.type === 'fire') {
      await db.query(
        `INSERT INTO fire_planner (user_id, country, monthly_expense, fire_multiple, monthly_contribution, annual_return_pct, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, country) DO UPDATE
         SET monthly_expense = EXCLUDED.monthly_expense,
             fire_multiple = EXCLUDED.fire_multiple,
             monthly_contribution = EXCLUDED.monthly_contribution,
             annual_return_pct = EXCLUDED.annual_return_pct,
             updated_at = NOW()`,
        [
          auth.userId,
          country,
          Number(body.monthlyExpense || 2500),
          Number(body.fireMultiple || 30),
          Number(body.monthlyContribution || 1000),
          Number(body.annualReturnPct || 6),
        ]
      )
      return res.status(200).json({ ok: true })
    }

    // Add a new goal
    if (body.type === 'goal') {
      const title = String(body.title || '').trim()
      const targetAmount = Number(body.targetAmount || 0)
      if (!title || targetAmount <= 0) {
        return res.status(400).json({ error: 'title and targetAmount are required' })
      }
      const inserted = await db.query(
        `INSERT INTO goals (user_id, title, target_amount, country, include_india)
         VALUES ($1, $2, $3, $4, FALSE)
         RETURNING id, title, target_amount AS "targetAmount", country, include_india AS "includeIndia"`,
        [auth.userId, title, targetAmount, country]
      )
      const g = inserted.rows[0]
      return res.status(201).json({
        goal: {
          id: String(g.id),
          title: String(g.title),
          targetAmount: Number(g.targetAmount),
          country: String(g.country),
          includeIndia: Boolean(g.includeIndia),
        },
      })
    }

    // Bulk import (migration from localStorage)
    if (body.type === 'import' && Array.isArray(body.goals)) {
      for (const g of body.goals) {
        const title = String(g.title || '').trim()
        const targetAmount = Number(g.targetAmount || 0)
        if (!title || targetAmount <= 0) continue
        await db.query(
          `INSERT INTO goals (user_id, title, target_amount, country)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [auth.userId, title, targetAmount, country]
        )
      }
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'type must be goal | fire | import' })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

async function patchGoal(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const body = req.body || {}
  const id = String(body.id || '')
  if (!id) return res.status(400).json({ error: 'id is required' })

  try {
    const db = await getDbClient()

    // Toggle include_india
    if (typeof body.includeIndia === 'boolean') {
      await db.query(
        `UPDATE goals SET include_india = $1 WHERE id = $2 AND user_id = $3`,
        [body.includeIndia, id, auth.userId]
      )
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'No valid fields to update' })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

async function deleteGoal(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const body = req.body || {}
  const id = String(body.id || '')
  if (!id) return res.status(400).json({ error: 'id is required' })

  try {
    const db = await getDbClient()
    await db.query(
      `DELETE FROM goals WHERE id = $1 AND user_id = $2`,
      [id, auth.userId]
    )
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}
