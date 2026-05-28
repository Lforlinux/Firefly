import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Gauge, PiggyBank, Target, TrendingUp } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio } from '@/utils/calculations'
import { totalLiabilitiesBase } from '@/utils/liabilities'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney, formatMoneyCompact } from '@/utils/format'
import { fetchGoals } from '@/services/api'
import type { FirePlannerData } from '@/services/api'

function detectProvider(ticker: string, notes: string): string {
  const n = (notes || '').toLowerCase()
  const t = (ticker || '').toLowerCase()
  if (n.includes('investengine')) return 'InvestEngine'
  if (n.includes('trading212') || n.includes('t212')) return 'Trading 212'
  if (n.includes('ajbell') || n.includes('aj bell')) return 'AJ Bell'
  if (n.includes('kite') || t.endsWith('.ns') || t.endsWith('.bo')) return 'Zerodha'
  if (n.includes('plum') || t.startsWith('cash:plum')) return 'Plum'
  if (t.startsWith('cash:')) return 'Cash'
  return 'Other'
}

const ISA_LIMIT = 20_000
const ISA_AJBELL_KEY  = 'firefly.isa.priya.ajbell'
const BOE_RATE_KEY    = 'firefly.rates.boe'   // Bank of England base rate %
const RBI_RATE_KEY    = 'firefly.rates.rbi'   // RBI repo rate %
const DEFAULT_BOE     = 3.75   // current BoE base rate
const DEFAULT_RBI     = 6.0    // current RBI repo rate

const DEFAULT_FIRE: FirePlannerData = { monthlyExpense: 2500, fireMultiple: 30, monthlyContribution: 1000, annualReturnPct: 6 }

