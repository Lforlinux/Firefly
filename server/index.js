/**
 * Firefly API server.
 *
 * Single source of truth: data.json (next to this file's repo root).
 * Server-managed cache:    data.cache.json — prices + fxRates + lastRefresh.
 * The cache is regenerated on demand via POST /api/refresh-prices and is safe to delete.
 *
 * Endpoints:
 *   GET  /api/portfolio         -> { ...data.json, ...data.cache.json }
 *   POST /api/portfolio         -> overwrite data.json (atomic; cache preserved)
 *   GET  /api/quote?symbol=X    -> { ticker, price, currency, asOf }
 *   GET  /api/fx?from=X&to=Y    -> { pair, rate, asOf }
 *   POST /api/refresh-prices    -> refresh all non-cash holdings + needed FX, return cache
 *   POST /api/snapshot          -> { date, valueGBP } appended to data.json snapshots[]
 *   POST /api/import/trading212 -> fetch Trading 212 data, return preview
 *   POST /api/import/commit     -> validate & persist imported transactions
 *   GET  /api/health            -> { ok: true }
 */
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const DATA_PATH = process.env.FIREFLY_DATA || path.join(REPO_ROOT, 'data.json')
const CACHE_PATH = process.env.FIREFLY_CACHE || path.join(REPO_ROOT, 'data.cache.json')
const PORT = Number(process.env.PORT) || 3001
const isProduction = process.env.NODE_ENV === 'production'

// ---------- file io ------------------------------------------------------

function defaultData() {
  return { holdings: [], snapshots: [], transactions: [], settings: { baseCurrency: 'GBP', lastUpdated: '' } }
}

function defaultCache() {
  return { prices: {}, fxRates: {}, lastRefresh: '' }
}

function readJsonOrDefault(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback()
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    console.warn(`[firefly] could not read ${path.basename(file)}:`, e.message)
    return fallback()
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

function readData() { return readJsonOrDefault(DATA_PATH, defaultData) }
function readCache() { return readJsonOrDefault(CACHE_PATH, defaultCache) }
function writeData(d) { writeJsonAtomic(DATA_PATH, d) }
function writeCache(c) { writeJsonAtomic(CACHE_PATH, c) }

// ---------- yahoo proxy --------------------------------------------------

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Firefly/1.0)' }

/**
 * Yahoo returns LSE-listed prices in pence (currency code "GBp"). Convert to pounds
 * and normalise the currency code to "GBP".
 */
function normaliseQuote(meta) {
  let price = meta?.regularMarketPrice
  let currency = meta?.currency || ''
  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  if (currency === 'GBp') {
    price = price / 100
    currency = 'GBP'
  }
  return { price: Math.round(price * 1e6) / 1e6, currency, asOf: new Date().toISOString() }
}

