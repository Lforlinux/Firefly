/**
 * Check contents of holdings_sync table (used for price refresh).
 * Run from project root: node server/check-holdings-sync.js
 */
import { getHoldingsSync } from './db.js'

const sync = getHoldingsSync()
if (!sync) {
  console.log('holdings_sync: (empty) — no row with id=1')
  console.log('Prices are only fetched for holdings in this table.')
  console.log('Sync holdings via POST /api/sync-holdings with { ukHoldings: [...] }')
  process.exit(0)
}

console.log('holdings_sync:')
console.log('  updated_at:', sync.updatedAt)
console.log('  holdings count:', sync.data?.length ?? 0)
if (Array.isArray(sync.data) && sync.data.length > 0) {
  console.log('\nHoldings (symbol, exchange, units, category):')
  for (const h of sync.data) {
    const ticker = (h.exchange === 'LSE' ? (h.symbol?.endsWith('.L') ? h.symbol : `${h.symbol}.L`) : h.symbol) || h.symbol
    console.log(`  - ${h.name || h.symbol}  symbol=${h.symbol}  exchange=${h.exchange || 'LSE'}  units=${h.units}  category=${h.category ?? '-'}  → ticker=${ticker}`)
  }
} else {
  console.log('  (no holdings in data array)')
}
