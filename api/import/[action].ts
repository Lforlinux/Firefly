/**
 * Single Serverless Function for Hobby plan limits:
 * /api/import/commit and /api/import/trading212 via dynamic segment `action`.
 */
import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../../lib/vercel-auth.js'

type ImportedTransaction = {
  date: string
  type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal'
  ticker?: string
  isin?: string
  name?: string
  quantity?: number
  price?: number
  priceCurrency?: string
  total: number
  totalCurrency: string
  notes?: string
  holdingType?: 'stock' | 'etf' | 'cash'
  sourceId?: string
}

function inferHoldingType(tx: ImportedTransaction): 'stock' | 'etf' | 'cash' {
  if (tx.holdingType === 'stock' || tx.holdingType === 'etf' || tx.holdingType === 'cash') return tx.holdingType
  if (tx.type === 'deposit' || tx.type === 'withdrawal') return 'cash'
  return 'etf'
}

function buildStableSourceId(source: string, tx: ImportedTransaction, ticker: string, qty: number, price: number, currency: string): string {
  if (tx.sourceId && tx.sourceId.trim()) return tx.sourceId.trim()
  return [
    source,
    tx.type,
    tx.date,
    ticker,
    qty.toFixed(8),
    price.toFixed(8),
    currency,
    (tx.notes || '').trim().toLowerCase(),
  ].join('|')
}

