import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth'

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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

