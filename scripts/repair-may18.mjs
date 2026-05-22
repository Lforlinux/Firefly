/**
 * One-off repair: recalculate the 2026-05-18 daily movement.
 *
 * Why: fetchT212Prices used `currentPrice ?? averagePrice`, meaning that on a
 * day when T212 returned null for currentPrice the cost-basis was stored as the
 * "market price". The next day that ghost price became prev_close, so the
 * movement showed total unrealised P&L instead of a 1-day move.
 *
 * This script:
 *  1. Deletes the bad daily_movements row for 2026-05-18
 *  2. Fetches 2026-05-15 (prev trading day) and 2026-05-18 closing prices from
 *     Yahoo Finance for every ticker in holdings
 *  3. Fetches USD→GBP, INR→GBP rates on 2026-05-18 from Frankfurter
 *  4. Calculates movement = Σ shares × (close₁₈ − close₁₅) × fx
 *  5. Upserts the corrected row (owner = 'all' + per-owner rows)
 *
 * Usage:
 *   POSTGRES_URL="..." node scripts/repair-may18.mjs
 * or just run with the .env.production.local already sourced.
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse .env.production.local without dotenv dependency
const envPath = resolve(__dirname, '../.env.production.local')
try {
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch { /* env file optional */ }

const DB_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!DB_URL) { console.error('Set POSTGRES_URL'); process.exit(1) }

const BASE = 'GBP'
const PREV_DATE = '2026-05-15'   // Friday (last trading day before 18 May)
const TARGET_DATE = '2026-05-18' // Monday (the day with the bad row)

// ---------------------------------------------------------------------------
// Yahoo Finance: fetch closing price for a specific date
// ---------------------------------------------------------------------------
async function yahooClose(ticker, dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const period1 = Math.floor(d.getTime() / 1000) - 86400
  const period2 = Math.floor(d.getTime() / 1000) + 2 * 86400
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return { error: `Yahoo HTTP ${res.status}` }
  let body
  try { body = await res.json() } catch { return { error: 'Yahoo bad JSON' } }
  const result = body?.chart?.result?.[0]
  if (!result) return { error: 'Yahoo: no result' }

  const timestamps = result.timestamp || []
  const closes = result.indicators?.quote?.[0]?.close || []
  const rawCcy = result.meta?.currency || 'USD'
  const isGBp = rawCcy === 'GBp'
  const currency = isGBp ? 'GBP' : rawCcy

  // Find the closest timestamp to the requested date (exchange-local day)
  let bestI = -1, bestDiff = Infinity
  for (let i = 0; i < timestamps.length; i++) {
    const tsDate = new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
    const diff = Math.abs(new Date(tsDate) - new Date(dateStr))
    if (diff < bestDiff && closes[i] != null) {
      bestDiff = diff
      bestI = i
    }
  }
  if (bestI === -1) return { error: `Yahoo ${ticker}: no close for ${dateStr}` }

  const tsDate = new Date(timestamps[bestI] * 1000).toISOString().slice(0, 10)
  const rawPrice = closes[bestI]
  const price = isGBp ? rawPrice / 100 : rawPrice
  console.log(`  ${ticker} [${dateStr}] → ${price} ${currency} (ts date: ${tsDate})`)
  return { price, currency }
}

// ---------------------------------------------------------------------------
// Frankfurter: historical FX rates on a given date
// ---------------------------------------------------------------------------
async function fxOnDate(date, from, tos) {
  const url = `https://api.frankfurter.app/${date}?from=${from}&to=${tos.join(',')}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`)
  const body = await res.json()
  return body?.rates || {}
}

