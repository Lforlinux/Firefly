import type { Exchange } from '@/types'

/**
 * Build ticker symbol for the given exchange (used by Twelve Data and display).
 * - NASDAQ: symbol as-is (e.g. AAPL, NVDA)
 * - LSE: symbol.L (e.g. VUAG.L)
 */
export function getTickerForExchange(symbol: string, exchange: Exchange): string {
  const s = symbol.trim().toUpperCase().replace(/^NASDAQ:|^LON:/i, '')
  switch (exchange) {
    case 'NASDAQ':
      return s
    case 'LSE':
      return s.endsWith('.L') ? s : `${s}.L`
    default:
      return s
  }
}

/** Alternate ticker for Alpha Vantage fallback. LSE: .LON */
function getTickerAlternate(symbol: string, exchange: Exchange): string | null {
  const s = symbol.trim().toUpperCase().replace(/^NASDAQ:|^LON:/i, '')
  const base = s.replace(/\.L$/, '')
  if (exchange === 'LSE') return `${base}.LON`
  return null
}

/** Map InvestEngine/ISA CSV security names (before " / ISIN") to LSE/NASDAQ tickers. */
const SECURITY_NAME_TO_TICKER: Record<string, string> = {
  'INVESCO NASDAQ 100': 'EQQQ',
  'VANGUARD S&P 500': 'VUAG',
  'ISHARES MSCI JAPAN': 'IJPN',
  'VANGUARD FTSE DEVELOPED EUROPE': 'VEUR',
  'VANGUARD FTSE DEVELOPED ASIA PACIFIC EX-JAPAN': 'VAPX',
  'ISHARES MSCI EMERGING MARKETS IMI': 'EIMI',
  'ISHARES PHYSICAL GOLD': 'SGLN',
}

function resolveSecurityNameToTicker(symbol: string, exchange: Exchange): string {
  const key = symbol.trim().toUpperCase().replace(/\s+/g, ' ')
  const ticker = SECURITY_NAME_TO_TICKER[key]
  if (ticker && (exchange === 'LSE' || exchange === 'NASDAQ')) return ticker
  return symbol
}

/** LSE symbols that Twelve Data free tier does not include (Grow plan). These use Alpha Vantage fallback. */
const TWELVEDATA_LSE_FREE_TIER_UNSUPPORTED = new Set([
  'EQQQ', 'EIMI', 'VUAG', 'VAPX', 'VEUR', 'IJPN', 'SGLN',
])

/** True if this symbol+exchange is known to need Alpha Vantage only (Twelve Data free tier doesn't include it). */
function needsAlphaVantageOnly(symbol: string, exchange: Exchange): boolean {
  const resolved = resolveSecurityNameToTicker(symbol, exchange)
  const baseResolved = resolved.trim().toUpperCase().replace(/\.L$/i, '')
  return exchange === 'LSE' && TWELVEDATA_LSE_FREE_TIER_UNSUPPORTED.has(baseResolved)
}

/**
 * Which provider will be used for a quote: Twelve Data (free tier) or Alpha Vantage (fallback).
 */
export function getQuoteProvider(symbol: string, exchange: Exchange): 'Twelve Data' | 'Alpha Vantage (fallback)' {
  return needsAlphaVantageOnly(symbol, exchange) ? 'Alpha Vantage (fallback)' : 'Twelve Data'
}

/** Ticker used by server for price cache (resolve name + exchange suffix). */
export function getTickerForHolding(symbol: string, exchange: Exchange): string {
  return getTickerForExchange(resolveSecurityNameToTicker(symbol, exchange), exchange)
}

/** Yahoo Finance: unofficial, no API key, may be blocked by CORS in browser. Tried first for all symbols. */
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'
const TWELVEDATA_BASE = 'https://api.twelvedata.com'
const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query'
const TWELVEDATA_USAGE_KEY = 'personal-fin-app-twelvedata-usage'
const AV_USAGE_KEY = 'personal-fin-app-alpha-vantage-usage'
const DAILY_LIMIT_TD = 800
const MIN_MS_AV = 1100

/** Twelve Data: credits reset each minute; free tier 8 credits/min. Use 8.5s between requests. */
const MIN_MS_TD = 8500

