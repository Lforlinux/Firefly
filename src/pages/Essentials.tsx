import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, PageBody, PageHeader } from '@/components/ui'
import { fetchEssentials } from '@/services/api'
import { formatMoney } from '@/utils/format'

const STORAGE_KEY = 'firefly.essentials'

interface EssentialState {
  emergencyFundReady: boolean
  insured: boolean
  debtUnderControl: boolean
  retirementPlan: boolean
  estatePlan: boolean
}

const DEFAULT_STATE: EssentialState = {
  emergencyFundReady: false,
  insured: false,
  debtUnderControl: false,
  retirementPlan: false,
  estatePlan: false,
}

function loadState(): EssentialState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<EssentialState>) }
  } catch {
    return DEFAULT_STATE
  }
}

export function Essentials() {
  const [state, setState] = useState<EssentialState>(() => loadState())

  const score = useMemo(() => {
    const values = Object.values(state)
    const completed = values.filter(Boolean).length
    return Math.round((completed / values.length) * 100)
  }, [state])

  function toggle(key: keyof EssentialState) {
    setState((current) => {
      const next = { ...current, [key]: !current[key] }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <>
      <PageHeader title="Essentials" subtitle="A lightweight health checklist for your financial foundation." />
      <PageBody>
        <EtfVariation />

        <Card tone="elevated" className="ff-essentials-score-card">
          <div className="text-xs uppercase tracking-wider text-slate-500">Health score</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{score}</div>
          <p className="mt-1 text-sm text-slate-500">Keep this above 80 for a resilient financial base.</p>
        </Card>

        <Card tone="elevated" className="space-y-2 ff-essentials-list-card">
          <ChecklistRow
            label="Emergency fund covers at least 6 months"
            checked={state.emergencyFundReady}
            onToggle={() => toggle('emergencyFundReady')}
          />
          <ChecklistRow
            label="Core insurance is in place"
            checked={state.insured}
            onToggle={() => toggle('insured')}
          />
          <ChecklistRow
            label="Debt burden is manageable"
            checked={state.debtUnderControl}
            onToggle={() => toggle('debtUnderControl')}
          />
          <ChecklistRow
            label="Retirement strategy is active"
            checked={state.retirementPlan}
            onToggle={() => toggle('retirementPlan')}
          />
          <ChecklistRow
            label="Estate and will planning is documented"
            checked={state.estatePlan}
            onToggle={() => toggle('estatePlan')}
          />
        </Card>
      </PageBody>
    </>
  )
}

const MONTH_COLS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function PctCell({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-slate-400">—</span>
  const pos = pct >= 0
  return (
    <span className={pos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
      {pos ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function EtfVariation() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['essentials-etfs'],
    queryFn: fetchEssentials,
    staleTime: 10 * 60_000,
  })

  return (
    <Card tone="elevated" className="ff-essentials-etf-card">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">UK ETFs — price variation</h3>
        {data?.asOf && (
          <span className="text-xs text-slate-400">as of {new Date(data.asOf).toLocaleDateString('en-GB')}</span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Change from N months ago to now, across your GBP ETF holdings (KLN + Priya).
      </p>

      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading prices…</p>}
      {error && <p className="mt-4 text-sm text-rose-500">{(error as Error).message}</p>}

      {data && data.etfs.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="pb-2 pr-3 font-medium">ETF</th>
                <th className="pb-2 px-2 text-right font-medium">Current</th>
                {MONTH_COLS.map((m) => (
                  <th key={m} className="pb-2 px-2 text-right font-medium">{m}M</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.etfs.map((e) => (
                <tr key={e.ticker} className="border-t border-slate-200/70 dark:border-slate-700/70">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{e.name}</span>
                    <span className="ml-1.5 text-xs text-slate-400">{e.ticker}</span>
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {e.error || e.current == null ? '—' : formatMoney(e.current, 'GBP', 2)}
                  </td>
                  {MONTH_COLS.map((m) => {
                    const ch = e.changes?.find((c) => c.months === m)
                    return (
                      <td key={m} className="py-1.5 px-2 text-right whitespace-nowrap">
                        <PctCell pct={ch?.pct} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.etfs.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No UK ETF holdings found.</p>
      )}
    </Card>
  )
}

function ChecklistRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="ff-essentials-row flex cursor-pointer items-center justify-between rounded-xl border border-slate-200/90 bg-white/70 px-3 py-2 text-sm transition hover:border-slate-300 dark:border-slate-700/90 dark:bg-slate-900/60 dark:hover:border-slate-600">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 accent-slate-900 dark:accent-slate-100" />
    </label>
  )
}
