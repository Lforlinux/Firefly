import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio, bySector, byType } from '@/utils/calculations'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'

const COLORS = ['#0f172a', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1']
const COLORS_3D = ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#e879f9', '#f59e0b', '#34d399']
const TYPE_COLOR_3D: Record<string, string> = {
  etf: '#22d3ee',
  stock: '#e879f9',
  cash: '#a78bfa',
  crypto: '#f59e0b',
  commodity: '#67e8f9',
  bond: '#34d399',
}

export function Allocation() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, visualStyle } = useUi()

  const view = useMemo(() => {
    if (!data) return null
    const base = data.settings.baseCurrency || 'GBP'
    const ownerHoldings = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    const built = buildPortfolio(ownerHoldings, data.prices, data.fxRates, base)
    return {
      base,
      byTypeRows: byType(built.investedRows),
      bySectorRows: bySector(built.investedRows),
    }
  }, [data, selectedOwner])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load allocation" body={(error as Error).message} /></PageBody>
  if (!view) return null
  const is3d = visualStyle === 'premium3d'
  const pieColors = is3d ? COLORS_3D : COLORS
  const getPieColor = (key: string, index: number) => is3d ? (TYPE_COLOR_3D[key] || pieColors[index % pieColors.length]) : pieColors[index % pieColors.length]

  return (
    <>
      <PageHeader title="Allocation" subtitle="Understand where your capital is concentrated." />
      <PageBody>
        {view.byTypeRows.length === 0 ? (
          <EmptyState title="Add assets to see allocation" body="Allocation visuals appear once at least one asset has a value." />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card tone="elevated">
              <h3 className={`text-sm font-semibold ${is3d ? 'text-cyan-100' : ''}`}>By asset type</h3>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={view.byTypeRows} dataKey="valueBase" nameKey="key" innerRadius={56} outerRadius={94} paddingAngle={2}>
                      {view.byTypeRows.map((row, i) => (
                        <Cell
                          key={row.key}
                          fill={getPieColor(row.key, i)}
                          stroke={is3d ? 'rgba(224,231,255,0.65)' : '#e2e8f0'}
                          strokeWidth={1.2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, view.base)}
                      contentStyle={is3d ? { background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(129,140,248,0.45)', borderRadius: 12, boxShadow: '0 10px 30px rgba(99,102,241,0.35)', color: '#a5f3fc' } : undefined}
                      labelStyle={is3d ? { color: '#67e8f9' } : undefined}
                      itemStyle={is3d ? { color: '#a5f3fc' } : undefined}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {view.byTypeRows.map((row, i) => (
                  <div key={row.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: getPieColor(row.key, i) }}
                      />
                      <span className={is3d ? 'text-cyan-100' : 'text-slate-700 dark:text-slate-300'}>{row.key}</span>
                    </span>
                    <span className={is3d ? 'text-cyan-200/85 tabular-nums' : 'text-slate-500 tabular-nums dark:text-slate-400'}>
                      {(row.weight * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card tone="elevated" className="!p-0">
              <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <h3 className={`text-sm font-semibold ${is3d ? 'text-cyan-100' : ''}`}>By sector</h3>
              </div>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Sector</th>
                    <th className="px-5 py-3 text-right">Value</th>
                    <th className="px-5 py-3 text-right">Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {view.bySectorRows.map((row) => (
                    <tr key={row.key}>
                      <td className="px-5 py-2.5">{row.key}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(row.valueBase, view.base)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{(row.weight * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </PageBody>
    </>
  )
}
