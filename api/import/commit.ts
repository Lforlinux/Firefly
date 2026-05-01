import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/auth'

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
}

function inferHoldingType(tx: ImportedTransaction): 'stock' | 'etf' | 'cash' {
  if (tx.type === 'deposit' || tx.type === 'withdrawal') return 'cash'
  return 'etf'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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

        // Find or create holding for this user+ticker.
        const existing = await db.query(
          `SELECT id FROM holdings WHERE user_id = $1 AND ticker = $2 LIMIT 1`,
          [auth.userId, ticker]
        )
        let holdingId = existing.rows?.[0]?.id

        if (!holdingId) {
          const inserted = await db.query(
            `INSERT INTO holdings (user_id, ticker, name, type, sector, shares, avg_cost, currency, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING id`,
            [
              auth.userId,
              ticker,
              tx.name || ticker,
              inferHoldingType(tx),
              null,
              normalizedTxType === 'buy' ? qtyForTx : 0,
              priceForTx,
              currency,
              tx.notes || `Imported from ${source}`,
            ]
          )
          holdingId = inserted.rows?.[0]?.id
        } else if (normalizedTxType === 'buy') {
          // Lightweight running-share update for visibility in holdings table.
          await db.query(
            `UPDATE holdings
             SET shares = shares + $3,
                 avg_cost = CASE WHEN avg_cost = 0 THEN $4 ELSE avg_cost END,
                 updated_at = NOW()
             WHERE user_id = $1 AND id = $2`,
            [auth.userId, holdingId, qtyForTx, priceForTx]
          )
        } else if (normalizedTxType === 'sell') {
          await db.query(
            `UPDATE holdings
             SET shares = GREATEST(shares - $3, 0),
                 updated_at = NOW()
             WHERE user_id = $1 AND id = $2`,
            [auth.userId, holdingId, qtyForTx]
          )
        }

        await db.query(
          `INSERT INTO transactions (user_id, holding_id, transaction_type, shares, price, currency, transaction_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [auth.userId, holdingId, txType, qtyForTx, priceForTx, currency, tx.date, tx.notes || `Imported from ${source}`]
        )

        imported++
      } catch (e) {
        errors.push(`Row ${i}: ${e instanceof Error ? e.message : 'Import failed'}`)
      }
    }

    return res.status(200).json({
      imported,
      failed: transactions.length - imported,
      errors,
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}

