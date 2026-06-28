/**
 * FIRE projection — year-by-year compound-growth forecast of the combined
 * (UK + India) portfolio toward Lean / Standard / Fat FIRE milestones.
 *
 * Pure client-side math: "Saved so far" is the live combined net worth passed
 * in by the Analytics page, so the whole table re-computes automatically every
 * time the portfolio value changes — no API call, no extra Vercel function.
 *
 * Assumptions are SEEDED from the /goals FIRE planner (single source of truth,
 * so the accumulation target matches the Goals page) but stay editable here for
 * what-if scenarios. An edited field is persisted to localStorage as an override
 * and from then on wins over the planner value until cleared.
 *   - Monthly savings  ← planner.monthlyContribution
 *   - Growth rate (%)  ← planner.annualReturnPct
 *   - Monthly cost     ← planner.monthlyExpense → annual expense → FIRE multiples
 *                        (Accumulation 5× / Lean 25× / Standard 33.3× / Fat 50×)
 *   - Yearly increment is local-only (the planner has no equivalent field)
 */
import { useEffect, useMemo, useState } from 'react'
import { Flame } from 'lucide-react'
import { Card } from '@/components/ui'
import { formatMoney, formatMoneyCompact } from '@/utils/format'
import type { FirePlannerData } from '@/services/api'

// v2 keys: the original v1 keys hold stale neutral defaults that the first
// deploy persisted, which would defeat planner-seeding. v2 starts empty so an
// absent key means "not overridden → use the planner value".
const LS = {
  monthly: 'firefly.fire.v2.monthly',
  growth: 'firefly.fire.v2.growth',
  cost: 'firefly.fire.v2.cost',
  increment: 'firefly.fire.v2.increment',
}

// Fallbacks used only when the planner hasn't loaded / isn't set yet.
const DEF = { monthly: 1000, growth: 7, cost: 2000, increment: 5 }

const PROJECTION_YEARS = 30

type Row = {
  year: number
  annualSavings: number
  beginning: number
  growth: number
  end: number
  perMonthGain: number
  status: string
  /** 0..1 fraction of Fat FIRE, for the progress bar */
  fraction: number
  tier: 'accumulation' | 'lean' | 'standard' | 'fat'
  /** crossing badge for the left column, e.g. "Lean FIRE", "£2M" */
  badge: string | null
}

