import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Camera } from 'lucide-react'
import { usePortfolio, usePostSnapshot, useUi } from '@/context/AppContext'
import { buildPortfolio } from '@/utils/calculations'
import { formatMoney, formatRelative } from '@/utils/format'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import type { Snapshot } from '@/types'

type Range = '30d' | '90d' | '1y' | 'all'

function filterByRange(snapshots: Snapshot[], range: Range): Snapshot[] {
  if (range === 'all' || snapshots.length === 0) return snapshots
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365
  const cutoff = Date.now() - days * 86400_000
  return snapshots.filter((s) => new Date(s.date).getTime() >= cutoff)
}

function drawdown(series: Snapshot[]): number {
  let peak = -Infinity
  let maxDd = 0
  for (const s of series) {
    if (s.valueGBP > peak) peak = s.valueGBP
    if (peak > 0) {
      const dd = (s.valueGBP - peak) / peak
      if (dd < maxDd) maxDd = dd
    }
  }
  return maxDd * 100 // negative percent
}

export function Performance() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner } = useUi()
  const post = usePostSnapshot()
  const [range, setRange] = useState<Range>('all')

  const view = useMemo(() => {
    if (!data) return null
    const filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    const built = buildPortfolio(filtered, data.prices, data.fxRates, data.settings.baseCurrency || 'GBP')
    const today = new Date().toISOString().slice(0, 10)
    const hasTodaySnapshot = data.snapshots.some((s) => s.date === today)
    const withLivePoint = hasTodaySnapshot
      ? data.snapshots
      : [...data.snapshots, { date: today, valueGBP: built.totalValueBase }]
    const series = filterByRange(withLivePoint, range)
    return { built, series, base: data.settings.baseCurrency || 'GBP' }
  }, [data, selectedOwner, range])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load performance" body={(error as Error).message} /></PageBody>
  if (!data || !view) return null

  const { series, base, built } = view
  const dd = drawdown(series)
  const start = series[0]?.valueGBP ?? 0
  const end = series[series.length - 1]?.valueGBP ?? 0
  const change = end - start
  const changePct = start === 0 ? 0 : (change / start) * 100

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle={`${data.snapshots.length} snapshots · ${formatRelative(data.lastRefresh)}`}
        right={
          <button
            type="button"
            onClick={() => post.mutate({ date: new Date().toISOString().slice(0, 10), valueGBP: built.totalValueBase })}
            disabled={post.isPending || built.totalValueBase === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Camera className="h-4 w-4" />
            {post.isPending ? 'Saving…' : 'Snapshot now'}
          </button>
        }
      />
      <PageBody>
        {data.snapshots.length === 0 ? (
          <EmptyState
            title="No snapshots yet"
            body="Snapshots are how the performance chart is built. Click 'Snapshot now' after refreshing prices to record today's portfolio value, then check back tomorrow."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Period change</div>
                <div className={`mt-2 text-2xl font-semibold tabular-nums ${change > 0 ? 'text-emerald-500' : change < 0 ? 'text-rose-500' : 'text-slate-900 dark:text-slate-100'}`}>
                  {formatMoney(change, base)}
                </div>
                <div className="mt-1 text-xs text-slate-500">{changePct.toFixed(1)}%</div>
              </Card>
              <Card>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Max drawdown</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-500">{dd.toFixed(1)}%</div>
                <div className="mt-1 text-xs text-slate-500">in selected range</div>
              </Card>
              <Card>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Latest snapshot</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatMoney(end, base)}
                </div>
                <div className="mt-1 text-xs text-slate-500">{series[series.length - 1]?.date ?? '—'}</div>
              </Card>
            </div>

            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Portfolio value over time</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{series.length} points</p>
                </div>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs dark:border-slate-800 dark:bg-slate-900">
                  {(['30d', '90d', '1y', 'all'] as Range[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRange(r)}
                      className={`rounded-md px-2.5 py-1 font-semibold uppercase ${
                        range === r ? 'bg-white shadow-sm dark:bg-slate-700 text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v: number) => formatMoney(v, base)} width={80} />
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, base)}
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                    />
                    <Line type="monotone" dataKey="valueGBP" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </>
        )}
      </PageBody>
    </>
  )
}
