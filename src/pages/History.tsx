import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '@/context/AppContext'
import { currentValue, gainLossPercent } from '@/utils/calculations'
import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { TrendingUp, Calendar, BarChart3 } from 'lucide-react'
import { format } from 'date-fns'

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

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
}

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

export function History() {
  const { totalPortfolioHistory, ukHoldings } = useApp()

  // Fetch live prices for current value
  const [livePrices, setLivePrices] = useState<Record<string, number>>({})
  
  useEffect(() => {
    fetch('/api/cached-prices')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.prices) setLivePrices(data.prices)
      })
      .catch(() => {})
  }, [])

  // Calculate current total value using live prices
  const currentTotalValue = useMemo(() => {
    return ukHoldings.reduce((sum, h) => {
      const ticker = getTickerForSymbol(h.symbol, h.exchange)
      const livePrice = livePrices[ticker] || h.unitPrice
      return sum + (livePrice * h.units)
    }, 0)
  }, [ukHoldings, livePrices])

  const monthlyData = useMemo(() => {
    const byMonth = new Map<string, number>()
    for (const p of totalPortfolioHistory) {
      const month = p.date.slice(0, 7)
      byMonth.set(month, p.valueGBP)
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, value]) => ({
        month,
        label: format(new Date(month + '-01'), 'MMM yy'),
        value
      }))
  }, [totalPortfolioHistory])

  const monthlyGain = useMemo(() => {
    return monthlyData.map((d, i) => {
      const prev = i > 0 ? monthlyData[i - 1].value : 0
      const gain = d.value - prev
      const gainPct = prev > 0 ? (gain / prev) * 100 : 0
      return { ...d, gain, gainPct }
    })
  }, [monthlyData])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">History</h1>
              <p className="text-xs text-slate-500">Portfolio performance over time</p>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto" {...fadeInUp}>
        {/* Portfolio Value Chart */}
        <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-6 border border-slate-800 mb-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Portfolio Value Over Time
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={(v) => `£${(v/1000).toFixed(0)}k`} axisLine={{ stroke: '#334155' }} width={60} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="value" stroke="#6366F1" strokeWidth={2} fill="url(#valueGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Monthly Gain Chart */}
        <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            Monthly Gains
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyGain.slice(-12)}>
                <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={(v) => `£${(v/1000).toFixed(0)}k`} axisLine={{ stroke: '#334155' }} width={60} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="gain" fill="#22C55E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-slate-400 text-sm">Total Months</p>
            <p className="text-2xl font-bold text-white">{monthlyData.length}</p>
          </div>
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-slate-400 text-sm">Current Value</p>
            <p className="text-2xl font-bold text-white">£{currentTotalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
          </div>
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-slate-400 text-sm">Holdings</p>
            <p className="text-2xl font-bold text-white">{ukHoldings.length}</p>
          </div>
        </div>
      </main>
    </div>
  )
}
