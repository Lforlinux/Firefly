/**
 * Daily job: at 23:59 server time, compute portfolio value from synced holdings
 * (fetch prices from Yahoo) and save snapshot. Today's gain = market movement vs yesterday.
 * Price refresh: every 30 mins, fetch prices for all synced holdings and store in price_cache.
 */
import { getHoldingsSync, saveSnapshot, savePriceCache, saveHoldingSnapshot } from './db.js'

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

export function getTickerForExchange(symbol, exchange) {
  const s = String(symbol).trim().toUpperCase().replace(/^NASDAQ:|^LON:|^NSE:|^BSE:/i, '')
  switch (exchange) {
    case 'NASDAQ':
      return s
    case 'LSE':
      return s.endsWith('.L') ? s : `${s}.L`
    case 'NSE':
      return s.endsWith('.NS') ? s : s.endsWith('.NSE') ? s.replace(/\.NSE$/, '.NS') : `${s}.NS`
    case 'BSE':
      return s.endsWith('.BSE') ? s : `${s}.BSE`
    default:
      return s
  }
}

function normalizeKey(s) {
  return String(s).trim().toUpperCase().replace(/\s+/g, ' ')
}

const NAME_TO_TICKER_RAW = [
  ['Invesco Nasdaq 100', 'EQQQ'],
  ['Vanguard S&P 500', 'VUAG'],
  ['iShares MSCI Japan', 'CSJP'],
  ['Vanguard FTSE Developed Europe', 'VEUR'],
  ['Vanguard FTSE Developed Asia Pacific Ex-Japan', 'VAPX'],
  ['iShares MSCI Emerging Markets IMI', 'EIMI'],
  ['iShares Physical Gold', 'SGLN'],
  ['Vanguard FTSE All-World', 'VWRL'],
  ['Vanguard FTSE All-World UCITS', 'VWRL'],
  ['Vanguard FTSE All-World UCITS ETF', 'VWRL'],
]

function buildNameToTickerMap() {
  const map = {}
  for (const [name, ticker] of NAME_TO_TICKER_RAW) {
    map[normalizeKey(name)] = ticker
  }
  return map
}

export const SECURITY_NAME_TO_TICKER = buildNameToTickerMap()

export function resolveSymbol(symbol, exchange) {
  const key = normalizeKey(symbol)
  const ticker = SECURITY_NAME_TO_TICKER[key]
  if (ticker && (exchange === 'LSE' || exchange === 'NASDAQ')) return ticker
  return symbol
}

/** Resolve a raw symbol (e.g. "iShares MSCI Emerging Markets IMI.L") to Yahoo ticker (e.g. "EIMI.L"). */
export function resolveQuoteSymbol(symbol) {
  const raw = String(symbol).trim()
  const isLse = raw.endsWith('.L') || raw.endsWith('.LON')
  const exchange = isLse ? 'LSE' : 'NASDAQ'
  const base = raw.replace(/\.(L|LON)$/i, '').trim()
  const resolved = resolveSymbol(base, exchange)
  const ticker = getTickerForExchange(resolved, exchange)
  return ticker
}

function lsePriceToPounds(ticker, price) {
  const isLse = ticker.endsWith('.L') || ticker.endsWith('.LON')
  if (isLse && price >= 1000) return price / 100
  return price
}

async function fetchPrice(ticker) {
  const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=1d`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Firefly/1.0)' },
  })
  if (!res.ok) return null
  const data = await res.json()
  const result = data.chart?.result?.[0]
  const raw = result?.meta?.regularMarketPrice
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw <= 0) return null
  return Math.round(lsePriceToPounds(ticker, raw) * 100) / 100
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Load synced UK holdings, compute total value in GBP (Cash = units*cost, else fetch price), save snapshot.
 */
export async function recordDailySnapshot() {
  const sync = getHoldingsSync()
  if (!sync?.data?.length) {
    console.log('[daily] No holdings synced; skipping snapshot.')
    return
  }
  const ukHoldings = sync.data
  let totalGBP = 0
  const date = todayStr()
  
  for (const h of ukHoldings) {
    const isCash = h.category === 'Cash' || h.symbol === 'CASH'
    let price = null
    let valueGBP = 0
    
    if (isCash) {
      valueGBP = (h.averageCost ?? 0) * (h.units ?? 0)
      price = h.averageCost ?? 0
    } else if (h.currency === 'GBP') {
      const symbol = resolveSymbol(h.symbol, h.exchange || 'LSE')
      const ticker = getTickerForExchange(symbol, h.exchange || 'LSE')
      price = await fetchPrice(ticker)
      if (price != null && price > 0) {
        valueGBP = (h.units ?? 0) * price
      } else {
        valueGBP = (h.units ?? 0) * (h.unitPrice ?? 0)
        price = h.unitPrice ?? 0
      }
      await new Promise((r) => setTimeout(r, 350))
    }
    
    totalGBP += valueGBP
    
    // Save individual holding snapshot
    if (price != null && h.currency === 'GBP') {
      saveHoldingSnapshot(
        date,
        h.symbol,
        h.name,
        h.owner,
        h.units ?? 0,
        price,
        Math.round(valueGBP * 100) / 100
      )
    }
  }
  
  saveSnapshot(date, Math.round(totalGBP * 100) / 100)
  console.log(`[daily] Snapshot saved: ${date} = £${totalGBP.toFixed(2)}`)
}

/**
 * Refresh price cache: fetch Yahoo price for each synced non-cash GBP holding, save to price_cache.
 */
export async function refreshPriceCache() {
  const sync = getHoldingsSync()
  if (!sync?.data?.length) return
  const ukHoldings = sync.data
  let count = 0
  for (const h of ukHoldings) {
    const isCash = h.category === 'Cash' || h.symbol === 'CASH'
    if (isCash || h.currency !== 'GBP') continue
    const symbol = resolveSymbol(h.symbol, h.exchange || 'LSE')
    const ticker = getTickerForExchange(symbol, h.exchange || 'LSE')
    const price = await fetchPrice(ticker)
    if (price != null && price > 0) {
      savePriceCache(ticker, price)
      count++
    }
    await new Promise((r) => setTimeout(r, 350))
  }
  if (count > 0) console.log(`[price-refresh] Cached ${count} prices`)
}

/**
 * Schedule: check every minute; at 23:59 run recordDailySnapshot.
 */
let lastRunDate = null
export function scheduleDailyJob() {
  setInterval(() => {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const today = todayStr()
    if (hour === 23 && minute === 59 && lastRunDate !== today) {
      lastRunDate = today
      recordDailySnapshot().catch((e) => console.error('[daily] Error:', e))
    }
  }, 60_000)
  console.log('[daily] Scheduled 23:59 snapshot job.')
}

const PRICE_REFRESH_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Schedule: refresh price cache every 30 minutes.
 */
export function schedulePriceRefresh() {
  refreshPriceCache().catch((e) => console.error('[price-refresh] Error:', e))
  setInterval(() => {
    refreshPriceCache().catch((e) => console.error('[price-refresh] Error:', e))
  }, PRICE_REFRESH_MS)
  console.log('[price-refresh] Scheduled every 30 minutes.')
}
