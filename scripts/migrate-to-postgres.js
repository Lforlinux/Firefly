#!/usr/bin/env node
/**
 * Migrates Firefly JSON data into Postgres.
 * Usage:
 *   node scripts/migrate-to-postgres.js
 *   DATABASE_URL=postgresql://postgres@localhost:5432/firefly node scripts/migrate-to-postgres.js
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataPath = path.join(root, 'data.json')
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres@localhost:5432/firefly'

function parseOwner(notes) {
  const text = String(notes || '')
  const m = text.match(/Owner:\s*([^|]+)/i)
  return m ? m[1].trim() : 'Default'
}

async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16)
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err)
      resolve(`${salt.toString('hex')}:${key.toString('hex')}`)
    })
  })
}

function loadData() {
  const raw = fs.readFileSync(dataPath, 'utf8')
  return JSON.parse(raw)
}

async function main() {
  const client = new pg.Client({ connectionString })
  await client.connect()
  console.log('Connected:', connectionString.replace(/:[^@]*@/, ':***@'))
  try {
    const data = loadData()
    const holdings = Array.isArray(data.holdings) ? data.holdings : []
    const snapshots = Array.isArray(data.snapshots) ? data.snapshots : []

    await client.query('BEGIN')

    // Group by owner and create one user per owner
    const ownerNames = [...new Set(holdings.map((h) => parseOwner(h.notes)))]
    const ownerToUserId = new Map()
    const defaultPassword = await hashPassword('test12345')
    for (const owner of ownerNames) {
      const safe = owner.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
      const email = `${safe || 'default'}@firefly.local`
      const inserted = await client.query(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [email, defaultPassword]
      )
      const userId = inserted.rows[0].id
      ownerToUserId.set(owner, userId)
      await client.query(
        `INSERT INTO settings (user_id, base_currency)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET base_currency = EXCLUDED.base_currency, last_updated = NOW()`,
        [userId, data?.settings?.baseCurrency || 'GBP']
      )
    }

    // Clear child tables for idempotent migration
    await client.query('DELETE FROM transactions')
    await client.query('DELETE FROM snapshots')
    await client.query('DELETE FROM holdings')

    for (const h of holdings) {
      const owner = parseOwner(h.notes)
      const userId = ownerToUserId.get(owner) || ownerToUserId.values().next().value
      await client.query(
        `INSERT INTO holdings (user_id, ticker, name, type, sector, shares, avg_cost, currency, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          userId,
          h.ticker || 'UNKNOWN',
          h.name || 'Unnamed',
          h.type || 'unknown',
          h.sector || null,
          Number(h.shares || 0),
          Number(h.avgCost || 0),
          h.currency || 'GBP',
          h.notes || null,
        ]
      )
    }

    // Snapshot data has no owner. Attach to KLN if exists, else first user.
    const klnUserId = ownerToUserId.get('KLN') || ownerToUserId.values().next().value
    for (const s of snapshots) {
      const snapshotDate = s.date || new Date().toISOString().slice(0, 10)
      const totalValue = Number(s.valueGBP ?? s.totalValue ?? 0)
      await client.query(
        `INSERT INTO snapshots (user_id, snapshot_date, total_value, notes)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, snapshot_date) DO UPDATE SET total_value = EXCLUDED.total_value, notes = EXCLUDED.notes`,
        [klnUserId, snapshotDate, totalValue, null]
      )
    }

    await client.query('COMMIT')

    const hc = await client.query('SELECT COUNT(*)::int AS c FROM holdings')
    const sc = await client.query('SELECT COUNT(*)::int AS c FROM snapshots')
    const uc = await client.query('SELECT COUNT(*)::int AS c FROM users')
    console.log('Migration complete:')
    console.log('- users:', uc.rows[0].c)
    console.log('- holdings:', hc.rows[0].c)
    console.log('- snapshots:', sc.rows[0].c)
    console.log('Default password for generated users: test12345')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('Migration failed:', e?.message || e)
  process.exit(1)
})
