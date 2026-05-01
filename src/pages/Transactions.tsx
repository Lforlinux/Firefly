import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePortfolio, useSavePortfolio, useUi } from '@/context/AppContext'
import { formatMoney, formatDate } from '@/utils/format'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import type { Transaction } from '@/types'

type Side = Transaction['side']

const SIDE_TONES: Record<Side, string> = {
  buy: 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/20',
  sell: 'bg-rose-500/10 text-rose-500 ring-rose-500/20',
  dividend: 'bg-blue-500/10 text-blue-500 ring-blue-500/20',
  split: 'bg-purple-500/10 text-purple-500 ring-purple-500/20',
  fee: 'bg-amber-500/10 text-amber-500 ring-amber-500/20',
}

function newId(): string {
  return (
    crypto.randomUUID?.() ||
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  )
}

export function Transactions() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner } = useUi()
  const save = useSavePortfolio()
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<Omit<Transaction, 'id'>>({
    date: new Date().toISOString().slice(0, 10),
    ticker: '',
    side: 'buy',
    shares: 0,
    price: 0,
    currency: 'GBP',
    notes: '',
  })

  const sortedTxs = useMemo(() => {
    if (!data) return []
    return data.transactions.slice().sort((a, b) => b.date.localeCompare(a.date))
  }, [data])

  function add() {
    if (!data) return
    if (!draft.ticker || draft.shares <= 0 || draft.price < 0) return
    const next: Transaction[] = [...data.transactions, { ...draft, id: newId() }]
    save.mutate({ holdings: data.holdings, snapshots: data.snapshots, transactions: next, settings: data.settings })
    setShowForm(false)
    setDraft({ ...draft, ticker: '', shares: 0, price: 0, notes: '' })
  }

  function remove(id: string) {
    if (!data) return
    const next = data.transactions.filter((t) => t.id !== id)
    save.mutate({ holdings: data.holdings, snapshots: data.snapshots, transactions: next, settings: data.settings })
  }

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load transactions" body={(error as Error).message} /></PageBody>
  if (!data) return null

  // Owner filter doesn't apply to transactions yet (they're flat).
  void selectedOwner

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${data.transactions.length} entries`}
        right={
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" /> {showForm ? 'Close' : 'Add'}
          </button>
        }
      />
      <PageBody>
        {showForm && (
          <Card>
            <h3 className="text-sm font-semibold">New transaction</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
              <input placeholder="Ticker" value={draft.ticker} onChange={(e) => setDraft({ ...draft, ticker: e.target.value.toUpperCase() })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-mono dark:border-slate-700 dark:bg-slate-800" />
              <select value={draft.side} onChange={(e) => setDraft({ ...draft, side: e.target.value as Side })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Dividend</option>
                <option value="split">Split</option>
                <option value="fee">Fee</option>
              </select>
              <input type="number" step="any" placeholder="Shares" value={draft.shares || ''} onChange={(e) => setDraft({ ...draft, shares: Number(e.target.value) })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
              <input type="number" step="any" placeholder="Price" value={draft.price || ''} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
              <input placeholder="Currency" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
              <button type="button" onClick={add} disabled={save.isPending || !draft.ticker || draft.shares <= 0} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
            <input placeholder="Notes (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
          </Card>
        )}

        {sortedTxs.length === 0 ? (
          <EmptyState
            title="No transactions logged"
            body="Use the Add button to record buys, sells, dividends, splits and fees. Once recorded, FIFO cost basis and per-side reports become available."
          />
        ) : (
          <Card className="!p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Ticker</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedTxs.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">{formatDate(t.date)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold">{t.ticker}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ring-1 ring-inset ${SIDE_TONES[t.side]}`}>{t.side}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{t.shares}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(t.price, t.currency, 2)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-semibold">{formatMoney(t.shares * t.price, t.currency)}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{t.notes}</td>
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => remove(t.id)} className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500" aria-label="Delete transaction">
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
