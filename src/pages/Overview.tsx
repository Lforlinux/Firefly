import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { AlertCircle, Wallet } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio, byType, topN } from '@/utils/calculations'
import { formatMoney, formatPercent, formatRelative } from '@/utils/format'
import { Card, EmptyState, GainLossBadge, KpiCard, Loading, PageBody, PageHeader } from '@/components/ui'

const TYPE_COLORS: Record<string, string> = {
  stock: '#22c55e',
  etf: '#3b82f6',
  cash: '#94a3b8',
  commodity: '#f59e0b',
  crypto: '#a855f7',
  bond: '#0ea5e9',
}

export function Overview() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner } = useUi()

  const view = useMemo(() => {
    if (!data) return null
    const filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    const base = data.settings.baseCurrency || 'GBP'
    const built = buildPortfolio(filtered, data.prices, data.fxRates, base)
    const allocation = byType(built.investedRows, built.totalValueBase - built.cashValueBase)
    const top = topN(built.investedRows, 5)
    const livePriceCount = Object.keys(data.prices || {}).length
    return { ...built, allocation, top, base, livePriceCount }
  }, [data, selectedOwner])

  if (isLoading) return <Loading label="Loading portfolio…" />
  if (error) return <PageBody><EmptyState title="Couldn't load portfolio" body={(error as Error).message} /></PageBody>
  if (!data || !view) return null

  const { totalValueBase, totalCostBase, totalGainLoss, totalGainLossPct, cashValueBase, allocation, top, base, livePriceCount } = view
  const investedValue = totalValueBase - cashValueBase

  return (
    <>
      <PageHeader
        title="Portfolio Overview"
        subtitle={
          <>
            {selectedOwner === 'all' ? 'All portfolios' : `${selectedOwner}'s portfolio`} ·{' '}
            Last refresh: {formatRelative(data.lastRefresh)}
          </>
        }
      />
      <PageBody>
        {livePriceCount === 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="text-sm text-amber-700 dark:text-amber-300">
                No live prices yet. All values below are at <strong>cost basis</strong>. Click <strong>Refresh prices</strong> in the sidebar to fetch live quotes from Yahoo Finance.
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Total value"
            value={formatMoney(totalValueBase, base)}
            sub={livePriceCount === 0 ? 'cost basis' : `${view.investedRows.length} positions`}
          />
          <KpiCard
            label="Invested"
            value={formatMoney(investedValue, base)}
            sub={`Cost: ${formatMoney(totalCostBase - cashValueBase, base)}`}
          />
          <KpiCard
            label="Total G/L"
            value={formatMoney(totalGainLoss, base)}
            tone={totalGainLoss === 0 ? 'neutral' : totalGainLoss > 0 ? 'gain' : 'loss'}
            sub={livePriceCount === 0 ? '—' : formatPercent(totalGainLossPct)}
          />
          <KpiCard
            label="Cash"
            value={formatMoney(cashValueBase, base)}
            sub={`${view.cashRows.length} cash position${view.cashRows.length === 1 ? '' : 's'}`}
            icon={<Wallet className="h-4 w-4 text-slate-400" />}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Allocation by type</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Excludes cash</p>
            {allocation.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No invested holdings</div>
            ) : (
              <>
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocation} dataKey="valueBase" nameKey="key" innerRadius={48} outerRadius={80} paddingAngle={2}>
                        {allocation.map((s) => (
                          <Cell key={s.key} fill={TYPE_COLORS[s.key] || '#64748b'} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => formatMoney(v, base)}
                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {allocation.map((s) => (
                    <li key={s.key} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[s.key] || '#64748b' }} />
                        <span className="capitalize text-slate-700 dark:text-slate-300">{s.key}</span>
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {formatMoney(s.valueBase, base)} <span className="ml-2 tabular-nums text-xs">{(s.weight * 100).toFixed(1)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Top holdings</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">By portfolio weight</p>
            {top.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No holdings</div>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
                {top.map((h) => (
                  <li key={h.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{h.ticker}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">{h.type}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{h.name}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatMoney(h.valueBase, base)}</div>
                        <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{(h.weight * 100).toFixed(1)}%</div>
                      </div>
                      {!h.valueIsCost && (
                        <GainLossBadge amount={h.gainLoss} pct={h.gainLossPct} currency={base} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  )
}
