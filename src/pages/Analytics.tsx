import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Gauge, PiggyBank, Target, TrendingUp } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio } from '@/utils/calculations'
import { loadLiabilities, totalLiabilitiesBase } from '@/utils/liabilities'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney, formatMoneyCompact } from '@/utils/format'

type GoalItem = { id: string; title: string; targetAmount: number }
type FirePlanner = { monthlyExpense: number; fireMultiple: number; monthlyContribution: number; annualReturnPct: number }

const ISA_LIMIT = 20_000
const ISA_AJBELL_KEY = 'firefly.isa.priya.ajbell'


function readGoals(): GoalItem[] {
  try {
    const raw = localStorage.getItem('firefly.goals')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function readFirePlanner(): FirePlanner {
  try {
    const raw = localStorage.getItem('firefly.firePlanner')
    const parsed = raw ? JSON.parse(raw) : null
    return {
      monthlyExpense: Number(parsed?.monthlyExpense || 2500),
      fireMultiple: Number(parsed?.fireMultiple || 30),
      monthlyContribution: Number(parsed?.monthlyContribution || 1000),
      annualReturnPct: Number(parsed?.annualReturnPct || 6),
    }
  } catch {
    return { monthlyExpense: 2500, fireMultiple: 30, monthlyContribution: 1000, annualReturnPct: 6 }
  }
}

export function Analytics() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, selectedCountry } = useUi()
  const [ajbellInput, setAjbellInput] = useState(() => {
    try { return String(JSON.parse(localStorage.getItem(ISA_AJBELL_KEY) || '0') || '') } catch { return '' }
  })

  const ajbellAmount = Math.max(0, Number(ajbellInput) || 0)
  useEffect(() => {
    localStorage.setItem(ISA_AJBELL_KEY, JSON.stringify(ajbellAmount))
  }, [ajbellAmount])

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
    const allLiabilities = loadLiabilities()
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

    const goals = readGoals()
    const fire = readFirePlanner()
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
    }
  }, [data, selectedOwner, selectedCountry])

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
              const autoAjbell = isa?.byOwner['Priya']?.['ajbell'] ?? 0
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
                      {' '}/ £{ISA_LIMIT.toLocaleString()} used · <span className="text-emerald-600 dark:text-emerald-400">£{remaining.toLocaleString('en-GB', { maximumFractionDigits: 0 })} left</span>
                    </span>
                  </div>
                  <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="flex h-full items-center justify-center bg-pink-500 text-[10px] font-semibold text-white"
                      style={{ width: `${usedPct}%` }}
                      title={`AJBell: £${total.toFixed(0)}`}
                    >
                      {usedPct > 6 ? 'AJ Bell' : ''}
                    </div>
                    <div className="flex-1 bg-slate-100 dark:bg-slate-800" />
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-pink-500" />AJ Bell</span>
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
