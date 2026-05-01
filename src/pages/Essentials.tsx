import { useMemo, useState } from 'react'
import { Card, PageBody, PageHeader } from '@/components/ui'

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

function ChecklistRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="ff-essentials-row flex cursor-pointer items-center justify-between rounded-xl border border-slate-200/90 bg-white/70 px-3 py-2 text-sm transition hover:border-slate-300 dark:border-slate-700/90 dark:bg-slate-900/60 dark:hover:border-slate-600">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 accent-slate-900 dark:accent-slate-100" />
    </label>
  )
}
