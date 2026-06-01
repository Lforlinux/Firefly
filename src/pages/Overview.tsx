import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertCircle, CalendarClock, Flame, ShieldCheck, TrendingDown, TrendingUp, X } from 'lucide-react'
import { usePortfolio, usePostDailyMovement, useUi } from '@/context/AppContext'
import { buildPortfolio, byType, topN, convertToBase } from '@/utils/calculations'
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

  const openFxModal = useCallback(async () => {
    setFxModalOpen(true)
    if (fxHistory.length > 0) return
    setFxLoading(true)
    try {
      const end = new Date().toISOString().slice(0, 10)
      const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const res = await fetch(`https://api.frankfurter.app/${start}..${end}?from=GBP&to=INR`)
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
      dailyMovement,
      prevCloseAsOf,
    }
  }, [data, selectedOwner, selectedCountry])

  // Auto-save today's movement — use ref guard to prevent re-firing on mutation state changes
  useEffect(() => {
    if (!data || !view || view.dailyMovement == null) return
    const today = new Date().toISOString().slice(0, 10)
    const runKey = `${today}|${selectedOwner}|${Math.round(view.dailyMovement)}`
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
      movementGBP: view.dailyMovement,
      portfolioValueGBP: view.totalValueBase,
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="Portfolio"
            value={money(totalValueBase)}
            sub={privacyMode ? hidden : `Invested: ${formatMoney(totalCostBase, base)}`}
          />
          <Link to="/networth-progress" className="block transition hover:opacity-95">
            <KpiCard
              label="Net worth"
              value={money(netWorth)}
              sub={livePriceCount === 0 ? 'cost basis' : `${view.investedRows.length} positions`}
            />
          </Link>
          <KpiCard
            label="Total G/L"
            value={money(totalGainLoss)}
            tone={totalGainLoss === 0 ? 'neutral' : totalGainLoss > 0 ? 'gain' : 'loss'}
            sub={livePriceCount === 0 ? '—' : formatPercent(totalGainLossPct)}
          />
          <Link to="/daily-movement" className="block transition hover:opacity-95">
            <KpiCard
              label={(() => { const d = new Date().getDay(); return d === 0 || d === 6 ? 'Last trading day' : "Today's movement" })()}
              value={dailyMovement == null ? '—' : money(dailyMovement)}
              tone={dailyMovement == null ? 'neutral' : dailyMovement >= 0 ? 'gain' : 'loss'}
              sub={prevCloseAsOf ? `vs close ${new Date(prevCloseAsOf + (prevCloseAsOf.includes('T') ? '' : 'T12:00:00Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Refresh again tomorrow to see'}
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
    </>
  )
}