/** Delay in ms between requests when doing "refresh all". */
export const REFRESH_ALL_DELAY_MS_TWELVEDATA = MIN_MS_TD

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function recordTdRequest(): void {
  try {
    const raw = localStorage.getItem(TWELVEDATA_USAGE_KEY)
    const today = todayKey()
    const prev: { date: string; used: number } = raw ? JSON.parse(raw) : { date: '', used: 0 }
    const used = prev.date === today ? prev.used + 1 : 1
    localStorage.setItem(TWELVEDATA_USAGE_KEY, JSON.stringify({ date: today, used }))
  } catch {
    // ignore
  }
}

/** Estimated usage for today (only counts requests made by this app). */
export function getTwelveDataUsage(): { date: string; used: number; limit: number; remaining: number } {
  try {
    const raw = localStorage.getItem(TWELVEDATA_USAGE_KEY)
    const today = todayKey()
    const prev: { date: string; used: number } = raw ? JSON.parse(raw) : { date: '', used: 0 }
    const used = prev.date === today ? prev.used : 0
    return {
      date: today,
      used,
      limit: DAILY_LIMIT_TD,
      remaining: Math.max(0, DAILY_LIMIT_TD - used),
    }
  } catch {
    return { date: todayKey(), used: 0, limit: DAILY_LIMIT_TD, remaining: DAILY_LIMIT_TD }
  }
}

function recordAvRequest(): void {
  try {
    const raw = localStorage.getItem(AV_USAGE_KEY)
    const today = todayKey()
    const prev: { date: string; used: number } = raw ? JSON.parse(raw) : { date: '', used: 0 }
    const used = prev.date === today ? prev.used + 1 : 1
    localStorage.setItem(AV_USAGE_KEY, JSON.stringify({ date: today, used }))
  } catch {
    /* ignore */
  }
}

let lastYahooRequestTime = 0
let lastTdRequestTime = 0
let lastAvRequestTime = 0
const MIN_MS_YAHOO = 300

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function throttleAv(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastAvRequestTime
  if (elapsed < MIN_MS_AV && lastAvRequestTime > 0) await delay(MIN_MS_AV - elapsed)
}

async function throttleTd(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastTdRequestTime
  if (elapsed < MIN_MS_TD && lastTdRequestTime > 0) {
    await delay(MIN_MS_TD - elapsed)
  }
}

export interface QuoteResult {
  price: number
  error?: string
}

/**
 * Fetch latest price from Alpha Vantage GLOBAL_QUOTE.
 * Set VITE_ALPHA_VANTAGE_KEY in .env or pass apiKey. Free key: https://www.alphavantage.co/support/#api-key
 */
/** Alpha Vantage returns LSE prices in pence (e.g. EQQQ.L "05. price": "44429" = £444.29). Convert to pounds when >= 1000. */
function lsePriceToPounds(ticker: string, price: number): number {
  const isLse = ticker.endsWith('.L') || ticker.endsWith('.LON')
  if (isLse && price >= 1000) return price / 100
  return price
}

function parseAvQuoteResponse(data: Record<string, unknown>, ticker: string): QuoteResult {
  if (data.Note && typeof data.Note === 'string') {
    return { price: 0, error: 'Alpha Vantage rate limit (25/day). Try again later or refresh one at a time.' }
  }
  if (data['Error Message'] && typeof data['Error Message'] === 'string') {
    return { price: 0, error: (data['Error Message'] as string).trim() }
  }
  if (data.Information && typeof data.Information === 'string') {
    const info = (data.Information as string).trim()
    if (/rate limit|25 request|spreading out|free api request|premium/i.test(info)) {
      return { price: 0, error: 'Alpha Vantage rate limit (25/day). Try again tomorrow or upgrade at alphavantage.co/premium.' }
    }
    return { price: 0, error: info }
  }
  const quote = data['Global Quote'] as Record<string, unknown> | undefined
  if (!quote) {
    return { price: 0, error: 'No quote in Alpha Vantage response.' }
  }
  const priceStr = quote['05. price']
  if (priceStr != null && String(priceStr).trim() !== '') {
    let price = parseFloat(String(priceStr).trim())
    if (!Number.isNaN(price) && price > 0) {
      price = lsePriceToPounds(ticker, price)
      return { price: Math.round(price * 100) / 100 }
    }
  }
  return { price: 0, error: `No quote for "${ticker}". Check symbol and exchange.` }
}

/** Parse Twelve Data /quote response. Success: object with "close". Error: status "error" + code/message.
 * 404 = symbol not on free tier (e.g. LSE ETFs like EQQQ/EIMI need Grow plan) — app falls back to Alpha Vantage. */
