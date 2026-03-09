import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '@/context/AppContext'
import { formatMoney } from '@/utils/format'
import { fireNumber, yearsToFire, currentValue } from '@/utils/calculations'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine } from 'recharts'
import { Flame, Target, Shield, TrendingUp, Calendar } from 'lucide-react'

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

export function Goals() {
  const { ukHoldings, annualExpensesGBP } = useApp()
  const [fireMultiple, setFireMultiple] = useState(30)
  const [monthlySavings, setMonthlySavings] = useState(2000)
  const [growthRate, setGrowthRate] = useState(7)

  const totalValue = useMemo(() => ukHoldings.reduce((sum, h) => sum + currentValue(h.unitPrice, h.units), 0), [ukHoldings])
  const fireTarget = fireNumber(annualExpensesGBP, fireMultiple)
  const years = yearsToFire(totalValue, fireTarget, monthlySavings, growthRate)
  const progress = (totalValue / fireTarget) * 100

  // Projection data
  const projectionData = useMemo(() => {
    const data = []
    let value = totalValue
    for (let i = 0; i <= 20; i++) {
      data.push({
        year: i,
        label: `Year ${i}`,
        value: Math.round(value)
      })
      value = value * (1 + growthRate / 100) + monthlySavings * 12
    }
    return data
  }, [totalValue, monthlySavings, growthRate])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Goals</h1>
              <p className="text-xs text-slate-500">FIRE & savings targets</p>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto" {...fadeInUp}>
        {/* FIRE Hero Card */}
        <motion.div variants={fadeInUp} className="bg-gradient-to-r from-orange-600 to-red-600 rounded-3xl p-8 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-orange-100 text-sm mb-2">FIRE Target ({fireMultiple}x expenses)</p>
              <p className="text-5xl font-bold text-white">{formatMoney(fireTarget, 'GBP')}</p>
              <p className="text-orange-100 mt-2">Annual expenses: {formatMoney(annualExpensesGBP, 'GBP')}/yr</p>
            </div>
            <div className="text-right">
              <p className="text-4xl font-bold text-white">{years.toFixed(1)}</p>
              <p className="text-orange-100 text-sm">years to FIRE</p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-orange-100">Progress</span>
              <span className="text-white font-medium">{progress.toFixed(1)}%</span>
            </div>
            <div className="h-3 bg-white/20 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-white rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(progress, 100)}%` }}
                transition={{ duration: 1, delay: 0.3 }}
              />
            </div>
            <p className="text-orange-100 text-sm mt-2">{formatMoney(totalValue, 'GBP')} saved</p>
          </div>
        </motion.div>

        {/* Controls */}
        <motion.div variants={fadeInUp} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <label className="text-slate-400 text-sm mb-2 block">FIRE Multiple</label>
            <input 
              type="range" min="25" max="50" value={fireMultiple} 
              onChange={(e) => setFireMultiple(Number(e.target.value))}
              className="w-full accent-orange-500"
            />
            <p className="text-white font-bold mt-2">{fireMultiple}x expenses</p>
          </div>
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <label className="text-slate-400 text-sm mb-2 block">Monthly Savings</label>
            <input 
              type="range" min="500" max="5000" step="100" value={monthlySavings} 
              onChange={(e) => setMonthlySavings(Number(e.target.value))}
              className="w-full accent-orange-500"
            />
            <p className="text-white font-bold mt-2">{formatMoney(monthlySavings, 'GBP')}/month</p>
          </div>
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <label className="text-slate-400 text-sm mb-2 block">Expected Growth</label>
            <input 
              type="range" min="1" max="15" value={growthRate} 
              onChange={(e) => setGrowthRate(Number(e.target.value))}
              className="w-full accent-orange-500"
            />
            <p className="text-white font-bold mt-2">{growthRate}%/year</p>
          </div>
        </motion.div>

        {/* Projection Chart */}
        <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-6 border border-slate-800 mb-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            FIRE Projection
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projectionData}>
                <defs>
                  <linearGradient id="fireGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F97316" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={(v) => `£${(v/1000000).toFixed(1)}M`} axisLine={{ stroke: '#334155' }} width={60} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={fireTarget} stroke="#22C55E" strokeDasharray="5 5" label={{ value: 'FIRE', fill: '#22C55E', fontSize: 12 }} />
                <Area type="monotone" dataKey="value" stroke="#F97316" strokeWidth={2} fill="url(#fireGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <Target className="w-8 h-8 text-orange-500 mb-3" />
            <p className="text-slate-400 text-sm">Target</p>
            <p className="text-2xl font-bold">{formatMoney(fireTarget, 'GBP')}</p>
          </div>
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <Shield className="w-8 h-8 text-emerald-500 mb-3" />
            <p className="text-slate-400 text-sm">Current</p>
            <p className="text-2xl font-bold">{formatMoney(totalValue, 'GBP')}</p>
          </div>
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <Calendar className="w-8 h-8 text-blue-500 mb-3" />
            <p className="text-slate-400 text-sm">FIRE Date</p>
            <p className="text-2xl font-bold">
              {new Date(Date.now() + years * 365.25 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
