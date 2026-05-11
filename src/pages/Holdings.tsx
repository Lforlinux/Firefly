import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio } from '@/utils/calculations'
import { formatMoney, formatPercent, formatShares } from '@/utils/format'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { commitImport } from '@/services/importService'
import type { HoldingRow } from '@/types'
import type { ImportedTransaction } from '@/types/import'

const OWNERS = ['KLN', 'Priya'] as const
type OwnerName = typeof OWNERS[number]

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

function normalizeCashTicker(provider: string): string {
  const core = provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `CASH:${core || 'MANUAL'}`
}

export function Holdings() {
  const { selectedOwner, privacyMode, visualStyle, selectedCountry } = useUi()
  const { data, isLoading, error } = usePortfolio()
  const qc = useQueryClient()
  const manualImport = useMutation({
    mutationFn: async (tx: ImportedTransaction) => commitImport('manual', [tx]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portfolio'] }) },
  })
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'stock' | 'etf' | 'cash' | 'commodity' | 'crypto' | 'bond'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('valueBase')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showCash, setShowCash] = useState(true)
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualStatus, setManualStatus] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [manualDraft, setManualDraft] = useState({
    assetType: 'cash' as 'cash' | 'stock' | 'etf',
    date: new Date().toISOString().slice(0, 10),
    providerOrTicker: '',
    name: '',
    quantity: '',
    price: '',
    currency: 'GBP',
    owner: selectedOwner === 'KLN' || selectedOwner === 'Priya' ? selectedOwner : 'KLN',
    notes: '',
  })

  const view = useMemo(() => {
    const holdings = data?.holdings
    const settings = data?.settings

    if (!holdings || !settings) return null

    let ownerFiltered = selectedOwner === 'all'
      ? holdings
      : holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    if (selectedCountry === 'UK') ownerFiltered = ownerFiltered.filter((h) => h.currency !== 'INR')
    else if (selectedCountry === 'India') ownerFiltered = ownerFiltered.filter((h) => h.currency === 'INR')

    const base = selectedCountry === 'India' ? 'INR' : (settings.baseCurrency || 'GBP')
    const built = buildPortfolio(ownerFiltered, data?.prices || {}, data?.fxRates || {}, base)

    const q = query.trim().toLowerCase()
    let rows = built.rows
    if (!showCash) rows = rows.filter((r) => r.type !== 'cash')
    if (typeFilter !== 'all') rows = rows.filter((r) => r.type === typeFilter)
    if (q) rows = rows.filter((r) =>
      r.ticker.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.sector.toLowerCase().includes(q),
    )
    rows = rows.slice().sort((a, b) => compare(a, b, sortKey, sortDir))
    const categoryTotals = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + r.valueBase
      return acc
    }, {})
    return { rows, base, built, holdings, categoryTotals }
  }, [data, selectedOwner, selectedCountry, query, sortKey, sortDir, showCash, typeFilter])

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'ticker' || k === 'name' || k === 'type' || k === 'sector' ? 'asc' : 'desc') }
  }

  function addManualAsset() {
    setManualStatus(null)
    const assetType = manualDraft.assetType
    const currency = manualDraft.currency.trim().toUpperCase() || 'GBP'
    const date = manualDraft.date || new Date().toISOString().slice(0, 10)
    const owner = manualDraft.owner.trim()
    if (!OWNERS.includes(owner as OwnerName)) return
    const ownerNote = `Owner: ${owner}`
    const userNotes = manualDraft.notes.trim()
    const notes = [ownerNote, userNotes].filter(Boolean).join(' | ')

    if (assetType === 'cash') {
      const provider = manualDraft.providerOrTicker.trim()
      const amount = Number(manualDraft.price)
      if (!provider || !Number.isFinite(amount) || amount <= 0) return
      const ticker = normalizeCashTicker(provider)
      const tx: ImportedTransaction = {
        date,
        type: 'deposit',
        ticker,
        name: manualDraft.name.trim() || `${provider} Cash`,
        quantity: 1,
        price: amount,
        priceCurrency: currency,
        total: amount,
        totalCurrency: currency,
        source: 'manual',
        holdingType: 'cash',
        sourceId: ['deposit', date, ticker, '1.00000000', amount.toFixed(8), currency].join('|'),
        notes,
      }
      manualImport.mutate(tx, {
        onSuccess: (result) => {
          const skipped = Number(result?.skipped || 0)
          const imported = Number(result?.imported || 0)
          if (skipped > 0 && imported === 0) {
            setManualStatus({ kind: 'warn', text: 'Skipped as duplicate. Matching transaction already exists.' })
          } else {
            setManualStatus({ kind: 'ok', text: 'Manual cash entry saved.' })
          }
          setShowManualForm(false)
          setManualDraft({
            assetType: 'cash',
            date: new Date().toISOString().slice(0, 10),
            providerOrTicker: '',
            name: '',
            quantity: '',
            price: '',
            currency: 'GBP',
            owner: selectedOwner === 'KLN' || selectedOwner === 'Priya' ? selectedOwner : 'KLN',
            notes: '',
          })
        },
        onError: (e) => {
          setManualStatus({ kind: 'error', text: (e as Error).message || 'Failed to save manual entry.' })
        },
      })
      return
    }

    const ticker = manualDraft.providerOrTicker.trim().toUpperCase()
    const quantity = Number(manualDraft.quantity)
    const price = Number(manualDraft.price)
    if (!ticker || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) return
    const total = quantity * price
    const tx: ImportedTransaction = {
      date,
      type: 'buy',
      ticker,
      name: manualDraft.name.trim() || ticker,
      quantity,
      price,
      priceCurrency: currency,
      total,
      totalCurrency: currency,
      source: 'manual',
      holdingType: assetType,
      sourceId: ['buy', date, ticker, quantity.toFixed(8), price.toFixed(8), currency].join('|'),
      notes,
    }
    manualImport.mutate(tx, {
      onSuccess: (result) => {
        const skipped = Number(result?.skipped || 0)
        const imported = Number(result?.imported || 0)
        if (skipped > 0 && imported === 0) {
          setManualStatus({ kind: 'warn', text: 'Skipped as duplicate. Matching transaction already exists.' })
        } else {
          setManualStatus({ kind: 'ok', text: 'Manual stock/ETF entry saved.' })
        }
        setShowManualForm(false)
        setManualDraft({
          assetType: 'cash',
          date: new Date().toISOString().slice(0, 10),
          providerOrTicker: '',
          name: '',
          quantity: '',
          price: '',
          currency: 'GBP',
          owner: selectedOwner === 'KLN' || selectedOwner === 'Priya' ? selectedOwner : 'KLN',
          notes: '',
        })
      },
      onError: (e) => {
        setManualStatus({ kind: 'error', text: (e as Error).message || 'Failed to save manual entry.' })
      },
    })
  }

  if (isLoading) return <Loading label="Loading holdings…" />
  if (error) return <PageBody><EmptyState title="Couldn't load holdings" body={(error as Error).message} /></PageBody>
  if (!view) return null

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle={`${view.rows.length} of ${view.holdings.length} items`}
        right={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowManualForm((s) => !s)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {showManualForm ? 'Close manual form' : 'Add manual entry'}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={showCash} onChange={(e) => setShowCash(e.target.checked)} className="accent-emerald-500" />
              Show cash
            </label>
          </div>
        }
      />
      <PageBody>
        {manualStatus && (
          <Card tone="soft" className={`border ${
            manualStatus.kind === 'ok'
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
              : manualStatus.kind === 'warn'
                ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
                : 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40'
          }`}>
            <p className="text-sm">{manualStatus.text}</p>
          </Card>
        )}

        {showManualForm && (
          <Card>
            <h3 className="text-sm font-semibold">Manual asset/cash entry</h3>
            <p className="mt-1 text-xs text-slate-500">Purchase date is required so later CSV imports are deduped against this entry.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <select
                value={manualDraft.assetType}
                onChange={(e) => setManualDraft((d) => ({ ...d, assetType: e.target.value as 'cash' | 'stock' | 'etf' }))}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="cash">Cash</option>
                <option value="stock">Stock</option>
                <option value="etf">ETF</option>
              </select>
              <input
                type="date"
                value={manualDraft.date}
                onChange={(e) => setManualDraft((d) => ({ ...d, date: e.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                placeholder={manualDraft.assetType === 'cash' ? 'Provider (e.g. Plum)' : 'Ticker (e.g. VUAG.L)'}
                value={manualDraft.providerOrTicker}
                onChange={(e) => setManualDraft((d) => ({ ...d, providerOrTicker: e.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                placeholder="Name (optional)"
                value={manualDraft.name}
                onChange={(e) => setManualDraft((d) => ({ ...d, name: e.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
              {manualDraft.assetType !== 'cash' && (
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Quantity"
                  value={manualDraft.quantity}
                  onChange={(e) => setManualDraft((d) => ({ ...d, quantity: e.target.value }))}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
                />
              )}
              <input
                type="number"
                min="0"
                step="any"
                placeholder={manualDraft.assetType === 'cash' ? 'Amount' : 'Price'}
                value={manualDraft.price}
                onChange={(e) => setManualDraft((d) => ({ ...d, price: e.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                placeholder="Currency"
                value={manualDraft.currency}
                onChange={(e) => setManualDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <select
                value={manualDraft.owner}
                onChange={(e) => setManualDraft((d) => ({ ...d, owner: e.target.value as OwnerName }))}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <button
                type="button"
                onClick={addManualAsset}
                disabled={
                  manualImport.isPending ||
                  !manualDraft.providerOrTicker.trim() ||
                  !OWNERS.includes(manualDraft.owner as OwnerName) ||
                  Number(manualDraft.price) <= 0 ||
                  (manualDraft.assetType !== 'cash' && Number(manualDraft.quantity) <= 0)
                }
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {manualImport.isPending ? 'Saving…' : 'Save entry'}
              </button>
            </div>
            <input
              placeholder="Notes (optional)"
              value={manualDraft.notes}
              onChange={(e) => setManualDraft((d) => ({ ...d, notes: e.target.value }))}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(['stock', 'etf', 'cash', 'crypto'] as const).map((t) => (
            <Card
              key={t}
              className={[
                'ff-assets-type-card',
                visualStyle === 'premium3d'
                  ? 'border-indigo-300/35 bg-gradient-to-br from-indigo-900/55 to-slate-900/45 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_28px_rgba(15,23,42,0.4)]'
                  : '',
              ].join(' ')}
            >
              <div className={`text-[11px] uppercase tracking-wider ${visualStyle === 'premium3d' ? 'text-indigo-200/90' : 'text-slate-500'}`}>{t}</div>
              <div className={`mt-1 text-base font-semibold tabular-nums ${visualStyle === 'premium3d' ? 'text-cyan-100' : ''}`}>
                {privacyMode ? '•••••' : formatMoney(view.categoryTotals[t] || 0, view.base)}
              </div>
            </Card>
          ))}
        </div>

        <Card tone="elevated" className="!p-0">
          <div className="ff-holdings-filterbar flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <Search className="ff-holdings-filter-icon h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ticker, name, or sector…"
              className="ff-holdings-filter-input w-full bg-transparent text-sm placeholder:text-slate-400 focus:outline-none"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="ff-holdings-filter-select rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="all">All types</option>
              <option value="stock">Stock</option>
              <option value="etf">ETF</option>
              <option value="cash">Cash</option>
              <option value="commodity">Commodity</option>
              <option value="crypto">Crypto</option>
              <option value="bond">Bond</option>
            </select>
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
                          <span className="ff-type-pill rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">{r.type}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatShares(r.shares)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                          {r.avgCost > 0 ? (privacyMode ? '•••••' : formatMoney(r.avgCost, r.currency, 2)) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                          {r.livePrice != null
                            ? (privacyMode ? '•••••' : formatMoney(r.livePrice, r.livePriceCcy || r.currency, 2))
                            : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {privacyMode ? '•••••' : formatMoney(r.valueBase, view.base)}
                          {r.valueIsCost && <span className="ml-1 text-[10px] text-slate-400">cost</span>}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${tone}`}>
                          {r.valueIsCost ? <span className="text-slate-400">—</span> : (privacyMode ? '•••••' : formatMoney(r.gainLoss, view.base))}
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