function readOverride(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function FireProjection({
  savedSoFar,
  firePlanner,
  gbpToInr,
  is3d,
}: {
  savedSoFar: number
  firePlanner: FirePlannerData | null
  gbpToInr: number | null
  is3d: boolean
}) {
  // null override = "follow the planner"; a string = user has edited this field
  const [monthlyOv, setMonthlyOv] = useState<string | null>(() => readOverride(LS.monthly))
  const [growthOv, setGrowthOv] = useState<string | null>(() => readOverride(LS.growth))
  const [costOv, setCostOv] = useState<string | null>(() => readOverride(LS.cost))
  const [incInput, setIncInput] = useState<string>(() => readOverride(LS.increment) ?? String(DEF.increment))

  // Planner-seeded display values (override wins; else planner; else fallback)
  const monthlyInput = monthlyOv ?? String(firePlanner?.monthlyContribution ?? DEF.monthly)
  const growthInput = growthOv ?? String(firePlanner?.annualReturnPct ?? DEF.growth)
  const costInput = costOv ?? String(firePlanner?.monthlyExpense ?? DEF.cost)

  const monthly = Math.max(0, Number(monthlyInput) || 0)
  const growthPct = Math.max(0, Number(growthInput) || 0)
  const monthlyCost = Math.max(0, Number(costInput) || 0)
  const incrementPct = Math.max(0, Number(incInput) || 0)

  const setOverride = (
    setter: (v: string) => void,
    key: string,
  ) => (v: string) => {
    setter(v)
    try { localStorage.setItem(key, v) } catch { /* ignore */ }
  }
  const onMonthly = setOverride(setMonthlyOv, LS.monthly)
  const onGrowth = setOverride(setGrowthOv, LS.growth)
  const onCost = setOverride(setCostOv, LS.cost)
  useEffect(() => { try { localStorage.setItem(LS.increment, incInput) } catch { /* ignore */ } }, [incInput])

  const model = useMemo(() => {
    const annualExpense = monthlyCost * 12
    const milestones = {
      accumulation: annualExpense * 5,
      lean: annualExpense * 25,
      standard: annualExpense * (100 / 3), // ≈ 33.3× — Lean × 4/3
      fat: annualExpense * 50,
    }

    const tierOf = (v: number): Row['tier'] =>
      v >= milestones.fat ? 'fat'
      : v >= milestones.standard ? 'standard'
      : v >= milestones.lean ? 'lean'
      : 'accumulation'

    // Phase rule: always report Accumulation Phase % until it hits 100%, only
    // THEN report Lean FIRE % (measured across the Accumulation→Lean band), then
    // multiples of each higher tier. Matches the /goals Accumulation card.
    const statusOf = (v: number): string => {
      if (milestones.fat <= 0) return '—'
      if (v < milestones.accumulation)
        return `${((v / milestones.accumulation) * 100).toFixed(0)}% of Accumulation Phase`
      if (v < milestones.lean)
        return `${(((v - milestones.accumulation) / (milestones.lean - milestones.accumulation)) * 100).toFixed(0)}% of Lean FIRE`
      if (v < milestones.standard) return `${(v / milestones.lean).toFixed(1)}× Lean FIRE`
      if (v < milestones.fat) return `${(v / milestones.standard).toFixed(1)}× Standard FIRE`
      return `${(v / milestones.fat).toFixed(1)}× Fat FIRE`
    }

    const startYear = new Date().getFullYear()
    const rows: Row[] = []

    let prevEnd = savedSoFar
    let prevTier: Row['tier'] = tierOf(savedSoFar)
    let prevMillions = Math.floor(savedSoFar / 1_000_000)

    // Base year — current portfolio value, no growth yet
    rows.push({
      year: startYear,
      annualSavings: 0,
      beginning: savedSoFar,
      growth: 0,
      end: savedSoFar,
      perMonthGain: 0,
      status: statusOf(savedSoFar),
      fraction: milestones.fat > 0 ? Math.min(1, savedSoFar / milestones.fat) : 0,
      tier: prevTier,
      badge: null,
    })

    for (let i = 1; i <= PROJECTION_YEARS; i++) {
      const annualSavings = monthly * 12 * Math.pow(1 + incrementPct / 100, i - 1)
      const beginning = prevEnd + annualSavings
      const growth = beginning * (growthPct / 100)
      const end = beginning + growth
      const tier = tierOf(end)

      // Left-column crossing badge: FIRE tier first, else new £-million crossed
      let badge: string | null = null
      if (tier !== prevTier) {
        badge = tier === 'lean' ? 'Lean FIRE 🔥'
          : tier === 'standard' ? 'Standard FIRE'
          : tier === 'fat' ? 'Fat FIRE 🎉'
          : null
      }
      const millions = Math.floor(end / 1_000_000)
      if (!badge && millions > prevMillions && millions >= 1) {
        badge = `£${millions}M`
      }

      rows.push({
        year: startYear + i,
        annualSavings,
        beginning,
        growth,
        end,
        perMonthGain: growth / 12,
        status: statusOf(end),
        fraction: milestones.fat > 0 ? Math.min(1, end / milestones.fat) : 0,
        tier,
        badge,
      })

      prevEnd = end
      prevTier = tier
      prevMillions = Math.max(prevMillions, millions)
    }

    const firstYearAtLeast = (target: number) =>
      rows.find((r) => r.end >= target)?.year ?? null

    return {
      annualExpense,
      milestones,
      rows,
      stageYears: {
        accumulation: firstYearAtLeast(milestones.accumulation),
        lean: firstYearAtLeast(milestones.lean),
        standard: firstYearAtLeast(milestones.standard),
        fat: firstYearAtLeast(milestones.fat),
      },
    }
  }, [savedSoFar, monthly, growthPct, monthlyCost, incrementPct])

  const inr = (gbp: number) => (gbpToInr != null ? formatMoneyCompact(gbp * gbpToInr, 'INR') : null)

  const inputCls = is3d
    ? 'w-24 rounded border border-white/15 bg-white/10 px-2 py-1 text-right text-sm text-cyan-50 focus:border-cyan-300/50 focus:outline-none'
    : 'w-24 rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm text-slate-800 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  const labelCls = is3d ? 'text-cyan-200/80' : 'text-slate-500'

  const stages: Array<{ key: keyof typeof model.stageYears; label: string; target: number; accent: string }> = [
    { key: 'accumulation', label: 'Accumulation (5×)', target: model.milestones.accumulation, accent: 'text-slate-500' },
    { key: 'lean', label: 'Lean FIRE (25×)', target: model.milestones.lean, accent: 'text-rose-500' },
    { key: 'standard', label: 'Standard FIRE (33×)', target: model.milestones.standard, accent: 'text-amber-500' },
    { key: 'fat', label: 'Fat FIRE (50×)', target: model.milestones.fat, accent: 'text-emerald-500' },
  ]

  return (
    <Card tone="elevated" className={is3d ? 'border-indigo-400/30 bg-gradient-to-br from-indigo-900/55 to-slate-900/45' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-100'}`}>
            <Flame className="h-4 w-4 text-orange-500" />
            FIRE projection — 🇬🇧 UK + 🇮🇳 India combined
          </h3>
          <p className={`mt-0.5 text-xs ${is3d ? 'text-cyan-200/75' : 'text-slate-500'}`}>
            Live forecast from your current combined value · updates whenever the portfolio changes
          </p>
        </div>
        <div className="text-right">
          <div className={`text-[11px] uppercase tracking-wider ${labelCls}`}>Saved so far</div>
          <div className={`text-lg font-semibold tabular-nums ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-50'}`}>
            {formatMoney(savedSoFar, 'GBP')}
          </div>
        </div>
      </div>

      {/* Editable assumptions — seeded from the /goals FIRE planner */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className={`text-[11px] ${labelCls}`}>Monthly savings (£)</span>
          <input type="number" min="0" step="50" value={monthlyInput} onChange={(e) => onMonthly(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`text-[11px] ${labelCls}`}>Growth rate (%/yr)</span>
          <input type="number" min="0" step="0.5" value={growthInput} onChange={(e) => onGrowth(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`text-[11px] ${labelCls}`}>Monthly cost (£)</span>
          <input type="number" min="0" step="50" value={costInput} onChange={(e) => onCost(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`text-[11px] ${labelCls}`}>Yearly increment (%)</span>
          <input type="number" min="0" step="1" value={incInput} onChange={(e) => setIncInput(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className={`mt-1.5 text-[11px] ${is3d ? 'text-indigo-200/60' : 'text-slate-400'}`}>
        Savings, growth &amp; monthly cost seeded from your <a href="/goals" className="underline underline-offset-2">FIRE planner</a> · edit here to model what-ifs
      </div>

      {model.annualExpense <= 0 && (
        <div className={`mt-4 rounded-xl px-3 py-4 text-center text-sm ${is3d ? 'bg-white/5 text-cyan-200/80' : 'bg-slate-50 text-slate-500 dark:bg-slate-800/50'}`}>
          Enter a monthly cost above to compute FIRE targets.
        </div>
      )}

      {/* Milestone stage chips */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stages.map((s) => {
          const year = model.stageYears[s.key]
          const inrStr = inr(s.target)
          return (
            <div key={s.key} className={`rounded-xl p-3 ${is3d ? 'bg-white/5' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
              <div className={`text-[11px] font-medium uppercase tracking-wider ${s.accent}`}>{s.label}</div>
              <div className={`mt-1 text-lg font-semibold tabular-nums ${is3d ? 'text-cyan-100' : 'text-slate-900 dark:text-slate-50'}`}>
                {year ?? '—'}
              </div>
              <div className={`text-[11px] tabular-nums ${labelCls}`}>
                {formatMoneyCompact(s.target, 'GBP')}{inrStr ? ` · ${inrStr}` : ''}
              </div>
            </div>
          )
        })}
      </div>
      <div className={`mt-2 text-[11px] ${is3d ? 'text-indigo-200/60' : 'text-slate-400'}`}>
        Annual expense {formatMoney(model.annualExpense, 'GBP')} (monthly cost × 12) · FIRE targets are multiples of it
      </div>

      {/* Year-by-year table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">Year</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Annual savings</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Growth</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Year-end total</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">/mo gain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {model.rows.map((r) => {
              const barColor = r.tier === 'fat' || r.tier === 'standard'
                ? 'bg-emerald-500'
                : r.tier === 'lean' ? 'bg-amber-500' : 'bg-rose-400'
              return (
                <tr key={r.year} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                    {r.year}
                    {r.badge && (
                      <span className="ml-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        {r.badge}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.annualSavings > 0 ? formatMoney(r.annualSavings, 'GBP') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {r.growth > 0 ? formatMoney(r.growth, 'GBP') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(r.end, 'GBP')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className={`h-full ${barColor}`} style={{ width: `${Math.max(2, r.fraction * 100)}%` }} />
                      </div>
                      <span className="whitespace-nowrap text-xs text-slate-500">{r.status}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {r.perMonthGain > 0 ? formatMoney(r.perMonthGain, 'GBP') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className={`mt-2 text-[11px] ${is3d ? 'text-indigo-200/50' : 'text-slate-400'}`}>
        Projection only · assumes steady contributions and {growthPct}% annual growth · not investment advice
      </div>
    </Card>
  )
}
