import { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, getDbClient } from '../lib/vercel-auth.js'

/**
 * Price sources (in priority order):
 * 1. T212 REST API — if T212_API_KEY env var is set (recommended)
 * 2. Yahoo Finance — free, no key; fallback for any ticker not priced above
 *    (covers UK .L, India .NS, and US tickers — Stooq was tried here previously
 *    but is unreliable from Vercel's IPs, so it has been dropped)
 *
 * FX rates: Frankfurter.app — always free, no key, works from any IP.
 */

// Old ticker → current ticker mapping for renamed companies
const TICKER_ALIASES: Record<string, string> = {
  FB:   'META',  // Meta Platforms (rebranded Oct 2021)
  AAXN: 'AXON', // Axon Enterprise (rebranded Apr 2021)
  TWTR: 'X',    // X Corp (formerly Twitter)
}

// ---------------------------------------------------------------------------
// T212 REST API
// ---------------------------------------------------------------------------
async function fetchT212Prices(
  apiKey: string,
  tickers: string[],
  asOf: string,
): Promise<Record<string, { price: number; currency: string; asOf: string }>> {
  const res = await fetch('https://live.trading212.com/api/v0/equity/portfolio', {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const rateRemaining = res.headers.get('x-ratelimit-remaining')
    console.error(
      `[refresh-prices] T212 API HTTP ${res.status}` +
      (rateRemaining ? ` (rate-limit-remaining=${rateRemaining})` : '') +
      `: ${body.slice(0, 500)}`
    )
    // 401 = bad/expired API key, 403 = key missing the "portfolio" scope,
    // 429 = rate limited — surfacing the body distinguishes these from a
    // generic IP block, which T212 only applies if an IP allow-list is
    // configured on the key itself (Settings > API on trading212.com).
    throw new Error(`T212 API HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const positions: any[] = await res.json()

  const out: Record<string, { price: number; currency: string; asOf: string }> = {}
  const tickerSet = new Set(tickers.map((t) => t.toUpperCase()))

  for (const pos of positions) {
    // T212 ticker format: NVDA_US_EQ → strip suffix to get NVDA
    const raw = String(pos.ticker || '')
    const ticker = raw.replace(/_[A-Z]+_EQ$/, '').replace(/_EQ$/, '').toUpperCase()
    if (!tickerSet.has(ticker)) continue
    // Never fall back to averagePrice (cost basis) — that would book unrealised
    // gain/loss as a single day's movement whenever currentPrice is briefly null.
    const price = Number(pos.currentPrice)
    if (!Number.isFinite(price) || price <= 0) continue
    out[ticker] = { price, currency: 'USD', asOf }
  }
  return out
}

// ---------------------------------------------------------------------------
// Yahoo Finance — fallback for any ticker T212 didn't price (UK .L, India .NS,
// US stocks). Handles GBp → GBP conversion for LSE-listed securities.
// ---------------------------------------------------------------------------
async function yahooPrice(ticker: string): Promise<{ price: number; currency: string } | { error: string }> {
  const lookupTicker = TICKER_ALIASES[ticker.toUpperCase()] || ticker
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(lookupTicker)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { error: `Yahoo HTTP ${res.status}` }
    const body = await res.json()
    const meta = body?.chart?.result?.[0]?.meta
    const rawPrice = meta?.regularMarketPrice
    const rawCcy = String(meta?.currency || '')
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) return { error: 'No price from Yahoo' }
    // Yahoo returns GBp (pence) for LSE-listed securities — convert to GBP
    const isGBp = rawCcy === 'GBp'
    return { price: isGBp ? rawPrice / 100 : rawPrice, currency: isGBp ? 'GBP' : rawCcy }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'fetch failed' }
  }
}

// ---------------------------------------------------------------------------
// Yahoo Finance daily history — used to backfill missed trading days so a gap
// in cron runs reconstructs one real bar per day instead of collapsing the
// whole gap into a single oversized movement. Returns closes oldest → newest,
// already normalised to major units (GBp → GBP).
// ---------------------------------------------------------------------------
async function yahooDailyHistory(
  ticker: string,
  fromDate: string,
  toDate: string,
): Promise<{ closes: { date: string; close: number }[]; currency: string } | { error: string }> {
  const lookupTicker = TICKER_ALIASES[ticker.toUpperCase()] || ticker
  const period1 = Math.floor(new Date(`${fromDate}T00:00:00Z`).getTime() / 1000)
  const period2 = Math.floor(new Date(`${toDate}T23:59:59Z`).getTime() / 1000)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(lookupTicker)}?interval=1d&period1=${period1}&period2=${period2}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { error: `Yahoo hist HTTP ${res.status}` }
    const body = await res.json()
    const result = body?.chart?.result?.[0]
    const timestamps: number[] = result?.timestamp || []
    const rawCloses: (number | null)[] = result?.indicators?.quote?.[0]?.close || []
    const rawCcy = String(result?.meta?.currency || '')
    const isGBp = rawCcy === 'GBp'
    const closes: { date: string; close: number }[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const c = rawCloses[i]
      if (!Number.isFinite(c) || (c as number) <= 0) continue
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
      closes.push({ date, close: isGBp ? (c as number) / 100 : (c as number) })
    }
    if (closes.length === 0) return { error: 'No history from Yahoo' }
    return { closes, currency: isGBp ? 'GBP' : rawCcy }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'fetch failed' }
  }
}

// ---------------------------------------------------------------------------
// Frankfurter FX (always works)
// ---------------------------------------------------------------------------
async function frankfurterRates(from: string, tos: string[]): Promise<Record<string, number>> {
  if (tos.length === 0) return {}
  const url = `https://api.frankfurter.dev/v1/latest?from=${from}&to=${[...new Set(tos)].join(',')}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`)
  const body = await res.json()
  return body?.rates || {}
}

// ---------------------------------------------------------------------------
// Inline FX helper (mirrors calculations.ts convertToBase for server use)
// ---------------------------------------------------------------------------
function toBase(amount: number, from: string, fxMap: Record<string, number>, base: string): number {
  if (!from || from.toUpperCase() === base.toUpperCase()) return amount
  const rate = fxMap[`${from.toUpperCase()}_${base.toUpperCase()}`]
  return rate ? amount * rate : amount
}

function ownerFromNotes(notes: string | null): string | undefined {
  if (!notes) return undefined
  const m = notes.match(/Owner:\s*([A-Za-z][A-Za-z0-9 _'-]*)/)
  return m ? m[1].trim() : undefined
}

// ---------------------------------------------------------------------------
// Save daily movements for a user after prices have been refreshed
// ---------------------------------------------------------------------------
async function saveDailyMovements(
  db: Awaited<ReturnType<typeof getDbClient>>,
  userId: string,
  base: string,
  fxMap: Record<string, number>,
  today: string,
) {
  // Include cash holdings too — for a true wealth value, cash in investment
  // accounts (Plum, broker cash) counts. They have no price feed, so they're
  // valued at avg_cost below and never contribute to the daily movement.
  const hRes = await db.query(
    `SELECT h.ticker, h.shares, h.currency, h.notes, h.avg_cost
     FROM holdings h
     WHERE h.user_id = $1`,
    [userId]
  )
  const holdings: { ticker: string; shares: number; currency: string; notes: string | null; avg_cost: number }[] = hRes.rows || []
  if (holdings.length === 0) return

  const priceRes = await db.query(`SELECT ticker, price, currency, prev_close FROM price_cache`)
  const priceMap = new Map<string, { price: number; currency: string; prevClose: number | null }>(
    (priceRes.rows || []).map((r: any) => [
      String(r.ticker),
      { price: Number(r.price), currency: String(r.currency), prevClose: r.prev_close != null ? Number(r.prev_close) : null },
    ])
  )

  // Guard: never write a snapshot when a currency we must convert has no rate.
  // toBase() would otherwise treat the missing rate as 1:1 and distort the value
  // (this is what wrote a £6M/£47k row when the INR fetch timed out). Skipping
  // this run is safe — the next run (or backfill) fills the day correctly.
  const baseU = base.toUpperCase()
  const neededCcys = new Set<string>()
  for (const h of holdings) {
    const cc = (priceMap.get(h.ticker)?.currency || h.currency || base).toUpperCase()
    if (cc && cc !== 'GBX') neededCcys.add(cc)
  }
  for (const cc of neededCcys) {
    if (cc !== baseU && !(fxMap[`${cc}_${baseU}`] > 0)) {
      console.error(`[refresh-prices] skipping movement save for user ${userId}: missing FX ${cc}->${baseU}`)
      return
    }
  }

  // Determine distinct owners from holdings
  const owners = new Set<string>(['all'])
  for (const h of holdings) {
    const o = ownerFromNotes(h.notes)
    if (o) owners.add(o)
  }

  let allPortfolioValue = 0

  for (const owner of owners) {
    const filtered = owner === 'all'
      ? holdings
      : holdings.filter((h) => ownerFromNotes(h.notes)?.toLowerCase() === owner.toLowerCase())

    let movement = 0
    let portfolioValue = 0

    for (const h of filtered) {
      const q = priceMap.get(h.ticker)

      // Portfolio value counts EVERY holding: live price when available, else
      // cost basis. Assets with no daily price feed (Indian MFs, EPF) have a
      // price but no prev_close — they were being dropped, undervaluing the
      // total by ~their full value. prev_close is only needed for the movement.
      let unitPrice = q && Number.isFinite(q.price) && q.price > 0 ? q.price : Number(h.avg_cost)
      let valueCcy = q?.currency || h.currency || base
      if (valueCcy === 'GBX') { unitPrice = unitPrice / 100; valueCcy = 'GBP' } // pence → GBP
      if (Number.isFinite(unitPrice) && unitPrice > 0) {
        portfolioValue += h.shares * unitPrice * toBase(1, valueCcy, fxMap, base)
      }

      // Daily movement only for holdings that have a previous close to compare.
      if (q && q.prevClose != null) {
        movement += h.shares * (q.price - q.prevClose) * toBase(1, q.currency, fxMap, base)
      }
    }

    if (portfolioValue <= 0) continue

    if (owner === 'all') allPortfolioValue = portfolioValue

    await db.query(
      `INSERT INTO daily_movements (user_id, movement_date, owner, movement_gbp, portfolio_value_gbp)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, movement_date, owner)
       DO UPDATE SET movement_gbp = EXCLUDED.movement_gbp, portfolio_value_gbp = EXCLUDED.portfolio_value_gbp`,
      [userId, today, owner, movement, portfolioValue]
    )
  }

  // Save goal progress snapshot for the combined portfolio
  if (allPortfolioValue > 0) {
    const goalsRes = await db.query(
      `SELECT title, target_amount FROM goals WHERE user_id = $1`,
      [userId]
    )
    for (const g of goalsRes.rows || []) {
      const target = Number(g.target_amount)
      if (target <= 0) continue
      const pct = (allPortfolioValue / target) * 100
      await db.query(
        `INSERT INTO daily_goal_snapshots (user_id, snapshot_date, goal_title, target_amount, portfolio_gbp, progress_pct)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, snapshot_date, goal_title)
         DO UPDATE SET target_amount = EXCLUDED.target_amount, portfolio_gbp = EXCLUDED.portfolio_gbp, progress_pct = EXCLUDED.progress_pct`,
        [userId, today, g.title, target, allPortfolioValue, pct]
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Backfill daily movements for trading days missed while the cron wasn't
// running. Reconstructs one real bar per missing day from Yahoo daily closes
// so a multi-day gap no longer collapses into a single oversized bar. Runs
// BEFORE saveDailyMovements writes today's row, and never overwrites existing
// rows (ON CONFLICT DO NOTHING). No-op in normal daily operation.
// ---------------------------------------------------------------------------
async function backfillDailyMovements(
  db: Awaited<ReturnType<typeof getDbClient>>,
  userId: string,
  base: string,
  fxMap: Record<string, number>,
  today: string,
  histCache: Map<string, { closes: { date: string; close: number }[]; currency: string } | null>,
) {
  const lastRes = await db.query(
    `SELECT MAX(movement_date) AS last FROM daily_movements WHERE user_id = $1 AND owner = 'all'`,
    [userId]
  )
  const lastRaw = lastRes.rows?.[0]?.last
  if (!lastRaw) return // no history yet — nothing to backfill against
  const lastDate = new Date(lastRaw).toISOString().slice(0, 10)

  // Only a gap of ≥2 days can hide a missing trading day. If the last recorded
  // day is today or yesterday there is nothing to fill — bail before any fetch.
  const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
  if (lastDate >= yesterday) return

  // Bound the window so a very old last-run doesn't fetch months of data.
  const MAX_BACKFILL_DAYS = 45
  const earliest = new Date(Date.now() - MAX_BACKFILL_DAYS * 86400000).toISOString().slice(0, 10)
  const gapFrom = lastDate > earliest ? lastDate : earliest

  const hRes = await db.query(
    `SELECT h.ticker, h.shares, h.currency, h.notes, h.avg_cost
     FROM holdings h WHERE h.user_id = $1`,
    [userId]
  )
  const holdings: { ticker: string; shares: number; currency: string; notes: string | null; avg_cost: number }[] = hRes.rows || []
  if (holdings.length === 0) return

  const equityTickers = [...new Set(
    holdings
      .filter((h) => h.ticker && !String(h.ticker).startsWith('CASH:'))
      .map((h) => String(h.ticker))
  )]

  // Start history a week before the gap so the first missing day has a prior
  // close to diff against. Fetch each ticker once, shared across users.
  const histFrom = new Date(new Date(`${gapFrom}T00:00:00Z`).getTime() - 7 * 86400000).toISOString().slice(0, 10)
  await Promise.all(equityTickers.map(async (t) => {
    if (histCache.has(t)) return
    const h = await yahooDailyHistory(t, histFrom, today)
    histCache.set(t, 'error' in h ? null : h)
  }))

  // Candidate missing days: any close date strictly inside (gapFrom, today).
  const candidateDates = new Set<string>()
  for (const t of equityTickers) {
    const hist = histCache.get(t)
    if (!hist) continue
    for (const { date } of hist.closes) {
      if (date > gapFrom && date < today) candidateDates.add(date)
    }
  }
  if (candidateDates.size === 0) return

  // Drop days that already have rows (defensive — MAX() should exclude them).
  const existingRes = await db.query(
    `SELECT DISTINCT movement_date FROM daily_movements
     WHERE user_id = $1 AND movement_date > $2 AND movement_date < $3`,
    [userId, gapFrom, today]
  )
  const existingDates = new Set(
    (existingRes.rows || []).map((r: any) => new Date(r.movement_date).toISOString().slice(0, 10))
  )
  const missingDates = [...candidateDates].filter((d) => !existingDates.has(d)).sort()
  if (missingDates.length === 0) return

  const owners = new Set<string>(['all'])
  for (const h of holdings) {
    const o = ownerFromNotes(h.notes)
    if (o) owners.add(o)
  }

  let filled = 0
  for (const owner of owners) {
    const filtered = owner === 'all'
      ? holdings
      : holdings.filter((h) => ownerFromNotes(h.notes)?.toLowerCase() === owner.toLowerCase())

    for (const date of missingDates) {
      let movement = 0
      let portfolioValue = 0

      for (const h of filtered) {
        const hist = histCache.get(String(h.ticker))
        if (hist) {
          const idx = hist.closes.findIndex((c) => c.date === date)
          // Movement needs the trading day immediately before `date`.
          if (idx > 0) {
            movement += h.shares * (hist.closes[idx].close - hist.closes[idx - 1].close) * toBase(1, hist.currency, fxMap, base)
          }
          // Value at `date` uses the most recent close on or before it.
          let asOfClose: number | null = null
          for (const c of hist.closes) {
            if (c.date <= date) asOfClose = c.close
            else break
          }
          if (asOfClose != null && asOfClose > 0) {
            portfolioValue += h.shares * asOfClose * toBase(1, hist.currency, fxMap, base)
            continue
          }
        }
        // No price feed (cash/MF/EPF) or no close yet — value at cost basis.
        let unitPrice = Number(h.avg_cost)
        let valueCcy = h.currency || base
        if (valueCcy === 'GBX') { unitPrice = unitPrice / 100; valueCcy = 'GBP' }
        if (Number.isFinite(unitPrice) && unitPrice > 0) {
          portfolioValue += h.shares * unitPrice * toBase(1, valueCcy, fxMap, base)
        }
      }

      if (portfolioValue <= 0) continue

      await db.query(
        `INSERT INTO daily_movements (user_id, movement_date, owner, movement_gbp, portfolio_value_gbp)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, movement_date, owner) DO NOTHING`,
        [userId, date, owner, movement, portfolioValue]
      )
      if (owner === 'all') filled++
    }
  }

  if (filled > 0) {
    console.log(`[refresh-prices] backfilled ${filled} missing movement day(s) for user ${userId}`)
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron invokes this path with a GET (carrying Authorization: Bearer
  // <CRON_SECRET>); the manual "Refresh data" button uses an authenticated POST.
  // Identify the cron BEFORE the method check — otherwise the nightly GET is
  // rejected with 405 before it can run (which is exactly why the cron never
  // fired: every invocation 405'd here).
  const cronSecret = process.env.CRON_SECRET
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`

  if (!isCron) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const auth = requireAuth(req)
    if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  }

  const auth = isCron ? null : requireAuth(req)

  try {
    const db = await getDbClient()

    // For cron: collect all user IDs that have holdings to process
    const userIds: string[] = []
    if (isCron) {
      const usersRes = await db.query(`SELECT DISTINCT user_id FROM holdings LIMIT 20`)
      userIds.push(...(usersRes.rows || []).map((r: any) => String(r.user_id)))
    } else {
      userIds.push(auth!.userId)
    }

    if (userIds.length === 0) return res.status(200).json({ ok: true, message: 'No users with holdings' })

    // Refresh prices once (shared price_cache across all users)
    const primaryUserId = userIds[0]
    const settingsRes = await db.query(`SELECT base_currency FROM settings WHERE user_id = $1 LIMIT 1`, [primaryUserId])
    const base = String(settingsRes.rows?.[0]?.base_currency || 'GBP').toUpperCase()

    const holdingsRes = await db.query(`SELECT ticker, type, currency FROM holdings WHERE user_id = $1`, [primaryUserId])
    const holdings: { ticker: string; type: string; currency: string }[] = holdingsRes.rows || []

    const tickers = [...new Set(
      holdings
        .filter((h) => h.type !== 'cash' && h.ticker && !h.ticker.startsWith('CASH:'))
        .map((h) => h.ticker)
    )]

    const errors: { ticker?: string; pair?: string; error: string }[] = []
    const asOf = new Date().toISOString()
    const pricesMap: Record<string, { price: number; currency: string; asOf: string }> = {}
    const t212Key = process.env.T212_API_KEY

    if (t212Key) {
      // Primary: T212 REST API — returns live prices for T212 holdings
      try {
        const t212Prices = await fetchT212Prices(t212Key, tickers, asOf)
        Object.assign(pricesMap, t212Prices)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'failed'
        console.error(`[refresh-prices] T212 API failed: ${msg}`)
        errors.push({ error: `T212 API: ${msg}` } as any)
      }
    }

    // Fallback for tickers not yet priced (InvestEngine ETFs, or when T212 key
    // missing/invalid) — Yahoo Finance covers UK .L, India .NS, and US tickers.
    const unpricedTickers = tickers.filter((t) => !pricesMap[t])
    if (unpricedTickers.length > 0) {
      await Promise.all(unpricedTickers.map(async (ticker) => {
        const q = await yahooPrice(ticker)
        if ('error' in q) errors.push({ ticker, error: q.error })
        else pricesMap[ticker] = { ...q, asOf }
      }))
    }

    // Fetch existing prices before updating so we can roll prev_close on a new trading day
    const today = new Date().toISOString().slice(0, 10)
    const existingRes = await db.query(
      `SELECT ticker, price, as_of, prev_close, prev_close_as_of FROM price_cache`
    )
    const existingByTicker = new Map<string, {
      price: number; asOf: string
      prevClose: number | null; prevCloseAsOf: string | null
    }>()
    for (const row of existingRes.rows || []) {
      existingByTicker.set(row.ticker, {
        price: Number(row.price),
        asOf: row.as_of,
        prevClose: row.prev_close != null ? Number(row.prev_close) : null,
        prevCloseAsOf: row.prev_close_as_of || null,
      })
    }

    // Write prices to DB (delete-then-insert avoids ON CONFLICT constraint issues)
    // Roll prev_close when this is the first refresh of a new calendar day (UTC)
    for (const [ticker, q] of Object.entries(pricesMap)) {
      const existing = existingByTicker.get(ticker)
      let prevClose: number | null = null
      let prevCloseAsOf: string | null = null

      if (existing?.asOf) {
        const existingDate = new Date(existing.asOf).toISOString().slice(0, 10)
        if (existingDate < today) {
          // First refresh of a new day — yesterday's price becomes prev_close
          prevClose = existing.price
          prevCloseAsOf = existing.asOf
        } else {
          // Same-day refresh — carry forward existing prev_close
          prevClose = existing.prevClose
          prevCloseAsOf = existing.prevCloseAsOf
        }
      }

      await db.query(`DELETE FROM price_cache WHERE ticker = $1`, [ticker])
      await db.query(
        `INSERT INTO price_cache (ticker, price, currency, as_of, updated_at, prev_close, prev_close_as_of)
         VALUES ($1,$2,$3,$4,NOW(),$5,$6)`,
        [ticker, q.price, q.currency, q.asOf, prevClose, prevCloseAsOf]
      )
    }

    // FX rates (GBX = pence, not ISO — skip it)
    const ISO_ONLY = (c: string) => c && c !== 'GBX' && c.length === 3
    const neededCurrencies = new Set<string>()
    for (const h of holdings) {
      const c = h.currency?.toUpperCase()
      if (ISO_ONLY(c) && c !== base) neededCurrencies.add(c)
    }
    for (const q of Object.values(pricesMap)) {
      const c = q.currency?.toUpperCase()
      if (ISO_ONLY(c) && c !== base) neededCurrencies.add(c)
    }

    const fxRatesMap: Record<string, { rate: number; asOf: string }> = {}
    const fromCurrencies = new Set([...neededCurrencies, base])
    for (const from of fromCurrencies) {
      const toList = from === base
        ? [...neededCurrencies, 'INR'].filter((c) => c !== base)
        : [base]
      if (toList.length === 0) continue
      try {
        const rates = await frankfurterRates(from, toList)
        for (const [to, rate] of Object.entries(rates)) {
          if (Number.isFinite(rate) && rate > 0) fxRatesMap[`${from}_${to}`] = { rate, asOf }
        }
      } catch (e) {
        errors.push({ pair: `${from}_${base}`, error: e instanceof Error ? e.message : 'FX failed' })
      }
    }
    fxRatesMap[`${base}_${base}`] = { rate: 1, asOf }

    for (const [pair, { rate, asOf: pAsOf }] of Object.entries(fxRatesMap)) {
      const [fromCcy, toCcy] = pair.split('_')
      await db.query(`DELETE FROM fx_cache WHERE from_currency = $1 AND to_currency = $2`, [fromCcy, toCcy])
      await db.query(
        `INSERT INTO fx_cache (pair, from_currency, to_currency, rate, as_of, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())`,
        [pair, fromCcy, toCcy, rate, pAsOf]
      )
    }

    // Build flat fxMap for movement calculation. Seed from the persisted
    // fx_cache first so a failed live FX fetch (e.g. Frankfurter timeout) falls
    // back to the last-known rate instead of leaving a currency unconverted —
    // toBase() treats a missing rate as 1:1, which massively distorts foreign
    // holdings (INR counted as GBP inflated a portfolio ~128x). Fresh rates from
    // this run then take precedence.
    const fxMapFlat: Record<string, number> = {}
    try {
      const fxAll = await db.query(`SELECT pair, rate FROM fx_cache`)
      for (const r of fxAll.rows || []) {
        const rate = Number(r.rate)
        if (Number.isFinite(rate) && rate > 0) fxMapFlat[String(r.pair)] = rate
      }
    } catch { /* no cache yet — rely on fresh rates below */ }
    for (const [pair, { rate }] of Object.entries(fxRatesMap)) fxMapFlat[pair] = rate

    // Save daily movements for every user. Backfill any trading days missed
    // while the cron wasn't running FIRST (so today's fresh row isn't the
    // MAX(date) it measures the gap against), then write today's row. The
    // history cache is shared so a ticker held by multiple users is fetched once.
    const histCache = new Map<string, { closes: { date: string; close: number }[]; currency: string } | null>()
    for (const uid of userIds) {
      try {
        await backfillDailyMovements(db, uid, base, fxMapFlat, today, histCache)
      } catch (e) {
        errors.push({ error: `backfill for ${uid}: ${e instanceof Error ? e.message : 'failed'}` } as any)
      }
      try {
        await saveDailyMovements(db, uid, base, fxMapFlat, today)
      } catch (e) {
        errors.push({ error: `movements for ${uid}: ${e instanceof Error ? e.message : 'failed'}` } as any)
      }
    }

    const source = t212Key ? 'trading212' : 'yahoo'
    const lastRefresh = new Date().toISOString()

    console.log(
      `[refresh-prices] ${isCron ? 'cron' : 'manual'} run: ` +
      `${Object.keys(pricesMap).length}/${tickers.length} tickers priced, ${errors.length} errors` +
      (errors.length ? ` — ${JSON.stringify(errors)}` : '')
    )

    // Persist this run so staleness/failures are checkable independent of the
    // dashboard's "Last refresh" badge, which only reflects the freshest ticker
    // and stays green even when other tickers silently stop updating.
    try {
      await db.query(
        `INSERT INTO refresh_log (is_cron, tickers_total, tickers_refreshed, error_count, errors)
         VALUES ($1,$2,$3,$4,$5)`,
        [!!isCron, tickers.length, Object.keys(pricesMap).length, errors.length, JSON.stringify(errors)]
      )
    } catch (e) {
      console.error(`[refresh-prices] failed to write refresh_log: ${e instanceof Error ? e.message : 'failed'}`)
    }

    return res.status(200).json({
      ok: true,
      source,
      lastRefresh,
      tickersRefreshed: Object.keys(pricesMap).length,
      fxPairs: Object.keys(fxRatesMap).length,
      errors,
      cache: { prices: pricesMap, fxRates: fxRatesMap, lastRefresh },
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' })
  }
}
