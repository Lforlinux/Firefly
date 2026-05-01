import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio, byType, bySector } from '@/utils/calculations'
import { formatMoney, formatRelative } from '@/utils/format'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'

const PALETTE = [
  '#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#0ea5e9',
  '#ec4899', '#10b981', '#6366f1', '#f97316', '#14b8a6', '#84cc16',
]
const PALETTE_3D = ['#22d3ee', '#38bdf8', '#67e8f9', '#a78bfa', '#e879f9', '#f59e0b', '#34d399']

function colorFor(idx: number) { return PALETTE[idx % PALETTE.length] }
function colorFor3d(idx: number) { return PALETTE_3D[idx % PALETTE_3D.length] }

const TYPE_COLORS: Record<string, string> = {
  stock: '#22c55e',
  etf: '#3b82f6',
  cash: '#94a3b8',
  commodity: '#f59e0b',
  crypto: '#a855f7',
  bond: '#0ea5e9',
}

export function Sectors() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, visualStyle } = useUi()

  const view = useMemo(() => {
    if (!data) return null
    const filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    const base = data.settings.baseCurrency || 'GBP'
    const built = buildPortfolio(filtered, data.prices, data.fxRates, base)
    const investedTotal = built.totalValueBase - built.cashValueBase
    const sectorSlices = bySector(built.investedRows, investedTotal)
    const typeSlices = byType(built.rows, built.totalValueBase) // include cash in type breakdown for completeness
    return { built, base, sectorSlices, typeSlices, investedTotal }
  }, [data, selectedOwner])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load sectors" body={(error as Error).message} /></PageBody>
  if (!data || !view) return null

  const { sectorSlices, typeSlices, base } = view
  const is3d = visualStyle === 'premium3d'

  return (
    <>
      <PageHeader
        title="Sector & Asset Breakdown"
        subtitle={`Last refresh: ${formatRelative(data.lastRefresh)}`}
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">By sector</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Excludes cash</p>
            {sectorSlices.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No sector data</div>
            ) : (
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sectorSlices} dataKey="valueBase" nameKey="key" innerRadius={56} outerRadius={96} paddingAngle={2}>
                      {sectorSlices.map((s, i) => (
                        <Cell
                          key={s.key}
                          fill={is3d ? colorFor3d(i) : colorFor(i)}
                          stroke={is3d ? 'rgba(224,231,255,0.65)' : '#e2e8f0'}
                          strokeWidth={1.2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, base)}
                      contentStyle={is3d
                        ? { background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(129,140,248,0.45)', borderRadius: 12, color: '#a5f3fc', boxShadow: '0 10px 30px rgba(99,102,241,0.35)' }
                        : { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                      labelStyle={is3d ? { color: '#67e8f9' } : undefined}
                      itemStyle={is3d ? { color: '#a5f3fc' } : undefined}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">By asset type</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Includes cash</p>
            {typeSlices.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No data</div>
            ) : (
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={typeSlices} dataKey="valueBase" nameKey="key" innerRadius={56} outerRadius={96} paddingAngle={2}>
                      {typeSlices.map((s, i) => (
                        <Cell
                          key={s.key}
                          fill={is3d ? colorFor3d(i) : (TYPE_COLORS[s.key] || '#64748b')}
                          stroke={is3d ? 'rgba(224,231,255,0.65)' : '#e2e8f0'}
                          strokeWidth={1.2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, base)}
                      contentStyle={is3d
                        ? { background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(129,140,248,0.45)', borderRadius: 12, color: '#a5f3fc', boxShadow: '0 10px 30px rgba(99,102,241,0.35)' }
                        : { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                      labelStyle={is3d ? { color: '#67e8f9' } : undefined}
                      itemStyle={is3d ? { color: '#a5f3fc' } : undefined}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        <Card className="!p-0">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Allocation table</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Sector breakdown by value and weight</p>
          </div>
          {sectorSlices.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">No data</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3">Sector</th>
                  <th className="px-5 py-3 text-right">Holdings</th>
                  <th className="px-5 py-3 text-right">Value</th>
                  <th className="px-5 py-3 text-right">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sectorSlices.map((s, i) => (
                  <tr key={s.key} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                    <td className="px-5 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: is3d ? colorFor3d(i) : colorFor(i) }} />
                        <span className="font-medium text-slate-900 dark:text-slate-100">{s.key}</span>
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{s.count}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(s.valueBase, base)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{(s.weight * 100).toFixed(1)}%</td>
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
