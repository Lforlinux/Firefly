import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { convertToBase } from '@/utils/calculations'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney, formatPercent } from '@/utils/format'

interface Contributor {
  id: string
  ticker: string
  name: string
  move: number // in base currency
  pct: number  // (price − prevClose) / prevClose
}

export function DailyMovement() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner, selectedCountry, visualStyle } = useUi()
  const is3d = visualStyle === 'premium3d'

  const { base, movements, bestDay, worstDay, totalCaptured, today } = useMemo(() => {
    if (!data) return { base: 'GBP', movements: [], bestDay: null, worstDay: null, totalCaptured: 0, today: null }
    const base = data.settings.baseCurrency || 'GBP'

    const movements = [...(data.dailyMovements || [])]
      .filter((m) => m.owner === selectedOwner)
      .sort((a, b) => a.date.localeCompare(b.date))
      // keep last 60 trading days
      .slice(-60)

    const vals = movements.map((m) => m.movementGBP)
    const bestDay = vals.length ? movements[vals.indexOf(Math.max(...vals))] : null
    const worstDay = vals.length ? movements[vals.indexOf(Math.min(...vals))] : null
    const totalCaptured = vals.reduce((s, v) => s + v, 0)

    // Latest-day per-holding breakdown, computed live from price vs prev close.
    // Mirrors the dashboard "Today's movement" card: same owner + country filter
    // and base currency, so the totals tie out.
    let filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    if (selectedCountry === 'UK') filtered = filtered.filter((h) => h.currency !== 'INR')
    else if (selectedCountry === 'India') filtered = filtered.filter((h) => h.currency === 'INR')
    const todayBase = selectedCountry === 'India' ? 'INR' : base

    const contributors: Contributor[] = []
    let total = 0
    let asOf: string | null = null
    for (const h of filtered) {
      if (h.type === 'cash') continue
      const quote = data.prices?.[h.ticker]
      if (!quote?.prevClose) continue
      const fx = convertToBase(1, quote.currency, data.fxRates, todayBase) ?? 1
      const move = h.shares * (quote.price - quote.prevClose) * fx
      if (!Number.isFinite(move) || move === 0) continue
      total += move
      contributors.push({
        id: h.id,
        ticker: h.ticker,
        name: h.name,
        move,
        pct: quote.prevClose ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : 0,
      })
      if (!asOf || (quote.prevCloseAsOf && quote.prevCloseAsOf > asOf)) asOf = quote.prevCloseAsOf ?? asOf
    }
    const gainers = contributors.filter((c) => c.move > 0).sort((a, b) => b.move - a.move)
    const losers = contributors.filter((c) => c.move < 0).sort((a, b) => a.move - b.move)
    const today = contributors.length > 0
      ? { total, asOf, gainers, losers, base: todayBase }
      : null

    return { base, movements, bestDay, worstDay, totalCaptured, today }
  }, [data, selectedOwner, selectedCountry])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load movements" body={(error as Error).message} /></PageBody>

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T12:00:00Z')
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return (
    <>
      <PageHeader
        title="Daily market movement"
        subtitle="How your portfolio moved each trading day based on price changes."
        right={
          <Link to="/" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        }
      />
      <PageBody>
        {movements.length === 0 ? (
          <EmptyState
            title="No movement data yet"
            body="Prices are captured automatically at 21:30 UTC on trading days. You can also trigger a manual refresh from the dashboard."
          />
        ) : (
          <>
            {today && (() => {
              const up = today.total >= 0
              const cRow = (c: Contributor) => (
                <div key={c.id} className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 ${is3d ? 'hover:bg-indigo-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{c.ticker}</div>
                    <div className="truncate text-[11px] text-slate-500">{c.name}</div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <div className={`text-sm font-semibold ${c.move >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {c.move >= 0 ? '+' : ''}{formatMoney(c.move, today.base)}
                    </div>
                    <div className={`text-[11px] ${c.move >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>{formatPercent(c.pct)}</div>
                  </div>
                </div>
              )
              return (
                <Card tone="elevated">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Latest day — who moved it</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Per-holding contribution{today.asOf ? ` vs close ${fmtDate(today.asOf)}` : ''}. Sums to the total.
                      </p>
                    </div>
                    <div className={`shrink-0 text-right text-2xl font-semibold tabular-nums ${up ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {up ? '+' : ''}{formatMoney(today.total, today.base)}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
                        <TrendingUp className="h-3.5 w-3.5" /> Gainers ({today.gainers.length})
                      </div>
                      {today.gainers.length > 0
                        ? <div className="max-h-64 overflow-y-auto">{today.gainers.map(cRow)}</div>
                        : <p className="px-2.5 py-1.5 text-xs text-slate-400">None up on the day.</p>}
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-rose-500">
                        <TrendingDown className="h-3.5 w-3.5" /> Losers ({today.losers.length})
                      </div>
                      {today.losers.length > 0
                        ? <div className="max-h-64 overflow-y-auto">{today.losers.map(cRow)}</div>
                        : <p className="px-2.5 py-1.5 text-xs text-slate-400">None down on the day.</p>}
                    </div>
                  </div>
                </Card>
              )
            })()}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card tone="elevated">
                <div className="text-xs uppercase tracking-wider text-slate-500">Captured total</div>
                <div className={`mt-2 text-2xl font-semibold tabular-nums ${totalCaptured >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {formatMoney(totalCaptured, base)}
                </div>
                <div className="mt-1 text-xs text-slate-500">{movements.length} days recorded</div>
              </Card>
              <Card tone="elevated">
                <div className="text-xs uppercase tracking-wider text-slate-500">Best day</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-500">
                  {bestDay ? formatMoney(bestDay.movementGBP, base) : '—'}
                </div>
                <div className="mt-1 text-xs text-slate-500">{bestDay ? fmtDate(bestDay.date) : ''}</div>
              </Card>
              <Card tone="elevated">
                <div className="text-xs uppercase tracking-wider text-slate-500">Worst day</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-500">
                  {worstDay ? formatMoney(worstDay.movementGBP, base) : '—'}
                </div>
                <div className="mt-1 text-xs text-slate-500">{worstDay ? fmtDate(worstDay.date) : ''}</div>
              </Card>
            </div>

            <Card tone="elevated">
              <h3 className="text-sm font-semibold">Daily P&amp;L — last {movements.length} days</h3>
              <p className="mt-1 text-xs text-slate-500">
                Each bar is (close − prev close) × shares × FX. Gaps are days with no price capture.
              </p>
              <div className="mt-4 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={movements} barCategoryGap="30%">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={is3d ? 'rgba(99,102,241,0.35)' : 'rgba(148,163,184,0.2)'}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtDate}
                      stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                      fontSize={11}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      width={92}
                      stroke={is3d ? '#c7d2fe' : '#94a3b8'}
                      fontSize={11}
                      tickFormatter={(v: number) => formatMoney(v, base)}
                    />
                    <ReferenceLine y={0} stroke={is3d ? 'rgba(199,210,254,0.4)' : 'rgba(148,163,184,0.5)'} />
                    <Tooltip
                      formatter={(v: number) => [formatMoney(v, base), 'Movement']}
                      labelFormatter={fmtDate}
                      contentStyle={
                        is3d
                          ? { background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(129,140,248,0.45)', borderRadius: 12, boxShadow: '0 10px 30px rgba(99,102,241,0.35)' }
                          : undefined
                      }
                    />
                    <Bar dataKey="movementGBP" name="Movement" radius={[3, 3, 0, 0]}>
                      {movements.map((m, i) => (
                        <Cell
                          key={i}
                          fill={
                            m.movementGBP >= 0
                              ? (is3d ? '#34d399' : '#10b981')
                              : (is3d ? '#f87171' : '#ef4444')
                          }
                          style={is3d ? { filter: `drop-shadow(0 0 4px ${m.movementGBP >= 0 ? 'rgba(52,211,153,0.6)' : 'rgba(248,113,113,0.6)'})` } : undefined}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </>
        )}
      </PageBody>
    </>
  )
}
