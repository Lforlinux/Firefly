/**
 * Backfill historical holding snapshots from Yahoo Finance.
 * Usage: node backfill-holdings.js [--days N]
 * 
 * Fetches up to 7 years of daily prices for each holding and stores in DB.
 */
import { getHoldingsSync, saveHoldingSnapshot, close } from './db.js'
import yfinance from 'yfinance'

const YAHOO_TICKER_MAP = {
  // UK ETFs
  'Invesco Nasdaq 100': 'EQQQ.L',
  'Vanguard S&P 500': 'VUAG.L',
  'iShares MSCI Japan': 'CSJP.L',
  'Vanguard FTSE Developed Europe': 'VEUR.L',
  'Vanguard FTSE Developed Asia Pacific Ex-Japan': 'VAPX.L',
  'iShares MSCI Emerging Markets IMI': 'EIMI.L',
  'iShares Physical Gold': 'SGLN.L',
  // Add more mappings as needed
}

function resolveYahooTicker(symbol, name) {
  // Check map first
  if (YAHOO_TICKER_MAP[name]) return YAHOO_TICKER_MAP[name]
  
  // LSE stocks usually have .L suffix
  if (!symbol.endsWith('.L') && !symbol.endsWith('.LON')) {
    return `${symbol}.L`
  }
  return symbol.replace('.LON', '.L')
}

function lsePriceToPounds(price) {
  if (price >= 1000) return price / 100
  return price
}

async function backfill(holdings, days = 365 * 7) {
  console.log(`Backfilling up to ${days} days for ${holdings.length} holdings...`)
  
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  
  let count = 0
  
  for (const h of holdings) {
    const ticker = resolveYahooTicker(h.symbol, h.name)
    console.log(`  Fetching ${ticker} (${h.name})...`)
    
    try {
      const data = yfinance.download(ticker, start=startDate, end=endDate, progress=false)
      
      if (!data || data.length === 0) {
        console.log(`    No data for ${ticker}`)
        continue
      }
      
      // Process each day
      for (const [date, row] of data.iterrows()) {
        let price = row['Close']
        if (Array.isArray(price)) price = price[0] // Handle multi-index
        price = lsePriceToPounds(price)
        const valueGBP = h.units * price
        
        saveHoldingSnapshot(
          date.toISOString().slice(0, 10),
          h.symbol,
          h.name,
          h.owner,
          h.units,
          Math.round(price * 100) / 100,
          Math.round(valueGBP * 100) / 100
        )
        count++
      }
      
      console.log(`    Saved ${data.length} days`)
    } catch (e) {
      console.error(`    Error: ${e.message}`)
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 200))
  }
  
  console.log(`Done! Saved ${count} historical snapshots.`)
}

async function main() {
  const args = process.argv.slice(2)
  let days = 365 * 7 // Default 7 years
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[i + 1], 10)
    }
  }
  
  const sync = getHoldingsSync()
  if (!sync?.data?.length) {
    console.log('No holdings synced. Run sync first.')
    process.exit(1)
  }
  
  await backfill(sync.data, days)
  close()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
