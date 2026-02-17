/**
 * API server: Yahoo quote proxy, snapshots DB, daily 23:59 portfolio snapshot.
 */
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { getSnapshots, getPriceCache, saveHoldingsSync } from './db.js'
import { recordDailySnapshot, scheduleDailyJob, schedulePriceRefresh } from './dailyJob.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001
const isProduction = process.env.NODE_ENV === 'production'

const app = express()
app.use(express.json({ limit: '1mb' }))

function lsePriceToPounds(ticker, price) {
  const isLse = ticker.endsWith('.L') || ticker.endsWith('.LON')
  if (isLse && price >= 1000) return price / 100
  return price
}

app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || '').trim()
  if (!symbol) {
    return res.status(400).json({ price: 0, error: 'Missing symbol' })
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Firefly/1.0)' },
    })
    if (!response.ok) {
      return res.json({ price: 0, error: `Yahoo: ${response.status}` })
    }
    const data = await response.json()
    const chart = data.chart
    const result = chart?.result?.[0]
    const raw = result?.meta?.regularMarketPrice
    if (typeof raw !== 'number' || Number.isNaN(raw) || raw <= 0) {
      return res.json({ price: 0, error: `No quote for "${symbol}" from Yahoo.` })
    }
    const price = lsePriceToPounds(symbol, raw)
    res.json({ price: Math.round(price * 100) / 100 })
  } catch (e) {
    const msg = e?.message || 'Network error'
    res.status(500).json({ price: 0, error: `Yahoo: ${msg}` })
  }
})

app.get('/api/snapshots', (_req, res) => {
  try {
    const list = getSnapshots()
    res.json(list)
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Failed to load snapshots' })
  }
})

app.post('/api/sync-holdings', (req, res) => {
  try {
    const { ukHoldings } = req.body || {}
    if (!Array.isArray(ukHoldings)) {
      return res.status(400).json({ error: 'Body must include ukHoldings array' })
    }
    saveHoldingsSync(ukHoldings)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Failed to sync holdings' })
  }
})

app.post('/api/record-daily', async (_req, res) => {
  try {
    await recordDailySnapshot()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Failed to record snapshot' })
  }
})

app.get('/api/cached-prices', (_req, res) => {
  try {
    const { prices, updated } = getPriceCache()
    res.json({ prices, updated })
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Failed to load price cache' })
  }
})

if (isProduction) {
  const dist = path.join(__dirname, '../dist')
  app.use(express.static(dist))
  app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')))
}

scheduleDailyJob()
schedulePriceRefresh()

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
  if (!isProduction) {
    console.log('  API: GET /api/quote  GET /api/snapshots  GET /api/cached-prices')
    console.log('  API: POST /api/sync-holdings  POST /api/record-daily')
  }
})
