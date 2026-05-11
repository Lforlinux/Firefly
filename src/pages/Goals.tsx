import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Trash2 } from 'lucide-react'
import { usePortfolio } from '@/context/AppContext'
import { useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { buildPortfolio } from '@/utils/calculations'
import { loadLiabilities, totalLiabilitiesBase } from '@/utils/liabilities'

interface GoalItem {
  id: string
  title: string
  targetAmount: number
}

const STORAGE_KEY = 'firefly.goals'
const FIRE_KEY = 'firefly.firePlanner'

interface FirePlanner {
  monthlyExpense: number
  fireMultiple: number
  monthlyContribution: number
  annualReturnPct: number
}

function loadGoals(): GoalItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadFirePlanner(): FirePlanner {
  try {
    const raw = localStorage.getItem(FIRE_KEY)
    if (!raw) {
      return { monthlyExpense: 2500, fireMultiple: 30, monthlyContribution: 1000, annualReturnPct: 6 }
    }
    const parsed = JSON.parse(raw)
    return {
      monthlyExpense: Number(parsed.monthlyExpense || 2500),
      fireMultiple: Number(parsed.fireMultiple || 30),
      monthlyContribution: Number(parsed.monthlyContribution || 1000),
      annualReturnPct: Number(parsed.annualReturnPct || 6),
    }
  } catch {
    return { monthlyExpense: 2500, fireMultiple: 30, monthlyContribution: 1000, annualReturnPct: 6 }
  }
}

function estimateYearsToTarget(startingValue: number, target: number, monthlyContribution: number, annualReturnPct: number): number {
  if (startingValue >= target) return 0
  let value = Math.max(0, startingValue)
  const yearlyContribution = Math.max(0, monthlyContribution) * 12
  const growth = Math.max(-99, annualReturnPct) / 100
  for (let year = 1; year <= 80; year++) {
    value = value * (1 + growth) + yearlyContribution
    if (value >= target) return year
  }
  return 80
}

export function Goals() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, visualStyle, selectedCountry } = useUi()
  const [goals, setGoals] = useState<GoalItem[]>(() => loadGoals())
  const [firePlanner, setFirePlanner] = useState<FirePlanner>(() => loadFirePlanner())
  const [draft, setDraft] = useState({ title: '', targetAmount: '' })

  const base = selectedCountry === 'India' ? 'INR' : (data?.settings.baseCurrency || 'GBP')
  const currentPortfolioValue = useMemo(() => {
    if (!data) return 0
    let filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    if (selectedCountry === 'UK') filtered = filtered.filter((h) => h.currency !== 'INR')
    else if (selectedCountry === 'India') filtered = filtered.filter((h) => h.currency === 'INR')
    const built = buildPortfolio(filtered, data.prices, data.fxRates, base)
    const allLiabilities = loadLiabilities()
    const relevantLiabilities = selectedCountry === 'India'
      ? allLiabilities.filter((l) => l.currency === 'INR')
      : selectedCountry === 'UK'
        ? allLiabilities.filter((l) => l.currency !== 'INR')
        : allLiabilities
    const liabilities = totalLiabilitiesBase(relevantLiabilities, base)
    return built.totalValueBase - liabilities
  }, [data, selectedOwner, selectedCountry, base])

  const summary = useMemo(() => {
    const totalTarget = goals.reduce((a, g) => a + g.targetAmount, 0)
    const totalCurrent = goals.length === 0 ? 0 : currentPortfolioValue
    return { totalTarget, totalCurrent }
  }, [goals, currentPortfolioValue])
  const is3d = visualStyle === 'premium3d'
  const fieldClass = is3d
    ? 'mt-1 w-full rounded-lg border border-indigo-300/30 bg-indigo-900/45 px-3 py-2 text-sm text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_14px_rgba(59,130,246,0.16)] placeholder:text-cyan-200/60'
    : 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800'
  const statBoxClass = is3d
    ? 'rounded-xl border border-indigo-300/30 bg-indigo-900/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_24px_rgba(30,41,59,0.35)]'
    : 'rounded-xl border border-slate-200/90 bg-slate-50/90 p-3 dark:border-slate-700/90 dark:bg-slate-900/85'
  const addInfoClass = is3d
    ? 'rounded-lg border border-indigo-300/30 bg-indigo-900/35 px-3 py-2 text-xs text-cyan-100/85'
    : 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
  const progressTrackClass = is3d ? 'mt-3 h-2 rounded-full bg-indigo-950/70' : 'mt-3 h-2 rounded-full bg-slate-200 dark:bg-slate-800'
  const progressFillClass = is3d
    ? 'h-2 rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 shadow-[0_0_10px_rgba(56,189,248,0.55)]'
    : 'h-2 rounded-full bg-slate-900 dark:bg-slate-200'

  const fire = useMemo(() => {
    const target = firePlanner.monthlyExpense * 12 * firePlanner.fireMultiple
    const progress = target <= 0 ? 0 : Math.min((currentPortfolioValue / target) * 100, 100)
    const years = estimateYearsToTarget(
      currentPortfolioValue,
      target,
      firePlanner.monthlyContribution,
      firePlanner.annualReturnPct,
    )
    return { target, progress, years }
  }, [firePlanner, currentPortfolioValue])

  const fireProjection = useMemo(() => {
    const points: Array<{ year: number; value: number; target: number }> = []
    const target = fire.target
    let value = Math.max(0, currentPortfolioValue)
    const yearlyContribution = Math.max(0, firePlanner.monthlyContribution) * 12
    const growth = Math.max(-99, firePlanner.annualReturnPct) / 100
    for (let year = 0; year <= 30; year++) {
      points.push({ year, value, target })
      value = value * (1 + growth) + yearlyContribution
    }
    return points
  }, [fire.target, currentPortfolioValue, firePlanner.monthlyContribution, firePlanner.annualReturnPct])

  function persist(next: GoalItem[]) {
    setGoals(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  function updateFirePlanner(next: Partial<FirePlanner>) {
    setFirePlanner((prev) => {
      const merged = { ...prev, ...next }
      try { localStorage.setItem(FIRE_KEY, JSON.stringify(merged)) } catch { /* ignore */ }
      return merged
    })
  }

  function addGoal() {
    const target = Number(draft.targetAmount)
    if (!draft.title.trim() || !Number.isFinite(target) || target <= 0) return
    const next: GoalItem[] = [
      ...goals,
      {
        id: crypto.randomUUID?.() || String(Date.now()),
        title: draft.title.trim(),
        targetAmount: target,
      },
    ]
    persist(next)
    setDraft({ title: '', targetAmount: '' })
  }

  function removeGoal(id: string) {
    persist(goals.filter((g) => g.id !== id))
  }

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load goals" body={(error as Error).message} /></PageBody>

  return (
    <>
      <PageHeader title="Goals" subtitle="Track progress toward your next financial milestones." />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Goals</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{goals.length}</div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Total target</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(summary.totalTarget, base)}</div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Current progress</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(summary.totalCurrent, base)}</div>
          </Card>
        </div>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">FIRE planner</h3>
          <p className="mt-1 text-xs text-slate-500">Uses your live portfolio net worth as current value.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <label className="text-xs text-slate-500">
              Monthly expenses
              <input
                type="number"
                value={firePlanner.monthlyExpense}
                onChange={(e) => updateFirePlanner({ monthlyExpense: Number(e.target.value || 0) })}
                className={fieldClass}
              />
            </label>
            <label className="text-xs text-slate-500">
              FIRE multiple
              <select
                value={firePlanner.fireMultiple}
                onChange={(e) => updateFirePlanner({ fireMultiple: Number(e.target.value) })}
                className={fieldClass}
              >
                <option value={25}>25x</option>
                <option value={30}>30x</option>
                <option value={40}>40x</option>
                <option value={50}>50x</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Monthly savings
              <input
                type="number"
                value={firePlanner.monthlyContribution}
                onChange={(e) => updateFirePlanner({ monthlyContribution: Number(e.target.value || 0) })}
                className={fieldClass}
              />
            </label>
            <label className="text-xs text-slate-500">
              Return % (annual)
              <input
                type="number"
                step="0.1"
                value={firePlanner.annualReturnPct}
                onChange={(e) => updateFirePlanner({ annualReturnPct: Number(e.target.value || 0) })}
                className={fieldClass}
              />
            </label>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className={statBoxClass}>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">FIRE target</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(fire.target, base)}</div>
            </div>
            <div className={statBoxClass}>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Progress</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{fire.progress.toFixed(1)}%</div>
            </div>
            <div className={statBoxClass}>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Years to FIRE</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{fire.years >= 80 ? '80+' : fire.years}</div>
            </div>
          </div>
          <div className={progressTrackClass}>
            <div className={progressFillClass} style={{ width: `${Math.min(100, fire.progress)}%` }} />
          </div>
        </Card>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">FIRE projection</h3>
          <p className="mt-1 text-xs text-slate-500">Projected net worth over time vs FIRE target.</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fireProjection}>
                <CartesianGrid strokeDasharray="3 3" stroke={is3d ? 'rgba(99,102,241,0.35)' : 'rgba(148,163,184,0.25)'} />
                <XAxis dataKey="year" stroke={is3d ? '#c7d2fe' : '#94a3b8'} fontSize={11} tickFormatter={(v: number) => `Y${v}`} />
                <YAxis
                  stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                  fontSize={11}
                  width={96}
                  tickFormatter={(v: number) => formatMoney(v, base)}
                />
                <Tooltip
                  formatter={(v: number) => formatMoney(v, base)}
                  labelFormatter={(label: number) => `Year ${label}`}
                  contentStyle={is3d ? { background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(129,140,248,0.45)', borderRadius: 12, boxShadow: '0 10px 30px rgba(99,102,241,0.35)' } : undefined}
                />
                <ReferenceLine y={fire.target} stroke={is3d ? '#e879f9' : '#f59e0b'} strokeDasharray="6 6" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={is3d ? '#38bdf8' : '#0f172a'}
                  strokeWidth={is3d ? 3 : 2.5}
                  dot={false}
                  style={is3d ? { filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.85))' } : undefined}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500">Dashed line is FIRE target. Solid line is projected portfolio value.</p>
        </Card>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">Add goal</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <input value={draft.title} onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))} placeholder="Goal name" className={is3d ? 'rounded-lg border border-indigo-300/30 bg-indigo-900/45 px-3 py-2 text-sm text-cyan-100 placeholder:text-cyan-200/60' : 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800'} />
            <input value={draft.targetAmount} onChange={(e) => setDraft((v) => ({ ...v, targetAmount: e.target.value }))} placeholder="Target amount" type="number" className={is3d ? 'rounded-lg border border-indigo-300/30 bg-indigo-900/45 px-3 py-2 text-sm text-cyan-100 placeholder:text-cyan-200/60' : 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800'} />
            <div className={addInfoClass}>
              Current value auto-syncs from portfolio
            </div>
            <button type="button" onClick={addGoal} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">Add</button>
          </div>
        </Card>

        {goals.length === 0 ? (
          <EmptyState title="No goals yet" body="Create your first goal to monitor progress from dashboard previews." />
        ) : (
          <Card tone="elevated" className="space-y-4">
            {goals.map((g) => {
              const currentAmount = currentPortfolioValue
              const progress = g.targetAmount <= 0 ? 0 : Math.min((currentAmount / g.targetAmount) * 100, 100)
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{g.title}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs tabular-nums text-slate-500">{progress.toFixed(0)}%</div>
                      <button
                        type="button"
                        onClick={() => removeGoal(g.id)}
                        className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500"
                        aria-label={`Delete goal ${g.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className={is3d ? 'mt-2 h-2 rounded-full bg-indigo-950/70' : 'mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-800'}>
                    <div
                      className={is3d
                        ? 'h-2 rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 shadow-[0_0_10px_rgba(56,189,248,0.55)]'
                        : 'h-2 rounded-full bg-slate-900 dark:bg-slate-200'}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatMoney(currentAmount, base)} / {formatMoney(g.targetAmount, base)}
                  </div>
                </div>
              )
            })}
          </Card>
        )}
      </PageBody>
    </>
  )
}