function parseTwelveDataQuote(data: Record<string, unknown>, ticker: string): QuoteResult {
  const code = data.code as number | undefined
  const status = data.status as string | undefined
  const message = data.message as string | undefined
  if (status === 'error' && message) {
    if (code === 429) return { price: 0, error: 'Twelve Data rate limit (800/day, 8/min). Wait a moment and try again.' }
    if (code === 401) return { price: 0, error: 'Invalid Twelve Data API key. Check More → Settings.' }
    if (code === 404) {
      const isGrowPlan = /Grow|upgrading|pricing/i.test(message)
      return {
        price: 0,
        error: isGrowPlan
          ? `Twelve Data free tier doesn't include this symbol (${ticker}). Add Alpha Vantage key in More → Settings for fallback.`
          : `Symbol "${ticker}" not found. Check symbol and exchange.`,
      }
    }
    return { price: 0, error: message }
  }
  const closeStr = data.close
  if (closeStr != null && String(closeStr).trim() !== '') {
    const price = parseFloat(String(closeStr).trim())
    if (!Number.isNaN(price) && price > 0) {
      const p = lsePriceToPounds(ticker, price)
      return { price: p }
    }
  }
  return { price: 0, error: `No quote for "${ticker}". Check symbol and exchange.` }
}

/** Parse Yahoo Finance v8 chart response. Price may be in pence for LSE; we convert to pounds when >= 1000. */
function parseYahooChartResponse(data: Record<string, unknown>, ticker: string): QuoteResult {
  const chart = data.chart as { result?: Array<{ meta?: { regularMarketPrice?: number } }> } | undefined
  const result = chart?.result?.[0]
  const price = result?.meta?.regularMarketPrice
  if (typeof price === 'number' && !Number.isNaN(price) && price > 0) {
    const p = lsePriceToPounds(ticker, price)
    return { price: Math.round(p * 100) / 100 }
  }
  return { price: 0, error: `No quote for "${ticker}" from Yahoo.` }
}

/** Try our backend first (no CORS); fall back to direct Yahoo if backend unavailable. */
async function fetchQuoteYahoo(symbol: string, exchange: Exchange): Promise<QuoteResult> {
  const now = Date.now()
  const elapsed = now - lastYahooRequestTime
  if (elapsed < MIN_MS_YAHOO && lastYahooRequestTime > 0) await delay(MIN_MS_YAHOO - elapsed)
  const ticker = getTickerForExchange(symbol, exchange)
  lastYahooRequestTime = Date.now()

  try {
    const apiRes = await fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`)
    if (apiRes.ok) {
      const data = (await apiRes.json()) as { price?: number; error?: string }
      if (typeof data.price === 'number' && data.price > 0) {
        return { price: data.price }
      }
      return { price: 0, error: data.error ?? 'No quote from API.' }
    }
  } catch {
    /* backend not running or not reachable; fall back to direct Yahoo (may hit CORS in browser) */
  }

  try {
    const res = await fetch(`${YAHOO_CHART_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalFinance/1.0)' },
    })
    if (!res.ok) return { price: 0, error: `Yahoo: ${res.status}` }
    const data = (await res.json()) as Record<string, unknown>
    return parseYahooChartResponse(data, ticker)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error'
    return { price: 0, error: `Yahoo: ${msg}` }
  }
}

/** Twelve Data LSE: try base+XLON, base+LSE, then base.L (no exchange). Some symbols need LSE or .L form. */
function getTwelveDataSymbolAndExchange(symbol: string, exchange: Exchange): { symbol: string; exchange?: string }[] {
  const s = symbol.trim().toUpperCase().replace(/^NASDAQ:|^LON:|^NSE:|^BSE:/i, '')
  const base = s.replace(/\.L$/, '').replace(/\.NS$/, '').replace(/\.NSE$/, '').replace(/\.BSE$/, '')
  if (exchange === 'LSE') {
    return [
      { symbol: base, exchange: 'XLON' },
      { symbol: base, exchange: 'LSE' },
      { symbol: base + '.L', exchange: 'XLON' },
      { symbol: base + '.L' },
    ]
  }
  if (exchange === 'NASDAQ') return [{ symbol: base, exchange: 'NASDAQ' }]
  return [{ symbol: getTickerForExchange(symbol, exchange), exchange: undefined }]
}

