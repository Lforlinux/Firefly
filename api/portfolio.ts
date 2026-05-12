import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return getPortfolio(req, res)
  if (req.method === 'POST') return savePortfolio(req, res)
  if (req.method === 'DELETE') return flushHoldings(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getPortfolio(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const db = await getDbClient()
    // UK financial year boundaries
    const now = new Date()
    const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate()
    const fyStartYear = (m > 4 || (m === 4 && d >= 6)) ? y : y - 1
    const fyStart = `${fyStartYear}-04-06`
    const fyEnd = `${fyStartYear + 1}-04-05`
    const fyLabel = `${fyStartYear}/${String(fyStartYear + 1).slice(2)}`

    const [holdings, snapshots, transactions, settingsRow, prices, fxRates, isaDeposits, isaIe, movementsRes] = await Promise.all([
      db.query(
        `SELECT id, ticker, name, type, sector, shares, avg_cost, currency, notes, created_at, updated_at
         FROM holdings WHERE user_id = $1 ORDER BY created_at DESC`,
        [auth.userId]
      ),
      db.query(
        `SELECT id, snapshot_date AS date, total_value AS "valueGBP", notes, created_at
         FROM snapshots WHERE user_id = $1 ORDER BY snapshot_date`,
        [auth.userId]
      ),
      db.query(
        `SELECT t.id, t.holding_id, h.ticker, t.transaction_type, t.shares, t.price, t.currency, t.transaction_date,
                -- Fall back to holding notes for owner attribution when the transaction has no owner tag
                CASE WHEN t.notes ILIKE '%Owner:%' THEN t.notes
                     ELSE COALESCE(h.notes, t.notes) END AS notes,
                t.created_at
         FROM transactions t
         LEFT JOIN holdings h ON h.id = t.holding_id
         WHERE t.user_id = $1
         ORDER BY t.transaction_date DESC`,
        [auth.userId]
      ),
      db.query(
        `SELECT base_currency, theme, last_updated, created_at
         FROM settings WHERE user_id = $1 LIMIT 1`,
        [auth.userId]
      ),
      db.query(`SELECT ticker, price, currency, as_of, prev_close, prev_close_as_of FROM price_cache`),
      db.query(`SELECT pair, rate, as_of FROM fx_cache`),
      db.query(
        `SELECT owner, source, SUM(amount) AS total FROM isa_deposits
         WHERE user_id = $1 AND deposit_date >= $2 AND deposit_date <= $3
         GROUP BY owner, source`,
        [auth.userId, fyStart, fyEnd]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT
           CASE WHEN notes ILIKE '%Owner: KLN%' THEN 'KLN'
                WHEN notes ILIKE '%Owner: Priya%' THEN 'Priya'
                ELSE 'KLN' END AS owner,
           SUM(shares * price) AS total
         FROM transactions
         WHERE user_id = $1
           AND notes ILIKE '%InvestEngine ISA%'
           AND transaction_date >= $2 AND transaction_date <= $3
           AND transaction_type = 'buy'
         GROUP BY owner`,
        [auth.userId, fyStart, fyEnd]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT movement_date AS date, owner, movement_gbp, portfolio_value_gbp
         FROM daily_movements
         WHERE user_id = $1
         ORDER BY movement_date DESC
         LIMIT 90`,
        [auth.userId]
      ).catch(() => ({ rows: [] })),
    ])

    const pricesMap: Record<string, { price: number; currency: string; asOf: string; prevClose?: number; prevCloseAsOf?: string }> = {}
    for (const p of prices.rows || []) {
      pricesMap[p.ticker] = {
        price: Number(p.price),
        currency: String(p.currency || ''),
        asOf: new Date(p.as_of).toISOString(),
        ...(p.prev_close != null && { prevClose: Number(p.prev_close) }),
        ...(p.prev_close_as_of && { prevCloseAsOf: new Date(p.prev_close_as_of).toISOString() }),
      }
    }
    const fxMap: Record<string, { rate: number; asOf: string }> = {}
    for (const f of fxRates.rows || []) {
      fxMap[f.pair] = {
        rate: Number(f.rate),
        asOf: new Date(f.as_of).toISOString(),
      }
    }
    const refreshTimes = [
      ...(prices.rows || []).map((p: any) => new Date(p.as_of).getTime()),
      ...(fxRates.rows || []).map((f: any) => new Date(f.as_of).getTime()),
    ].filter((t) => Number.isFinite(t))
    const lastRefresh = refreshTimes.length ? new Date(Math.max(...refreshTimes)).toISOString() : null

    const settings = settingsRow.rows?.[0]
      ? {
          baseCurrency: settingsRow.rows[0].base_currency || 'GBP',
          theme: settingsRow.rows[0].theme || 'dark',
          lastUpdated: settingsRow.rows[0].last_updated
            ? new Date(settingsRow.rows[0].last_updated).toISOString()
            : new Date().toISOString(),
        }
      : { baseCurrency: 'GBP', theme: 'dark', lastUpdated: new Date().toISOString() }

    const normalizedHoldings = (holdings.rows || []).map((h: any) => ({
      id: String(h.id),
      ticker: String(h.ticker || ''),
      name: String(h.name || ''),
      type: String(h.type || 'stock'),
      sector: h.sector == null ? '' : String(h.sector),
      shares: Number(h.shares || 0),
      avgCost: Number(h.avg_cost || 0),
      currency: String(h.currency || 'GBP'),
      notes: h.notes == null ? '' : String(h.notes),
    }))

    const normalizedSnapshots = (snapshots.rows || []).map((s: any) => ({
      date: new Date(s.date).toISOString().slice(0, 10),
      valueGBP: Number(s.valueGBP || 0),
      ...(s.notes ? { notes: String(s.notes) } : {}),
    }))

    const normalizedTransactions = (transactions.rows || []).map((t: any) => ({
      id: String(t.id),
      date: new Date(t.transaction_date).toISOString().slice(0, 10),
      ticker: String(t.ticker || ''),
      side: String(t.transaction_type || 'buy'),
      shares: Number(t.shares || 0),
      price: Number(t.price || 0),
      currency: String(t.currency || 'GBP'),
      notes: t.notes == null ? '' : String(t.notes),
    }))

    const normalizedMovements = (movementsRes.rows || []).map((m: any) => ({
      date: new Date(m.date).toISOString().slice(0, 10),
      owner: String(m.owner || 'all'),
      movementGBP: Number(m.movement_gbp || 0),
      portfolioValueGBP: m.portfolio_value_gbp != null ? Number(m.portfolio_value_gbp) : null,
    }))

    const isaByOwner: Record<string, Record<string, number>> = {}
    for (const row of (isaDeposits.rows || [])) {
      const o = String(row.owner)
      if (!isaByOwner[o]) isaByOwner[o] = {}
      isaByOwner[o][String(row.source)] = Number(row.total)
    }
    for (const row of (isaIe.rows || [])) {
      const o = String(row.owner)
      if (!isaByOwner[o]) isaByOwner[o] = {}
      isaByOwner[o]['investengine'] = Number(row.total)
    }

    return res.status(200).json({
      holdings: normalizedHoldings,
      snapshots: normalizedSnapshots,
      transactions: normalizedTransactions,
      settings,
      prices: pricesMap,
      fxRates: fxMap,
      lastRefresh,
      isa: { fy: { start: fyStart, end: fyEnd, label: fyLabel }, byOwner: isaByOwner },
      dailyMovements: normalizedMovements,
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

async function savePortfolio(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const body = req.body || {}
  if (!Array.isArray(body.holdings)) {
    return res.status(400).json({ error: 'Body must include holdings[]' })
  }

  try {
    const db = await getDbClient()

    await db.query(`DELETE FROM transactions WHERE user_id = $1`, [auth.userId])
    if (Array.isArray(body.snapshots)) {
      await db.query(`DELETE FROM snapshots WHERE user_id = $1`, [auth.userId])
    }
    if (body.holdings.length > 0 || body.clearHoldings === true) {
      await db.query(`DELETE FROM holdings WHERE user_id = $1`, [auth.userId])
    }

    const holdingIdMap: Record<string, string> = {}
    for (const h of body.holdings) {
      const inserted = await db.query(
        `INSERT INTO holdings (user_id, ticker, name, type, sector, shares, avg_cost, currency, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          auth.userId,
          h.ticker || 'UNKNOWN',
          h.name || 'Unnamed',
          h.type || 'stock',
          h.sector || null,
          Number(h.shares || 0),
          Number(h.avg_cost ?? h.avgCost ?? 0),
          h.currency || 'GBP',
          h.notes || null,
        ]
      )
      if (h.id) holdingIdMap[h.id] = inserted.rows[0].id
    }

    if (Array.isArray(body.transactions)) {
      for (const t of body.transactions) {
        const newHoldingId = holdingIdMap[t.holdingId || t.holding_id] || null
        if (!newHoldingId) continue
        await db.query(
          `INSERT INTO transactions (user_id, holding_id, transaction_type, shares, price, currency, transaction_date, notes, source_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [
            auth.userId,
            newHoldingId,
            t.side || t.transaction_type || 'buy',
            Number(t.shares || 0),
            Number(t.price || 0),
            t.currency || 'GBP',
            t.date || t.transaction_date || new Date().toISOString().slice(0, 10),
            t.notes || null,
            t.id || null,
          ]
        )
      }
    }

    if (Array.isArray(body.snapshots)) {
      for (const s of body.snapshots) {
        await db.query(
          `INSERT INTO snapshots (user_id, snapshot_date, total_value, notes)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, snapshot_date) DO UPDATE SET total_value = EXCLUDED.total_value, notes = EXCLUDED.notes`,
          [auth.userId, s.date, Number(s.valueGBP || 0), s.notes || null]
        )
      }
    }

    if (body.settings) {
      await db.query(
        `INSERT INTO settings (user_id, base_currency, theme, last_updated)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET base_currency = EXCLUDED.base_currency,
             theme = EXCLUDED.theme,
             last_updated = NOW()`,
        [auth.userId, body.settings.baseCurrency || 'GBP', body.settings.theme || 'dark']
      )
    }

    return res.status(200).json({
      ok: true,
      settings: {
        baseCurrency: body.settings?.baseCurrency || 'GBP',
        theme: body.settings?.theme || 'dark',
        lastUpdated: new Date().toISOString(),
      },
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

async function flushHoldings(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const body = req.body || {}
  const sources: string[] = Array.isArray(body.sources) ? body.sources : []
  if (sources.length === 0) {
    return res.status(400).json({ error: 'sources[] is required' })
  }

  try {
    const db = await getDbClient()
    let holdingsDeleted = 0
    let snapshotsDeleted = 0

    for (const source of sources) {
      if (source === 'all') {
        const result = await db.query(`DELETE FROM holdings WHERE user_id = $1`, [auth.userId])
        holdingsDeleted += result.rowCount ?? 0
      } else if (source === 'trading212') {
        const result = await db.query(
          `DELETE FROM holdings WHERE user_id = $1 AND LOWER(COALESCE(notes,'')) LIKE '%trading212%'`,
          [auth.userId]
        )
        holdingsDeleted += result.rowCount ?? 0
      } else if (source === 'investengine') {
        const result = await db.query(
          `DELETE FROM holdings WHERE user_id = $1 AND LOWER(COALESCE(notes,'')) LIKE '%investengine%'`,
          [auth.userId]
        )
        holdingsDeleted += result.rowCount ?? 0
      }
    }

    if (sources.includes('all')) {
      const result = await db.query(`DELETE FROM snapshots WHERE user_id = $1`, [auth.userId])
      snapshotsDeleted += result.rowCount ?? 0
    }

    return res.status(200).json({
      ok: true,
      deleted: { holdings: holdingsDeleted, snapshots: snapshotsDeleted },
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}
