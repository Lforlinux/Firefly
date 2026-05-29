#!/usr/bin/env node
/**
 * sync-loan-balances.mjs
 *
 * Run this after each Actual Budget bank sync to recalculate PCP/loan
 * balances from actual payment history and keep Firefly in sync.
 *
 * Usage:
 *   node scripts/sync-loan-balances.mjs
 *
 * Reads from:  Actual Budget REST API  (http://192.168.1.131:5006)
 * Writes to:   Neon PostgreSQL (POSTGRES_URL from .env.production.local)
 *
 * What it does:
 *   1. Queries Actual Budget for all "Toyota Fin Serv" payments since the
 *      reference date stored in the liability notes.
 *   2. Applies the PCP amortization formula for each confirmed payment.
 *   3. Updates outstanding_balance in the liabilities table if it changed.
 *   4. Also updates the refDate + refBalance in notes to the latest payment
 *      so future calculations are anchored to real data.
 */

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Config ────────────────────────────────────────────────────────────────────

const ACTUAL_SERVER = 'http://192.168.1.131:5006'
const ACTUAL_SYNC_ID = '3f6d3aaf-b550-42f8-bf27-43fa21632e6d'

// Load Neon DB URL from .env.production.local
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.production.local')
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
    for (const line of lines) {
      const m = line.match(/^POSTGRES_URL=["']?(.+?)["']?\s*$/)
      if (m) return m[1]
    }
  } catch { /* ignore */ }
  return process.env.POSTGRES_URL || process.env.DATABASE_URL
}

// ── PCP amortization ──────────────────────────────────────────────────────────

function applyPayments(refBalance, refDate, monthlyPayment, aprPct, paymentDay, paymentDates) {
  const monthlyRate = aprPct / 100 / 12
  let balance = refBalance

  // Sort payment dates that are strictly AFTER the reference date
  const sorted = paymentDates
    .filter((d) => d > refDate)
    .sort()

  for (const date of sorted) {
    const interest = balance * monthlyRate
    const principal = monthlyPayment - interest
    balance = Math.max(0, balance - principal)
    console.log(`  ${date} — interest £${interest.toFixed(2)}, principal £${principal.toFixed(2)}, balance £${balance.toFixed(2)}`)
  }

  return { balance: Math.round(balance * 100) / 100, lastPaymentDate: sorted[sorted.length - 1] ?? refDate }
}

// ── Actual Budget API ─────────────────────────────────────────────────────────

async function getActualBudgetToken() {
  // Actual Budget uses a simple password-based auth or no auth in self-hosted mode.
  // Try unauthenticated first (most self-hosted setups with no password).
  const resp = await fetch(`${ACTUAL_SERVER}/api/account-validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).catch(() => null)
  if (resp?.ok) {
    const data = await resp.json()
    return data?.data?.token ?? null
  }
  return null
}

async function queryActualTransactions(token, payeeName, startDate) {
  // Use the Actual Budget API to search transactions
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'X-BUDGET-ID': ACTUAL_SYNC_ID,
  }

  const url = `${ACTUAL_SERVER}/api/transactions?payee=${encodeURIComponent(payeeName)}&start=${startDate}`
  const resp = await fetch(url, { headers }).catch(() => null)
  if (!resp?.ok) return null
  return resp.json().catch(() => null)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = loadEnv()
  if (!dbUrl) {
    console.error('ERROR: Could not find POSTGRES_URL. Run from the Firefly project root.')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('✓ Connected to Firefly DB')

  // Load all liabilities that have PCP metadata
  const { rows: liabilities } = await client.query(`
    SELECT id, name, outstanding_balance, notes
    FROM liabilities
    WHERE notes LIKE '%"pcp"%'
  `)

  if (liabilities.length === 0) {
    console.log('No PCP liabilities found. Nothing to sync.')
    await client.end()
    return
  }

  for (const lib of liabilities) {
    let pcp
    try { pcp = JSON.parse(lib.notes).pcp } catch { continue }
    if (!pcp?.refBalance || !pcp?.refDate) continue

    console.log(`\n── ${lib.name} ──`)
    console.log(`  Reference: £${pcp.refBalance} as of ${pcp.refDate} (${pcp.remainingAtRef} payments remaining)`)
    console.log(`  Payee in Actual Budget: ${pcp.actualPayee || 'Toyota Fin Serv'}`)

    // Try to query Actual Budget for actual payment dates
    let actualPaymentDates = []
    try {
      const token = await getActualBudgetToken()
      const txData = await queryActualTransactions(token, pcp.actualPayee || 'Toyota Fin Serv', pcp.refDate)
      if (txData?.data) {
        actualPaymentDates = txData.data
          .filter((t) => t.amount < 0 && Math.abs(t.amount) >= (pcp.monthlyPayment * 100 - 100))
          .map((t) => t.date)
        console.log(`  Found ${actualPaymentDates.length} payment(s) in Actual Budget since ${pcp.refDate}`)
      } else {
        console.log(`  Actual Budget API not reachable or no matching data — using formula only`)
      }
    } catch (e) {
      console.log(`  Actual Budget query failed: ${e.message} — using formula only`)
    }

    // Fall back to formula-based calculation if Actual Budget is unavailable
    if (actualPaymentDates.length === 0) {
      // Generate expected payment dates since refDate up to today
      const today = new Date().toISOString().slice(0, 10)
      const ref = new Date(pcp.refDate + 'T12:00:00Z')
      const next = new Date(ref)
      next.setMonth(next.getMonth() + 1)
      next.setDate(pcp.paymentDay)
      let remaining = pcp.remainingAtRef

      while (remaining > 0 && next.toISOString().slice(0, 10) <= today) {
        actualPaymentDates.push(next.toISOString().slice(0, 10))
        next.setMonth(next.getMonth() + 1)
        remaining--
      }
      console.log(`  Formula-generated ${actualPaymentDates.length} payment date(s) since reference`)
    }

    if (actualPaymentDates.length === 0) {
      console.log(`  No new payments since reference — balance unchanged: £${pcp.refBalance}`)
      continue
    }

    // Apply payments
    const { balance, lastPaymentDate } = applyPayments(
      pcp.refBalance,
      pcp.refDate,
      pcp.monthlyPayment,
      pcp.aprPct,
      pcp.paymentDay,
      actualPaymentDates
    )

    const stored = Number(lib.outstanding_balance)
    console.log(`  Calculated balance: £${balance.toFixed(2)} (stored: £${stored.toFixed(2)})`)

    if (Math.abs(balance - stored) < 0.01) {
      console.log(`  ✓ Balance up to date — no change needed`)
      continue
    }

    // Update DB: new balance + roll forward the reference point
    const paymentsApplied = actualPaymentDates.filter((d) => d > pcp.refDate).length
    const newRemaining = pcp.remainingAtRef - paymentsApplied
    const newNotes = JSON.stringify({
      pcp: {
        ...pcp,
        refBalance: balance,
        refDate: lastPaymentDate,
        remainingAtRef: Math.max(0, newRemaining),
      },
    })

    await client.query(
      `UPDATE liabilities SET outstanding_balance = $1, notes = $2, updated_at = NOW() WHERE id = $3`,
      [balance, newNotes, lib.id]
    )
    console.log(`  ✓ Updated: £${stored.toFixed(2)} → £${balance.toFixed(2)} (ref rolled to ${lastPaymentDate})`)
  }

  await client.end()
  console.log('\n✓ Sync complete')
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