async function yahooQuote(ticker) {
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=1d`
  const res = await fetch(url, { headers: YAHOO_HEADERS })
  if (!res.ok) throw new Error(`yahoo ${ticker}: HTTP ${res.status}`)
  const body = await res.json()
  const meta = body?.chart?.result?.[0]?.meta
  const q = normaliseQuote(meta)
  if (!q) throw new Error(`yahoo ${ticker}: no quote in response`)
  return { ticker, ...q }
}

function fxPairSymbol(from, to) {
  // Yahoo uses "{FROM}{TO}=X" for FX, e.g. INRGBP=X, USDGBP=X.
  return `${from.toUpperCase()}${to.toUpperCase()}=X`
}

async function yahooFx(from, to) {
  if (from.toUpperCase() === to.toUpperCase()) {
    return { pair: `${from}_${to}`, rate: 1, asOf: new Date().toISOString() }
  }
  const sym = fxPairSymbol(from, to)
  const q = await yahooQuote(sym)
  return { pair: `${from.toUpperCase()}_${to.toUpperCase()}`, rate: q.price, asOf: q.asOf }
}

// ---------- app ----------------------------------------------------------

const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/portfolio', (_req, res) => {
  try {
    const data = readData()
    const cache = readCache()
    res.json({ ...data, ...cache })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/portfolio', (req, res) => {
  try {
    const body = req.body
    if (!body || typeof body !== 'object' || !Array.isArray(body.holdings)) {
      return res.status(400).json({ error: 'Body must be a portfolio object with a holdings array' })
    }
    // Preserve server-managed fields if they snuck into the payload — never write them to data.json.
    const next = {
      holdings: body.holdings,
      snapshots: Array.isArray(body.snapshots) ? body.snapshots : [],
      transactions: Array.isArray(body.transactions) ? body.transactions : [],
      settings: {
        baseCurrency: body.settings?.baseCurrency || 'GBP',
        lastUpdated: new Date().toISOString(),
      },
    }
    writeData(next)
    res.json({ ok: true, settings: next.settings })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/quote', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim()
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
  try {
    const q = await yahooQuote(symbol)
    res.json(q)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/api/fx', async (req, res) => {
  const from = String(req.query.from || '').trim().toUpperCase()
  const to = String(req.query.to || '').trim().toUpperCase()
  if (!from || !to) return res.status(400).json({ error: 'Missing from / to' })
  try {
    const q = await yahooFx(from, to)
    res.json(q)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

/**
 * Refresh prices for every non-cash holding plus FX rates needed to value them in baseCurrency.
 * Runs serially with a small delay between calls — Yahoo's chart endpoint is unrate-limited in
 * practice but politeness is cheap.
 */
app.post('/api/refresh-prices', async (_req, res) => {
  try {
    const data = readData()
    const cache = readCache()
    const base = (data.settings?.baseCurrency || 'GBP').toUpperCase()
    const tickers = [...new Set(
      data.holdings
        .filter((h) => h.type !== 'cash' && h.ticker && !h.ticker.startsWith('CASH:'))
        .map((h) => h.ticker)
    )]

    const errors = []
    for (const t of tickers) {
      try {
        const q = await yahooQuote(t)
        cache.prices[t] = { price: q.price, currency: q.currency || '', asOf: q.asOf }
      } catch (e) {
        errors.push({ ticker: t, error: e.message })
      }
      await new Promise((r) => setTimeout(r, 120))
    }

    // FX pairs needed: every currency that appears in holdings[*].currency or prices[*].currency
    // and isn't the base.
    const ccySet = new Set()
    for (const h of data.holdings) if (h.currency) ccySet.add(h.currency.toUpperCase())
    for (const t of Object.keys(cache.prices)) {
      const c = cache.prices[t]?.currency
      if (c) ccySet.add(c.toUpperCase())
    }
    ccySet.delete(base)

    for (const ccy of ccySet) {
      try {
        const fx = await yahooFx(ccy, base)
        cache.fxRates[fx.pair] = { rate: fx.rate, asOf: fx.asOf }
      } catch (e) {
        errors.push({ pair: `${ccy}_${base}`, error: e.message })
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    cache.fxRates[`${base}_${base}`] = { rate: 1, asOf: new Date().toISOString() }
    cache.lastRefresh = new Date().toISOString()
    writeCache(cache)

    res.json({
      ok: true,
      lastRefresh: cache.lastRefresh,
      tickersRefreshed: tickers.length - errors.filter((e) => e.ticker).length,
      fxPairs: ccySet.size - errors.filter((e) => e.pair).length,
      errors,
      cache,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/snapshot', (req, res) => {
  try {
    const date = String(req.body?.date || new Date().toISOString().slice(0, 10))
    const valueGBP = Number(req.body?.valueGBP)
    if (!Number.isFinite(valueGBP)) return res.status(400).json({ error: 'valueGBP must be a number' })
    const data = readData()
    const idx = data.snapshots.findIndex((s) => s.date === date)
    if (idx >= 0) data.snapshots[idx] = { date, valueGBP }
    else data.snapshots.push({ date, valueGBP })
    data.snapshots.sort((a, b) => a.date.localeCompare(b.date))
    data.settings.lastUpdated = new Date().toISOString()
    writeData(data)
    res.json({ ok: true, count: data.snapshots.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * POST /api/import/trading212
 * Fetch Trading 212 data via MCP connector, map to ImportedTransaction[], validate.
 * Returns ImportPreview { source, totalRecords, validRecords, errorRecords, transactions }
 */
app.post('/api/import/trading212', async (req, res) => {
  try {
    // Receives positions from the frontend after it calls the Trading 212 MCP.
    // Frontend calls window.cowork.callMcpTool('mcp__t212-mcp__fetch-open-positions', {})
    // then POSTs the result here for normalization and validation.

    const { positions, owner } = req.body

    if (!positions || !Array.isArray(positions)) {
      return res.status(400).json({
        error: 'Missing or invalid positions array. Frontend must call Trading 212 MCP first.',
      })
    }

    const transactions = []
    const errorRecords = []

    // Map each T212 position to a holding transaction
    positions.forEach((pos, idx) => {
      try {
        // Extract ticker from "AAPL_US_EQ" format
        const tickerParts = String(pos.ticker || '').split('_')
        const ticker = tickerParts[0] || ''

        const tx = {
          type: 'buy',
          date: new Date().toISOString().split('T')[0],
          ticker,
          name: pos.name || pos.instrumentName || '',
          shares: parseFloat(pos.quantity || pos.shares || 0),
          price: parseFloat(pos.lastPrice || pos.currentPrice || 0),
          cost: 0,
          currency: pos.currency || 'GBP',
          notes: `Imported from Trading 212`,
          owner: owner || 'Default',
        }

        // Calculate cost basis
        tx.cost = tx.shares * tx.price

        // Validate required fields
        const errors = []
        if (!tx.ticker) errors.push('Missing ticker')
        if (tx.shares <= 0) errors.push('Invalid shares')
        if (tx.price <= 0) errors.push('Invalid price')

        if (errors.length > 0) {
          errorRecords.push({ rowIndex: idx, message: errors.join('; ') })
        } else {
          transactions.push(tx)
        }
      } catch (e) {
        errorRecords.push({ rowIndex: idx, message: e?.message || 'Unknown parse error' })
      }
    })

    const validRecords = transactions.length

    res.json({
      source: 'trading212',
      totalRecords: positions.length,
      validRecords,
      errorRecords,
      transactions,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * POST /api/import/commit
 * Validate and persist imported transactions to data.json.
 * Body: { source: 'investengine' | 'trading212', transactions: ImportedTransaction[] }
 * Returns: { imported: number, failed: number, errors: string[] }
 */
app.post('/api/import/commit', (req, res) => {
  try {
    const { source, transactions } = req.body
    if (!source || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Body must include source and transactions array' })
    }

    const imported = []
    const failed = []
    const errors = []

    // Validate each transaction
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i]
      const txErrors = validateTransaction(tx)

      if (txErrors.length === 0) {
        imported.push(tx)
      } else {
        failed.push({ index: i, errors: txErrors })
        errors.push(`Row ${i}: ${txErrors.join('; ')}`)
      }
    }

    // Persist valid transactions to data.json
    const data = readData()
    if (!Array.isArray(data.transactions)) data.transactions = []
    data.transactions.push(...imported)
    data.settings.lastUpdated = new Date().toISOString()
    writeData(data)

    res.json({
      ok: true,
      imported: imported.length,
      failed: failed.length,
      errors,
      totalTransactions: data.transactions.length,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * Validate ImportedTransaction for completeness per transaction type.
 * Returns array of error messages; empty array = valid.
 */
function validateTransaction(tx) {
  const errors = []

  if (!tx.date) errors.push('Missing date')
  if (!tx.type) errors.push('Missing transaction type')

  switch (tx.type) {
    case 'buy':
    case 'sell':
      if (!tx.ticker && !tx.isin) errors.push('Missing ticker or ISIN')
      if (!tx.quantity || tx.quantity <= 0) errors.push('Invalid quantity')
      if (!tx.price || tx.price <= 0) errors.push('Invalid price')
      break
    case 'dividend':
      if (!tx.ticker && !tx.isin) errors.push('Missing ticker or ISIN')
      if (tx.total === undefined || tx.total < 0) errors.push('Invalid dividend amount')
      break
    case 'deposit':
    case 'withdrawal':
      if (tx.total === undefined || tx.total < 0) errors.push('Invalid amount')
      break
  }

  return errors
}

if (isProduction) {
  const dist = path.join(REPO_ROOT, 'dist')
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`[firefly] listening on http://localhost:${PORT}`)
  console.log(`[firefly] data:  ${DATA_PATH}`)
  console.log(`[firefly] cache: ${CACHE_PATH}`)
})
