import { useMemo } from 'react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { usePortfolio, useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'

/**
 * Wealth Timeline — fully automated.
 *
 * Data sources (no manual snapshots required going forward):
 *   1. Historical monthly snapshots (Jan 2025 – Apr 2026) stored in data.snapshots
 *   2. Daily automated portfolio values from data.dailyMovements (portfolio_value_gbp)
 *
 * For "all" owner: monthly snapshots + daily 'all' movements
 * For individual owner (KLN/Priya): daily movements only (monthly snapshots are whole-portfolio)
 */
export function Snapshots() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, visualStyle } = useUi()

  const { series, base, latestValue } = useMemo(() => {
    if (!data) return { series: [], base: 'GBP', latestValue: null }

    const base = data.settings.baseCurrency || 'GBP'
    const byDate = new Map<string, number>()

    // Source 1: monthly snapshots — only include for 'all' owner view.
    // Use the full portfolio value (valueGBP / total_value), which includes India
    // and every asset, to stay consistent with the daily_movements total (which
    // now counts all holdings). Using the UK-only uk_gbp here understated the
    // timeline and clashed with the India-inclusive daily values.
    if (selectedOwner === 'all') {
      for (const s of data.snapshots || []) {
        const v = Number(s.valueGBP)
        if (v > 0) byDate.set(s.date, v)
      }
    }

    // Source 2: daily_movements portfolio_value_gbp (automated, recent)
    // Filter by owner — 'all' uses the combined portfolio row
    const targetOwner = selectedOwner === 'all' ? 'all' : selectedOwner
    for (const m of data.dailyMovements || []) {
      if (m.owner !== targetOwner) continue
      const v = m.portfolioValueGBP
      if (v != null && v > 0) byDate.set(m.date, v)
    }

    const series = [...byDate.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const latestValue = series.length ? series[series.length - 1].value : null

    return { series, base, latestValue }
  }, [data, selectedOwner])

  const fmtAxisDate = (d: string) => {
    const dt = new Date(d + 'T12:00:00Z')
    return dt.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
  }

  const fmtTooltipDate = (d: string) =>
    new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load wealth timeline" body={(error as Error).message} /></PageBody>
  if (!data) return null

  const is3d = visualStyle === 'premium3d'
  const strokeColour = is3d ? '#38bdf8' : '#6366f1'
  const gradId = 'wt-grad'

  return (
    <>
      <PageHeader
        title="Wealth Timeline"
        subtitle="Automated daily tracking — no manual snapshots needed."
      />
      <PageBody>
        {series.length === 0 ? (
          <EmptyState
            title="No history yet"
            body={
              selectedOwner === 'all'
                ? 'No snapshots or daily movements recorded yet. Visit the Overview page daily to start building history.'
                : `No daily data yet for ${selectedOwner}. History builds automatically once price captures begin.`
            }
          />
        ) : (
          <>
            {latestValue != null && (
              <div className="mb-4">
                <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {formatMoney(latestValue, base)}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Latest recorded portfolio value
                  {selectedOwner !== 'all' ? ` · ${selectedOwner}` : ''}
                </div>
              </div>
            )}

            <Card tone="elevated">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Portfolio value over time</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {selectedOwner === 'all'
                      ? 'Monthly checkpoints (2025–Apr 2026) · daily tracking from May 2026'
                      : `Daily tracking for ${selectedOwner} · monthly history not available per-owner`}
                  </p>
                </div>
                <span className="text-xs text-slate-400">{series.length} data points</span>
              </div>

              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={strokeColour} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={strokeColour} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={is3d ? 'rgba(99,102,241,0.25)' : 'rgba(148,163,184,0.15)'}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtAxisDate}
                      stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                      fontSize={11}
                      interval="preserveStartEnd"
                      tickLine={false}
                    />
                    <YAxis
                      width={90}
                      stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                      fontSize={11}
                      tickFormatter={(v: number) => formatMoney(v, base)}
                      domain={['auto', 'auto']}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(v: number) => [formatMoney(v, base), 'Portfolio value']}
                      labelFormatter={fmtTooltipDate}
                      contentStyle={
                        is3d
                          ? { background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(129,140,248,0.45)', borderRadius: 12 }
                          : { borderRadius: 8 }
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={strokeColour}
                      strokeWidth={is3d ? 3 : 2}
                      fill={`url(#${gradId})`}
                      dot={false}
                      activeDot={{ r: 4, fill: strokeColour, strokeWidth: 0 }}
                      style={is3d ? { filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.85))' } : undefined}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Data point table */}
            <Card tone="elevated">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">History</h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
                {[...series].reverse().map((p) => (
                  <div key={p.date} className="flex justify-between py-2 text-sm">
                    <span className="text-slate-500">{fmtTooltipDate(p.date)}</span>
                    <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {formatMoney(p.value, base)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </PageBody>
    </>
  )
}
