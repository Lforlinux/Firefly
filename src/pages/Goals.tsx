import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Trash2 } from 'lucide-react'
import { usePortfolio } from '@/context/AppContext'
import { useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { buildPortfolio } from '@/utils/calculations'
import { loadLiabilities, totalLiabilitiesBase } from '@/utils/liabilities'
import {
  fetchGoals,
  addGoal as apiAddGoal,
  removeGoal as apiRemoveGoal,
  updateGoal as apiUpdateGoal,
  importGoals,
  saveFirePlanner,
  type FirePlannerData,
} from '@/services/api'

const LEGACY_GOALS_KEY_UK = 'firefly.goals'
const LEGACY_GOALS_KEY_INDIA = 'firefly.goals.india'
const LEGACY_FIRE_KEY = 'firefly.firePlanner'
const MIGRATED_KEY = 'firefly.goals.migrated' // set after first-time DB migration

const DEFAULT_FIRE: FirePlannerData = {
  monthlyExpense: 2500,
  fireMultiple: 30,
  monthlyContribution: 1000,
  annualReturnPct: 6,
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
  const { data, isLoading: portfolioLoading, error: portfolioError } = usePortfolio()
  const { selectedOwner, visualStyle, selectedCountry } = useUi()
  const qc = useQueryClient()
  const country = selectedCountry === 'India' ? 'India' : 'UK'
  const migratedRef = useRef(false)

  // ── load goals + fire planner from DB ──────────────────────────────────────
  const { data: goalsData, isLoading: goalsLoading } = useQuery({
    queryKey: ['goals', country],
    queryFn: () => fetchGoals(country),
    staleTime: 5 * 60_000,
  })

  const goals = goalsData?.goals ?? []
  const [firePlanner, setFirePlanner] = useState<FirePlannerData>(DEFAULT_FIRE)

  // Sync fire planner from DB (or keep defaults if none saved yet)
  useEffect(() => {
    if (goalsData?.firePlanner) setFirePlanner(goalsData.firePlanner)
  }, [goalsData?.firePlanner])

  // ── one-time migration from localStorage → DB ──────────────────────────────
  useEffect(() => {
    if (migratedRef.current) return
    if (localStorage.getItem(MIGRATED_KEY)) return
    if (goalsLoading) return // wait until we know DB state
    migratedRef.current = true

    const legacyKey = country === 'India' ? LEGACY_GOALS_KEY_INDIA : LEGACY_GOALS_KEY_UK
    try {
      const raw = localStorage.getItem(legacyKey)
      const parsed: Array<{ title: string; targetAmount: number }> = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed) && parsed.length > 0 && goals.length === 0) {
        importGoals(parsed, country).then(() => {
          qc.invalidateQueries({ queryKey: ['goals', country] })
        }).catch(() => {/* silently ignore */})
      }
    } catch { /* ignore */ }

    // Migrate fire planner
    try {
      const fireRaw = localStorage.getItem(LEGACY_FIRE_KEY)
      if (fireRaw) {
        const fp = JSON.parse(fireRaw) as Partial<FirePlannerData>
        if (fp.monthlyExpense || fp.fireMultiple) {
          const merged = { ...DEFAULT_FIRE, ...fp }
          saveFirePlanner(merged, country).catch(() => {/* ignore */})
        }
      }
    } catch { /* ignore */ }

    localStorage.setItem(MIGRATED_KEY, '1')
  }, [goalsLoading, goals.length, country, qc])

  // ── mutations ──────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: ({ title, targetAmount }: { title: string; targetAmount: number }) =>
      apiAddGoal(title, targetAmount, country),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals', country] }),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiRemoveGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals', country] }),
  })

  const toggleIndiaMutation = useMutation({
    mutationFn: ({ id, includeIndia }: { id: string; includeIndia: boolean }) =>
      apiUpdateGoal(id, { includeIndia }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals', country] }),
  })

  const fireMutation = useMutation({
    mutationFn: (fp: FirePlannerData) => saveFirePlanner(fp, country),
  })

  function updateFirePlanner(next: Partial<FirePlannerData>) {
    setFirePlanner((prev) => {
      const merged = { ...prev, ...next }
      fireMutation.mutate(merged)
      return merged
    })
  }

  const [draft, setDraft] = useState({ title: '', targetAmount: '' })

  function addGoal() {
    const targetAmount = Number(draft.targetAmount)
    if (!draft.title.trim() || !Number.isFinite(targetAmount) || targetAmount <= 0) return
    addMutation.mutate({ title: draft.title.trim(), targetAmount })
    setDraft({ title: '', targetAmount: '' })
  }

  // ── portfolio value ────────────────────────────────────────────────────────
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

  // India portfolio value converted to GBP (for goals that opt-in to include India)
  const indiaPortfolioValueGBP = useMemo(() => {
    if (!data) return 0
    let filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    filtered = filtered.filter((h) => h.currency === 'INR')
    const built = buildPortfolio(filtered, data.prices, data.fxRates, 'GBP')
    const indiaLiabilities = totalLiabilitiesBase(loadLiabilities().filter((l) => l.currency === 'INR'), 'GBP')
    return Math.max(0, built.totalValueBase - indiaLiabilities)
  }, [data, selectedOwner])

  const summary = useMemo(() => {
    const totalTarget = goals.reduce((a, g) => a + g.targetAmount, 0)
    const totalCurrent = goals.length === 0 ? 0 : currentPortfolioValue
    return { totalTarget, totalCurrent }
  }, [goals, currentPortfolioValue])

  // ── FIRE ───────────────────────────────────────────────────────────────────
  const is3d = visualStyle === 'premium3d'

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

  // ── styles ─────────────────────────────────────────────────────────────────
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

  if (portfolioLoading || goalsLoading) return <Loading />
  if (portfolioError) return <PageBody><EmptyState title="Couldn't load goals" body={(portfolioError as Error).message} /></PageBody>

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
            <input
              value={draft.title}
              onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && addGoal()}
              placeholder="Goal name"
              className={is3d ? 'rounded-lg border border-indigo-300/30 bg-indigo-900/45 px-3 py-2 text-sm text-cyan-100 placeholder:text-cyan-200/60' : 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800'}
            />
            <input
              value={draft.targetAmount}
              onChange={(e) => setDraft((v) => ({ ...v, targetAmount: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && addGoal()}
              placeholder="Target amount"
              type="number"
              className={is3d ? 'rounded-lg border border-indigo-300/30 bg-indigo-900/45 px-3 py-2 text-sm text-cyan-100 placeholder:text-cyan-200/60' : 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800'}
            />
            <div className={addInfoClass}>Current value auto-syncs from portfolio</div>
            <button
              type="button"
              onClick={addGoal}
              disabled={addMutation.isPending}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {addMutation.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </Card>

        {goals.length === 0 ? (
          <EmptyState title="No goals yet" body="Create your first goal to monitor progress from dashboard previews." />
        ) : (
          <Card tone="elevated" className="space-y-4">
            {goals.map((g) => {
              const effectiveValue = currentPortfolioValue + (g.includeIndia ? indiaPortfolioValueGBP : 0)
              const progress = g.targetAmount <= 0 ? 0 : Math.min((effectiveValue / g.targetAmount) * 100, 100)
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{g.title}</div>
                    <div className="flex items-center gap-3">
                      {/* Include India toggle — only shown on UK goals page */}
                      {country === 'UK' && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 select-none">
                          <input
                            type="checkbox"
                            checked={g.includeIndia}
                            onChange={(e) => toggleIndiaMutation.mutate({ id: g.id, includeIndia: e.target.checked })}
                            className="h-3.5 w-3.5 rounded accent-indigo-500"
                          />
                          🇮🇳 India
                        </label>
                      )}
                      <div className="text-xs tabular-nums text-slate-500">{progress.toFixed(0)}%</div>
                      <button
                        type="button"
                        onClick={() => removeMutation.mutate(g.id)}
                        disabled={removeMutation.isPending}
                        className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
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
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>{formatMoney(effectiveValue, base)} / {formatMoney(g.targetAmount, base)}</span>
                    {g.includeIndia && indiaPortfolioValueGBP > 0 && (
                      <span className="rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-indigo-500">
                        +{formatMoney(indiaPortfolioValueGBP, 'GBP')} 🇮🇳
                      </span>
                    )}
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
