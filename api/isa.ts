import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

function currentFY() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const d = now.getDate()
  const fyStartYear = (m > 4 || (m === 4 && d >= 6)) ? y : y - 1
  return {
    start: `${fyStartYear}-04-06`,
    end: `${fyStartYear + 1}-04-05`,
    label: `${fyStartYear}/${String(fyStartYear + 1).slice(2)}`,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const db = await getDbClient()
    const fy = currentFY()

    // T212 and AJBell cash deposits from isa_deposits table
    const depositsRes = await db.query(`
      SELECT owner, source, SUM(amount) AS total
      FROM isa_deposits
      WHERE user_id = $1 AND deposit_date >= $2 AND deposit_date <= $3
      GROUP BY owner, source
    `, [auth.userId, fy.start, fy.end])

    // InvestEngine ISA: sum buy cost from transactions within the FY
    const ieRes = await db.query(`
      SELECT
        CASE
          WHEN notes ILIKE '%Owner: KLN%' THEN 'KLN'
          WHEN notes ILIKE '%Owner: Priya%' THEN 'Priya'
          ELSE 'KLN'
        END AS owner,
        SUM(shares * price) AS total
      FROM transactions
      WHERE user_id = $1
        AND notes ILIKE '%InvestEngine ISA%'
        AND transaction_date >= $2
        AND transaction_date <= $3
        AND transaction_type = 'buy'
      GROUP BY owner
    `, [auth.userId, fy.start, fy.end])

    const byOwner: Record<string, Record<string, number>> = {}
    for (const row of depositsRes.rows || []) {
      const o = String(row.owner)
      if (!byOwner[o]) byOwner[o] = {}
      byOwner[o][String(row.source)] = Number(row.total)
    }
    for (const row of ieRes.rows || []) {
      const o = String(row.owner)
      if (!byOwner[o]) byOwner[o] = {}
      byOwner[o]['investengine'] = Number(row.total)
    }

    return res.status(200).json({ ok: true, fy, byOwner })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}
