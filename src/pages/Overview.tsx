import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { AlertCircle, CalendarClock, Flame, ShieldCheck, TrendingUp } from 'lucide-react'
import { usePortfolio, usePostSnapshot, usePostDailyMovement, useUi } from '@/context/AppContext'
import { buildPortfolio, byType, topN, convertToBase } from '@/utils/calculations'
import { formatMoney, formatPercent, formatRelative } from '@/utils/format'
import { Card, EmptyState, GainLossBadge, KpiCard, Loading, PageBody, PageHeader } from '@/components/ui'
import { loadLiabilities, totalLiabilitiesBase } from '@/utils/liabilities'

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
  const postSnapshot = usePostSnapshot()
  const postDailyMovement = usePostDailyMovement()
  const { selectedOwner, privacyMode, visualStyle, selectedCountry, setSelectedCountry } = useUi()
  const autoSnapshotKeyRef = useRef('')
  const autoMovementKeyRef = useRef('')

  const view = useMemo(() => {
    if (!data) return null
    let filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    if (selectedCountry === 'UK') filtered = filtered.filter((h) => h.currency !== 'INR')
    else if (selectedCountry === 'India') filtered = filtered.filter((h) => h.currency === 'INR')
    const base = data.settings.baseCurrency || 'GBP'
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
    const liabilitiesTotal = totalLiabilitiesBase(loadLiabilities(), base)
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
    const monthKey = new Date().toISOString().slice(0, 7)
    const monthSnapshots = [...(data.snapshots || [])]
      .filter((s) => s.date.startsWith(monthKey))
      .sort((a, b) => a.date.localeCompare(b.date))
    const monthStartSnapshot = monthSnapshots[0]
    const monthStartValue = monthStartSnapshot ? Number(monthStartSnapshot.valueGBP || 0) : netWorth
    const monthDelta = netWorth - monthStartValue
    const monthGrowthSteps = monthDelta > 0 ? Math.floor(monthDelta / 100) : 0
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
      monthGrowthSteps,
      dailyMovement,
      prevCloseAsOf,
    }
  }, [data, selectedOwner, selectedCountry])

  const netWorthForAutoSnapshot = view?.netWorth ?? 0
  useEffect(() => {
    if (!data || !view || selectedOwner !== 'all' || selectedCountry !== 'all') return
    if (netWorthForAutoSnapshot <= 0) return
    const today = new Date().toISOString().slice(0, 10)
    const hasToday = data.snapshots.some((s) => s.date === today)
    if (hasToday) return
    const runKey = `${today}|${Math.round(netWorthForAutoSnapshot)}`
    if (autoSnapshotKeyRef.current === runKey) return
    autoSnapshotKeyRef.current = runKey
    postSnapshot.mutate({ date: today, valueGBP: netWorthForAutoSnapshot })
  }, [data, view, selectedOwner, netWorthForAutoSnapshot, postSnapshot])

  // Auto-save today's movement for all owners whenever we have prevClose data
  useEffect(() => {
    if (!data || !view || view.dailyMovement == null) return
    const today = new Date().toISOString().slice(0, 10)
    const runKey = `${today}|${selectedOwner}|${Math.round(view.dailyMovement)}`
    if (autoMovementKeyRef.current === runKey) return
    const alreadySaved = (data.dailyMovements || []).some(
      (m) => m.date === today && m.owner === selectedOwner
    )
    if (alreadySaved) return
    autoMovementKeyRef.current = runKey
    postDailyMovement.mutate({
      date: today,
      owner: selectedOwner,
      movementGBP: view.dailyMovement,
      portfolioValueGBP: view.totalValueBase,
    })
  }, [data, view, selectedOwner, postDailyMovement])

  if (isLoading) return <Loading label="Loading portfolio…" />
  if (error) return <PageBody><EmptyState title="Couldn't load portfolio" body={(error as Error).message} /></PageBody>
  if (!data || !view) return null

  const {
    totalValueBase,
    totalCostBase,
    totalGainLoss,
    totalGainLossPct,
    cashValueBase,
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
    monthGrowthSteps,
    netWorth,
    dailyMovement,
    prevCloseAsOf,
  } = view
  const investedValue = totalValueBase - cashValueBase
  const is3d = visualStyle === 'premium3d'
  const hidden = '•••••'
  const money = (v: number) => (privacyMode ? hidden : formatMoney(v, base))

  const flagBtnClass = (active: boolean) =>
    is3d
      ? [
          'rounded-lg px-2 py-1.5 text-xl leading-none transition-all',
          active
            ? 'bg-indigo-800/65 shadow-[0_0_12px_rgba(59,130,246,0.4)] ring-1 ring-indigo-300/40'
            : 'opacity-50 hover:opacity-90 hover:bg-indigo-900/40',
        ].join(' ')
      : [
          'rounded-lg px-2 py-1.5 text-xl leading-none transition-all',
          active
            ? 'bg-slate-900 shadow-sm dark:bg-slate-100 ring-2 ring-slate-400/30'
            : 'opacity-50 hover:opacity-90 hover:bg-slate-100 dark:hover:bg-slate-800',
        ].join(' ')

  const countryLabel = selectedCountry === 'UK' ? ' · 🇬🇧 UK only' : selectedCountry === 'India' ? ' · 🇮🇳 India only' : ''

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            {selectedOwner === 'all' ? 'All portfolios' : `${selectedOwner}'s portfolio`}{countryLabel} ·{' '}
            Last refresh: {formatRelative(data.lastRefresh)}
          </>
        }
        right={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelectedCountry(selectedCountry === 'UK' ? 'all' : 'UK')}
              className={flagBtnClass(selectedCountry === 'UK')}
              title="Show UK holdings only"
            >
              🇬🇧
            </button>
            <button
              type="button"
              onClick={() => setSelectedCountry(selectedCountry === 'India' ? 'all' : 'India')}
              className={flagBtnClass(selectedCountry === 'India')}
              title="Show India holdings only"
            >
              🇮🇳
            </button>
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
          <Link to="/networth-progress" className="block transition hover:opacity-95">
            <KpiCard
              label="Net worth"
              value={money(netWorth)}
              valueClassName={is3d ? 'ff-networth-value' : ''}
              sub={livePriceCount === 0 ? 'cost basis' : `${view.investedRows.length} positions`}
            />
          </Link>
          <KpiCard
            label="Invested"
            value={money(investedValue)}
            sub={privacyMode ? hidden : `Cost: ${formatMoney(totalCostBase - cashValueBase, base)}`}
          />
          <KpiCard
            label="Total G/L"
            value={money(totalGainLoss)}
            tone={totalGainLoss === 0 ? 'neutral' : totalGainLoss > 0 ? 'gain' : 'loss'}
            sub={livePriceCount === 0 ? '—' : formatPercent(totalGainLossPct)}
          />
          <Link to="/daily-movement" className="block transition hover:opacity-95">
            <KpiCard
              label="Today's movement"
              value={dailyMovement == null ? '—' : money(dailyMovement)}
              tone={dailyMovement == null ? 'neutral' : dailyMovement >= 0 ? 'gain' : 'loss'}
              sub={prevCloseAsOf ? `vs close ${new Date(prevCloseAsOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Refresh again tomorrow to see'}
              icon={<TrendingUp className="h-4 w-4 text-slate-400" />}
            />
          </Link>
          <KpiCard
            label="GBP → INR"
            value={gbpToInr == null ? '—' : `₹${gbpToInr.toFixed(2)}`}
            sub={gbpToInr == null ? 'Refresh prices to load FX' : '1 GBP in INR'}
          />
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
                  Baseline: {monthStartSnapshot ? monthStartSnapshot.date : 'today'}
                </p>
              </div>
              <CalendarClock className="mt-0.5 h-4 w-4 text-slate-400" />
            </div>
            <div className={`mt-4 text-xl font-semibold tabular-nums ${monthDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {privacyMode ? hidden : formatMoney(monthDelta, base)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {monthDelta >= 0
                ? `+£100 milestones hit this month: ${monthGrowthSteps}`
                : 'Market dip since month start - potential add window.'}
            </p>
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
                  <li key={h.id} className="flex items-center justify-between py-3">
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
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  )
}
