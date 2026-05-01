import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio } from '@/utils/calculations'
import { formatMoney, formatPercent, formatShares } from '@/utils/format'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import type { HoldingRow } from '@/types'

type SortKey = 'ticker' | 'name' | 'type' | 'sector' | 'shares' | 'avgCost' | 'livePrice' | 'valueBase' | 'gainLoss' | 'gainLossPct' | 'weight'
type SortDir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'ticker', label: 'Ticker', align: 'left' },
  { key: 'name', label: 'Name', align: 'left' },
  { key: 'type', label: 'Type', align: 'left' },
  { key: 'shares', label: 'Shares', align: 'right' },
  { key: 'avgCost', label: 'Avg Cost', align: 'right' },
  { key: 'livePrice', label: 'Current', align: 'right' },
  { key: 'valueBase', label: 'Value', align: 'right' },
  { key: 'gainLoss', label: 'G/L', align: 'right' },
  { key: 'gainLossPct', label: 'G/L %', align: 'right' },
  { key: 'weight', label: 'Weight', align: 'right' },
]

function compare(a: HoldingRow, b: HoldingRow, key: SortKey, dir: SortDir): number {
  const av = a[key], bv = b[key]
  let cmp: number
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
  else cmp = String(av ?? '').localeCompare(String(bv ?? ''))
  return dir === 'asc' ? cmp : -cmp
}

export function Holdings() {
  const { selectedOwner } = useUi()
  const { data, isLoading, error } = usePortfolio()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('valueBase')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showCash, setShowCash] = useState(true)

  const view = useMemo(() => {
    const holdings = data?.holdings
    const settings = data?.settings

    if (!holdings || !settings) return null

    const ownerFiltered = selectedOwner === 'all'
      ? holdings
      : holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))

    const built = buildPortfolio(ownerFiltered, data?.prices || {}, data?.fxRates || {}, settings.baseCurrency || 'GBP')

    const q = query.trim().toLowerCase()
    let rows = built.rows
    if (!showCash) rows = rows.filter((r) => r.type !== 'cash')
    if (q) rows = rows.filter((r) =>
      r.ticker.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.sector.toLowerCase().includes(q),
    )
    rows = rows.slice().sort((a, b) => compare(a, b, sortKey, sortDir))
    return { rows, base: settings.baseCurrency || 'GBP', built, holdings }
  }, [data, selectedOwner, query, sortKey, sortDir, showCash])

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'ticker' || k === 'name' || k === 'type' || k === 'sector' ? 'asc' : 'desc') }
  }

  if (isLoading) return <Loading label="Loading holdings…" />
  if (error) return <PageBody><EmptyState title="Couldn't load holdings" body={(error as Error).message} /></PageBody>
  if (!view) return null

  return (
    <>
      <PageHeader
        title="Holdings"
        subtitle={`${view.rows.length} of ${view.holdings.length} positions`}
        right={
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={showCash} onChange={(e) => setShowCash(e.target.checked)} className="accent-emerald-500" />
            Show cash
          </label>
        }
      />
      <PageBody>
        <Card className="!p-0">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ticker, name, or sector…"
              className="w-full bg-transparent text-sm placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          {view.rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">No matching holdings</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={`whitespace-nowrap px-4 py-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                        <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
                          {c.label}
                          {sortKey === c.key && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {view.rows.map((r) => {
                    const tone = r.gainLoss > 0 ? 'text-emerald-500' : r.gainLoss < 0 ? 'text-rose-500' : 'text-slate-500'
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100">{r.ticker}</td>
                        <td className="px-4 py-2.5">
                          <div className="max-w-xs truncate text-slate-900 dark:text-slate-100" title={r.name}>{r.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{r.sector}{r.owner ? ` · ${r.owner}` : ''}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">{r.type}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatShares(r.shares)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                          {r.avgCost > 0 ? formatMoney(r.avgCost, r.currency, 2) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                          {r.livePrice != null
                            ? formatMoney(r.livePrice, r.livePriceCcy || r.currency, 2)
                            : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(r.valueBase, view.base)}
                          {r.valueIsCost && <span className="ml-1 text-[10px] text-slate-400">cost</span>}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${tone}`}>
                          {r.valueIsCost ? <span className="text-slate-400">—</span> : formatMoney(r.gainLoss, view.base)}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${tone}`}>
                          {r.valueIsCost ? <span className="text-slate-400">—</span> : formatPercent(r.gainLossPct)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">
                          {(r.weight * 100).toFixed(1)}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </PageBody>
    </>
  )
}
