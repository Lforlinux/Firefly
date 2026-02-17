/**
 * Daily job: at 23:59 server time, compute portfolio value from synced holdings
 * (fetch prices from Yahoo) and save snapshot. Today's gain = market movement vs yesterday.
 * Price refresh: every 30 mins, fetch prices for all synced holdings and store in price_cache.
 */
import { getHoldingsSync, saveSnapshot, savePriceCache } from './db.js'

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

function getTickerForExchange(symbol, exchange) {
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

const SECURITY_NAME_TO_TICKER = {
  'INVESCO NASDAQ 100': 'EQQQ',
  'VANGUARD S&P 500': 'VUAG',
  'ISHARES MSCI JAPAN': 'IJPN',
  'VANGUARD FTSE DEVELOPED EUROPE': 'VEUR',
  'VANGUARD FTSE DEVELOPED ASIA PACIFIC EX-JAPAN': 'VAPX',
  'ISHARES MSCI EMERGING MARKETS IMI': 'EIMI',
  'ISHARES PHYSICAL GOLD': 'SGLN',
}

function resolveSymbol(symbol, exchange) {
  const key = String(symbol).trim().toUpperCase().replace(/\s+/g, ' ')
  const ticker = SECURITY_NAME_TO_TICKER[key]
  if (ticker && (exchange === 'LSE' || exchange === 'NASDAQ')) return ticker
  return symbol
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
  for (const h of ukHoldings) {
    const isCash = h.category === 'Cash' || h.symbol === 'CASH'
    if (isCash) {
      totalGBP += (h.averageCost ?? 0) * (h.units ?? 0)
      continue
    }
    if (h.currency !== 'GBP') continue // only GBP for UK portfolio snapshot
    const symbol = resolveSymbol(h.symbol, h.exchange || 'LSE')
    const ticker = getTickerForExchange(symbol, h.exchange || 'LSE')
    const price = await fetchPrice(ticker)
    if (price != null && price > 0) {
      totalGBP += (h.units ?? 0) * price
    } else {
      totalGBP += (h.units ?? 0) * (h.unitPrice ?? 0)
    }
    await new Promise((r) => setTimeout(r, 350))
  }
  const date = todayStr()
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
