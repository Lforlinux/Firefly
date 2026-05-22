import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio } from '@/utils/calculations'
import { formatMoney, formatPercent, formatShares } from '@/utils/format'
import { jsonFetch } from '@/services/api'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'

type Range = '1M' | '3M' | '6M' | '1Y'
const RANGES: Range[] = ['1M', '3M', '6M', '1Y']

interface PricePoint { date: string; close: number }
interface HistoryResponse { data: PricePoint[]; currency: string; ticker: string }

export function AssetDetail() {
  const { ticker } = useParams<{ ticker: string }>()
  const [range, setRange] = useState<Range>('3M')
  const { data, isLoading: portfolioLoading } = usePortfolio()
  const { privacyMode } = useUi()

  const { data: history, isLoading: historyLoading, error: historyError } = useQuery({
    queryKey: ['priceHistory', ticker, range],
    queryFn: () => jsonFetch<HistoryResponse>(`/api/prices/history?ticker=${encodeURIComponent(ticker!)}&range=${range}`),
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const { row, base, priceQuote, transactions } = useMemo(() => {
    if (!data || !ticker) return { row: null, base: 'GBP', priceQuote: null, transactions: [] }
    const base = data.settings.baseCurrency || 'GBP'
    const built = buildPortfolio(data.holdings, data.prices, data.fxRates, base)
    const row = built.rows.find((r) => r.ticker.toUpperCase() === ticker.toUpperCase()) ?? null
    const priceQuote = data.prices[ticker.toUpperCase()] ?? data.prices[ticker] ?? null
    const transactions = (data.transactions || [])
      .filter((t) => t.ticker.toUpperCase() === ticker.toUpperCase())
      .sort((a, b) => b.date.localeCompare(a.date))
    return { row, base, priceQuote, transactions }
  }, [data, ticker])

  const chartColor = useMemo(() => {
    if (!history?.data?.length) return '#10b981'
    const first = history.data[0].close
    const last = history.data[history.data.length - 1].close
    return last >= first ? '#10b981' : '#ef4444'
  }, [history])

  const rangeChange = useMemo(() => {
    if (!history?.data?.length) return null
    const first = history.data[0].close
    const last = history.data[history.data.length - 1].close
    return { amount: last - first, pct: first > 0 ? (last - first) / first : 0 }
  }, [history])

  const fmtDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  const backLink = (
    <Link
      to="/assets"
      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
    >
      <ArrowLeft className="h-4 w-4" />
      Assets
    </Link>
  )

  if (portfolioLoading) return <Loading />

  if (!row) {
    return (
      <>
        <PageHeader title={ticker || 'Asset'} right={backLink} />
        <PageBody>
          <EmptyState title="Holding not found" body={`No holding found for ticker "${ticker}".`} />
        </PageBody>
      </>
    )
  }

  const ccy = history?.currency || row.livePriceCcy || base
  const dayChange = (row.livePrice != null && priceQuote?.prevClose != null)
    ? row.livePrice - priceQuote.prevClose
    : null
  const dayChangePct = dayChange != null && (priceQuote?.prevClose ?? 0) > 0
    ? dayChange / priceQuote!.prevClose!
    : null

  return (
    <>
      <PageHeader title="" right={backLink} />
      <PageBody>
        {/* Hero header */}
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-50">{row.ticker}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {row.type}
            </span>
          </div>
          <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{row.name}</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
              {row.livePrice != null ? formatMoney(row.livePrice, ccy, 2) : '—'}
            </span>
            {dayChange != null && dayChangePct != null && (
              <span className={`text-sm font-medium tabular-nums ${dayChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {dayChange >= 0 ? '+' : ''}{formatMoney(dayChange, ccy, 2)}&ensp;
                ({dayChange >= 0 ? '+' : ''}{formatPercent(dayChangePct)}) today
              </span>
            )}
          </div>
        </div>

        {/* Price history chart */}
        <Card tone="elevated">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Price history</h3>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    range === r
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {rangeChange && !historyLoading && !historyError && (
            <div className={`mb-3 text-sm font-medium tabular-nums ${rangeChange.amount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {rangeChange.amount >= 0 ? '▲' : '▼'}&ensp;
              {formatMoney(Math.abs(rangeChange.amount), ccy, 2)}&ensp;
              ({rangeChange.amount >= 0 ? '+' : ''}{formatPercent(rangeChange.pct)}) over {range}
            </div>
          )}

          <div className="h-72">
            {historyLoading ? (
              <Loading label="Loading price history…" />
            ) : historyError || !history?.data?.length ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-slate-400">
                  {historyError
                    ? 'Price history unavailable for this holding (mutual fund / provident fund tickers are not supported).'
                    : 'No price data in this range.'}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`grad-${row.ticker}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartColor} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    stroke="#94a3b8"
                    fontSize={11}
                    interval="preserveStartEnd"
                    tickLine={false}
                  />
                  <YAxis
                    width={84}
                    stroke="#94a3b8"
                    fontSize={11}
                    tickFormatter={(v: number) => formatMoney(v, ccy, 2)}
                    domain={['auto', 'auto']}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatMoney(v, ccy, 2), 'Price']}
                    labelFormatter={fmtDate}
                    contentStyle={{ borderRadius: 8 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill={`url(#grad-${row.ticker})`}
                    dot={false}
                    activeDot={{ r: 4, fill: chartColor, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Current value"
            value={privacyMode ? '••••' : formatMoney(row.valueBase, base)}
          />
          <StatCard
            label="Cost basis"
            value={privacyMode ? '••••' : formatMoney(row.costBase, base)}
          />
          <StatCard
            label="Total gain / loss"
            value={privacyMode ? '••••' : (row.gainLoss >= 0 ? '+' : '') + formatMoney(row.gainLoss, base)}
            sub={!privacyMode && !row.valueIsCost ? formatPercent(row.gainLossPct) : undefined}
            tone={row.valueIsCost ? undefined : row.gainLoss >= 0 ? 'gain' : 'loss'}
          />
          <StatCard
            label="Portfolio weight"
            value={`${(row.weight * 100).toFixed(1)}%`}
            sub={`${formatShares(row.shares)} shares`}
          />
        </div>

        {/* Transactions */}
        {transactions.length > 0 && (
          <Card tone="elevated">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Transactions
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {transactions.slice(0, 25).map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                      t.side === 'buy'      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : t.side === 'sell'  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                      : t.side === 'dividend' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {t.side}
                    </span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">{fmtDate(t.date)}</span>
                  </div>
                  <div className="text-right text-sm text-slate-900 dark:text-slate-100">
                    <span className="tabular-nums">
                      {formatShares(t.shares)} @ {formatMoney(t.price, t.currency, 2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'gain' | 'loss'
}) {
  return (
    <Card tone="elevated">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1.5 text-lg font-semibold tabular-nums ${
        tone === 'gain' ? 'text-emerald-500'
        : tone === 'loss' ? 'text-rose-500'
        : 'text-slate-900 dark:text-slate-50'
      }`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  )
}
