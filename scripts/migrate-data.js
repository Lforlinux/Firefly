#!/usr/bin/env node

/**
 * One-time migration script: reads data.json and inserts into Postgres
 * Usage: node scripts/migrate-data.js [--connection-string="postgresql://..."]
 *
 * If no connection string provided, defaults to local dev database:
 *   postgresql://postgres@localhost:5432/firefly_local
 *
 * Creates a single user (hardcoded for now) and assigns all holdings to that user.
 * For multi-user migration, modify the user creation section below.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const crypto = require('crypto');
const pg = require('pg');

const readFile = promisify(fs.readFile);

// Parse args
const args = process.argv.slice(2);
let connectionString = 'postgresql://postgres@localhost:5432/firefly_local';
for (const arg of args) {
  if (arg.startsWith('--connection-string=')) {
    connectionString = arg.split('=')[1];
  }
}

console.log('🔗 Connecting to:', connectionString.replace(/:[^@]*@/, ':***@'));

// Hash password using crypto.scrypt (Node.js native)
async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt.toString('hex') + ':' + derivedKey.toString('hex'));
    });
  });
}

// Main migration
async function migrate() {
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    console.log('✓ Connected to database');

    // Read data.json
    const dataPath = path.join(__dirname, '..', 'data.json');
    const dataBuffer = await readFile(dataPath, 'utf8');
    const data = JSON.parse(dataBuffer);
    console.log(`✓ Loaded data.json (${data.holdings.length} holdings)`);

    // Start transaction
    await client.query('BEGIN');
    console.log('📦 Transaction started');

    // Create test user (Lex)
    const testEmail = 'lekshmi.kola@gmail.com';
    const testPassword = 'SecureTestPassword123!';
    const hashedPassword = await hashPassword(testPassword);

    const userRes = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [testEmail, hashedPassword]
    );
    const userId = userRes.rows[0].id;
    console.log(`✓ Created user: ${testEmail} (ID: ${userId})`);
    console.log(`  🔑 Password: ${testPassword} (for local testing only)`);

    // Create settings for user
    await client.query(
      'INSERT INTO settings (user_id, base_currency) VALUES ($1, $2)',
      [userId, data.settings?.baseCurrency || 'GBP']
    );
    console.log('✓ Created settings');

    // Insert holdings
    let insertedCount = 0;
    for (const holding of data.holdings) {
      try {
        await client.query(
          `INSERT INTO holdings
            (user_id, ticker, name, type, sector, shares, avg_cost, currency, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            userId,
            holding.ticker || 'UNKNOWN',
            holding.name || 'Unnamed',
            holding.type || 'unknown',
            holding.sector || null,
            holding.shares || 0,
            holding.avgCost || 0,
            holding.currency || 'GBP',
            holding.notes || null
          ]
        );
        insertedCount++;
      } catch (err) {
        console.error(`⚠️  Failed to insert ${holding.ticker}: ${err.message}`);
      }
    }
    console.log(`✓ Inserted ${insertedCount}/${data.holdings.length} holdings`);

    // Insert snapshots (if any)
    let snapshotCount = 0;
    if (data.snapshots && Array.isArray(data.snapshots)) {
      for (const snapshot of data.snapshots) {
        try {
          await client.query(
            `INSERT INTO snapshots
              (user_id, snapshot_date, total_value, notes)
             VALUES ($1, $2, $3, $4)`,
            [
              userId,
              snapshot.date || new Date().toISOString().split('T')[0],
              snapshot.totalValue || null,
              snapshot.notes || null
            ]
          );
          snapshotCount++;
        } catch (err) {
          console.error(`⚠️  Failed to insert snapshot: ${err.message}`);
        }
      }
    }
    if (snapshotCount > 0) {
      console.log(`✓ Inserted ${snapshotCount} snapshots`);
    } else {
      console.log('ℹ️  No snapshots to insert');
    }

    // Verify row counts
    const holdingsCheck = await client.query(
      'SELECT COUNT(*) FROM holdings WHERE user_id = $1',
      [userId]
    );
    const settingsCheck = await client.query(
      'SELECT COUNT(*) FROM settings WHERE user_id = $1',
      [userId]
    );

    // Commit transaction
    await client.query('COMMIT');
    console.log('✓ Transaction committed');

    // Summary
    console.log('\n✅ Migration complete');
    console.log('---');
    console.log(`Holdings: ${holdingsCheck.rows[0].count}`);
    console.log(`Settings: ${settingsCheck.rows[0].count}`);
    console.log('---');
    console.log('Test credentials:');
    console.log(`  Email: ${testEmail}`);
    console.log(`  Password: ${testPassword}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected');
  }
}

// Run
migrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
