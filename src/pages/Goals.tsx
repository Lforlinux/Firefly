import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronDown, Trash2 } from 'lucide-react'
import { usePortfolio } from '@/context/AppContext'
import { useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { buildPortfolio } from '@/utils/calculations'
import { totalLiabilitiesBase } from '@/utils/liabilities'
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

// ── Actual Budget client-side fetch ────────────────────────────────────────────
const AB_SERVER  = 'http://192.168.1.131:5006'
const AB_SYNC_ID = '3f6d3aaf-b550-42f8-bf27-43fa21632e6d'
const AB_INVEST_CATS = ['AJBELL', 'Plum', 'trading212', 'vanguard', 'Investengine']

async function fetchABInvestments(): Promise<{ monthlyAvg: number; breakdown: Record<string, number> } | null> {
  try {
    const authRes = await fetch(`${AB_SERVER}/api/account-validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      signal: AbortSignal.timeout(4000),
    })
    const token: string | null = authRes.ok ? ((await authRes.json())?.data?.token ?? null) : null
    const hdrs: Record<string, string> = { 'X-BUDGET-ID': AB_SYNC_ID }
    if (token) hdrs.Authorization = `Bearer ${token}`

    const since = new Date()
    since.setMonth(since.getMonth() - 6)
    const startDate = since.toISOString().slice(0, 10)

    const breakdown: Record<string, number> = {}
    let totalGBP = 0
    await Promise.all(AB_INVEST_CATS.map(async (cat) => {
      try {
        const r = await fetch(
          `${AB_SERVER}/api/transactions?category=${encodeURIComponent(cat)}&start=${startDate}`,
          { headers: hdrs, signal: AbortSignal.timeout(3000) },
        )
        if (!r.ok) return
        const j = await r.json()
        const txs: Array<{ amount: number }> = j?.data ?? []
        const sum = txs.reduce((s, t) => s + Math.abs(t.amount), 0) / 100
        if (sum > 0) { breakdown[cat] = sum; totalGBP += sum }
      } catch { /* CORS / unreachable */ }
    }))
    return totalGBP > 0 ? { monthlyAvg: totalGBP / 6, breakdown } : null
  } catch { return null }
}

// ── Accumulation Phase card ────────────────────────────────────────────────────
function AccumulationPhaseCard({
  currentNetWorth,
  liabilitiesTotal,
  indiaValueGBP,
  firePlanner,
  fire,
  abData,
  is3d,
  base,
}: {
  currentNetWorth: number
  liabilitiesTotal: number
  indiaValueGBP: number
  firePlanner: FirePlannerData
  fire: { target: number; progress: number; years: number }
  abData: { monthlyAvg: number; breakdown: Record<string, number> } | null | undefined
  is3d: boolean
  base: string
}) {
  const [open, setOpen] = useState(false)
  const [includeDebt, setIncludeDebt] = useState(true)
  const [includeIndia, setIncludeIndia] = useState(false)

  // Effective net worth for all calculations in this card
  const netWorth = (includeDebt ? currentNetWorth : currentNetWorth + liabilitiesTotal)
    + (includeIndia ? indiaValueGBP : 0)

  const monthlyInvest = abData?.monthlyAvg ?? firePlanner.monthlyContribution
  const isLive = abData != null

  const realYears = estimateYearsToTarget(netWorth, fire.target, monthlyInvest, firePlanner.annualReturnPct)
  const fireYear  = new Date().getFullYear() + realYears

  const pct   = fire.target > 0 ? Math.min((netWorth / fire.target) * 100, 100) : 0
  const phase = pct < 25 ? 'Early' : pct < 60 ? 'Mid' : 'Late'
  const phaseDesc = phase === 'Early'
    ? "You're in the most powerful stage — every pound invested now has the longest runway to compound. Consistency here beats everything else. Time in market > timing the market."
    : phase === 'Mid'
      ? "Momentum is building. Your portfolio is large enough that market returns are starting to do meaningful heavy lifting alongside your contributions. Stay the course."
      : "Final stretch. Compound growth is now outpacing what you add each month. Your wealth machine is nearly self-sufficient."

  const phaseBadge = phase === 'Early'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : phase === 'Mid'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'

  const ann = firePlanner.annualReturnPct
  const passive = (v: number) => (v * ann) / 100 / 12

  function yearsTo(target: number) {
    return estimateYearsToTarget(netWorth, target, monthlyInvest, ann)
  }

  const cloneBase = Math.max(1, netWorth)
  const CLONE_MULTIPLES = [2, 5, 10]
  const clones = CLONE_MULTIPLES.map((n) => ({
    label: `${n}× clones`,
    value: cloneBase * n,
    years: yearsTo(cloneBase * n),
    passive: passive(cloneBase * n),
    isFire: false,
  }))

  // Insert FIRE milestone; dedupe if it overlaps a clone year
  const fireMilestone = {
    label: 'FIRE ✨',
    value: fire.target,
    years: realYears,
    passive: passive(fire.target),
    isFire: true,
  }
  const allMilestones = [...clones, fireMilestone]
    .filter((m) => m.value > cloneBase || m.isFire) // skip if already past
    .sort((a, b) => a.years - b.years)

  const lbl  = is3d ? 'text-indigo-200/70' : 'text-slate-500 dark:text-slate-400'
  const val  = is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-50'
  const stat = is3d ? 'rounded-xl bg-white/5 p-3' : 'rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50'

  return (
    <Card tone="elevated" className={is3d ? 'border-indigo-400/30 bg-gradient-to-br from-indigo-900/55 to-slate-900/45' : ''}>

      {/* ── Clickable header (always visible) ── */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-lg">🌱</span>
          <h3 className={`text-sm font-semibold ${is3d ? 'text-cyan-100' : ''}`}>Accumulation Phase</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${phaseBadge}`}>
            {phase} · {pct.toFixed(0)}%
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* India toggle */}
          {indiaValueGBP > 0 && (
            <button
              type="button"
              onClick={() => setIncludeIndia((v) => !v)}
              className={[
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                includeIndia
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-700/50 dark:bg-indigo-950/40 dark:text-indigo-300'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900',
              ].join(' ')}
            >
              🇮🇳 {includeIndia ? 'India on' : 'India off'}
            </button>
          )}
          {/* Debt toggle */}
          <button
            type="button"
            onClick={() => setIncludeDebt((d) => !d)}
            className={[
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              includeDebt
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/50 dark:bg-rose-950/40 dark:text-rose-300'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900',
            ].join(' ')}
          >
            <span className={['h-1.5 w-1.5 rounded-full', includeDebt ? 'bg-rose-500' : 'bg-slate-400'].join(' ')} />
            {includeDebt ? 'Debt on' : 'Debt off'}
          </button>
        </div>
      </div>

      {/* ── Expanded content ── */}
      {open && <>
      <p className={`mt-3 text-xs leading-relaxed ${is3d ? 'text-cyan-200/75' : 'text-slate-500'}`}>{phaseDesc}</p>

      {/* ── Stats grid ── */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {([
          { label: 'Net worth',    value: formatMoney(netWorth, base) },
          { label: 'FIRE target',  value: formatMoney(fire.target, base) },
          { label: 'Progress',     value: `${pct.toFixed(1)}%` },
          {
            label: isLive ? 'Invested/mo 🟢' : 'Planned/mo',
            value: formatMoney(monthlyInvest, base),
            sub: isLive ? 'Live · Actual Budget' : 'From planner',
          },
          { label: 'Years to FIRE', value: realYears >= 80 ? '80+ yrs' : `${realYears} yr${realYears === 1 ? '' : 's'}` },
          { label: 'FIRE year',     value: fireYear >= 2106 ? '2106+' : String(fireYear) },
        ] as Array<{ label: string; value: string; sub?: string }>).map(({ label, value, sub }) => (
          <div key={label} className={stat}>
            <div className={`text-[11px] uppercase tracking-wider ${lbl}`}>{label}</div>
            <div className={`mt-0.5 text-sm font-semibold tabular-nums ${val}`}>{value}</div>
            {sub && <div className={`mt-0.5 text-[10px] ${lbl}`}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Progress bar ── */}
      <div className={is3d ? 'mt-4 h-2 rounded-full bg-indigo-950/70' : 'mt-4 h-2 rounded-full bg-slate-200 dark:bg-slate-800'}>
        <div
          className={is3d
            ? 'h-2 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-500 shadow-[0_0_10px_rgba(56,189,248,0.5)]'
            : 'h-2 rounded-full bg-emerald-500'}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      {/* ── AB breakdown chips ── */}
      {isLive && abData!.breakdown && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {Object.entries(abData!.breakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, total]) => (
              <span key={cat} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                is3d ? 'bg-indigo-700/40 text-cyan-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}>
                {cat} · {formatMoney(total / 6, base)}/mo
              </span>
            ))}
        </div>
      )}

      {/* ── Divider ── */}
      <div className={`my-5 border-t ${is3d ? 'border-indigo-400/20' : 'border-slate-200 dark:border-slate-700'}`} />

      {/* ── Clone section ── */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base">🧬</span>
          <h4 className={`text-sm font-semibold ${is3d ? 'text-cyan-100' : ''}`}>Portfolio Clones</h4>
        </div>
        <p className={`mt-1 text-xs leading-relaxed ${is3d ? 'text-cyan-200/75' : 'text-slate-500'}`}>
          One "clone" = your current portfolio ({formatMoney(cloneBase, base)}) working silently at {ann}% p.a.
          As wealth grows you accumulate more clones — each one generating more passive income than the last.
          At FIRE, your clone army covers living costs without you lifting a finger.
        </p>

        {/* 1 clone — today */}
        <div className={`mt-3 flex items-center justify-between rounded-xl border-2 p-3 ${
          is3d ? 'border-emerald-400/40 bg-emerald-900/20' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-900/10'
        }`}>
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌱</span>
            <div>
              <div className={`text-xs font-bold ${is3d ? 'text-emerald-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
                1 clone · NOW
              </div>
              <div className={`text-base font-bold tabular-nums ${val}`}>{formatMoney(cloneBase, base)}</div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-[11px] ${lbl}`}>Passive income today</div>
            <div className={`text-base font-semibold tabular-nums ${is3d ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {formatMoney(passive(cloneBase), base)}<span className="text-xs font-normal">/mo</span>
            </div>
          </div>
        </div>

        {/* Clone milestones */}
        <div className="mt-2 space-y-2">
          {allMilestones.map((m) => (
            <div
              key={m.label}
              className={`flex items-center justify-between rounded-xl p-3 ${
                m.isFire
                  ? is3d ? 'border border-fuchsia-400/30 bg-fuchsia-900/20' : 'border border-amber-200 bg-amber-50 dark:border-amber-700/30 dark:bg-amber-900/10'
                  : is3d ? 'bg-white/5' : 'bg-slate-50 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                  m.isFire
                    ? is3d ? 'bg-fuchsia-700/50 text-fuchsia-100' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : is3d ? 'bg-indigo-700/40 text-cyan-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                }`}>
                  {m.isFire ? '✨' : m.label.split('×')[0] + '×'}
                </div>
                <div>
                  <div className={`text-xs font-semibold ${
                    m.isFire
                      ? is3d ? 'text-fuchsia-200' : 'text-amber-700 dark:text-amber-400'
                      : is3d ? 'text-cyan-100' : 'text-slate-800 dark:text-slate-100'
                  }`}>{m.label}</div>
                  <div className={`text-[11px] tabular-nums ${lbl}`}>{formatMoney(m.value, base)}</div>
                </div>
              </div>
              <div className="flex items-center gap-5 text-right">
                <div>
                  <div className={`text-xs font-medium tabular-nums ${val}`}>
                    {m.years <= 0 ? 'Achieved!' : `~${m.years} yr${m.years === 1 ? '' : 's'}`}
                  </div>
                  <div className={`text-[10px] ${lbl}`}>
                    {m.years > 0 ? `~${new Date().getFullYear() + m.years}` : 'Today'}
                  </div>
                </div>
                <div>
                  <div className={`text-xs font-semibold tabular-nums ${
                    m.isFire
                      ? is3d ? 'text-fuchsia-300' : 'text-amber-600 dark:text-amber-400'
                      : is3d ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {formatMoney(m.passive, base)}<span className="text-[10px] font-normal">/mo</span>
                  </div>
                  <div className={`text-[10px] ${lbl}`}>passive</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Insight footer */}
        <div className={`mt-4 rounded-xl p-3 text-xs leading-relaxed ${
          is3d ? 'bg-indigo-950/50 text-indigo-200/70' : 'bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400'
        }`}>
          💡 Your portfolio silently generates{' '}
          <strong className={is3d ? 'text-cyan-200' : 'text-slate-700 dark:text-slate-300'}>
            {formatMoney(passive(cloneBase), base)}/month
          </strong>{' '}
          today at {ann}% p.a. — even while you sleep.
          At FIRE that rises to{' '}
          <strong className={is3d ? 'text-cyan-200' : 'text-slate-700 dark:text-slate-300'}>
            {formatMoney(passive(fire.target), base)}/month
          </strong>
          {passive(fire.target) >= firePlanner.monthlyExpense
            ? `, covering your ${formatMoney(firePlanner.monthlyExpense, base)}/mo expenses with ${formatMoney(passive(fire.target) - firePlanner.monthlyExpense, base)}/mo to spare.`
            : `, partially offsetting your ${formatMoney(firePlanner.monthlyExpense, base)}/mo expenses.`}
          {isLive
            ? ' Monthly investment figure is live from your Actual Budget.'
            : ' Update monthly savings in the planner above for a more accurate projection.'}
        </div>
      </div>
      </>}
    </Card>
  )
}

export function Goals() {
  const { data, isLoading: portfolioLoading, error: portfolioError } = usePortfolio()
  const { selectedOwner, visualStyle, selectedCountry } = useUi()
  const qc = useQueryClient()
  const country = selectedCountry === 'India' ? 'India' : 'UK'
  const migratedRef = useRef(false)

  // ── Actual Budget live investment data ────────────────────────────────────
  const { data: abData } = useQuery({
    queryKey: ['ab-investments'],
    queryFn: fetchABInvestments,
    staleTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

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
    const allLiabilities = data.liabilities ?? []
    const relevantLiabilities = selectedCountry === 'India'
      ? allLiabilities.filter((l) => l.currency === 'INR')
      : selectedCountry === 'UK'
        ? allLiabilities.filter((l) => l.currency !== 'INR')
        : allLiabilities
    const liabilities = totalLiabilitiesBase(relevantLiabilities, base)
    return built.totalValueBase - liabilities
  }, [data, selectedOwner, selectedCountry, base])

  // Liabilities total for the current country — passed to AccumulationPhaseCard
  const ukLiabilitiesTotal = useMemo(() => {
    if (!data) return 0
    const all = data.liabilities ?? []
    const relevant = selectedCountry === 'India'
      ? all.filter((l) => l.currency === 'INR')
      : selectedCountry === 'UK'
        ? all.filter((l) => l.currency !== 'INR')
        : all
    return totalLiabilitiesBase(relevant, base)
  }, [data, selectedCountry, base])

  // India portfolio value converted to GBP (for goals that opt-in to include India)
  const indiaPortfolioValueGBP = useMemo(() => {
    if (!data) return 0
    let filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    filtered = filtered.filter((h) => h.currency === 'INR')
    const built = buildPortfolio(filtered, data.prices, data.fxRates, 'GBP')
    const indiaLiabilities = totalLiabilitiesBase((data.liabilities ?? []).filter((l) => l.currency === 'INR'), 'GBP')
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

        {/* Accumulation Phase card — UK view only */}
        {country === 'UK' && (
          <AccumulationPhaseCard
            currentNetWorth={currentPortfolioValue}
            liabilitiesTotal={ukLiabilitiesTotal}
            indiaValueGBP={indiaPortfolioValueGBP}
            firePlanner={firePlanner}
            fire={fire}
            abData={abData}
            is3d={is3d}
            base={base}
          />
        )}

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
