import { useEffect, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { formatMoney, formatPercent } from '@/utils/format'
import { currentValue, gainLossPercent, fireNumber, monthsOfExpensesCovered } from '@/utils/calculations'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, Shield, Flame, ArrowUpRight, ArrowDownRight, PieChart as PieIcon, BarChart3, RefreshCw, Clock } from 'lucide-react'
import type { Holding } from '@/types'

const PIE_COLORS = ['#6366F1', '#22C55E', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6']

// Map fund names to Yahoo tickers
const NAME_TO_TICKER: Record<string, string> = {
  'Invesco Nasdaq 100': 'EQQQ',
  'Vanguard S&P 500': 'VUAG',
  'iShares MSCI Japan': 'CSJP',
  'Vanguard FTSE Developed Europe': 'VEUR',
  'Vanguard FTSE Developed Asia Pacific Ex-Japan': 'VAPX',
  'iShares MSCI Emerging Markets IMI': 'EIMI',
  'iShares Physical Gold': 'SGLN',
  'Vanguard FTSE All-World': 'VWRL',
  'iShares Core UK Gilts': 'IGLT',
}

function getTickerForSymbol(symbol: string, exchange: string): string {
  const ticker = NAME_TO_TICKER[symbol]
  if (ticker) {
    return exchange === 'LSE' ? `${ticker}.L` : ticker
  }
  return exchange === 'LSE' ? `${symbol}.L` : symbol
}

// Animation variants
const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
}

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
}

