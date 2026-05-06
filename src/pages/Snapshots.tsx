import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { usePortfolio, useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { loadLiabilities, totalLiabilitiesBase } from '@/utils/liabilities'
import { deriveNetWorthHistory } from '@/utils/netWorthHistory'

export function Snapshots() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, visualStyle } = useUi()

  const view = useMemo(() => {
    if (!data) return null
    const base = data.settings.baseCurrency || 'GBP'
    const liabilitiesTotal = totalLiabilitiesBase(loadLiabilities(), base)
    const derived = deriveNetWorthHistory(data, selectedOwner, liabilitiesTotal)
    const last = derived.series[derived.series.length - 1]
    const currentContributions = last?.contributions ?? 0
    const growth = derived.currentNetWorth - currentContributions
    const growthPct = currentContributions > 0 ? (growth / currentContributions) * 100 : 0
    return {
      base,
      snapshots: data.snapshots,
      currentNetWorth: derived.currentNetWorth,
      currentContributions,
      growth,
      growthPct,
      series: derived.series,
    }
  }, [data, selectedOwner])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load wealth timeline" body={(error as Error).message} /></PageBody>
  if (!view) return null

  const is3d = visualStyle === 'premium3d'
  const hasSeries = view.series.length > 1

  const statCard = (label: string, value: string, sub?: string, positive?: boolean) => (
    <div className={`rounded-xl p-4 ${is3d ? 'bg-slate-800/60 border border-indigo-500/20' : 'bg-slate-50 dark:bg-slate-800/40'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : ''}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Wealth Timeline"
        subtitle="Track net worth over time from your holdings and transactions."
      />
      <PageBody>
        {/* Summary stats */}
        {hasSeries && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statCard('Current Value', formatMoney(view.currentNetWorth, view.base))}
            {statCard('Total Invested', formatMoney(view.currentContributions, view.base))}
            {statCard(
              'Growth',
              formatMoney(view.growth, view.base),
              `${view.growthPct >= 0 ? '+' : ''}${view.growthPct.toFixed(1)}%`,
              view.growth >= 0,
            )}
            {statCard(
              'Return',
              `${view.growthPct >= 0 ? '+' : ''}${view.growthPct.toFixed(2)}%`,
              view.growth >= 0 ? 'Overall gain' : 'Overall loss',
              view.growth >= 0,
            )}
          </div>
        )}

        {!hasSeries ? (
          <EmptyState
            title="No history yet"
            body="Import holdings and transactions to auto-build your wealth timeline."
          />
        ) : (
          <Card tone="elevated">
            <h3 className="text-sm font-semibold">Wealth vs Invested</h3>
            <p className="mt-1 text-xs text-slate-500">
              Blue = current portfolio value · Grey = total invested · Gap = unrealised growth
            </p>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={view.series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gradNW" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={is3d ? '#38bdf8' : '#3b82f6'} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={is3d ? '#38bdf8' : '#3b82f6'} stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="gradInv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={is3d ? '#a78bfa' : '#94a3b8'} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={is3d ? '#a78bfa' : '#94a3b8'} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={is3d ? 'rgba(99,102,241,0.2)' : 'rgba(148,163,184,0.15)'}
                  />
                  <XAxis
                    dataKey="date"
                    fontSize={10}
                    stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                    tickFormatter={(v: string) => {
                      const d = new Date(v)
                      return `${d.toLocaleString('default', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`
                    }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    width={80}
                    stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                    fontSize={10}
                    tickFormatter={(v: number) => formatMoney(v, view.base)}
                  />
                  <Tooltip
                    formatter={(v: number, name: string) => [formatMoney(v, view.base), name]}
                    labelFormatter={(label: string) => {
                      const d = new Date(label)
                      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    }}
                    contentStyle={
                      is3d
                        ? { background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(129,140,248,0.4)', borderRadius: 12, boxShadow: '0 10px 30px rgba(99,102,241,0.3)' }
                        : { borderRadius: 8 }
                    }
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) => <span style={{ color: is3d ? '#c7d2fe' : '#64748b' }}>{value}</span>}
                  />
                  {/* Invested (contributions) — bottom fill */}
                  <Area
                    type="monotone"
                    dataKey="contributions"
                    name="Invested"
                    stroke={is3d ? '#a78bfa' : '#94a3b8'}
                    strokeWidth={1.5}
                    fill="url(#gradInv)"
                    dot={false}
                    strokeDasharray="4 3"
                    style={is3d ? { filter: 'drop-shadow(0 0 4px rgba(167,139,250,0.5))' } : undefined}
                  />
                  {/* Net worth — top fill */}
                  <Area
                    type="monotone"
                    dataKey="estimatedNetWorth"
                    name="Portfolio value"
                    stroke={is3d ? '#38bdf8' : '#3b82f6'}
                    strokeWidth={is3d ? 2.5 : 2}
                    fill="url(#gradNW)"
                    dot={false}
                    style={is3d ? { filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.7))' } : undefined}
                  />
                  {/* Snapshot checkpoints */}
                  {view.series.some((p) => p.snapshotNetWorth != null) && (
                    <Line
                      type="monotone"
                      dataKey="snapshotNetWorth"
                      name="Snapshot"
                      stroke={is3d ? '#34d399' : '#10b981'}
                      strokeWidth={is3d ? 2 : 1.5}
                      strokeDasharray="6 4"
                      dot={false}
                      connectNulls={false}
                      style={is3d ? { filter: 'drop-shadow(0 0 4px rgba(52,211,153,0.6))' } : undefined}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}
