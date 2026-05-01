import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { loadLiabilities, totalLiabilitiesBase } from '@/utils/liabilities'
import { deriveNetWorthHistory } from '@/utils/netWorthHistory'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'

export function NetWorthProgress() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, visualStyle } = useUi()

  const view = useMemo(() => {
    if (!data) return null
    const base = data.settings.baseCurrency || 'GBP'
    const liabilities = totalLiabilitiesBase(loadLiabilities(), base)
    const derived = deriveNetWorthHistory(data, selectedOwner, liabilities)
    return { ...derived, base }
  }, [data, selectedOwner])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load net worth progress" body={(error as Error).message} /></PageBody>
  if (!view) return null
  const is3d = visualStyle === 'premium3d'

  return (
    <>
      <PageHeader
        title="Net Worth Progress"
        subtitle="Track total net worth against cumulative contributions over time."
        right={
          <Link to="/" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        }
      />
      <PageBody>
        {view.series.length === 0 ? (
          <EmptyState title="No progress data yet" body="Import holdings and transactions to build your timeline automatically." />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card tone="elevated">
                <div className="text-xs uppercase tracking-wider text-slate-500">Current net worth</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(view.currentNetWorth, view.base)}</div>
              </Card>
              <Card tone="elevated">
                <div className="text-xs uppercase tracking-wider text-slate-500">Cumulative contributions</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(view.currentContributions, view.base)}</div>
              </Card>
            </div>

            <Card tone="elevated">
              <h3 className="text-sm font-semibold">Progress timeline</h3>
              <p className="mt-1 text-xs text-slate-500">Net worth auto-builds from your transaction timeline and current holdings prices. Snapshots are optional checkpoints.</p>
              <div className="mt-4 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={view.series}>
                    <CartesianGrid strokeDasharray="3 3" stroke={is3d ? 'rgba(99,102,241,0.35)' : 'rgba(148,163,184,0.2)'} />
                    <XAxis dataKey="date" stroke={is3d ? '#c7d2fe' : '#94a3b8'} fontSize={11} />
                    <YAxis
                      width={92}
                      stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                      fontSize={11}
                      tickFormatter={(v: number) => formatMoney(v, view.base)}
                    />
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, view.base)}
                      contentStyle={is3d ? { background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(129,140,248,0.45)', borderRadius: 12, boxShadow: '0 10px 30px rgba(99,102,241,0.35)' } : undefined}
                    />
                    <Line
                      type="monotone"
                      dataKey="estimatedNetWorth"
                      stroke={is3d ? '#38bdf8' : '#0f172a'}
                      strokeWidth={is3d ? 3 : 2.5}
                      dot={false}
                      name="Net worth (auto)"
                      style={is3d ? { filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.85))' } : undefined}
                    />
                    {view.series.some((p) => p.snapshotNetWorth != null) && (
                      <Line
                        type="monotone"
                        dataKey="snapshotNetWorth"
                        stroke={is3d ? '#a78bfa' : '#6366f1'}
                        strokeWidth={is3d ? 2.5 : 2}
                        strokeDasharray="6 4"
                        dot={false}
                        connectNulls={false}
                        name="Snapshot"
                        style={is3d ? { filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.75))' } : undefined}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="contributions"
                      stroke={is3d ? '#e879f9' : '#0ea5e9'}
                      strokeWidth={is3d ? 2.5 : 2}
                      dot={false}
                      name="Contributions"
                      style={is3d ? { filter: 'drop-shadow(0 0 6px rgba(232,121,249,0.75))' } : undefined}
                    />
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
