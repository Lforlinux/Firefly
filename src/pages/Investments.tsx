import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '@/context/AppContext'
import { formatMoney, formatPercent, formatUnits } from '@/utils/format'
import { currentValue, gainLoss, gainLossPercent } from '@/utils/calculations'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from 'recharts'
import { TrendingUp, TrendingDown, Plus, RefreshCw, Wallet, PieChart as PieIcon, BarChart3, Search, Filter, Upload, Clock } from 'lucide-react'
import { parseTradesCsv, parseTradesCsvTrading212, aggregateTradesToHoldings } from '@/utils/csvTrades'
import type { Holding, Exchange, AssetCategory } from '@/types'

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
  // Check if it's a known fund name first
  const ticker = NAME_TO_TICKER[symbol]
  if (ticker) {
    return exchange === 'LSE' ? `${ticker}.L` : ticker
  }
  // Otherwise use the symbol directly
  return exchange === 'LSE' ? `${symbol}.L` : symbol
}

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
}

const staggerContainer = {
  animate: {
    transition: { staggerChildren: 0.1 }
  }
}

// Custom tooltip
const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { value: number; name: string }[] }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
        <p className="text-slate-400 text-xs">{payload[0]?.name}</p>
        <p className="text-white font-semibold">£{payload[0]?.value?.toLocaleString()}</p>
      </div>
    )
  }
  return null
}