/** Twelve Data quote API: GET /quote?symbol=SYMBOL&exchange=EXCHANGE&apikey=KEY (same as curl test). */
async function fetchQuoteTwelveData(
  symbol: string,
  exchange: Exchange,
  apiKey: string
): Promise<QuoteResult> {
  const key = apiKey.trim()
  const toTry = getTwelveDataSymbolAndExchange(symbol, exchange)

  for (let i = 0; i < toTry.length; i++) {
    await throttleTd()
    const { symbol: sym, exchange: exParam } = toTry[i]
    const url = new URL(`${TWELVEDATA_BASE}/quote`)
    url.searchParams.set('symbol', sym)
    url.searchParams.set('apikey', key)
    if (exParam) url.searchParams.set('exchange', exParam)
    try {
      const res = await fetch(url.toString())
      lastTdRequestTime = Date.now()
      recordTdRequest()
      const data = (await res.json()) as Record<string, unknown>
      const result = parseTwelveDataQuote(data, sym)
      if (result.price > 0) return result
      if (result.error && (data.code === 429 || data.code === 401)) return result
      if (i === toTry.length - 1) return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      return { price: 0, error: msg }
    }
  }
  const lastSym = toTry[toTry.length - 1]?.symbol ?? symbol
  const hint =
    exchange === 'LSE'
      ? ' Twelve Data may not list this LSE symbol — try twelvedata.com symbol search or enter price manually.'
      : ''
  return {
    price: 0,
    error: `No quote for "${lastSym}". Check symbol and exchange.${hint}`,
  }
}

/** Fetch price. Tries Yahoo Finance first (free, no key), then Twelve Data, then Alpha Vantage. */
export async function fetchQuote(
  symbol: string,
  exchange: Exchange,
  twelveDataKey?: string,
  alphaVantageKey?: string
): Promise<QuoteResult> {
  const tdKey = (twelveDataKey ?? import.meta.env.VITE_TWELVEDATA_KEY)?.trim()
  const avKey = (alphaVantageKey ?? import.meta.env.VITE_ALPHA_VANTAGE_KEY)?.trim()
  const resolvedSymbol = resolveSecurityNameToTicker(symbol, exchange)

  const yahooResult = await fetchQuoteYahoo(resolvedSymbol, exchange)
  if (yahooResult.price > 0) return yahooResult

  const useAvOnly = needsAlphaVantageOnly(resolvedSymbol, exchange)
  if (useAvOnly) {
    if (!avKey) {
      return {
        price: 0,
        error: yahooResult.error
          ? `${yahooResult.error} No Alpha Vantage key — add one in More → Settings for fallback.`
          : 'This symbol (LSE ETF) needs Alpha Vantage. Set VITE_ALPHA_VANTAGE_KEY in .env or in More → Settings.',
      }
    }
    const avResult = await fetchQuoteAlphaVantage(resolvedSymbol, exchange, avKey)
    if (avResult.price > 0) return avResult
    if (yahooResult.error) {
      return {
        price: 0,
        error: `${yahooResult.error} Then Alpha Vantage: ${avResult.error ?? 'no quote'}.`,
      }
    }
    return avResult
  }

  if (!tdKey) {
    return { price: 0, error: 'No API key. Set VITE_TWELVEDATA_KEY in .env or in More → Settings.' }
  }
  const tdResult = await fetchQuoteTwelveData(resolvedSymbol, exchange, tdKey)
  if (tdResult.price > 0) return tdResult
  if (tdResult.error && /rate limit|Invalid.*key/i.test(tdResult.error)) return tdResult

  if (!avKey) return tdResult

  return fetchQuoteAlphaVantage(resolvedSymbol, exchange, avKey)
}

async function fetchQuoteAlphaVantage(
  symbol: string,
  exchange: Exchange,
  avKey: string
): Promise<QuoteResult> {
  await throttleAv()
  const tickersToTry = [getTickerForExchange(symbol, exchange)]
  const alt = getTickerAlternate(symbol, exchange)
  if (alt && alt !== tickersToTry[0]) tickersToTry.push(alt)
  for (const ticker of tickersToTry) {
    try {
      const url = `${ALPHA_VANTAGE_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(avKey)}`
      const res = await fetch(url)
      lastAvRequestTime = Date.now()
      recordAvRequest()
      const data = (await res.json()) as Record<string, unknown>
      const result = parseAvQuoteResponse(data, ticker)
      if (result.price > 0) return result
      if (result.error && /rate limit|25 request|spreading out/i.test(result.error)) return result
      if (ticker === tickersToTry[tickersToTry.length - 1]) return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      return { price: 0, error: msg }
    }
  }
  return {
    price: 0,
    error: `No quote for "${tickersToTry[tickersToTry.length - 1]}". Check symbol and exchange.`,
  }
}