async function handleCommit(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { source, transactions } = req.body || {}
    if (!source || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'source and transactions[] are required' })
    }

    const db = await getDbClient()
    const errors: string[] = []
    let imported = 0
    let skipped = 0

    await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_id TEXT`)
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_source_id_unique ON transactions(user_id, source_id) WHERE source_id IS NOT NULL`)

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i] as ImportedTransaction
      try {
        if (!tx?.date || !tx?.type) {
          errors.push(`Row ${i}: Missing date/type`)
          continue
        }

        const ticker = String(tx.ticker || tx.isin || '').trim().toUpperCase()
        if (!ticker) {
          errors.push(`Row ${i}: Missing ticker/isin`)
          continue
        }

        const shares = Number(tx.quantity ?? 0)
        const price = Number(tx.price ?? 0)
        const currency = String(tx.priceCurrency || tx.totalCurrency || 'GBP').toUpperCase()
        const txType = tx.type
        const normalizedTxType = txType === 'buy' || txType === 'sell' ? txType : 'buy'
        const qtyForTx = Number.isFinite(shares) && shares > 0 ? shares : 1
        const priceForTx = Number.isFinite(price) && price > 0 ? price : Number(tx.total || 0)
        if (!Number.isFinite(priceForTx) || priceForTx <= 0) {
          errors.push(`Row ${i}: Invalid price/total`)
          continue
        }
        const sourceId = buildStableSourceId(source, tx, ticker, qtyForTx, priceForTx, currency)
        // Snapshot rows (e.g. t212-pos-NVDA-1) represent current state, not a transaction to accumulate.
        const isSnapshot = sourceId.startsWith('t212-pos-')

        const existing = await db.query(
          `SELECT id FROM holdings WHERE user_id = $1 AND ticker = $2 LIMIT 1`,
          [auth.userId, ticker]
        )
        let holdingId = existing.rows?.[0]?.id

        // For snapshots: upsert the holding with exact shares/cost, then skip if already recorded.
        if (isSnapshot) {
          if (!holdingId) {
            const inserted = await db.query(
              `INSERT INTO holdings (user_id, ticker, name, type, sector, shares, avg_cost, currency, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [auth.userId, ticker, tx.name || ticker, inferHoldingType(tx), null, qtyForTx, priceForTx, currency, tx.notes || `Imported from ${source}`]
            )
            holdingId = inserted.rows?.[0]?.id
          } else {
            // Always overwrite with latest snapshot values
            await db.query(
              `UPDATE holdings SET shares = $3, avg_cost = $4, name = $5, currency = $6, updated_at = NOW()
               WHERE user_id = $1 AND id = $2`,
              [auth.userId, holdingId, qtyForTx, priceForTx, tx.name || ticker, currency]
            )
            // Remove stale snapshot transactions for this holding so re-import is idempotent
            await db.query(
              `DELETE FROM transactions WHERE user_id = $1 AND holding_id = $2 AND source_id LIKE 't212-pos-%'`,
              [auth.userId, holdingId]
            )
          }
        } else {
          // Regular transaction: check dedup by source_id first
          const existingBySource = await db.query(
            `SELECT id FROM transactions WHERE user_id = $1 AND source_id = $2 LIMIT 1`,
            [auth.userId, sourceId]
          )
          if (existingBySource.rows?.[0]?.id) { skipped++; continue }

          // Fallback fingerprint dedup (catches imports without stable source_ids)
          if (holdingId) {
            const existingByFingerprint = await db.query(
              `SELECT id FROM transactions
               WHERE user_id = $1 AND holding_id = $2 AND transaction_type = $3
                 AND transaction_date = $4::date AND currency = $5
                 AND ABS(shares - $6) < 1e-8 AND ABS(price - $7) < 1e-8
               LIMIT 1`,
              [auth.userId, holdingId, txType, tx.date, currency, qtyForTx, priceForTx]
            )
            if (existingByFingerprint.rows?.[0]?.id) { skipped++; continue }
          }

          if (!holdingId) {
            const inserted = await db.query(
              `INSERT INTO holdings (user_id, ticker, name, type, sector, shares, avg_cost, currency, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [auth.userId, ticker, tx.name || ticker, inferHoldingType(tx), null,
               normalizedTxType === 'buy' ? qtyForTx : 0, priceForTx, currency, tx.notes || `Imported from ${source}`]
            )
            holdingId = inserted.rows?.[0]?.id
          } else if (normalizedTxType === 'buy') {
            await db.query(
              `UPDATE holdings SET shares = shares + $3,
                 avg_cost = CASE WHEN avg_cost = 0 THEN $4 ELSE avg_cost END, updated_at = NOW()
               WHERE user_id = $1 AND id = $2`,
              [auth.userId, holdingId, qtyForTx, priceForTx]
            )
          } else if (normalizedTxType === 'sell') {
            await db.query(
              `UPDATE holdings SET shares = GREATEST(shares - $3, 0), updated_at = NOW()
               WHERE user_id = $1 AND id = $2`,
              [auth.userId, holdingId, qtyForTx]
            )
          }
        }

        await db.query(
          `INSERT INTO transactions (user_id, holding_id, transaction_type, shares, price, currency, transaction_date, notes, source_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [auth.userId, holdingId, txType, qtyForTx, priceForTx, currency, tx.date, tx.notes || `Imported from ${source}`, sourceId]
        )

        imported++
      } catch (e) {
        errors.push(`Row ${i}: ${e instanceof Error ? e.message : 'Import failed'}`)
      }
    }

    return res.status(200).json({
      imported,
      skipped,
      failed: transactions.length - imported - skipped,
      errors,
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

type Trading212Position = {
  ticker?: string
  symbol?: string
  isin?: string
  name?: string
  quantity?: number | string
  shares?: number | string
  averagePrice?: number | string
  avgPrice?: number | string
  average_price?: number | string
  currency?: string
}

async function handleTrading212(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { positions, owner } = req.body || {}
    if (!Array.isArray(positions)) {
      return res.status(400).json({ error: 'positions must be an array' })
    }

    const transactions: Array<Record<string, unknown>> = []
    const errorRecords: Array<{ rowIndex: number; message: string }> = []
    const date = new Date().toISOString().slice(0, 10)

    positions.forEach((p: Trading212Position, idx: number) => {
      try {
        const ticker = String(p.ticker || p.symbol || '').trim().toUpperCase()
        const isin = String(p.isin || '').trim().toUpperCase() || undefined
        const name = String(p.name || '').trim() || undefined
        const quantity = Number(p.quantity ?? p.shares ?? 0)
        const price = Number(p.averagePrice ?? p.avgPrice ?? p.average_price ?? 0)
        const ccy = String(p.currency || 'GBP').toUpperCase()

        if (!ticker && !isin) {
          errorRecords.push({ rowIndex: idx, message: 'Missing ticker/isin' })
          return
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          errorRecords.push({ rowIndex: idx, message: 'Invalid quantity' })
          return
        }
        if (!Number.isFinite(price) || price <= 0) {
          errorRecords.push({ rowIndex: idx, message: 'Invalid price' })
          return
        }

        transactions.push({
          date,
          type: 'buy',
          ticker: ticker || undefined,
          isin,
          name,
          quantity,
          price,
          priceCurrency: ccy,
          total: quantity * price,
          totalCurrency: ccy,
          source: 'trading212',
          sourceId: `t212-${idx}-${ticker || isin || 'row'}`,
          notes: owner ? `Owner: ${owner}` : undefined,
        })
      } catch (e) {
        errorRecords.push({ rowIndex: idx, message: e instanceof Error ? e.message : 'Parse failed' })
      }
    })

    return res.status(200).json({
      source: 'trading212',
      totalRecords: positions.length,
      validRecords: transactions.length,
      errorRecords,
      transactions,
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

function actionFromRequest(req: VercelRequest): string {
  const q = req.query.action
  const fromQuery = typeof q === 'string' ? q : Array.isArray(q) ? q[0] : ''
  if (fromQuery) return fromQuery
  const url = req.url || ''
  const m = url.match(/\/api\/import\/([^/?]+)/)
  return m ? m[1] : ''
}

async function handleT212Sync(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  try {
  // Positions can be supplied directly in the request body (e.g. from MCP bridge)
  // or fetched from T212 REST API using the T212_API_KEY env var.
  const bodyPositions = req.body?.positions
  let positions: Array<{
    ticker?: string
    quantity?: number
    averagePrice?: number
    currentPrice?: number
    [key: string]: unknown
  }>

  const owner: string | undefined = typeof req.body?.owner === 'string' && req.body.owner.trim()
    ? req.body.owner.trim()
    : undefined

  if (Array.isArray(bodyPositions) && bodyPositions.length > 0) {
    positions = bodyPositions
  } else {
    const apiKey = process.env.T212_API_KEY
    if (!apiKey) {
      return res.status(400).json({
        error: 'T212_API_KEY not configured. Add it to your Vercel environment variables.',
      })
    }
    const t212Res = await fetch('https://live.trading212.com/api/v0/equity/portfolio', {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10000),
    })
    if (!t212Res.ok) {
      const text = await t212Res.text()
      const hint = t212Res.status === 401
        ? ' — API key is invalid or expired. Regenerate it in T212 → Settings → API.'
        : ''
      return res.status(502).json({ error: `T212 API ${t212Res.status}${hint}` })
    }
    positions = await t212Res.json()
  }

    const db = await getDbClient()
    const errors: string[] = []
    let synced = 0
    let pricesUpdated = 0

    const nonGbpCurrencies = new Set<string>()

    for (const pos of positions) {
      try {
        const rawTicker = String(pos.ticker || '').trim()
        if (!rawTicker) { errors.push(`Skipping position with no ticker`); continue }

        // Parse ticker: NVDA_US_EQ → NVDA
        const ticker = rawTicker.split('_')[0].toUpperCase()

        // Determine currency from ticker suffix
        let currency = 'USD'
        if (/_UK_/.test(rawTicker)) currency = 'GBP'
        else if (/_US_/.test(rawTicker)) currency = 'USD'

        const shares = Number(pos.quantity ?? 0)
        const avgCost = Number(pos.averagePrice ?? 0)
        if (!Number.isFinite(shares) || shares <= 0) { errors.push(`${ticker}: invalid quantity`); continue }
        if (!Number.isFinite(avgCost) || avgCost <= 0) { errors.push(`${ticker}: invalid averagePrice`); continue }

        const notes = owner
          ? `Owner: ${owner} | Imported from trading212`
          : 'Imported from trading212'

        // UPSERT holding
        const existing = await db.query(
          `SELECT id FROM holdings WHERE user_id = $1 AND ticker = $2 LIMIT 1`,
          [auth.userId, ticker]
        )
        if (existing.rows?.[0]?.id) {
          await db.query(
            `UPDATE holdings SET shares = $3, avg_cost = $4, notes = $5, updated_at = NOW() WHERE user_id = $1 AND id = $2`,
            [auth.userId, existing.rows[0].id, shares, avgCost, notes]
          )
        } else {
          await db.query(
            `INSERT INTO holdings (user_id, ticker, name, type, shares, avg_cost, currency, notes)
             VALUES ($1,$2,$3,'stock',$4,$5,$6,$7)`,
            [auth.userId, ticker, ticker, shares, avgCost, currency, notes]
          )
        }
        synced++

        // Update price cache if currentPrice is valid
        const currentPrice = Number(pos.currentPrice)
        if (Number.isFinite(currentPrice) && currentPrice > 0) {
          await db.query(`DELETE FROM price_cache WHERE ticker = $1`, [ticker])
          await db.query(
            `INSERT INTO price_cache (ticker, price, currency, as_of) VALUES ($1,$2,$3,NOW())`,
            [ticker, currentPrice, currency]
          )
          pricesUpdated++
        }

        if (currency !== 'GBP') nonGbpCurrencies.add(currency)
      } catch (e) {
        errors.push(`${pos.ticker ?? '?'}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }

    // Fetch FX rates for non-GBP currencies
    if (nonGbpCurrencies.size > 0) {
      const toList = Array.from(nonGbpCurrencies)
        .filter((c) => c !== 'GBP')
        .join(',')
      if (toList) {
        try {
          const fxRes = await fetch(`https://api.frankfurter.app/latest?from=USD&to=GBP,${toList}`)
          if (fxRes.ok) {
            const fxData: { rates?: Record<string, number>; date?: string } = await fxRes.json()
            const asOf = fxData.date || new Date().toISOString().slice(0, 10)
            for (const [toCur, rate] of Object.entries(fxData.rates || {})) {
              const pair = `USD_${toCur}`
              await db.query(`DELETE FROM fx_cache WHERE from_currency = $1 AND to_currency = $2`, ['USD', toCur])
              await db.query(
                `INSERT INTO fx_cache (pair, from_currency, to_currency, rate, as_of, updated_at)
                 VALUES ($1,$2,$3,$4,$5,NOW())`,
                [pair, 'USD', toCur, rate, asOf]
              )
            }
          }
        } catch {
          errors.push('FX rate fetch failed')
        }
      }
    }

    return res.status(200).json({
      ok: true,
      synced,
      errors,
      pricesUpdated,
      source: 'trading212',
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const action = actionFromRequest(req)
  if (action === 'commit') return handleCommit(req, res)
  if (action === 'trading212') return handleTrading212(req, res)
  if (action === 't212-sync') return handleT212Sync(req, res)
  return res.status(404).json({ error: 'Unknown import action' })
}