export function Analytics() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, selectedCountry, visualStyle } = useUi()
  const is3d = visualStyle === 'premium3d'
  const country = selectedCountry === 'India' ? 'India' : 'UK'

  // Goals + FIRE from DB (same query as Goals page — cached, no extra network hit)
  const { data: goalsData } = useQuery({
    queryKey: ['goals', country],
    queryFn: () => fetchGoals(country),
    staleTime: 5 * 60_000,
  })

  const [ajbellInput, setAjbellInput] = useState(() => {
    try { return String(JSON.parse(localStorage.getItem(ISA_AJBELL_KEY) || '0') || '') } catch { return '' }
  })
  const [boeInput, setBoeInput] = useState(() => {
    try { return String(JSON.parse(localStorage.getItem(BOE_RATE_KEY) || String(DEFAULT_BOE))) } catch { return String(DEFAULT_BOE) }
  })
  const [rbiInput, setRbiInput] = useState(() => {
    try { return String(JSON.parse(localStorage.getItem(RBI_RATE_KEY) || String(DEFAULT_RBI))) } catch { return String(DEFAULT_RBI) }
  })

  const ajbellAmount = Math.max(0, Number(ajbellInput) || 0)
  const boeRate = Math.max(0, Number(boeInput) || DEFAULT_BOE)
  const rbiRate = Math.max(0, Number(rbiInput) || DEFAULT_RBI)

  useEffect(() => {
    localStorage.setItem(ISA_AJBELL_KEY, JSON.stringify(ajbellAmount))
  }, [ajbellAmount])
  useEffect(() => {
    localStorage.setItem(BOE_RATE_KEY, JSON.stringify(boeRate))
  }, [boeRate])
  useEffect(() => {
    localStorage.setItem(RBI_RATE_KEY, JSON.stringify(rbiRate))
  }, [rbiRate])

  const isa = data?.isa ?? null

  const view = useMemo(() => {
    if (!data) return null
    const base = selectedCountry === 'India' ? 'INR' : (data.settings.baseCurrency || 'GBP')
    let holdings = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    if (selectedCountry === 'UK') holdings = holdings.filter((h) => h.currency !== 'INR')
    else if (selectedCountry === 'India') holdings = holdings.filter((h) => h.currency === 'INR')
    const built = buildPortfolio(holdings, data.prices, data.fxRates, base)
    const allLiabilities = data.liabilities ?? []
    const relevantLiabilities = selectedCountry === 'India'
      ? allLiabilities.filter((l) => l.currency === 'INR')
      : selectedCountry === 'UK'
        ? allLiabilities.filter((l) => l.currency !== 'INR')
        : allLiabilities
    const liabilities = totalLiabilitiesBase(relevantLiabilities, base)
    const netWorth = built.totalValueBase - liabilities
    const directGbpInr = data.fxRates?.GBP_INR?.rate
    const inverseInrGbp = data.fxRates?.INR_GBP?.rate
    const gbpToInr = Number.isFinite(directGbpInr)
      ? Number(directGbpInr)
      : Number.isFinite(inverseInrGbp) && inverseInrGbp > 0
        ? 1 / Number(inverseInrGbp)
        : null
    const netWorthInr = gbpToInr != null ? netWorth * gbpToInr : null

    const goals = goalsData?.goals ?? []
    const fire: FirePlannerData = goalsData?.firePlanner ?? DEFAULT_FIRE
    const fireTarget = fire.monthlyExpense * 12 * fire.fireMultiple
    const fireProgress = fireTarget > 0 ? Math.min((netWorth / fireTarget) * 100, 100) : 0

    const goalCoverage = goals.length
      ? goals.reduce((acc, g) => acc + Math.min(100, (netWorth / Math.max(1, g.targetAmount)) * 100), 0) / goals.length
      : 0

    const top5Weight = built.investedRows
      .slice()
      .sort((a, b) => b.valueBase - a.valueBase)
      .slice(0, 5)
      .reduce((acc, r) => acc + r.weight, 0) * 100

    const snapshots = [...(data.snapshots || [])].sort((a, b) => a.date.localeCompare(b.date))
    const peak = snapshots.reduce((m, s) => Math.max(m, Number(s.valueGBP || 0)), 0)
    const currentSnap = snapshots.length ? Number(snapshots[snapshots.length - 1].valueGBP || 0) : netWorth
    const drawdownPct = peak > 0 ? ((currentSnap - peak) / peak) * 100 : 0

    const oneMonthAgo = new Date()
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30)
    const recentTx = (data.transactions || []).filter((t) => new Date(t.date) >= oneMonthAgo)
    const buys30d = recentTx.filter((t) => t.side === 'buy').reduce((a, t) => a + t.shares * t.price, 0)
    const sells30d = recentTx.filter((t) => t.side === 'sell').reduce((a, t) => a + t.shares * t.price, 0)
    const netFlow30d = buys30d - sells30d

    const investedCost = Math.max(1, built.totalCostBase - built.cashValueBase)
    const efficiencyRatio = (built.totalValueBase - built.cashValueBase) / investedCost

    const signals: string[] = []
    if (drawdownPct < -8) signals.push('Portfolio is in a notable drawdown - review dip-buying plan.')
    if (top5Weight > 55) signals.push('Top 5 positions are highly concentrated - diversification may reduce risk.')
    if (fireProgress < 35) signals.push('FIRE progress is still early - contribution consistency matters most now.')
    if (netFlow30d <= 0) signals.push('No positive net contributions in the last 30 days.')
    if (signals.length === 0) signals.push('Portfolio trend looks healthy. Stay consistent and rebalance periodically.')

    // Combined UK + India net worth (always in GBP as base, then converted to INR)
    // Uses all holdings regardless of country filter — only meaningful from UK view
    const gbpBase = data.settings.baseCurrency || 'GBP'
    const allOwnerHoldings = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    const allBuilt = buildPortfolio(allOwnerHoldings, data.prices, data.fxRates, gbpBase)
    const allLiabilitiesTotal = totalLiabilitiesBase(allLiabilities, gbpBase)
    const combinedNetWorthGBP = allBuilt.totalValueBase - allLiabilitiesTotal
    const combinedNetWorthInr = gbpToInr != null ? combinedNetWorthGBP * gbpToInr : null

    // Provider breakdown — respects country filter via built.rows
    const providerMap = new Map<string, number>()
    for (const row of built.rows) {
      const owner = row.owner || 'KLN'
      const provider = detectProvider(row.ticker, row.notes || '')
      const key = `${owner}||${provider}`
      providerMap.set(key, (providerMap.get(key) || 0) + row.valueBase)
    }
    const providerBreakdown = Array.from(providerMap.entries())
      .map(([key, valueGBP]) => {
        const [owner, provider] = key.split('||')
        return { owner, provider, valueGBP }
      })
      .filter((r) => r.valueGBP > 0.5)
      .sort((a, b) => a.owner.localeCompare(b.owner) || b.valueGBP - a.valueGBP)

    return {
      base,
      netWorth,
      netWorthInr,
      gbpToInr,
      liabilities,
      fireTarget,
      fireProgress,
      goalCoverage,
      goalsCount: goals.length,
      top5Weight,
      drawdownPct,
      netFlow30d,
      efficiencyRatio,
      signals,
      combinedNetWorthGBP,
      combinedNetWorthInr,
      providerBreakdown,
    }
  }, [data, selectedOwner, selectedCountry, goalsData])

  // Month-over-month portfolio growth %
  // Combines historical snapshots (uk_gbp from notes) + daily_movements for recent months
  const monthlyGrowth = useMemo(() => {
    if (!data) return []
    const byMonth = new Map<string, number>()

    // Source 1: snapshots — prefer uk_gbp from notes JSON
    for (const s of data.snapshots || []) {
      let v = Number(s.valueGBP)
      try {
        const parsed = JSON.parse(s.notes || '{}')
        if (parsed?.uk_gbp && Number.isFinite(Number(parsed.uk_gbp))) v = Number(parsed.uk_gbp)
      } catch { /* ignore */ }
      if (v > 0) byMonth.set(s.date.slice(0, 7), v)
    }

    // Source 2: daily_movements (owner='all') — last recorded value per month wins
    const sorted = [...(data.dailyMovements || [])]
      .filter((m) => m.owner === 'all' && m.portfolioValueGBP != null && m.portfolioValueGBP > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    for (const m of sorted) byMonth.set(m.date.slice(0, 7), m.portfolioValueGBP!)

    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    const result: Array<{ month: string; pct: number; label: string }> = []
    for (let i = 1; i < months.length; i++) {
      const [month, value] = months[i]
      const [, prev] = months[i - 1]
      const pct = prev > 0 ? ((value - prev) / prev) * 100 : 0
      const dt = new Date(month + '-01T12:00:00Z')
      const label = dt.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      result.push({ month, pct, label })
    }
    return result
  }, [data])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load analytics" body={(error as Error).message} /></PageBody>
  if (!view) return null

  return (
    <>
      <PageHeader title="Analytics" subtitle="Intelligent insights across portfolio, goals, and trajectory." />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card tone="elevated">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500">
              <span>FIRE progress</span>
              <Target className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{view.fireProgress.toFixed(1)}%</div>
            <div className="mt-1 text-xs text-slate-500">{formatMoney(view.netWorth, view.base)} / {formatMoney(view.fireTarget, view.base)}</div>
          </Card>
          <Card tone="elevated">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500">
              <span>Goal coverage</span>
              <Gauge className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{view.goalCoverage.toFixed(1)}%</div>
            <div className="mt-1 text-xs text-slate-500">{view.goalsCount} goals tracked</div>
          </Card>
          <Card tone="elevated">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500">
              <span>Concentration</span>
              <TrendingUp className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{view.top5Weight.toFixed(1)}%</div>
            <div className="mt-1 text-xs text-slate-500">Top 5 holdings weight</div>
          </Card>
          <Card tone="elevated">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500">
              <span>30d net flow</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </div>
            <div className={`mt-2 text-2xl font-semibold tabular-nums ${view.netFlow30d >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatMoney(view.netFlow30d, view.base)}
            </div>
            <div className="mt-1 text-xs text-slate-500">Buys minus sells in last 30 days</div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card tone="elevated" className="lg:col-span-2">
            <h3 className="text-sm font-semibold">Signal feed</h3>
            <p className="mt-1 text-xs text-slate-500">Automated observations from your latest data.</p>
            <div className="mt-3 space-y-2">
              {view.signals.map((s, i) => (
                <div key={i} className="ff-signal-item flex items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-sm dark:border-slate-700/90 dark:bg-slate-900/80">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card tone="elevated">
            <h3 className="text-sm font-semibold">Efficiency</h3>
            <p className="mt-1 text-xs text-slate-500">How effectively invested capital translates into current value.</p>
            <div className="mt-4 text-3xl font-semibold tabular-nums">{view.efficiencyRatio.toFixed(2)}x</div>
            <div className="mt-1 text-xs text-slate-500">Value / cost basis (excluding cash)</div>
            <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700">
              Current drawdown from peak snapshot: <span className={view.drawdownPct < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>{view.drawdownPct.toFixed(1)}%</span>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Net worth</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{formatMoney(view.netWorth, view.base)}</div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Net worth in INR</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">
              {view.netWorthInr == null ? '—' : formatMoneyCompact(view.netWorthInr, 'INR')}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {view.gbpToInr == null ? 'Refresh prices to load FX' : `1 GBP = ₹${view.gbpToInr.toFixed(2)}`}
            </div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Liabilities</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{formatMoney(view.liabilities, view.base)}</div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wider text-slate-500">Action center</div>
            <Link to="/goals" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-slate-700 underline-offset-2 hover:underline dark:text-slate-200">
              Tune FIRE assumptions
            </Link>
            <div>
              <Link to="/allocation" className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 underline-offset-2 hover:underline dark:text-slate-200">
                Rebalance allocation
              </Link>
            </div>
          </Card>
        </div>

        {/* Combined UK + India net worth — only shown in UK view */}
        {selectedCountry === 'UK' && (
          <Card tone="elevated" className={is3d ? 'border-indigo-400/30 bg-gradient-to-br from-indigo-900/55 to-slate-900/45' : ''}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`text-sm font-semibold ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>
                  Combined portfolio — 🇬🇧 UK + 🇮🇳 India
                </h3>
                <p className={`mt-0.5 text-xs ${is3d ? 'text-cyan-200/75' : 'text-slate-500'}`}>
                  Total net worth across both countries
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <div className={`text-[11px] uppercase tracking-wider ${is3d ? 'text-indigo-200/80' : 'text-slate-500'}`}>In GBP</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${is3d ? 'text-cyan-100' : ''}`}>
                  {formatMoney(view.combinedNetWorthGBP, 'GBP')}
                </div>
              </div>
              <div>
                <div className={`text-[11px] uppercase tracking-wider ${is3d ? 'text-indigo-200/80' : 'text-slate-500'}`}>In INR</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${is3d ? 'text-cyan-100' : ''}`}>
                  {view.combinedNetWorthInr == null ? '—' : formatMoney(view.combinedNetWorthInr, 'INR')}
                </div>
              </div>
            </div>
            {view.gbpToInr != null && (
              <div className={`mt-3 text-xs ${is3d ? 'text-indigo-200/70' : 'text-slate-400'}`}>
                FX: 1 GBP = ₹{view.gbpToInr.toFixed(2)} · India holdings converted at live rate
              </div>
            )}
            {view.gbpToInr == null && (
              <div className={`mt-3 text-xs ${is3d ? 'text-amber-300/70' : 'text-amber-600'}`}>
                Refresh prices to load FX rate for INR conversion
              </div>
            )}
          </Card>
        )}

        {/* Monthly interest calculator — shown alongside combined portfolio */}
        {selectedCountry === 'UK' && (
          <Card tone="elevated" className={is3d ? 'border-indigo-400/30 bg-gradient-to-br from-indigo-900/55 to-slate-900/45' : ''}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`text-sm font-semibold ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>
                  Monthly interest at central bank rates
                </h3>
                <p className={`mt-0.5 text-xs ${is3d ? 'text-cyan-200/75' : 'text-slate-500'}`}>
                  What your capital earns per month at the current base rate
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* GBP */}
              <div className={`rounded-xl p-4 ${is3d ? 'bg-white/5' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-medium uppercase tracking-wider ${is3d ? 'text-indigo-200/80' : 'text-slate-500'}`}>
                    🇬🇧 GBP · Bank of England
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="20"
                      value={boeInput}
                      onChange={(e) => setBoeInput(e.target.value)}
                      className="w-14 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-right text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                    <span className={`text-xs ${is3d ? 'text-indigo-200/60' : 'text-slate-400'}`}>%</span>
                  </div>
                </div>
                <div className={`mt-2 text-2xl font-semibold tabular-nums ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-50'}`}>
                  {formatMoney((view.combinedNetWorthGBP * boeRate) / 100 / 12, 'GBP')}
                  <span className={`ml-1 text-sm font-normal ${is3d ? 'text-indigo-200/60' : 'text-slate-400'}`}>/mo</span>
                </div>
                <div className={`mt-1 text-xs ${is3d ? 'text-indigo-200/50' : 'text-slate-400'}`}>
                  {formatMoney((view.combinedNetWorthGBP * boeRate) / 100, 'GBP')} per year · on {formatMoney(view.combinedNetWorthGBP, 'GBP')}
                </div>
              </div>

              {/* INR */}
              <div className={`rounded-xl p-4 ${is3d ? 'bg-white/5' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-medium uppercase tracking-wider ${is3d ? 'text-indigo-200/80' : 'text-slate-500'}`}>
                    🇮🇳 INR · Reserve Bank of India
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="20"
                      value={rbiInput}
                      onChange={(e) => setRbiInput(e.target.value)}
                      className="w-14 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-right text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                    <span className={`text-xs ${is3d ? 'text-indigo-200/60' : 'text-slate-400'}`}>%</span>
                  </div>
                </div>
                <div className={`mt-2 text-2xl font-semibold tabular-nums ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-50'}`}>
                  {view.combinedNetWorthInr == null
                    ? '—'
                    : formatMoney((view.combinedNetWorthInr * rbiRate) / 100 / 12, 'INR')}
                  <span className={`ml-1 text-sm font-normal ${is3d ? 'text-indigo-200/60' : 'text-slate-400'}`}>/mo</span>
                </div>
                <div className={`mt-1 text-xs ${is3d ? 'text-indigo-200/50' : 'text-slate-400'}`}>
                  {view.combinedNetWorthInr == null
                    ? 'Refresh prices to load FX'
                    : `${formatMoneyCompact((view.combinedNetWorthInr * rbiRate) / 100, 'INR')} per year · on ${formatMoneyCompact(view.combinedNetWorthInr, 'INR')}`}
                </div>
              </div>
            </div>

            <div className={`mt-3 text-[11px] ${is3d ? 'text-indigo-200/40' : 'text-slate-400'}`}>
              Simple interest only · tap the rate to update when central banks change rates
            </div>
          </Card>
        )}

        {/* Provider breakdown table */}
        {view.providerBreakdown.length > 0 && (
          <Card tone="elevated">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Where your money is held</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {selectedCountry === 'India' ? '🇮🇳 India holdings · values in INR' : '🇬🇧 UK holdings · values in GBP'} · live prices
            </p>
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Owner</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Provider</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-slate-500">Value (GBP)</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-slate-500">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {view.providerBreakdown.map((row) => {
                    const pct = view.netWorth > 0 ? (row.valueGBP / view.netWorth) * 100 : 0
                    return (
                      <tr key={`${row.owner}-${row.provider}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">{row.owner}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{row.provider}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoney(row.valueGBP, view.base)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{pct.toFixed(1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
                    <td colSpan={2} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Total</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatMoney(view.netWorth, view.base)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}

        {/* Monthly growth % chart — UK view, needs at least 2 months of data */}
        {selectedCountry !== 'India' && monthlyGrowth.length >= 2 && (
          <Card tone="elevated">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Monthly portfolio growth</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Month-over-month % change · {monthlyGrowth.length} months · historical snapshots + daily tracking
            </p>
            <div className="mt-4 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyGrowth} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                  <XAxis dataKey="label" fontSize={10} stroke="#94a3b8" tickLine={false} />
                  <YAxis
                    fontSize={10}
                    stroke="#94a3b8"
                    tickLine={false}
                    axisLine={false}
                    width={42}
                    tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v > 0 ? '+' : ''}${v.toFixed(2)}%`, 'Monthly return']}
                    contentStyle={{ borderRadius: 8 }}
                  />
                  <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                    {monthlyGrowth.map((entry) => (
                      <Cell
                        key={entry.month}
                        fill={entry.pct >= 0 ? '#10b981' : '#f43f5e'}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Summary row */}
            {(() => {
              const positive = monthlyGrowth.filter((m) => m.pct >= 0).length
              const best = monthlyGrowth.reduce((b, m) => m.pct > b.pct ? m : b, monthlyGrowth[0])
              const worst = monthlyGrowth.reduce((w, m) => m.pct < w.pct ? m : w, monthlyGrowth[0])
              return (
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span><span className="font-medium text-emerald-600 dark:text-emerald-400">{positive}</span> / {monthlyGrowth.length} months positive</span>
                  <span>Best <span className="font-medium text-emerald-600 dark:text-emerald-400">+{best.pct.toFixed(2)}%</span> {best.label}</span>
                  <span>Worst <span className="font-medium text-rose-500">{worst.pct.toFixed(2)}%</span> {worst.label}</span>
                </div>
              )
            })()}
          </Card>
        )}

        {/* ISA Allowance Tracker — UK only */}
        {selectedCountry !== 'India' && <Card tone="elevated">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">ISA allowance tracker</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                FY {isa?.fy.label ?? '—'} · £{ISA_LIMIT.toLocaleString()} limit per person
              </p>
            </div>
            <PiggyBank className="h-4 w-4 text-slate-400" />
          </div>

          <div className="mt-5 space-y-6">
            {/* KLN */}
            {(() => {
              const kln = isa?.byOwner['KLN'] ?? {}
              const t212 = kln['t212'] ?? 0
              const ie = kln['investengine'] ?? 0
              const total = t212 + ie
              const remaining = Math.max(0, ISA_LIMIT - total)
              const t212Pct = (t212 / ISA_LIMIT) * 100
              const iePct = (ie / ISA_LIMIT) * 100
              const remPct = (remaining / ISA_LIMIT) * 100
              return (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">KLN</span>
                    <span className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">£{total.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                      {' '}/ £{ISA_LIMIT.toLocaleString()} used · <span className="text-emerald-600 dark:text-emerald-400">£{remaining.toLocaleString('en-GB', { maximumFractionDigits: 0 })} left</span>
                    </span>
                  </div>
                  <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="flex h-full items-center justify-center bg-cyan-500 text-[10px] font-semibold text-white"
                      style={{ width: `${t212Pct}%` }}
                      title={`T212: £${t212.toFixed(0)}`}
                    >
                      {t212Pct > 6 ? 'T212' : ''}
                    </div>
                    <div
                      className="flex h-full items-center justify-center bg-violet-500 text-[10px] font-semibold text-white"
                      style={{ width: `${iePct}%` }}
                      title={`InvestEngine: £${ie.toFixed(0)}`}
                    >
                      {iePct > 6 ? 'IE' : ''}
                    </div>
                    <div className="flex-1 bg-slate-100 dark:bg-slate-800" style={{ width: `${remPct}%` }} />
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-cyan-500" />T212 £{t212.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-violet-500" />InvestEngine £{ie.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />Remaining £{remaining.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              )
            })()}

            {/* Priya */}
            {(() => {
              const autoAjbell = isa?.byOwner['Priya']?.['ajbell'] ?? 0  // already excludes transfers (API-side)
              const transferIn = isa?.transferByOwner?.['Priya']?.['ajbell'] ?? 0  // display only
              const total = autoAjbell > 0 ? autoAjbell : ajbellAmount
              const isAuto = autoAjbell > 0
              const remaining = Math.max(0, ISA_LIMIT - total)
              const usedPct = Math.min(100, (total / ISA_LIMIT) * 100)
              return (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Priya</span>
                    <span className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">£{total.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                      {' '}/ £{ISA_LIMIT.toLocaleString()} used · <span className={remaining > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}>£{remaining.toLocaleString('en-GB', { maximumFractionDigits: 0 })} left</span>
                    </span>
                  </div>
                  <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="flex h-full items-center justify-center bg-pink-500 text-[10px] font-semibold text-white"
                      style={{ width: `${usedPct}%` }}
                      title={`AJ Bell new contributions: £${total.toFixed(0)}`}
                    >
                      {usedPct > 6 ? 'AJ Bell' : ''}
                    </div>
                    <div className="flex-1 bg-slate-100 dark:bg-slate-800" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-pink-500" />AJ Bell</span>
                    {transferIn > 0 && (
                      <span className="text-slate-400">
                        +£{transferIn.toLocaleString('en-GB', { maximumFractionDigits: 0 })} ISA transfer in (excluded)
                      </span>
                    )}
                    {isAuto ? (
                      <span className="text-slate-400">Auto-synced from AJ Bell CSV</span>
                    ) : (
                      <label className="flex items-center gap-1.5">
                        <span>Enter deposited:</span>
                        <span className="text-slate-400">£</span>
                        <input
                          type="number"
                          min="0"
                          max="20000"
                          value={ajbellInput}
                          onChange={(e) => setAjbellInput(e.target.value)}
                          className="w-24 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          placeholder="0"
                        />
                      </label>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        </Card>}
      </PageBody>
    </>
  )
}
