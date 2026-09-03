import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertCircle, CalendarClock, Flame, ShieldCheck, TrendingDown, TrendingUp, X } from 'lucide-react'
import { usePortfolio, usePostDailyMovement, useUi } from '@/context/AppContext'
import { buildPortfolio, byType, topN, convertToBase, xirr, cagr } from '@/utils/calculations'
import type { CashFlow } from '@/utils/calculations'
import { formatMoney, formatPercent, formatRelative } from '@/utils/format'
import { Card, EmptyState, GainLossBadge, KpiCard, Loading, PageBody, PageHeader } from '@/components/ui'
import { totalLiabilitiesBase } from '@/utils/liabilities'

const TYPE_COLORS: Record<string, string> = {
  stock: '#22d3ee',
  etf: '#38bdf8',
  cash: '#a78bfa',
  commodity: '#e879f9',
  crypto: '#f472b6',
  bond: '#67e8f9',
}
const TYPE_COLORS_3D: Record<string, string> = {
  stock: '#e879f9',
  etf: '#22d3ee',
  cash: '#a78bfa',
  commodity: '#67e8f9',
  crypto: '#f59e0b',
  bond: '#34d399',
}

export function Overview() {
  const { data, isLoading, error } = usePortfolio()
  const postDailyMovement = usePostDailyMovement()
  const { selectedOwner, privacyMode, visualStyle, selectedCountry, setSelectedCountry } = useUi()
  const autoMovementKeyRef = useRef('')

  // ── GBP→INR history modal ──────────────────────────────────────────────────
  const [fxModalOpen, setFxModalOpen] = useState(false)
  const [fxHistory, setFxHistory] = useState<{ date: string; rate: number }[]>([])
  const [fxLoading, setFxLoading] = useState(false)

  // ── Total G/L detail modal ─────────────────────────────────────────────────
  const [glModalOpen, setGlModalOpen] = useState(false)
  // ── Portfolio breakdown modal ──────────────────────────────────────────────
  const [pvModalOpen, setPvModalOpen] = useState(false)

  const openFxModal = useCallback(async () => {
    setFxModalOpen(true)
    if (fxHistory.length > 0) return
    setFxLoading(true)
    try {
      const end = new Date().toISOString().slice(0, 10)
      const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const res = await fetch(`https://api.frankfurter.dev/v1/${start}..${end}?from=GBP&to=INR`)
      const data = await res.json()
      const points = Object.entries(data.rates as Record<string, { INR: number }>)
        .map(([date, r]) => ({ date, rate: r.INR }))
        .sort((a, b) => a.date.localeCompare(b.date))
      setFxHistory(points)
    } catch { /* ignore */ }
    finally { setFxLoading(false) }
  }, [fxHistory.length])

  const view = useMemo(() => {
    if (!data) return null
    let filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    if (selectedCountry === 'UK') filtered = filtered.filter((h) => h.currency !== 'INR')
    else if (selectedCountry === 'India') filtered = filtered.filter((h) => h.currency === 'INR')
    const base = selectedCountry === 'India' ? 'INR' : (data.settings.baseCurrency || 'GBP')
    const built = buildPortfolio(filtered, data.prices, data.fxRates, base)
    const allocation = byType(built.investedRows, built.totalValueBase - built.cashValueBase)
    const top = topN(built.investedRows, 5)
    const livePriceCount = Object.keys(data.prices || {}).length
    const directGbpInr = data.fxRates?.GBP_INR?.rate
    const inverseInrGbp = data.fxRates?.INR_GBP?.rate
    const gbpToInr = Number.isFinite(directGbpInr)
      ? Number(directGbpInr)
      : Number.isFinite(inverseInrGbp) && inverseInrGbp > 0
        ? 1 / Number(inverseInrGbp)
        : null
    const liabilitiesTotal = totalLiabilitiesBase(data.liabilities ?? [], base)
    const netWorth = built.totalValueBase - liabilitiesTotal

    // Today's movement: Σ((currentPrice - prevClose) × shares × fx), non-cash only
    let dailyMovement: number | null = null
    let prevCloseAsOf: string | null = null
    {
      let currentVal = 0
      let prevVal = 0
      let hasPrev = false
      for (const h of filtered.filter((h) => h.type !== 'cash')) {
        const quote = data.prices?.[h.ticker]
        if (!quote?.prevClose) continue
        hasPrev = true
        const fx = convertToBase(1, quote.currency, data.fxRates, base) ?? 1
        currentVal += h.shares * quote.price * fx
        prevVal += h.shares * quote.prevClose * fx
        if (!prevCloseAsOf || quote.prevCloseAsOf! > prevCloseAsOf) prevCloseAsOf = quote.prevCloseAsOf ?? null
      }
      if (hasPrev) dailyMovement = currentVal - prevVal
    }
    // Total portfolio in GBP (all holdings, no country filter) — for auto-snapshot only
    const gbpBase = data.settings.baseCurrency || 'GBP'
    const allOwnerHoldings = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    const totalBuilt = buildPortfolio(allOwnerHoldings, data.prices, data.fxRates, gbpBase)
    const totalLiabGBP = totalLiabilitiesBase(data.liabilities ?? [], gbpBase)
    const totalNetWorthGBP = totalBuilt.totalValueBase - totalLiabGBP

    // All-country daily movement in GBP — mirrors the filtered calc above but
    // over every holding for this owner, so the auto-snapshot below never lets a
    // country filter (which drops INR holdings) overwrite the owner's true
    // movement/value. The filtered `dailyMovement` is kept for the display card.
    let totalMovementGBP: number | null = null
    {
      let currentVal = 0
      let prevVal = 0
      let hasPrev = false
      for (const h of allOwnerHoldings.filter((h) => h.type !== 'cash')) {
        const quote = data.prices?.[h.ticker]
        if (!quote?.prevClose) continue
        hasPrev = true
        const fx = convertToBase(1, quote.currency, data.fxRates, gbpBase) ?? 1
        currentVal += h.shares * quote.price * fx
        prevVal += h.shares * quote.prevClose * fx
      }
      if (hasPrev) totalMovementGBP = currentVal - prevVal
    }

    // MTD = sum of daily price movements since the 1st of this month.
    // daily_movements is market-only (new holdings have no prevClose on buy day,
    // so they're skipped by the cron). No manual snapshots needed.
    const thisMonthStart = new Date().toISOString().slice(0, 8) + '01'
    const allMovements = data.dailyMovements || []

    // Sum movements for 'all' owner within this calendar month
    const mtdMovements = allMovements.filter(
      (m) => m.owner === 'all' && m.date >= thisMonthStart
    )
    const monthDelta = mtdMovements.length > 0
      ? mtdMovements.reduce((sum, m) => sum + m.movementGBP, 0)
      : null

    // Opening date & value = last captured day before this month
    const lastPrevMovement = allMovements
      .filter((m) => m.owner === 'all' && m.date < thisMonthStart)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
    const monthStartSnapshot = lastPrevMovement
      ? { date: lastPrevMovement.date, value: lastPrevMovement.portfolioValueGBP ?? 0 }
      : null

    // Best / worst single day in the month
    const bestDay  = mtdMovements.length > 0 ? mtdMovements.reduce((b, m) => m.movementGBP > b.movementGBP ? m : b) : null
    const worstDay = mtdMovements.length > 0 ? mtdMovements.reduce((w, m) => m.movementGBP < w.movementGBP ? m : w) : null

    // % gain: monthDelta / portfolio value at start of first captured day this month
    // allMovements is DESC, so the oldest MTD row is at the end of mtdMovements
    const firstMtdRow = mtdMovements.length > 0 ? mtdMovements[mtdMovements.length - 1] : null
    const mtdOpenValue = firstMtdRow && firstMtdRow.portfolioValueGBP != null
      ? firstMtdRow.portfolioValueGBP - firstMtdRow.movementGBP
      : null
    const mtdPct = mtdOpenValue && mtdOpenValue > 0 && monthDelta != null
      ? monthDelta / mtdOpenValue
      : null
    // ── Gain/Loss detail (for the Total G/L modal) ─────────────────────────────
    const today = new Date().toISOString().slice(0, 10)
    // Per-holding unrealised winners & losers, biggest £ move first.
    const glRows = [...built.investedRows].sort((a, b) => b.gainLoss - a.gainLoss)
    const winners = glRows.filter((r) => r.gainLoss > 0)
    const losers = glRows.filter((r) => r.gainLoss < 0).sort((a, b) => a.gainLoss - b.gainLoss)

    // XIRR — money-weighted, from dated transactions + today's liquidation value.
    // Buys are cash in (−), sells/dividends are cash out (+). All converted to base
    // at current FX (historical FX isn't stored — noted in the modal).
    const filteredTickers = new Set(filtered.map((h) => h.ticker))
    const glTxns = (data.transactions || []).filter((t) => {
      if (!filteredTickers.has(t.ticker)) return false
      if (selectedOwner !== 'all' && !((t.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))) return false
      return true
    })
    const flows: CashFlow[] = []
    let dividendsBase = 0
    for (const t of glTxns) {
      const gross = convertToBase(t.shares * t.price, t.currency, data.fxRates, base)
      if (gross == null || !Number.isFinite(gross)) continue
      if (t.side === 'buy') flows.push({ date: t.date, amount: -Math.abs(gross) })
      else if (t.side === 'sell') flows.push({ date: t.date, amount: Math.abs(gross) })
      else if (t.side === 'dividend') {
        const div = gross || convertToBase(t.price, t.currency, data.fxRates, base) || 0
        flows.push({ date: t.date, amount: Math.abs(div) })
        dividendsBase += Math.abs(div)
      } else if (t.side === 'fee') flows.push({ date: t.date, amount: -Math.abs(gross) })
      // 'split' has no cash impact
    }
    if (built.totalValueBase > 0) flows.push({ date: today, amount: built.totalValueBase })
    const xirrPct = flows.length >= 2 ? xirr(flows) : null

    // CAGR — whole-portfolio, GBP, since the earliest snapshot.
    const snaps = [...(data.snapshots || [])].sort((a, b) => a.date.localeCompare(b.date))
    const firstSnap = snaps[0] ?? null
    const cagrPct = firstSnap
      ? cagr(firstSnap.valueGBP, firstSnap.date, totalBuilt.totalValueBase, today)
      : null

    const glDetail = {
      totalGainLoss: built.totalGainLoss,
      totalCostBase: built.totalCostBase,
      totalValueBase: built.totalValueBase,
      simpleReturnPct: built.totalGainLossPct,
      winners,
      losers,
      xirrPct,
      cagrPct,
      cagrSince: firstSnap?.date ?? null,
      dividendsBase,
      txnCount: glTxns.length,
    }

    // ── Portfolio value detail (for the Portfolio modal) ───────────────────────
    const byTypeMap = new Map<string, number>()
    for (const r of built.rows) byTypeMap.set(r.type, (byTypeMap.get(r.type) ?? 0) + r.valueBase)
    const pvTypes = [...byTypeMap.entries()]
      .map(([type, value]) => ({ type, value, weight: built.totalValueBase > 0 ? value / built.totalValueBase : 0 }))
      .sort((a, b) => b.value - a.value)
    const pvDetail = {
      value: built.totalValueBase,
      cost: built.totalCostBase,
      gain: built.totalGainLoss,
      gainPct: built.totalGainLossPct,
      cashValue: built.cashValueBase,
      investedValue: built.totalValueBase - built.cashValueBase,
      positions: built.investedRows.length,
      types: pvTypes,
      holdings: [...built.rows].sort((a, b) => b.valueBase - a.valueBase),
    }

    // ── Market "income" (£) — price gains with deposits excluded, from daily
    // movements. Same source as Analytics' Monthly market growth. Always GBP.
    const ymNow = today.slice(0, 7)
    const yNow = today.slice(0, 4)
    let monthlyIncomeGBP = 0
    let yearlyIncomeGBP = 0
    let hasIncomeData = false
    for (const m of data.dailyMovements || []) {
      if (m.owner !== selectedOwner) continue
      const val = Number(m.movementGBP) || 0
      if (m.date.slice(0, 4) === yNow) { yearlyIncomeGBP += val; hasIncomeData = true }
      if (m.date.slice(0, 7) === ymNow) monthlyIncomeGBP += val
    }

    let essentialsScore = 0
    let fireProgress = 0
    let fireYears = 0
    try {
      const essentialsRaw = localStorage.getItem('firefly.essentials')
      const essentials = essentialsRaw ? JSON.parse(essentialsRaw) : {}
      const values = Object.values(essentials).filter((v) => typeof v === 'boolean') as boolean[]
      essentialsScore = values.length ? Math.round((values.filter(Boolean).length / values.length) * 100) : 0
      const fireRaw = localStorage.getItem('firefly.firePlanner')
      const fire = fireRaw ? JSON.parse(fireRaw) : { monthlyExpense: 2500, fireMultiple: 30, monthlyContribution: 1000, annualReturnPct: 6 }
      const target = Number(fire.monthlyExpense || 0) * 12 * Number(fire.fireMultiple || 0)
      fireProgress = target > 0 ? Math.min((netWorth / target) * 100, 100) : 0
      if (target <= 0 || netWorth >= target) {
        fireYears = 0
      } else {
        let value = Math.max(0, netWorth)
        const yearlyContribution = Math.max(0, Number(fire.monthlyContribution || 0)) * 12
        const growth = Math.max(-99, Number(fire.annualReturnPct || 0)) / 100
        fireYears = 80
        for (let year = 1; year <= 80; year++) {
          value = value * (1 + growth) + yearlyContribution
          if (value >= target) {
            fireYears = year
            break
          }
        }
      }
    } catch {
      // ignore local state parsing errors
    }
    return {
      ...built,
      allocation,
      top,
      base,
      livePriceCount,
      gbpToInr,
      essentialsScore,
      liabilitiesTotal,
      netWorth,
      fireProgress,
      fireYears,
      monthStartSnapshot,
      monthDelta,
      bestDay,
      worstDay,
      firstMtdRow,
      mtdPct,
      totalNetWorthGBP,
      totalValueGBP: totalBuilt.totalValueBase,
      totalMovementGBP,
      dailyMovement,
      prevCloseAsOf,
      glDetail,
      pvDetail,
      monthlyIncomeGBP,
      yearlyIncomeGBP,
      hasIncomeData,
      incomeYear: yNow,
    }
  }, [data, selectedOwner, selectedCountry])

  // Auto-save today's movement — use ref guard to prevent re-firing on mutation state changes
  useEffect(() => {
    // Post the all-country GBP values, never the country-filtered view — a
    // filtered snapshot would overwrite the owner's true movement/value (this is
    // what wrote a UK-only 'all' row when the dashboard was viewed with the UK
    // filter). The cron writes the same all-country figures, so they agree.
    if (!data || !view || view.totalMovementGBP == null) return
    const today = new Date().toISOString().slice(0, 10)
    const runKey = `${today}|${selectedOwner}|${Math.round(view.totalMovementGBP)}`
    // Always set the ref first — prevents repeated calls when alreadySaved or same key
    if (autoMovementKeyRef.current === runKey) return
    autoMovementKeyRef.current = runKey
    const alreadySaved = (data.dailyMovements || []).some(
      (m) => m.date === today && m.owner === selectedOwner
    )
    if (alreadySaved) return
    postDailyMovement.mutate({
      date: today,
      owner: selectedOwner,
      movementGBP: view.totalMovementGBP,
      portfolioValueGBP: view.totalValueGBP,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view, selectedOwner])

  if (isLoading) return <Loading label="Loading portfolio…" />
  if (error) return <PageBody><EmptyState title="Couldn't load portfolio" body={(error as Error).message} /></PageBody>
  if (!data || !view) return null

  const {
    totalValueBase,
    totalCostBase,
    totalGainLoss,
    totalGainLossPct,
    allocation,
    top,
    base,
    livePriceCount,
    gbpToInr,
    essentialsScore,
    fireProgress,
    fireYears,
    monthStartSnapshot,
    monthDelta,
    bestDay,
    worstDay,
    firstMtdRow,
    mtdPct,
    netWorth,
    dailyMovement,
    prevCloseAsOf,
    glDetail,
    pvDetail,
    monthlyIncomeGBP,
    yearlyIncomeGBP,
    hasIncomeData,
    incomeYear,
  } = view
  const is3d = visualStyle === 'premium3d'
  const hidden = '•••••'
  const money = (v: number) => (privacyMode ? hidden : formatMoney(v, base))

  const flagBtn = (country: 'UK' | 'India', flag: string) => {
    const active = selectedCountry === country
    return (
      <button
        key={country}
        type="button"
        onClick={() => setSelectedCountry(country)}
        title={`${country} holdings`}
        className={[
          'rounded-lg px-2 py-1 text-xl leading-none transition-all',
          is3d
            ? active
              ? 'bg-indigo-700/70 ring-1 ring-indigo-300/50 shadow-[0_0_10px_rgba(99,102,241,0.5)]'
              : 'opacity-35 hover:opacity-75 hover:bg-indigo-900/40'
            : active
              ? 'bg-slate-900 shadow-sm dark:bg-slate-100'
              : 'opacity-35 hover:opacity-75 hover:bg-slate-100 dark:hover:bg-slate-800',
        ].join(' ')}
      >
        {flag}
      </button>
    )
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            {selectedOwner === 'all' ? 'All portfolios' : `${selectedOwner}'s portfolio`} ·{' '}
            Last refresh: {formatRelative(data.lastRefresh)}
          </>
        }
        right={
          <div className="flex items-center gap-1">
            {flagBtn('UK', '🇬🇧')}
            {flagBtn('India', '🇮🇳')}
          </div>
        }
      />
      <PageBody>
        {livePriceCount === 0 && (
          <Card tone="soft" className="border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="text-sm text-amber-700 dark:text-amber-300">
                No live prices yet. All values below are at <strong>cost basis</strong>. Click <strong>Refresh prices</strong> in the sidebar to fetch live quotes from Yahoo Finance.
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <button type="button" onClick={() => setPvModalOpen(true)} className="block w-full text-left transition hover:opacity-90 active:scale-[0.98]">
            <KpiCard
              label="Portfolio"
              value={money(totalValueBase)}
              sub={privacyMode ? hidden : `Invested: ${formatMoney(totalCostBase, base)}`}
            />
          </button>
          <Link to="/networth-progress" className="block transition hover:opacity-95">
            <KpiCard
              label="Net worth"
              value={money(netWorth)}
              sub={livePriceCount === 0 ? 'cost basis' : `${view.investedRows.length} positions`}
            />
          </Link>
          <button type="button" onClick={() => setGlModalOpen(true)} className="block w-full text-left transition hover:opacity-90 active:scale-[0.98]">
            <KpiCard
              label="Total G/L"
              value={money(totalGainLoss)}
              tone={totalGainLoss === 0 ? 'neutral' : totalGainLoss > 0 ? 'gain' : 'loss'}
              sub={livePriceCount === 0 ? '—' : `${formatPercent(totalGainLossPct)} · Tap for detail`}
            />
          </button>
          <Link to="/daily-movement" className="block transition hover:opacity-95">
            <KpiCard
              label={(() => { const d = new Date().getDay(); return d === 0 || d === 6 ? 'Last trading day' : "Today's movement" })()}
              value={dailyMovement == null ? '—' : money(dailyMovement)}
              tone={dailyMovement == null ? 'neutral' : dailyMovement >= 0 ? 'gain' : 'loss'}
              sub={prevCloseAsOf ? `vs close ${new Date(prevCloseAsOf + (prevCloseAsOf.includes('T') ? '' : 'T12:00:00Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Refresh again tomorrow to see'}
              icon={<TrendingUp className="h-4 w-4 text-slate-400" />}
            />
          </Link>
          <Link to="/analytics" className="block transition hover:opacity-95">
            <KpiCard
              label="Market income"
              value={hasIncomeData ? (privacyMode ? hidden : formatMoney(monthlyIncomeGBP, 'GBP')) : '—'}
              tone={!hasIncomeData ? 'neutral' : monthlyIncomeGBP >= 0 ? 'gain' : 'loss'}
              sub={hasIncomeData
                ? (privacyMode ? hidden : `${incomeYear}: ${formatMoney(yearlyIncomeGBP, 'GBP')}`)
                : 'Builds as prices are tracked'}
              icon={<TrendingUp className="h-4 w-4 text-slate-400" />}
            />
          </Link>
          <button type="button" onClick={openFxModal} className="block w-full text-left transition hover:opacity-90 active:scale-[0.98]">
            <KpiCard
              label="GBP → INR"
              value={gbpToInr == null ? '—' : `₹${gbpToInr.toFixed(2)}`}
              sub={gbpToInr == null ? 'Refresh prices to load FX' : 'Tap for 1-year chart'}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card tone="elevated">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Essentials score</h3>
                <p className="mt-1 text-xs text-slate-500">Financial readiness tracker</p>
              </div>
              <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-4 text-3xl font-semibold tabular-nums">{essentialsScore}</div>
            <p className="mt-1 text-xs text-slate-500">{essentialsScore >= 80 ? 'Strong baseline' : 'Set up essentials to improve score'}</p>
            <Link to="/essentials" className="mt-3 inline-block text-xs font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-300">Open essentials</Link>
          </Card>
          <Card tone="elevated">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">FIRE progress</h3>
                <p className="mt-1 text-xs text-slate-500">Financial independence trajectory</p>
              </div>
              <Flame className="mt-0.5 h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-4 text-3xl font-semibold tabular-nums">{fireProgress.toFixed(1)}%</div>
            <p className="mt-1 text-xs text-slate-500">{fireYears === 0 ? 'At or above FIRE target' : `Estimated ${fireYears >= 80 ? '80+' : fireYears} years to FIRE`}</p>
            <div className={is3d ? 'mt-3 h-2 rounded-full bg-indigo-950/70' : 'mt-3 h-2 rounded-full bg-slate-200 dark:bg-slate-800'}>
              <div
                className={is3d
                  ? 'h-2 rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 shadow-[0_0_10px_rgba(56,189,248,0.55)]'
                  : 'h-2 rounded-full bg-slate-900 dark:bg-slate-200'}
                style={{ width: `${Math.min(100, fireProgress)}%` }}
              />
            </div>
            <Link to="/goals" className="mt-3 inline-block text-xs font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-300">Open goals</Link>
          </Card>
          <Card tone="elevated">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Month-to-date signal</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Market gain only · new investments excluded
                </p>
              </div>
              <CalendarClock className="mt-0.5 h-4 w-4 text-slate-400" />
            </div>
            {monthDelta == null ? (
              <div className="mt-4 text-sm text-slate-400">
                Waiting for first price capture of the month
              </div>
            ) : (
              <>
                <div className={`mt-4 text-xl font-semibold tabular-nums ${monthDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {privacyMode ? hidden : (monthDelta >= 0 ? '+' : '') + formatMoney(monthDelta, base)}
                </div>
                {mtdPct != null && (
                  <p className="mt-1 text-xs text-slate-500">
                    {mtdPct >= 0 ? '+' : ''}{formatPercent(mtdPct)} market return
                    {monthStartSnapshot ? ` · since ${monthStartSnapshot.date}` : firstMtdRow ? ` · since ${firstMtdRow.date}` : ''}
                  </p>
                )}
                {(bestDay || worstDay) && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {bestDay && <>▲ {new Date(bestDay.date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {bestDay.movementGBP >= 0 ? '+' : ''}{formatMoney(bestDay.movementGBP, base)}</>}
                    {bestDay && worstDay && bestDay.date !== worstDay.date && <> &middot; ▼ {new Date(worstDay.date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {formatMoney(worstDay.movementGBP, base)}</>}
                  </p>
                )}
              </>
            )}
            <Link to="/snapshots" className="mt-3 inline-block text-xs font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-300">Open wealth timeline</Link>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card tone="elevated" className="lg:col-span-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Allocation by type</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Excludes cash</p>
            {allocation.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">Add assets to see allocation</div>
            ) : (
              <>
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocation} dataKey="valueBase" nameKey="key" innerRadius={48} outerRadius={80} paddingAngle={2}>
                        {allocation.map((s) => (
                          <Cell
                            key={s.key}
                            fill={is3d ? (TYPE_COLORS_3D[s.key] || '#22d3ee') : (TYPE_COLORS[s.key] || '#64748b')}
                            stroke={is3d ? 'rgba(224,231,255,0.65)' : '#e2e8f0'}
                            strokeWidth={1.2}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => formatMoney(v, base)}
                        contentStyle={is3d ? { background: 'rgba(15, 23, 42, 0.88)', border: '1px solid rgba(129, 140, 248, 0.45)', borderRadius: 12, boxShadow: '0 8px 32px rgba(59,130,246,0.3)', color: '#a5f3fc' } : undefined}
                        labelStyle={is3d ? { color: '#67e8f9' } : undefined}
                        itemStyle={is3d ? { color: '#a5f3fc' } : undefined}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {allocation.map((s) => (
                    <li key={s.key} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: is3d ? (TYPE_COLORS_3D[s.key] || '#22d3ee') : (TYPE_COLORS[s.key] || '#64748b') }} />
                        <span className="capitalize text-slate-700 dark:text-slate-300">{s.key}</span>
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {privacyMode ? hidden : formatMoney(s.valueBase, base)} <span className="ml-2 tabular-nums text-xs">{(s.weight * 100).toFixed(1)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card tone="elevated" className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Top holdings</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">By portfolio weight</p>
            {top.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No assets yet. Add your first asset to get started.</div>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
                {top.map((h) => (
                  <li key={h.id}>
                    <Link
                      to={`/assets/${encodeURIComponent(h.ticker)}`}
                      className="flex items-center justify-between py-3 hover:opacity-80 transition-opacity"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{h.ticker}</span>
                          <span className="ff-type-pill rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">{h.type}</span>
                        </div>
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{h.name}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{privacyMode ? hidden : formatMoney(h.valueBase, base)}</div>
                          <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{(h.weight * 100).toFixed(1)}%</div>
                        </div>
                        {!h.valueIsCost && !privacyMode && (
                          <GainLossBadge amount={h.gainLoss} pct={h.gainLossPct} currency={base} />
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
      {/* ── GBP→INR 1-year history modal ───────────────────────────────────── */}
      {fxModalOpen && (() => {
        const minRate = fxHistory.length ? Math.min(...fxHistory.map((p) => p.rate)) : 0
        const maxRate = fxHistory.length ? Math.max(...fxHistory.map((p) => p.rate)) : 0
        const firstRate = fxHistory[0]?.rate ?? null
        const lastRate  = fxHistory[fxHistory.length - 1]?.rate ?? null
        const change    = firstRate && lastRate ? lastRate - firstRate : null
        const changePct = firstRate && change != null ? (change / firstRate) * 100 : null
        const isUp      = change != null && change >= 0

        // Thin out to ~52 weekly points for a clean chart
        const chartData = fxHistory.filter((_, i) => i % Math.max(1, Math.floor(fxHistory.length / 52)) === 0)

        const fmtDate = (d: string) =>
          new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            onClick={() => setFxModalOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className={[
                'relative w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl',
                is3d
                  ? 'bg-indigo-950/95 border border-indigo-400/30 text-cyan-100'
                  : 'bg-white dark:bg-slate-900',
              ].join(' ')}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className={`text-base font-semibold ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>
                    GBP → INR · Past 12 months
                  </h2>
                  {change != null && changePct != null && (
                    <p className={`mt-0.5 flex items-center gap-1.5 text-sm ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(1)}%) over the year
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setFxModalOpen(false)}
                  className={`rounded-lg p-1.5 transition ${is3d ? 'hover:bg-indigo-800/60 text-cyan-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Stats row */}
              {fxHistory.length > 0 && (
                <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: 'Low', value: `₹${minRate.toFixed(2)}` },
                    { label: 'Now', value: `₹${(lastRate ?? 0).toFixed(2)}` },
                    { label: 'High', value: `₹${maxRate.toFixed(2)}` },
                  ].map(({ label, value }) => (
                    <div key={label} className={`rounded-xl py-2 px-3 ${is3d ? 'bg-indigo-900/50' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
                      <div className={`text-xs ${is3d ? 'text-cyan-300/70' : 'text-slate-500'}`}>{label}</div>
                      <div className={`text-sm font-semibold tabular-nums mt-0.5 ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Chart */}
              {fxLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <div className={`text-sm ${is3d ? 'text-cyan-300/70' : 'text-slate-400'}`}>Loading rates…</div>
                </div>
              ) : fxHistory.length === 0 ? (
                <div className="flex h-48 items-center justify-center">
                  <div className={`text-sm ${is3d ? 'text-cyan-300/70' : 'text-slate-400'}`}>Could not load data</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={is3d ? 'rgba(99,102,241,0.2)' : '#e2e8f0'}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short' })}
                      tick={{ fontSize: 11, fill: is3d ? '#a5b4fc' : '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                      interval={Math.floor(chartData.length / 6)}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 11, fill: is3d ? '#a5b4fc' : '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                      width={42}
                      tickFormatter={(v) => `₹${v.toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(v: number) => [`₹${v.toFixed(2)}`, 'GBP→INR']}
                      labelFormatter={fmtDate}
                      contentStyle={
                        is3d
                          ? { background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 10, color: '#a5f3fc' }
                          : { borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }
                      }
                    />
                    {firstRate && (
                      <ReferenceLine
                        y={firstRate}
                        stroke={is3d ? 'rgba(165,180,252,0.35)' : '#cbd5e1'}
                        strokeDasharray="4 4"
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke={is3d ? '#22d3ee' : '#6366f1'}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {fxHistory.length > 0 && (
                <p className={`mt-2 text-center text-[11px] ${is3d ? 'text-indigo-300/60' : 'text-slate-400'}`}>
                  {fmtDate(fxHistory[0].date)} – {fmtDate(fxHistory[fxHistory.length - 1].date)} · Frankfurter.app
                </p>
              )}
            </div>
          </div>
        )
      })()}

      {glModalOpen && (() => {
        const gl = glDetail
        const glUp = gl.totalGainLoss >= 0
        const pct = (v: number | null, suffix = '') =>
          v == null ? '—' : `${formatPercent(v)}${suffix}`
        const metrics = [
          {
            label: 'Simple return',
            value: pct(gl.simpleReturnPct),
            note: 'Total gain ÷ cost. Not annualised — ignores how long you’ve held or when you added money.',
            available: true,
          },
          {
            label: 'XIRR',
            value: pct(gl.xirrPct, '/yr'),
            note: gl.xirrPct == null
              ? `Needs dated transactions${gl.txnCount === 0 ? ' — none imported for this view yet' : ''}.`
              : 'Money-weighted annual return from your buys, sells & dividends. Best single figure when you contribute over time.',
            available: gl.xirrPct != null,
          },
          {
            label: 'CAGR',
            value: pct(gl.cagrPct, '/yr'),
            note: gl.cagrPct == null
              ? 'Needs ~3+ months of snapshot history.'
              : `Compound annual growth of the whole portfolio (GBP) since ${new Date(gl.cagrSince! + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}.`,
            available: gl.cagrPct != null,
          },
        ]

        const glRow = (r: typeof gl.winners[number]) => (
          <div key={r.id} className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 ${is3d ? 'hover:bg-indigo-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
            <div className="min-w-0">
              <div className={`truncate text-sm font-medium ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>{r.ticker}</div>
              <div className="truncate text-[11px] text-slate-500">{r.name}</div>
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <div className={`text-sm font-semibold ${r.gainLoss >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {r.gainLoss >= 0 ? '+' : ''}{money(r.gainLoss)}
              </div>
              <div className={`text-[11px] ${r.gainLoss >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>{formatPercent(r.gainLossPct)}</div>
            </div>
          </div>
        )

        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            onClick={() => setGlModalOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className={[
                'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl',
                is3d ? 'bg-indigo-950/95 border border-indigo-400/30 text-cyan-100' : 'bg-white dark:bg-slate-900',
              ].join(' ')}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className={`text-base font-semibold ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>
                    Total gain / loss
                  </h2>
                  <p className={`mt-0.5 text-2xl font-bold tabular-nums ${glUp ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {glUp ? '+' : ''}{money(gl.totalGainLoss)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {money(gl.totalValueBase)} value · {money(gl.totalCostBase)} invested
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setGlModalOpen(false)}
                  className={`rounded-lg p-1.5 transition ${is3d ? 'hover:bg-indigo-800/60 text-cyan-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {/* Return metrics */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {metrics.map((m) => (
                    <div key={m.label} className={`rounded-xl px-2 py-2.5 ${is3d ? 'bg-indigo-900/50' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
                      <div className={`text-[11px] ${is3d ? 'text-cyan-300/70' : 'text-slate-500'}`}>{m.label}</div>
                      <div className={`mt-0.5 text-base font-semibold tabular-nums ${m.available ? (is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100') : 'text-slate-400'}`}>
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {metrics.map((m) => (
                    <li key={m.label} className="flex gap-2 text-[11px] leading-snug text-slate-500">
                      <span className={`font-semibold ${is3d ? 'text-cyan-200' : 'text-slate-600 dark:text-slate-300'}`}>{m.label}:</span>
                      <span>{m.note}</span>
                    </li>
                  ))}
                </ul>

                {/* Winners */}
                {gl.winners.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
                      <TrendingUp className="h-3.5 w-3.5" /> Gainers ({gl.winners.length})
                    </div>
                    <div className="max-h-44 overflow-y-auto">{gl.winners.map(glRow)}</div>
                  </div>
                )}

                {/* Losers */}
                {gl.losers.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-rose-500">
                      <TrendingDown className="h-3.5 w-3.5" /> Losers ({gl.losers.length})
                    </div>
                    <div className="max-h-44 overflow-y-auto">{gl.losers.map(glRow)}</div>
                  </div>
                )}

                {/* Footnote */}
                <p className={`mt-4 text-[11px] leading-snug ${is3d ? 'text-indigo-300/60' : 'text-slate-400'}`}>
                  Gainers/losers are unrealised, at live prices.
                  {gl.dividendsBase > 0 && ` Dividends received (${money(gl.dividendsBase)}) are included in XIRR.`}
                  {' '}XIRR converts each transaction at current FX (historical FX isn’t stored), so cross-currency figures are approximate.
                </p>
              </div>
            </div>
          </div>
        )
      })()}

      {pvModalOpen && (() => {
        const pv = pvDetail
        const gainUp = pv.gain >= 0
        const typeColor = (t: string) => (is3d ? TYPE_COLORS_3D : TYPE_COLORS)[t] ?? '#94a3b8'
        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
        const tiles = [
          { label: 'Securities', value: money(pv.investedValue) },
          { label: 'Cash', value: money(pv.cashValue) },
          { label: 'Positions', value: String(pv.positions) },
        ]
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            onClick={() => setPvModalOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className={[
                'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl',
                is3d ? 'bg-indigo-950/95 border border-indigo-400/30 text-cyan-100' : 'bg-white dark:bg-slate-900',
              ].join(' ')}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className={`text-base font-semibold ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>
                    Portfolio value
                  </h2>
                  <p className={`mt-0.5 text-2xl font-bold tabular-nums ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>
                    {money(pv.value)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {money(pv.cost)} invested ·{' '}
                    <span className={gainUp ? 'text-emerald-500' : 'text-rose-500'}>
                      {gainUp ? '+' : ''}{money(pv.gain)} ({formatPercent(pv.gainPct)})
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPvModalOpen(false)}
                  className={`rounded-lg p-1.5 transition ${is3d ? 'hover:bg-indigo-800/60 text-cyan-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {/* Tiles */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {tiles.map((t) => (
                    <div key={t.label} className={`rounded-xl px-2 py-2.5 ${is3d ? 'bg-indigo-900/50' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
                      <div className={`text-[11px] ${is3d ? 'text-cyan-300/70' : 'text-slate-500'}`}>{t.label}</div>
                      <div className={`mt-0.5 text-base font-semibold tabular-nums ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>{t.value}</div>
                    </div>
                  ))}
                </div>

                {/* By asset type */}
                {pv.types.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold text-slate-500">By asset type</div>
                    {/* stacked weight bar */}
                    <div className="mb-3 flex h-2 overflow-hidden rounded-full">
                      {pv.types.map((t) => (
                        <div key={t.type} style={{ width: `${t.weight * 100}%`, background: typeColor(t.type) }} title={`${cap(t.type)} ${(t.weight * 100).toFixed(1)}%`} />
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      {pv.types.map((t) => (
                        <div key={t.type} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: typeColor(t.type) }} />
                            <span className={`truncate ${is3d ? 'text-cyan-100' : 'text-slate-700 dark:text-slate-200'}`}>{cap(t.type)}</span>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <span className={`font-medium ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>{money(t.value)}</span>
                            <span className="ml-2 text-[11px] text-slate-500">{(t.weight * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Holdings by value */}
                {pv.holdings.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1 text-xs font-semibold text-slate-500">Holdings by value ({pv.holdings.length})</div>
                    <div className="max-h-72 overflow-y-auto">
                      {pv.holdings.map((h) => (
                        <div key={h.id} className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 ${is3d ? 'hover:bg-indigo-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: typeColor(h.type) }} />
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-medium ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>{h.ticker}</div>
                              <div className="truncate text-[11px] text-slate-500">{h.name}</div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <div className={`text-sm font-semibold ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>{money(h.valueBase)}</div>
                            <div className="text-[11px] text-slate-500">{pv.value > 0 ? ((h.valueBase / pv.value) * 100).toFixed(1) : '0.0'}%</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className={`mt-4 text-[11px] leading-snug ${is3d ? 'text-indigo-300/60' : 'text-slate-400'}`}>
                  Values at live prices where available, otherwise cost basis.
                  {livePriceCount === 0 && ' No live prices yet — figures shown at cost.'}
                </p>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
