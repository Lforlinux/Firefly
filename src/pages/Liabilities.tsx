import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HandCoins, Trash2 } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { loadLiabilities } from '@/utils/liabilities'
import { fetchGoals, addLiability, removeLiability } from '@/services/api'
import type { LiabilityItem } from '@/services/api'
import type { CurrencyCode } from '@/types'

const MIGRATED_KEY = 'firefly.liabilities.migrated'

type LiabilityCategory = 'mortgage' | 'credit-card' | 'student-loan' | 'personal-loan' | 'car-loan' | 'custom'

export function Liabilities() {
  const { data, isLoading: portfolioLoading, error: portfolioError } = usePortfolio()
  const { selectedCountry } = useUi()
  const qc = useQueryClient()
  const migratedRef = useRef(false)

  // Fetch liabilities from DB (liabilities come bundled in the goals endpoint)
  const { data: goalsData, isLoading: liabLoading } = useQuery({
    queryKey: ['goals', 'UK'],           // liabilities are global (not country-scoped)
    queryFn: () => fetchGoals('UK'),
    staleTime: 5 * 60_000,
  })

  const items: LiabilityItem[] = goalsData?.liabilities ?? []

  // One-time migration: localStorage → DB
  useMemo(() => {
    if (migratedRef.current) return
    if (localStorage.getItem(MIGRATED_KEY)) return
    if (liabLoading) return
    if (items.length > 0) {
      // DB already has data — just mark migrated
      localStorage.setItem(MIGRATED_KEY, '1')
      migratedRef.current = true
      return
    }
    migratedRef.current = true
    const legacy = loadLiabilities()
    if (legacy.length === 0) {
      localStorage.setItem(MIGRATED_KEY, '1')
      return
    }
    // Migrate each item
    Promise.all(
      legacy.map((l) =>
        addLiability({
          name: l.name,
          category: l.category,
          lender: l.lender,
          outstandingBalance: l.outstandingBalance,
          currency: l.currency,
          notes: l.notes,
        })
      )
    )
      .then(() => {
        qc.invalidateQueries({ queryKey: ['goals'] })
        localStorage.setItem(MIGRATED_KEY, '1')
      })
      .catch(() => {/* silently ignore */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liabLoading, items.length])

  const [draft, setDraft] = useState({
    name: '',
    category: 'custom' as LiabilityCategory,
    lender: '',
    outstandingBalance: '',
    currency: selectedCountry === 'India' ? 'INR' : 'GBP',
    notes: '',
  })

  const addMutation = useMutation({
    mutationFn: (item: Omit<LiabilityItem, 'id'>) => addLiability(item),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeLiability(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  const view = useMemo(() => {
    if (!data) return null
    const base = selectedCountry === 'India' ? 'INR' : (data.settings.baseCurrency || 'GBP')
    const visibleItems = selectedCountry === 'India'
      ? items.filter((i) => i.currency.toUpperCase() === 'INR')
      : selectedCountry === 'UK'
        ? items.filter((i) => i.currency.toUpperCase() !== 'INR')
        : items
    const total = visibleItems
      .filter((i) => i.currency.toUpperCase() === base.toUpperCase())
      .reduce((a, i) => a + i.outstandingBalance, 0)
    return { base, total, visibleItems }
  }, [data, items, selectedCountry])

  function submitAdd() {
    const outstanding = Number(draft.outstandingBalance)
    if (!draft.name.trim() || !Number.isFinite(outstanding) || outstanding <= 0) return
    addMutation.mutate({
      name: draft.name.trim(),
      category: draft.category,
      lender: draft.lender.trim(),
      outstandingBalance: outstanding,
      currency: draft.currency.toUpperCase() || 'GBP',
      notes: draft.notes.trim(),
    })
    setDraft({ name: '', category: 'custom', lender: '', outstandingBalance: '', currency: 'GBP', notes: '' })
  }

  if (portfolioLoading || liabLoading) return <Loading />
  if (portfolioError) return <PageBody><EmptyState title="Couldn't load liabilities" body={(portfolioError as Error).message} /></PageBody>
  if (!view) return null

  return (
    <>
      <PageHeader title="Liabilities" subtitle="Track debt and obligations in one place." />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Total liabilities</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(view.total, view.base)}</div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Active items</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{view.visibleItems.length}</div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Debt health</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{view.total > 0 ? 'Watch' : 'Clear'}</div>
          </Card>
        </div>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">Add liability</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
              placeholder="Liability name"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              value={draft.lender}
              onChange={(e) => setDraft((d) => ({ ...d, lender: e.target.value }))}
              placeholder="Lender (optional)"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as LiabilityCategory }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="mortgage">Mortgage</option>
              <option value="credit-card">Credit card</option>
              <option value="student-loan">Student loan</option>
              <option value="personal-loan">Personal loan</option>
              <option value="car-loan">Car loan</option>
              <option value="custom">Custom</option>
            </select>
            <input
              value={draft.outstandingBalance}
              onChange={(e) => setDraft((d) => ({ ...d, outstandingBalance: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
              type="number"
              placeholder="Outstanding balance"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              value={draft.currency}
              onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))}
              placeholder="Currency (GBP / INR)"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={submitAdd}
              disabled={addMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              <HandCoins className="h-4 w-4" />
              {addMutation.isPending ? 'Adding…' : 'Add liability'}
            </button>
          </div>
          <input
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder="Notes (optional)"
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </Card>

        {view.visibleItems.length === 0 ? (
          <EmptyState title="No liabilities added yet" body="Add mortgages, loans, and cards to get a complete net worth view." />
        ) : (
          <Card tone="elevated" className="!p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Lender</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {view.visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{item.name}</div>
                      {item.notes && (
                        <div className="text-xs text-slate-400 mt-0.5 max-w-xs truncate">{item.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 capitalize text-slate-600 dark:text-slate-400">
                      {item.category.replace('-', ' ')}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell text-slate-500">
                      {item.lender || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatMoney(item.outstandingBalance, item.currency as CurrencyCode)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeMutation.mutate(item.id)}
                        disabled={removeMutation.isPending}
                        className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </PageBody>
    </>
  )
}
