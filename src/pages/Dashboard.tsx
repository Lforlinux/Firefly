import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { formatMoney, formatPercent } from '@/utils/format'
import { currentValue, gainLossPercent, fireNumber, monthsOfExpensesCovered } from '@/utils/calculations'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts'
import { TrendingUp, Wallet, Shield, Flame, ArrowUpRight, ArrowDownRight, ArrowUp, ArrowDown } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/Tabs'
import { getTickerForHolding } from '@/services/priceApi'
import type { Holding } from '@/types'

const PIE_COLORS = ['#4A90E2', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4']

/** When viewing "All", group holdings by name and return one row per fund with combined value and G/L %. */
function aggregateHoldingsByName(holdings: Holding[]): Holding[] {
  const byKey = new Map<
    string,
    { totalValue: number; totalInvested: number; first: Holding }
  >()
  for (const h of holdings) {
    const key = (h.name || h.symbol).trim().toLowerCase() || h.id
    const val = currentValue(h.unitPrice, h.units)
    const cost = h.averageCost * h.units
    const cur = byKey.get(key)
    if (!cur) {
      byKey.set(key, { totalValue: val, totalInvested: cost, first: h })
    } else {
      cur.totalValue += val
      cur.totalInvested += cost
    }
  }
  return [...byKey.entries()].map(([key, { totalValue, totalInvested, first }]) => ({
    ...first,
    id: `agg-${key}`,
    name: first.name,
    symbol: first.symbol,
    units: 1,
    unitPrice: totalValue,
    averageCost: totalInvested,
  }))
}

export function Dashboard() {
  const {
    ukHoldings,
    selectedPortfolio,
    totalPortfolioHistory,
    recordUkPortfolioSnapshot,
    recordTotalPortfolioSnapshot,
    updateHoldingPrice,
    getCashAddedDate,
    annualExpensesGBP,
    budgets,
    emergencyFund,
  } = useApp()

  const displayHoldings: Holding[] = useMemo(() => {
    if (selectedPortfolio === 'all') return ukHoldings
    return ukHoldings.filter((h) => (h.owner ?? 'KLN') === selectedPortfolio)
  }, [ukHoldings, selectedPortfolio])
  const portfolioLabel = selectedPortfolio === 'all' ? 'Dashboard' : selectedPortfolio

  /** For the Holdings tab table: when "All", show one row per fund (combined); otherwise per-holding. */
  const holdingsTableList = useMemo(() => {
    if (selectedPortfolio === 'all') return aggregateHoldingsByName(displayHoldings)
    return displayHoldings
  }, [selectedPortfolio, displayHoldings])

  const [holdingsSort, setHoldingsSort] = useState<{ key: 'value' | 'glpct'; dir: 'asc' | 'desc' }>({ key: 'value', dir: 'desc' })
  const sortedHoldings = useMemo(() => {
    const list = [...holdingsTableList]
    if (holdingsSort.key === 'value') {
      list.sort((a, b) => {
        const va = currentValue(a.unitPrice, a.units)
        const vb = currentValue(b.unitPrice, b.units)
        return holdingsSort.dir === 'asc' ? va - vb : vb - va
      })
    } else {
      list.sort((a, b) => {
        const pa = gainLossPercent(currentValue(a.unitPrice, a.units), a.averageCost * a.units)
        const pb = gainLossPercent(currentValue(b.unitPrice, b.units), b.averageCost * b.units)
        return holdingsSort.dir === 'asc' ? pa - pb : pb - pa
      })
    }
    return list
  }, [holdingsTableList, holdingsSort])

  const monthlyExpensesFromBudget = budgets.uk.reduce((s, b) => s + b.amount, 0)

  const ukTotal = ukHoldings.reduce((sum, h) => sum + currentValue(h.unitPrice, h.units), 0)
  const ukInvested = ukHoldings.reduce((sum, h) => sum + h.averageCost * h.units, 0)

  const displayTotalValue = displayHoldings.reduce((sum, h) => sum + currentValue(h.unitPrice, h.units), 0)
  const displayInvested = displayHoldings.reduce((sum, h) => sum + h.averageCost * h.units, 0)
  const grandTotalGBP = displayTotalValue
  const displayGain = displayTotalValue - displayInvested
  const displayGainPct = gainLossPercent(displayTotalValue, displayInvested)

  useEffect(() => {
    recordUkPortfolioSnapshot(ukInvested)
  }, [ukInvested, recordUkPortfolioSnapshot])
  useEffect(() => {
    recordTotalPortfolioSnapshot(ukInvested)
  }, [ukInvested, recordTotalPortfolioSnapshot])

  const ukXirr = gainLossPercent(ukTotal, ukInvested)

  const monthlyExpensesGBP = annualExpensesGBP / 12
  const emergencyBalanceFromCash = ukHoldings
    .filter((h) => h.category === 'Cash' || h.symbol === 'CASH')
    .reduce((s, h) => s + currentValue(h.unitPrice, h.units), 0)
  const emergencyTarget = monthlyExpensesFromBudget * emergencyFund.targetMonths
  const emergencyPct = emergencyTarget > 0 ? (emergencyBalanceFromCash / emergencyTarget) * 100 : 0

  const fire30xGBP = fireNumber(annualExpensesGBP, 30)
  const fireProgressGBP = (grandTotalGBP / fire30xGBP) * 100

  const curr: 'GBP' = 'GBP'
  const displayTotal = grandTotalGBP

  const todayStr = new Date().toISOString().slice(0, 10)
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  const [apiSnapshots, setApiSnapshots] = useState<{ date: string; valueGBP: number }[]>([])
  useEffect(() => {
    fetch('/api/snapshots')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => (Array.isArray(data) ? setApiSnapshots(data) : null))
      .catch(() => {})
  }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/sync-holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ukHoldings }),
      }).catch(() => {})
    }, 2000)
    return () => clearTimeout(t)
  }, [ukHoldings])

  useEffect(() => {
    fetch('/api/cached-prices')
      .then((r) => (r.ok ? r.json() : { prices: {} }))
      .then((data: { prices?: Record<string, number> }) => {
        const prices = data?.prices ?? {}
        if (Object.keys(prices).length === 0) return
        ukHoldings.forEach((h) => {
          if (h.category === 'Cash' || h.symbol === 'CASH') return
          const ticker = getTickerForHolding(h.symbol, h.exchange)
          const price = prices[ticker]
          if (price != null && price > 0 && price !== h.unitPrice) {
            updateHoldingPrice('uk', h.id, price)
          }
        })
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply server cache once on mount
  }, [])

  const allocationData = [
    { name: 'Equity', value: 65, color: PIE_COLORS[0] },
    { name: 'Debt/Fixed', value: 14, color: PIE_COLORS[1] },
    { name: 'Gold', value: 8, color: PIE_COLORS[2] },
    { name: 'Cash', value: 8, color: PIE_COLORS[3] },
    { name: 'Other', value: 5, color: PIE_COLORS[4] },
  ]

  const cashHoldings = displayHoldings.filter((h) => h.category === 'Cash' || h.symbol === 'CASH')
  const toYYYYMMDD = (s: string): string => {
    const t = s.trim()
    if (!t) return todayStr
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
    const d = new Date(t)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return todayStr
  }
  const effectiveAddedDate = (h: (typeof cashHoldings)[0]): string => {
    const fromHolding = h.addedDate && h.addedDate.trim() !== '' ? toYYYYMMDD(h.addedDate) : ''
    const fromState = getCashAddedDate?.(h) ? toYYYYMMDD(getCashAddedDate(h) ?? '') : ''
    const resolved = fromHolding || fromState || todayStr
    return toYYYYMMDD(resolved)
  }
  const cashAddedByDate = (date: string) =>
    cashHoldings
      .filter((h) => effectiveAddedDate(h) <= date)
      .reduce((s, h) => s + h.averageCost * h.units, 0)
  /** Cash added on dates strictly before a given date (excluded from cost-basis comparison so past deposits aren't "today's gain") */
  const cashAddedBefore = (date: string) =>
    cashHoldings
      .filter((h) => effectiveAddedDate(h) < date)
      .reduce((s, h) => s + h.averageCost * h.units, 0)
  const baseValueAt = (date: string) => {
    const prev = totalPortfolioHistory.filter((p) => p.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0]
    return prev ? prev.valueGBP : 0
  }
  const dayBefore = (date: string) => {
    const d = new Date(date + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }
  const displayPoints = (() => {
    const byDate = new Map<string, number>()
    for (const p of totalPortfolioHistory) {
      const value = p.date === todayStr ? p.valueGBP : p.valueGBP + cashAddedByDate(p.date)
      byDate.set(p.date, value)
    }
    for (const p of apiSnapshots) {
      byDate.set(p.date, p.valueGBP)
    }
    for (const h of cashHoldings) {
      const d = effectiveAddedDate(h)
      const dayBeforeD = dayBefore(d)
      if (d !== todayStr) {
        byDate.set(d, baseValueAt(d) + cashAddedByDate(d))
      }
      if (!byDate.has(dayBeforeD)) {
        byDate.set(dayBeforeD, baseValueAt(dayBeforeD) + cashAddedByDate(dayBeforeD))
      }
    }
    byDate.set(todayStr, displayTotalValue)
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, valueGBP]) => ({
        date,
        valueGBP,
      }))
  })()
  const yesterdayValueFromApi = apiSnapshots.find((p) => p.date === yesterdayStr)?.valueGBP
  const todaySnapshot = totalPortfolioHistory.find((p) => p.date === todayStr)
  const yesterdaySnapshot = totalPortfolioHistory.find((p) => p.date === yesterdayStr)
  const yesterdayValueForComparison =
    selectedPortfolio === 'all' && yesterdayValueFromApi != null
      ? yesterdayValueFromApi
      : yesterdaySnapshot
        ? yesterdaySnapshot.valueGBP - cashAddedBefore(yesterdayStr)
        : 0
  const todayValueForComparison =
    selectedPortfolio === 'all'
      ? displayTotalValue
      : todaySnapshot
        ? todaySnapshot.valueGBP - cashAddedBefore(todayStr)
        : 0
  const hasYesterdayAndToday =
    selectedPortfolio === 'all'
      ? yesterdayValueFromApi != null && yesterdayValueFromApi > 0
      : Boolean(todaySnapshot && yesterdaySnapshot)
  const todayChange = hasYesterdayAndToday ? todayValueForComparison - yesterdayValueForComparison : 0
  const todayChangePct =
    hasYesterdayAndToday && yesterdayValueForComparison > 0
      ? (todayChange / yesterdayValueForComparison) * 100
      : 0
  const chartData = displayPoints.map((p) => ({
    label: new Date(p.date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
    total: p.valueGBP,
  }))

  // Monthly table: last point per month, then growth vs previous month
  const monthlyGrowthTable = (() => {
    const lastInMonth = new Map<string, { date: string; valueGBP: number }>()
    for (const p of displayPoints) {
      const month = p.date.slice(0, 7)
      const cur = lastInMonth.get(month)
      if (!cur || p.date > cur.date) lastInMonth.set(month, { date: p.date, valueGBP: p.valueGBP })
    }
    const months = [...lastInMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return months.map(([ym, { valueGBP }], i) => {
      const prev = i > 0 ? months[i - 1][1].valueGBP : 0
      const growthGBP = valueGBP - prev
      const growthPct = prev > 0 ? (growthGBP / prev) * 100 : 0
      return {
        month: ym,
        label: new Date(ym + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        valueGBP,
        valueDisplay: valueGBP,
        growthGBP,
        growthDisplay: growthGBP,
        growthPct,
      }
    })
  })()

  // Same calculation as Portfolio growth (total): displayPoints (totalPortfolioHistory + cash by date).
  // Force last point to cost basis (ukInvested) so chart matches History and never shows current-value spike.
  const ukGrowthData = (() => {
    const arr = displayPoints.map((p) => ({
      date: p.date,
      label: new Date(p.date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      value: p.valueGBP,
    }))
    const last = arr[arr.length - 1]
    if (last && last.date === todayStr) {
      arr[arr.length - 1] = { ...last, value: ukInvested }
    }
    return arr
  })()

  const byOwner = (() => {
    type OwnerKey = 'KLN' | 'Priya' | 'Other'
    const sum: Record<OwnerKey, number> = { KLN: 0, Priya: 0, Other: 0 }
    for (const h of displayHoldings) {
      const v = currentValue(h.unitPrice, h.units)
      const key: OwnerKey = h.owner === 'Priya' ? 'Priya' : h.owner === 'KLN' ? 'KLN' : 'Other'
      sum[key] += v
    }
    const total = sum.KLN + sum.Priya + sum.Other
    if (total <= 0) return []
    const colors: Record<OwnerKey, string> = {
      KLN: '#14B8A6',
      Priya: '#D4A84B',
      Other: '#94A3B8',
    }
    const labels: Record<OwnerKey, string> = {
      KLN: 'KLN',
      Priya: 'Priya',
      Other: 'Other',
    }
    return (['KLN', 'Priya', 'Other'] as const)
      .filter((k) => sum[k] > 0)
      .map((k) => ({
        name: labels[k],
        value: Math.round(sum[k] * 100) / 100,
        pct: total > 0 ? (sum[k] / total) * 100 : 0,
        color: colors[k],
      }))
  })()

  type BrokerKey = 'InvestEngine' | 'Trading212' | 'Cash' | 'Other'
  const byBroker = (() => {
    const sum: Record<BrokerKey, number> = { InvestEngine: 0, Trading212: 0, Cash: 0, Other: 0 }
    for (const h of displayHoldings) {
      const v = currentValue(h.unitPrice, h.units)
      const key: BrokerKey =
        h.category === 'Cash' || h.symbol === 'CASH'
          ? 'Cash'
          : h.broker === 'Trading212'
            ? 'Trading212'
            : h.broker === 'InvestEngine'
              ? 'InvestEngine'
              : 'Other'
      sum[key] += v
    }
    const total = sum.InvestEngine + sum.Trading212 + sum.Cash + sum.Other
    if (total <= 0) return []
    const colors: Record<BrokerKey, string> = {
      InvestEngine: '#4A90E2',
      Trading212: '#7C3AED',
      Cash: '#0D9488',
      Other: '#94A3B8',
    }
    const labels: Record<BrokerKey, string> = {
      InvestEngine: 'InvestEngine',
      Trading212: 'Trading 212',
      Cash: 'Cash',
      Other: 'Other',
    }
    return (['InvestEngine', 'Trading212', 'Cash', 'Other'] as const)
      .filter((k) => sum[k] > 0)
      .map((k) => ({
        name: labels[k],
        value: Math.round(sum[k] * 100) / 100,
        pct: total > 0 ? (sum[k] / total) * 100 : 0,
        color: colors[k],
      }))
  })()

  const displayTotalFormatted = displayTotalValue
  const todayChangeDisplay = todayChange

  /** Overview chart data: same as displayPoints, with short label for axis (Ghostfolio-style) */
  const overviewChartData = displayPoints.map((p) => ({
    date: p.date,
    label: new Date(p.date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
    value: p.valueGBP,
  }))

  return (
    <div className="min-h-screen text-gray-900">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold text-gray-900">{portfolioLabel}</h1>
      </header>

      <Tabs defaultValue="overview">
        <div className="border-b border-gray-200 px-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-4 w-full min-w-0">
          <TabsContent value="overview">
            <div className="mx-auto max-w-3xl">
              <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
                {overviewChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={overviewChartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <defs>
                        <linearGradient id="overviewGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#14B8A6" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#14B8A6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        formatter={(v: number) => [formatMoney(Number(v), 'GBP'), 'Portfolio']}
                        labelFormatter={(label) => label}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#14B8A6"
                        strokeWidth={2}
                        fill="url(#overviewGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500">
                    Add holdings and open the dashboard (or import CSV) to build your chart.
                  </div>
                )}
              </div>
              <div className="mt-4">
                <p className="text-3xl font-bold text-gray-900">
                  {formatMoney(displayTotalFormatted, curr)}
                </p>
                <p className="text-xs text-gray-500 mb-1">Current value</p>
                {selectedPortfolio === 'all' && hasYesterdayAndToday ? (
                  <p className={`text-lg font-semibold ${todayChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {todayChange >= 0 ? '+' : ''}{formatMoney(todayChangeDisplay, curr)} ({formatPercent(todayChangePct)})
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">—</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="today">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Portfolio</p>
                <p className="text-xl font-bold text-gray-900">{portfolioLabel}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatMoney(displayTotalFormatted, curr)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Current value</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Today&apos;s gain</p>
                <p className={`text-xl font-bold flex items-center gap-1 ${selectedPortfolio === 'all' && hasYesterdayAndToday ? (todayChange >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-500'}`}>
                  {selectedPortfolio === 'all' && hasYesterdayAndToday ? (
                    <>
                      {todayChange >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                      {`${todayChange >= 0 ? '' : ''}${formatMoney(todayChangeDisplay, curr)} (${formatPercent(todayChangePct)})`}
                    </>
                  ) : (
                    '—'
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {selectedPortfolio === 'all'
                    ? hasYesterdayAndToday
                      ? 'Market movement vs yesterday (EOD from server)'
                      : 'Server records snapshot at 23:59. Tomorrow you’ll see day-over-day change'
                    : 'Per-portfolio history not tracked'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Unrealised gain</p>
                <p className={`text-xl font-bold flex items-center gap-1 ${displayGain >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {displayGain >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                  {formatMoney(displayGain, curr)} ({formatPercent(displayGainPct)})
                </p>
                <p className="text-xs text-gray-500 mt-1">Value vs cost basis</p>
              </div>
            </div>

            {byBroker.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Asset allocation</h2>
                <p className="text-xs text-gray-500 mb-2">As on {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm min-h-[200px]">
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1 min-h-[200px]">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={byBroker}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                            nameKey="name"
                          >
                            {byBroker.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string, props: { payload?: { pct?: number } }) => [
                              `${formatMoney(value, curr)} (${(props.payload?.pct ?? 0).toFixed(1)}%)`,
                              name,
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col justify-center gap-1">
                      <p className="text-lg font-bold text-gray-900">{formatMoney(displayTotalFormatted, curr)}</p>
                      <p className="text-xs text-gray-500">Current value</p>
                      {byBroker.map((entry, i) => (
                        <span key={i} className="text-sm flex items-center gap-2" style={{ color: entry.color }}>
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                          {entry.name} {entry.pct.toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {displayHoldings.length === 0 && (
              <p className="text-sm text-gray-500 py-6">No holdings yet. Add holdings in Portfolio.</p>
            )}
          </TabsContent>

          <TabsContent value="holdings">
            {displayHoldings.length > 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="p-3 font-medium">Name</th>
                      <th className="p-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setHoldingsSort((s) =>
                              s.key === 'value' ? { key: 'value', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'value', dir: 'desc' }
                            )
                          }
                          className="inline-flex items-center gap-1 hover:text-gray-900"
                        >
                          Value
                          {holdingsSort.key === 'value' &&
                            (holdingsSort.dir === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />)}
                        </button>
                      </th>
                      <th className="p-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setHoldingsSort((s) =>
                              s.key === 'glpct' ? { key: 'glpct', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'glpct', dir: 'desc' }
                            )
                          }
                          className="inline-flex items-center gap-1 hover:text-gray-900"
                        >
                          G/L %
                          {holdingsSort.key === 'glpct' &&
                            (holdingsSort.dir === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />)}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHoldings.map((h) => {
                      const val = currentValue(h.unitPrice, h.units)
                      const cost = h.averageCost * h.units
                      const pct = gainLossPercent(val, cost)
                      return (
                        <tr key={h.id} className="border-t border-gray-100">
                          <td className="p-3 font-medium">{h.symbol || h.name}</td>
                          <td className="p-3 text-right">{formatMoney(val, curr)}</td>
                          <td className={`p-3 text-right ${pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatPercent(pct)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="p-3 border-t border-gray-100 bg-gray-50">
                  <Link to="/investments" className="text-sm font-medium text-primary hover:underline">
                    Edit holdings →
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-6">No holdings. <Link to="/investments" className="text-primary font-medium">Add in Portfolio</Link>.</p>
            )}
          </TabsContent>

          <TabsContent value="performance">
            <section className="space-y-4 mb-6">
              <Card title="Portfolio" icon={<Wallet className="h-5 w-5" />}>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoney(displayTotalFormatted, curr)}
                </p>
                <p className={`text-sm ${ukXirr >= 0 ? 'text-success' : 'text-error'}`}>
                  XIRR {formatPercent(ukXirr)}
                </p>
              </Card>
              <Card title="Grand Total" icon={<TrendingUp className="h-5 w-5" />} highlight>
                <p className="text-2xl font-bold text-gray-900">
                  {formatMoney(displayTotal, curr)}
                </p>
                <p className="text-sm text-gray-500">
                  Today: {selectedPortfolio === 'all' && hasYesterdayAndToday
                    ? `${todayChange >= 0 ? '+' : ''}${formatMoney(todayChangeDisplay, curr)} (${formatPercent(todayChangePct)})`
                    : '—'}
                </p>
              </Card>
              <Card title="Emergency Fund" icon={<Shield className="h-5 w-5" />}>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoney(emergencyBalanceFromCash, 'GBP')} / {formatMoney(emergencyTarget, 'GBP')}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">From Cash holdings</p>
                <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${emergencyPct >= 100 ? 'bg-success' : emergencyPct >= 66 ? 'bg-warning' : 'bg-error'}`}
                    style={{ width: `${Math.min(emergencyPct, 100)}%` }}
                  />
                </div>
              </Card>
            </section>

            {byBroker.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Portfolio by broker</h2>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm min-h-[200px]">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Pie
                        data={byBroker}
                        cx="50%"
                        cy="45%"
                        innerRadius={0}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, pct }) => `${name} ${pct.toFixed(0)}%`}
                        labelLine
                      >
                        {byBroker.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string, props: { payload?: { pct?: number } }) => [
                          `${formatMoney(value, curr)} (${(props.payload?.pct ?? 0).toFixed(1)}%)`,
                          name,
                        ]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

                  {byOwner.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Portfolio by owner</h2>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm min-h-[200px]">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Pie
                        data={byOwner}
                        cx="50%"
                        cy="45%"
                        innerRadius={0}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, pct }) => `${name} ${pct.toFixed(0)}%`}
                        labelLine
                      >
                        {byOwner.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string, props: { payload?: { pct?: number } }) => [
                          `${formatMoney(value, curr)} (${(props.payload?.pct ?? 0).toFixed(1)}%)`,
                          name,
                        ]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-600">
                  {byOwner.map((entry, i) => (
                    <span key={i} style={{ color: entry.color }}>
                      {entry.name} {entry.pct.toFixed(0)}%
                    </span>
                  ))}
                </div>
                </div>
              </section>
            )}

            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">UK investment growth</h2>
              <p className="text-xs text-gray-500 mb-3">Cost basis (amount invested) over time — same data as Portfolio growth (total).</p>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm min-h-[240px]">
                {ukGrowthData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={ukGrowthData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <defs>
                        <linearGradient id="ukGrowthGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4A90E2" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#4A90E2" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(value: number) => [formatMoney(Number(value), 'GBP'), 'UK portfolio']}
                        labelFormatter={(label) => label}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#4A90E2"
                        strokeWidth={2}
                        fill="url(#ukGrowthGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                    Visit the dashboard or import broker CSV to build your UK growth chart.
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2 text-center">
                  Current value: {formatMoney(ukTotal, curr)}
                  {' · '}Points from CSV trade dates or once per day when you open the dashboard.
                </p>
              </div>
            </section>

            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">FIRE Progress</h2>
              <div className="grid grid-cols-2 gap-3">
                <Card title="UK (£1M goal)" icon={<Flame className="h-5 w-5" />}>
                  <p className="text-lg font-semibold text-gray-900">{(grandTotalGBP / 1_000_000 * 100).toFixed(1)}%</p>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(grandTotalGBP / 1_000_000 * 100, 100)}%` }} />
                  </div>
                </Card>
                <Card title="Standard FIRE (30x)" icon={<Flame className="h-5 w-5" />}>
                  <p className="text-lg font-semibold text-gray-900">{fireProgressGBP.toFixed(1)}%</p>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(fireProgressGBP, 100)}%` }} />
                  </div>
                </Card>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Months of expenses covered: {monthsOfExpensesCovered(grandTotalGBP, monthlyExpensesGBP).toFixed(1)}
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Portfolio growth (total)</h2>
              <p className="text-xs text-gray-500 mb-3">Cost basis (amount invested) over time. Import broker CSV so steps align with investment dates.</p>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm min-h-[200px]">
                {chartData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={chartData}>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: number) => [formatMoney(v, 'GBP'), 'Total']} />
                        <Line type="monotone" dataKey="total" stroke="#4A90E2" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      Current total: {formatMoney(displayTotal, curr)} · Points from CSV trade dates or once per day when you open the dashboard.
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-500 text-sm text-center">
                    <p>Visit the dashboard over time to build your total portfolio chart.</p>
                    <p className="text-xs mt-2">Current total: {formatMoney(displayTotal, curr)}</p>
                  </div>
                )}
              </div>
            </section>

            {monthlyGrowthTable.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Growth by month</h2>
                <p className="text-xs text-gray-500 mb-3">Amount (cost basis) at end of month and growth vs previous month.</p>
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
                        <tr>
                          <th className="p-3 font-medium">Month</th>
                          <th className="p-3 font-medium text-right">Amount</th>
                          <th className="p-3 font-medium text-right">Growth</th>
                          <th className="p-3 font-medium text-right">Growth %</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-900">
                        {monthlyGrowthTable.map((row) => (
                          <tr key={row.month} className="border-t border-gray-100">
                            <td className="p-3">{row.label}</td>
                            <td className="p-3 text-right font-medium">{formatMoney(row.valueDisplay, curr)}</td>
                            <td className={`p-3 text-right ${row.growthGBP >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {row.growthGBP >= 0 ? '+' : ''}{formatMoney(row.growthDisplay, curr)}
                            </td>
                            <td className={`p-3 text-right ${row.growthPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {row.growthPct >= 0 ? '+' : ''}{formatPercent(row.growthPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Current vs ideal allocation</h2>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm min-h-[200px]">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <Pie
                      data={allocationData}
                      cx="50%"
                      cy="45%"
                      innerRadius={52}
                      outerRadius={72}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      label={false}
                    >
                      {allocationData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [`${value}%`, 'Allocation']} contentStyle={{ fontSize: 12 }} />
                    <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-600">
                  {allocationData.map((entry, i) => (
                    <span key={i} style={{ color: entry.color }}>
                      {entry.name} {entry.value}%
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

function Card({
  title,
  icon,
  children,
  highlight,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-xl p-4 shadow-sm border ${
        highlight
          ? 'border-primary/30 bg-primary/5 dark:bg-primary/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
      }`}
    >
      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 mb-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>
      {children}
    </div>
  )
}

