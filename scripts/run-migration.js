#!/usr/bin/env node
/**
 * Firefly Migration Runner
 * Reads db/schema.sql and executes it against the POSTGRES_URL
 * Usage: node scripts/run-migration.js
 */

import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql')

const connectionString = process.env.POSTGRES_URL
if (!connectionString) {
  console.error('❌ POSTGRES_URL environment variable not set')
  process.exit(1)
}

console.log('🚀 Starting database migration...')
console.log(`📖 Reading schema from: ${SCHEMA_PATH}`)

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Required for Neon
})

async function run() {
  try {
    await client.connect()
    console.log('✅ Connected to database')

    // Execute schema
    console.log('📝 Executing schema...')
    await client.query(schema)
    console.log('✅ Schema applied successfully')

    // List tables
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    console.log('📋 Tables created:')
    result.rows.forEach((row) => console.log(`   - ${row.table_name}`))

    console.log('✨ Migration complete!')
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
