import { useMemo } from 'react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { formatRelative, formatDate } from '@/utils/format'
import { Card, Loading, PageBody, PageHeader } from '@/components/ui'

export function Settings() {
  const { data, isLoading } = usePortfolio()
  const { theme, toggleTheme } = useUi()

  const fxRows = useMemo(() => {
    if (!data) return []
    return Object.entries(data.fxRates || {}).map(([pair, v]) => ({ pair, ...v }))
  }, [data])

  if (isLoading) return <Loading />
  if (!data) return null

  return (
    <>
      <PageHeader title="Settings" subtitle="Configuration, FX rates, and data status" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="text-sm font-semibold">General</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Base currency</dt>
                <dd className="font-mono font-semibold">{data.settings.baseCurrency}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Theme</dt>
                <dd>
                  <button type="button" onClick={toggleTheme} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700">
                    {theme}
                  </button>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Last data update</dt>
                <dd className="tabular-nums">{formatDate(data.settings.lastUpdated)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Last price refresh</dt>
                <dd className="tabular-nums">{formatRelative(data.lastRefresh)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold">Data status</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Holdings</dt>
                <dd className="tabular-nums">{data.holdings.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Snapshots</dt>
                <dd className="tabular-nums">{data.snapshots.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Transactions</dt>
                <dd className="tabular-nums">{data.transactions.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Cached prices</dt>
                <dd className="tabular-nums">{Object.keys(data.prices || {}).length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">FX pairs</dt>
                <dd className="tabular-nums">{Object.keys(data.fxRates || {}).length}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <Card className="!p-0">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold">FX rates</h3>
            <p className="text-xs text-slate-500">Refreshed by the sidebar Refresh button</p>
          </div>
          {fxRows.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">No FX rates cached yet</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3">Pair</th>
                  <th className="px-5 py-3 text-right">Rate</th>
                  <th className="px-5 py-3 text-right">As of</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {fxRows.map((r) => (
                  <tr key={r.pair}>
                    <td className="px-5 py-2.5 font-mono">{r.pair.replace('_', ' → ')}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{r.rate.toFixed(6)}</td>
                    <td className="px-5 py-2.5 text-right text-slate-500">{formatRelative(r.asOf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </PageBody>
    </>
  )
}
