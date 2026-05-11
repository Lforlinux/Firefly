import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePortfolio, useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { loadLiabilities, totalLiabilitiesBase } from '@/utils/liabilities'
import { deriveNetWorthHistory } from '@/utils/netWorthHistory'

export function Snapshots() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, visualStyle, selectedCountry } = useUi()

  const view = useMemo(() => {
    if (!data) return null
    const base = selectedCountry === 'India' ? 'INR' : (data.settings.baseCurrency || 'GBP')
    const allLiabilities = loadLiabilities()
    const relevantLiabilities = selectedCountry === 'India'
      ? allLiabilities.filter((l) => l.currency === 'INR')
      : selectedCountry === 'UK'
        ? allLiabilities.filter((l) => l.currency !== 'INR')
        : allLiabilities
    const liabilitiesTotal = totalLiabilitiesBase(relevantLiabilities, base)
    const derived = deriveNetWorthHistory(data, selectedOwner, liabilitiesTotal, selectedCountry)
    return { base, snapshots: data.snapshots, currentNetWorth: derived.currentNetWorth, series: derived.series }
  }, [data, selectedOwner, selectedCountry])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load wealth timeline" body={(error as Error).message} /></PageBody>
  if (!view) return null
  const is3d = visualStyle === 'premium3d'

  return (
    <>
      <PageHeader
        title="Wealth Timeline"
        subtitle="Track net worth over time from your holdings and transactions."
      />
      <PageBody>
        {view.series.length === 0 ? (
          <EmptyState
            title="No history yet"
            body="Import holdings and transactions to auto-build your wealth timeline."
          />
        ) : (
          <Card tone="elevated">
            <h3 className="text-sm font-semibold">Wealth history</h3>
            <p className="mt-1 text-xs text-slate-500">Auto-calculated from transactions and current holdings; saved checkpoints appear as a dashed overlay when available.</p>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={view.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke={is3d ? 'rgba(99,102,241,0.35)' : 'rgba(148,163,184,0.2)'} />
                  <XAxis dataKey="date" fontSize={11} stroke={is3d ? '#c7d2fe' : '#94a3b8'} />
                  <YAxis
                    width={90}
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
                    strokeWidth={is3d ? 3 : 2}
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
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}