export function Investments() {
  const { ukHoldings, addHolding, removeHolding, updateHoldingPrice, replaceHoldingsByBroker, setUkPortfolioHistoryFromCsv, setTotalPortfolioHistoryFromCsv, clearPortfolio } = useApp()
  const [showAdd, setShowAdd] = useState(false)
  const [showImportCsv, setShowImportCsv] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'value' | 'gain' | 'name'>('value')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState<{ current: number; total: number; symbol: string } | null>(null)

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshProgress({ current: 0, total: ukHoldings.length, symbol: 'Starting...' })
    
    const newPrices: Record<string, number> = {}
    for (let i = 0; i < ukHoldings.length; i++) {
      const h = ukHoldings[i]
      if (h.category === 'Cash' || h.symbol === 'CASH') continue
      
      const ticker = getTickerForSymbol(h.symbol, h.exchange)
      setRefreshProgress({ current: i + 1, total: ukHoldings.length, symbol: h.symbol })
      
      try {
        const res = await fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`)
        const data = await res.json()
        if (data.price && data.price > 0) {
          updateHoldingPrice('uk', h.id, data.price)
          newPrices[ticker] = data.price
        }
      } catch {}
      
      await new Promise(r => setTimeout(r, 350))
    }
    
    setRefreshing(false)
    setRefreshProgress(null)
  }

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        
        // Detect format: Trading212 has "Date" column, InvestEngine has different format
        const isTrading212 = text.includes('Date') && text.includes('Action')
        const holdings = isTrading212 
          ? aggregateTradesToHoldings(parseTradesCsvTrading212(text))
          : aggregateTradesToHoldings(parseTradesCsv(text))
        
        replaceHoldingsByBroker('uk', isTrading212 ? 'Trading212' : 'InvestEngine', holdings)
        alert(`Imported ${holdings.length} holdings!`)
      } catch (err) {
        alert('Failed to parse CSV: ' + err)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Calculate totals
  const totalValue = useMemo(() => ukHoldings.reduce((sum, h) => sum + currentValue(h.unitPrice, h.units), 0), [ukHoldings])
  const totalInvested = useMemo(() => ukHoldings.reduce((sum, h) => sum + h.averageCost * h.units, 0), [ukHoldings])
  const totalGain = totalValue - totalInvested
  const totalGainPct = gainLossPercent(totalValue, totalInvested)

  // Filter and sort
  const filteredHoldings = useMemo(() => {
    let holdings = [...ukHoldings]
    if (searchTerm) {
      holdings = holdings.filter(h => 
        h.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        h.symbol?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }
    holdings.sort((a, b) => {
      if (sortBy === 'value') return currentValue(b.unitPrice, b.units) - currentValue(a.unitPrice, a.units)
      if (sortBy === 'gain') return gainLossPercent(currentValue(b.unitPrice, b.units), b.averageCost * b.units) - gainLossPercent(currentValue(a.unitPrice, a.units), a.averageCost * a.units)
      return (a.name || a.symbol || '').localeCompare(b.name || b.symbol || '')
    })
    return holdings
  }, [ukHoldings, searchTerm, sortBy])

  // Allocation by category
  const categoryData = useMemo(() => {
    const byCategory: Record<string, number> = {}
    ukHoldings.forEach(h => {
      const cat = h.category || 'Other'
      byCategory[cat] = (byCategory[cat] || 0) + currentValue(h.unitPrice, h.units)
    })
    const total = Object.values(byCategory).reduce((s, v) => s + v, 0)
    return Object.entries(byCategory).map(([name, value], i) => ({
      name,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
      color: PIE_COLORS[i % PIE_COLORS.length]
    }))
  }, [ukHoldings])

  // Top holdings
  const topHoldings = useMemo(() => {
    return [...ukHoldings]
      .sort((a, b) => currentValue(b.unitPrice, b.units) - currentValue(a.unitPrice, a.units))
      .slice(0, 5)
  }, [ukHoldings])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Investments</h1>
              <p className="text-xs text-slate-500">Manage your portfolio</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Import CSV
              <input type="file" accept=".csv" onChange={handleImportCsv} className="hidden" />
            </label>
            <button 
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {refreshing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
              {refreshing 
                ? `Refreshing ${refreshProgress?.symbol} (${refreshProgress?.current}/${refreshProgress?.total})`
                : 'Refresh Prices'
              }
            </button>
            <button 
              onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Holding
            </button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto" {...fadeInUp}>
        {/* Stats Cards */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-slate-400 text-sm mb-1">Total Value</p>
            <p className="text-2xl font-bold text-white">{formatMoney(totalValue, 'GBP')}</p>
          </motion.div>
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-slate-400 text-sm mb-1">Total Invested</p>
            <p className="text-2xl font-bold text-white">{formatMoney(totalInvested, 'GBP')}</p>
          </motion.div>
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-slate-400 text-sm mb-1">Total Gain/Loss</p>
            <p className={`text-2xl font-bold ${totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalGain >= 0 ? '+' : ''}{formatMoney(totalGain, 'GBP')}
            </p>
          </motion.div>
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-slate-400 text-sm mb-1">Return</p>
            <p className={`text-2xl font-bold ${totalGainPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalGainPct >= 0 ? '+' : ''}{formatPercent(totalGainPct)}
            </p>
          </motion.div>
        </motion.div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Allocation */}
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <PieIcon className="w-5 h-5 text-purple-400" />
              Allocation
            </h3>
            <div className="flex items-center gap-6">
              <div className="w-32 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={4} dataKey="value">
                      {categoryData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {categoryData.map(item => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-slate-300">{item.name}</span>
                    </div>
                    <span className="text-sm font-medium">{item.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Top Holdings */}
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-400" />
              Top Holdings
            </h3>
            <div className="space-y-3">
              {topHoldings.map((h, i) => {
                const val = currentValue(h.unitPrice, h.units)
                const pct = (val / totalValue) * 100
                const gl = gainLossPercent(val, h.averageCost * h.units)
                return (
                  <div key={h.id || i} className="flex items-center justify-between p-3 bg-slate-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                      <div>
                        <p className="font-medium text-white">{h.symbol || h.name}</p>
                        <p className="text-xs text-slate-400">{h.units} units @ {formatMoney(h.averageCost, 'GBP')}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-white">{formatMoney(val, 'GBP')}</p>
                      <p className={`text-xs ${gl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{gl >= 0 ? '+' : ''}{formatPercent(gl)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </div>

        {/* Holdings Table */}
        <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-lg font-semibold">All Holdings ({filteredHoldings.length})</h3>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'value' | 'gain' | 'name')}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none"
              >
                <option value="value">Sort by Value</option>
                <option value="gain">Sort by Gain</option>
                <option value="name">Sort by Name</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase">Symbol</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase">Name</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Units</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Avg Cost</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Price</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Value</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Gain/Loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredHoldings.map((h, i) => {
                  const val = currentValue(h.unitPrice, h.units)
                  const gl = gainLoss(val, h.averageCost * h.units)
                  const glPct = gainLossPercent(val, h.averageCost * h.units)
                  return (
                    <motion.tr 
                      key={h.id || i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="hover:bg-slate-800/50"
                    >
                      <td className="px-4 py-3 font-medium text-indigo-400">{h.symbol}</td>
                      <td className="px-4 py-3 text-slate-300">{h.name || '-'}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{formatUnits(h.units)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{formatMoney(h.averageCost, 'GBP')}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{formatMoney(h.unitPrice, 'GBP')}</td>
                      <td className="px-4 py-3 text-right font-medium text-white">{formatMoney(val, 'GBP')}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={gl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {gl >= 0 ? '+' : ''}{formatMoney(gl, 'GBP')} ({glPct >= 0 ? '+' : ''}{formatPercent(glPct)})
                        </span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Add Holding Modal */}
        {showAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-900 rounded-2xl p-6 w-full max-w-md border border-slate-700">
              <h3 className="text-xl font-bold mb-4">Add Holding</h3>
              <form onSubmit={(e) => { e.preventDefault(); alert('Add holding clicked - implement form handler'); }} className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Category</label>
                  <select className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white">
                    <option>Equity</option>
                    <option>ETF</option>
                    <option>Gold</option>
                    <option>Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Name</label>
                  <input type="text" placeholder="e.g. Vanguard S&P 500" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Exchange</label>
                    <select className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white">
                      <option>LSE (London)</option>
                      <option>NASDAQ</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Symbol</label>
                    <input type="text" placeholder="e.g. VUAG" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Units</label>
                    <input type="number" step="0.001" placeholder="0" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Avg Cost</label>
                    <input type="number" step="0.01" placeholder="0.00" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Owner</label>
                  <select className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white">
                    <option>KLN</option>
                    <option>Priya</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors">Add Holding</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
