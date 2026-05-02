/**
 * Database initialization handler for Vercel
 * This endpoint initializes the Neon schema if tables don't exist
 * Usage: POST /api/db-init (with secret token for security)
 */

import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql')

const INIT_SECRET = process.env.DB_INIT_SECRET || 'dev-secret'

export default async function handler(req, res) {
  // Verify secret
  const secret = req.headers['x-db-init-secret'] || req.query.secret
  if (secret !== INIT_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const connectionString = process.env.POSTGRES_URL
  if (!connectionString) {
    return res.status(500).json({ error: 'POSTGRES_URL not set' })
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    console.log('[db-init] Connected to database')

    // Read schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')

    // Execute schema
    console.log('[db-init] Executing schema...')
    await client.query(schema)
    console.log('[db-init] Schema applied')

    // List tables
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)

    const tables = result.rows.map((row) => row.table_name)

    return res.status(200).json({
      success: true,
      message: 'Database initialized',
      tables,
    })
  } catch (error) {
    console.error('[db-init] Error:', error.message)
    return res.status(500).json({
      error: 'Database initialization failed',
      details: error.message,
    })
  } finally {
    await client.end()
  }
}