function aggregateHoldingsByName(holdings: Holding[]): Holding[] {
  const byKey = new Map<string, { totalValue: number; totalInvested: number; first: Holding }>()
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

  // Live prices from cache
  const [livePrices, setLivePrices] = useState<Record<string, number>>({})

  // Calculate total value using LIVE prices from cache
  const displayTotalValue = useMemo(() => 
    displayHoldings.reduce((sum, h) => {
      // Use resolved ticker for live price lookup
      const ticker = getTickerForSymbol(h.symbol, h.exchange)
      const livePrice = livePrices[ticker] || h.unitPrice
      return sum + (livePrice * h.units)
    }, 0), 
  [displayHoldings, livePrices])
  
  const displayInvested = useMemo(() => 
    displayHoldings.reduce((sum, h) => sum + h.averageCost * h.units, 0), 
  [displayHoldings])

  const displayGain = displayTotalValue - displayInvested
  const displayGainPct = gainLossPercent(displayTotalValue, displayInvested)

  const monthlyExpensesFromBudget = budgets.uk.reduce((s, b) => s + b.amount, 0)
  const fire30xGBP = fireNumber(annualExpensesGBP, 30)
  const fireProgressGBP = (displayTotalValue / fire30xGBP) * 100

  const todayStr = new Date().toISOString().slice(0, 10)
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  const [apiSnapshots, setApiSnapshots] = useState<{ date: string; valueGBP: number }[]>([])
  const [syncStatus, setSyncStatus] = useState<{ lastSync: string | null; count: number; refreshing: boolean }>({
    lastSync: null,
    count: 0,
    refreshing: false
  })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState<{ current: number; total: number; symbol: string } | null>(null)
  
  useEffect(() => {
    fetch('/api/snapshots')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => (Array.isArray(data) ? setApiSnapshots(data) : null))
      .catch(() => {})
  }, [])

  // Poll cached-prices for live prices and sync status
  useEffect(() => {
    let mounted = true
    const fetchSyncStatus = async () => {
      try {
        const res = await fetch('/api/cached-prices')
        const data = await res.json()
        if (mounted && data.prices) {
          setLivePrices(data.prices) // Use live prices for portfolio value
          const count = Object.keys(data.prices).length
          const lastSync = data.updated ? new Date(data.updated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null
          // Estimate if refreshing: if last sync was > 25 min ago, consider it might be refreshing soon
          const lastSyncDate = data.updated ? new Date(data.updated) : null
          const minsAgo = lastSyncDate ? (Date.now() - lastSyncDate.getTime()) / 60000 : null
          setSyncStatus({ lastSync, count, refreshing: minsAgo !== null && minsAgo < 30 })
        }
      } catch {}
    }
    fetchSyncStatus()
    const interval = setInterval(fetchSyncStatus, 30000) // Poll every 30s
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  // Manual refresh to fetch live prices on demand
  const handleManualRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setRefreshProgress({ current: 0, total: displayHoldings.length, symbol: 'Starting...' })
    
    const newPrices: Record<string, number> = {}
    for (let i = 0; i < displayHoldings.length; i++) {
      const h = displayHoldings[i]
      if (h.category === 'Cash' || h.symbol === 'CASH') continue
      
      const ticker = getTickerForSymbol(h.symbol, h.exchange)
      setRefreshProgress({ current: i + 1, total: displayHoldings.length, symbol: h.symbol })
      
      try {
        const res = await fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`)
        const data = await res.json()
        if (data.price && data.price > 0) {
          newPrices[ticker] = data.price
        }
      } catch {}
      
      await new Promise(r => setTimeout(r, 350))
    }
    
    setLivePrices(prev => ({ ...prev, ...newPrices }))
    setIsRefreshing(false)
    setRefreshProgress(null)
  }

  const yesterdayValueFromApi = apiSnapshots.find((p) => p.date === yesterdayStr)?.valueGBP
  const todaySnapshot = totalPortfolioHistory.find((p) => p.date === todayStr)
  const yesterdaySnapshot = totalPortfolioHistory.find((p) => p.date === yesterdayStr)

  const hasYesterdayAndToday = yesterdayValueFromApi != null && yesterdayValueFromApi > 0
  const todayChange = hasYesterdayAndToday && yesterdayValueFromApi ? displayTotalValue - yesterdayValueFromApi : 0
  const todayChangePct = hasYesterdayAndToday && yesterdayValueFromApi ? (todayChange / yesterdayValueFromApi) * 100 : 0

  // Chart data
  const chartData = useMemo(() => {
    const byDate = new Map<string, number>()
    for (const p of totalPortfolioHistory) {
      byDate.set(p.date, p.valueGBP)
    }
    for (const p of apiSnapshots) {
      byDate.set(p.date, p.valueGBP)
    }
    byDate.set(todayStr, displayTotalValue)
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, valueGBP]) => ({
        date,
        label: new Date(date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
        value: valueGBP,
      }))
  }, [totalPortfolioHistory, apiSnapshots, todayStr, displayTotalValue])

  // Allocation by broker
  const allocationData = useMemo(() => {
    const byBroker: Record<string, number> = {}
    for (const h of displayHoldings) {
      const broker = h.broker || 'Other'
      byBroker[broker] = (byBroker[broker] || 0) + currentValue(h.unitPrice, h.units)
    }
    const total = Object.values(byBroker).reduce((s, v) => s + v, 0)
    return Object.entries(byBroker).map(([name, value], i) => ({
      name,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
      color: PIE_COLORS[i % PIE_COLORS.length],
    }))
  }, [displayHoldings])

  // Custom tooltip for charts
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
          <p className="text-slate-400 text-xs">{label}</p>
          <p className="text-white font-semibold">£{payload[0].value?.toLocaleString()}</p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                Firefly
              </h1>
              <p className="text-xs text-slate-500">Portfolio Tracker</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link 
              to="/investments" 
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
            >
              Investments
            </Link>
            <Link 
              to="/goals" 
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
            >
              Goals
            </Link>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto" {...fadeInUp}>
        {/* Sync Status Bar */}
        <motion.div 
          className="flex items-center justify-between px-4 py-2 mb-4 bg-slate-900/50 border border-slate-800 rounded-xl"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${syncStatus.refreshing || isRefreshing ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
              {syncStatus.refreshing || isRefreshing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
              <span className="text-xs font-medium">
                {isRefreshing 
                  ? `Refreshing ${refreshProgress?.symbol} (${refreshProgress?.current}/${refreshProgress?.total})`
                  : syncStatus.refreshing 
                    ? 'Refreshing prices...' 
                    : `Synced ${syncStatus.count} symbols`
                }
              </span>
            </div>
            {syncStatus.lastSync && !isRefreshing && (
              <span className="text-xs text-slate-500">
                Last sync: {syncStatus.lastSync}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              Total value {formatMoney(displayTotalValue, 'GBP')}
            </span>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh Prices'}
            </button>
          </div>
        </motion.div>

        {/* Hero Portfolio Card */}
        <motion.div 
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 p-8 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Background decoration */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
          
          <div className="relative z-10">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-indigo-200 text-sm font-medium mb-1">Total Portfolio Value</p>
                <h2 className="text-5xl font-bold text-white tracking-tight">
                  {formatMoney(displayTotalValue, 'GBP')}
                </h2>
              </div>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${todayChange >= 0 ? 'bg-white/20' : 'bg-red-500/20'}`}>
                {todayChange >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                <span className={`font-semibold ${todayChange >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {todayChange >= 0 ? '+' : ''}{formatPercent(todayChangePct)}
                </span>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-6 mt-8">
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur">
                <p className="text-indigo-200 text-xs mb-1">Total Gain</p>
                <p className={`text-2xl font-bold ${displayGain >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {displayGain >= 0 ? '+' : ''}{formatMoney(displayGain, 'GBP')}
                </p>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur">
                <p className="text-indigo-200 text-xs mb-1">Return</p>
                <p className={`text-2xl font-bold ${displayGainPct >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {displayGainPct >= 0 ? '+' : ''}{formatPercent(displayGainPct)}
                </p>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur">
                <p className="text-indigo-200 text-xs mb-1">FIRE Progress</p>
                <p className="text-2xl font-bold text-white">{fireProgressGBP.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {/* Today's Gain Card */}
          <motion.div 
            className="bg-slate-900 rounded-2xl p-6 border border-slate-800"
            variants={fadeInUp}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-400" />
                Today's Gain
              </h3>
            </div>
            <div className="flex items-end gap-3">
              <span className={`text-4xl font-bold ${todayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {todayChange >= 0 ? '+' : ''}{formatMoney(todayChange, 'GBP')}
              </span>
              <span className={`text-sm mb-2 ${todayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatPercent(todayChangePct)}
              </span>
            </div>
            <div className="mt-4 h-2 bg-slate-800 rounded-full overflow-hidden">
              <motion.div 
                className={`h-full rounded-full ${todayChange >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(Math.abs(todayChangePct), 100)}%` }}
                transition={{ duration: 1, delay: 0.3 }}
              />
            </div>
          </motion.div>

          {/* Allocation Donut Card */}
          <motion.div 
            className="bg-slate-900 rounded-2xl p-6 border border-slate-800"
            variants={fadeInUp}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <PieIcon className="w-5 h-5 text-purple-400" />
                Allocation
              </h3>
            </div>
            <div className="flex items-center gap-6">
              <div className="w-32 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocationData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {allocationData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {allocationData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-slate-300">{item.name}</span>
                    </div>
                    <span className="text-sm font-medium text-white">{item.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Performance Chart */}
        <motion.div 
          className="bg-slate-900 rounded-2xl p-6 border border-slate-800"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Performance
            </h3>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              Portfolio Value
            </div>
          </div>
          <div className="h-72">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <defs>
                    <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366F1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="label" 
                    tick={{ fontSize: 11, fill: '#64748B' }} 
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11, fill: '#64748B' }} 
                    tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                    width={60}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#6366F1"
                    strokeWidth={3}
                    fill="url(#portfolioGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500">
                Add holdings to see performance chart
              </div>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  )
}
