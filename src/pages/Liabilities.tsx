import { useMemo, useState } from 'react'
import { HandCoins, Trash2 } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { LiabilityItem, loadLiabilities, saveLiabilities } from '@/utils/liabilities'
import type { CurrencyCode } from '@/types'

export function Liabilities() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedCountry } = useUi()
  const [items, setItems] = useState<LiabilityItem[]>(() => loadLiabilities())
  const [draft, setDraft] = useState({
    name: '',
    category: 'custom' as LiabilityItem['category'],
    lender: '',
    outstandingBalance: '',
    currency: selectedCountry === 'India' ? 'INR' : 'GBP',
    notes: '',
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
    return { base, total, count: visibleItems.length, visibleItems }
  }, [data, items, selectedCountry])

  function persist(next: LiabilityItem[]) {
    setItems(next)
    saveLiabilities(next)
  }

  function addItem() {
    const outstanding = Number(draft.outstandingBalance)
    if (!draft.name.trim() || !Number.isFinite(outstanding) || outstanding <= 0) return
    const next: LiabilityItem[] = [
      ...items,
      {
        id: crypto.randomUUID?.() || `${Date.now()}`,
        name: draft.name.trim(),
        category: draft.category,
        lender: draft.lender.trim(),
        outstandingBalance: outstanding,
        currency: draft.currency.toUpperCase() || 'GBP',
        notes: draft.notes.trim(),
      },
    ]
    persist(next)
    setDraft({
      name: '',
      category: 'custom',
      lender: '',
      outstandingBalance: '',
      currency: 'GBP',
      notes: '',
    })
  }

  function removeItem(id: string) {
    persist(items.filter((i) => i.id !== id))
  }

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load liabilities" body={(error as Error).message} /></PageBody>
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
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Liability name" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <input value={draft.lender} onChange={(e) => setDraft((d) => ({ ...d, lender: e.target.value }))} placeholder="Lender (optional)" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as LiabilityItem['category'] }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <option value="mortgage">Mortgage</option>
              <option value="credit-card">Credit card</option>
              <option value="student-loan">Student loan</option>
              <option value="personal-loan">Personal loan</option>
              <option value="car-loan">Car loan</option>
              <option value="custom">Custom</option>
            </select>
            <input value={draft.outstandingBalance} onChange={(e) => setDraft((d) => ({ ...d, outstandingBalance: e.target.value }))} type="number" placeholder="Outstanding balance" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <input value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} placeholder="Currency" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <button type="button" onClick={addItem} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
              <HandCoins className="h-4 w-4" />
              Add liability
            </button>
          </div>
          <input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Notes (optional)" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
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
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {view.visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-slate-500">{item.lender || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 capitalize">{item.category.replace('-', ' ')}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(item.outstandingBalance, item.currency as CurrencyCode)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => removeItem(item.id)} className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500" aria-label="Delete liability">
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
