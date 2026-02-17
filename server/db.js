/**
 * SQLite DB for daily snapshots and synced holdings.
 * - snapshots: one row per day (EOD value in GBP)
 * - holdings_sync: latest UK holdings JSON for the 23:59 job
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'firefly.db')
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    date TEXT PRIMARY KEY,
    value_gbp REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS holdings_sync (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS price_cache (
    ticker TEXT PRIMARY KEY,
    price REAL NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

export function getSnapshots() {
  const rows = db.prepare('SELECT date, value_gbp FROM snapshots ORDER BY date').all()
  return rows.map((r) => ({ date: r.date, valueGBP: r.value_gbp }))
}

export function saveSnapshot(date, valueGBP) {
  db.prepare('INSERT OR REPLACE INTO snapshots (date, value_gbp) VALUES (?, ?)').run(date, valueGBP)
}

export function getHoldingsSync() {
  const row = db.prepare('SELECT data, updated_at FROM holdings_sync WHERE id = 1').get()
  return row ? { data: JSON.parse(row.data), updatedAt: row.updated_at } : null
}

export function saveHoldingsSync(ukHoldings) {
  const data = JSON.stringify(ukHoldings)
  const updatedAt = new Date().toISOString()
  db.prepare(
    'INSERT OR REPLACE INTO holdings_sync (id, data, updated_at) VALUES (1, ?, ?)'
  ).run(data, updatedAt)
}

export function getPriceCache() {
  const rows = db.prepare('SELECT ticker, price, updated_at FROM price_cache').all()
  const byTicker = {}
  let updated = null
  for (const r of rows) {
    byTicker[r.ticker] = r.price
    if (!updated || r.updated_at > updated) updated = r.updated_at
  }
  return { prices: byTicker, updated }
}

export function savePriceCache(ticker, price) {
  const updatedAt = new Date().toISOString()
  db.prepare('INSERT OR REPLACE INTO price_cache (ticker, price, updated_at) VALUES (?, ?, ?)').run(ticker, price, updatedAt)
}

export function close() {
  db.close()
}