function ownerFromNotes(notes) {
  if (!notes) return undefined
  const m = notes.match(/Owner:\s*([A-Za-z][A-Za-z0-9 _'-]*)/)
  return m ? m[1].trim() : undefined
}

function toBase(amount, from, fxMap) {
  if (!from || from.toUpperCase() === BASE) return amount
  const rate = fxMap[`${from.toUpperCase()}_${BASE}`]
  if (!rate) { console.warn(`  ⚠  No FX rate for ${from}_${BASE} — treating as ${BASE}`) }
  return rate ? amount * rate : amount
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

// 1. Get all users with holdings
const { rows: userRows } = await client.query(
  `SELECT DISTINCT user_id FROM holdings WHERE type != 'cash' AND ticker NOT LIKE 'CASH:%'`
)
console.log(`Found ${userRows.length} user(s)`)

for (const { user_id } of userRows) {
  console.log(`\n=== user ${user_id} ===`)

  // 2. Load holdings
  const { rows: holdings } = await client.query(
    `SELECT ticker, shares, currency, notes FROM holdings
     WHERE user_id = $1 AND type != 'cash' AND ticker NOT LIKE 'CASH:%'`,
    [user_id]
  )
  if (holdings.length === 0) { console.log('  no holdings'); continue }

  const tickers = [...new Set(holdings.map(h => h.ticker))]
  console.log(`  tickers: ${tickers.join(', ')}`)

  // 3. Fetch prev-day and target-day prices from Yahoo
  console.log(`\nFetching prices for ${PREV_DATE}:`)
  const prevPrices = {}
  for (const t of tickers) {
    const r = await yahooClose(t, PREV_DATE)
    if ('error' in r) console.warn(`  ⚠  ${t}: ${r.error}`)
    else prevPrices[t] = r
  }

  console.log(`\nFetching prices for ${TARGET_DATE}:`)
  const targetPrices = {}
  for (const t of tickers) {
    const r = await yahooClose(t, TARGET_DATE)
    if ('error' in r) console.warn(`  ⚠  ${t}: ${r.error}`)
    else targetPrices[t] = r
  }

  // 4. Fetch FX rates on the target date
  const neededCurrencies = new Set()
  for (const p of [...Object.values(prevPrices), ...Object.values(targetPrices)]) {
    if (p.currency && p.currency !== BASE && p.currency.length === 3) {
      neededCurrencies.add(p.currency.toUpperCase())
    }
  }
  // Also pull INR in case of India holdings
  neededCurrencies.add('INR')

  const fxMap = {}
  if (neededCurrencies.size > 0) {
    console.log(`\nFetching FX rates on ${TARGET_DATE}: GBP → ${[...neededCurrencies].join(', ')}`)
    // We want X → GBP, so fetch from each foreign ccy to GBP
    for (const ccy of neededCurrencies) {
      if (ccy === BASE) continue
      try {
        const rates = await fxOnDate(TARGET_DATE, ccy, [BASE])
        if (rates[BASE]) {
          fxMap[`${ccy}_${BASE}`] = rates[BASE]
          console.log(`  ${ccy}/${BASE} = ${rates[BASE]}`)
        }
      } catch (e) {
        console.warn(`  ⚠  FX ${ccy}: ${e.message}`)
      }
    }
  }

  // 5. Calculate movement per owner
  const owners = new Set(['all'])
  for (const h of holdings) {
    const o = ownerFromNotes(h.notes)
    if (o) owners.add(o)
  }

  console.log(`\nCalculating movements for owners: ${[...owners].join(', ')}`)
  const results = {}

  for (const owner of owners) {
    const filtered = owner === 'all'
      ? holdings
      : holdings.filter(h => ownerFromNotes(h.notes)?.toLowerCase() === owner.toLowerCase())

    let movement = 0
    let portfolioValue = 0
    let counted = 0

    for (const h of filtered) {
      const prev = prevPrices[h.ticker]
      const today = targetPrices[h.ticker]
      if (!prev || !today) {
        console.warn(`  ⚠  Skipping ${h.ticker} — missing price data`)
        continue
      }
      const fx = toBase(1, today.currency, fxMap)
      const diff = h.shares * (today.price - prev.price) * fx
      movement += diff
      portfolioValue += h.shares * today.price * fx
      counted++
      console.log(
        `  [${owner}] ${h.ticker}: ${h.shares} shares × (${today.price.toFixed(4)} − ${prev.price.toFixed(4)}) × fx${fx.toFixed(4)} = ${diff.toFixed(2)} GBP`
      )
    }

    if (counted === 0) { console.log(`  [${owner}] no priced holdings — skipping`); continue }
    results[owner] = { movement, portfolioValue }
    console.log(`  [${owner}] TOTAL movement = ${movement.toFixed(2)} GBP  portfolio = ${portfolioValue.toFixed(2)} GBP`)
  }

  // 6. Delete the bad row(s) and upsert corrected values
  console.log(`\nDeleting bad daily_movements rows for ${TARGET_DATE} user ${user_id}…`)
  await client.query(
    `DELETE FROM daily_movements WHERE user_id = $1 AND movement_date = $2`,
    [user_id, TARGET_DATE]
  )

  for (const [owner, { movement, portfolioValue }] of Object.entries(results)) {
    await client.query(
      `INSERT INTO daily_movements (user_id, movement_date, owner, movement_gbp, portfolio_value_gbp)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, movement_date, owner)
       DO UPDATE SET movement_gbp = EXCLUDED.movement_gbp, portfolio_value_gbp = EXCLUDED.portfolio_value_gbp`,
      [user_id, TARGET_DATE, owner, movement, portfolioValue]
    )
    console.log(`  ✓ Upserted [${owner}]: ${movement.toFixed(2)} GBP`)
  }
}

await client.end()
console.log('\nDone.')
