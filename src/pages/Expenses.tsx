import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '@/context/AppContext'
import { formatMoney } from '@/utils/format'
import { Plus, TrendingUp, Wallet, PieChart as PieIcon, Calendar, RotateCcw } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from 'recharts'

const COLORS = ['#6366F1', '#22C55E', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#EF4444', '#3B82F6']

const DEFAULT_BUDGETS = [
  { id: 'c1', name: 'House Rent/Mortgage', amount: 2399 },
  { id: 'c2', name: 'Internet', amount: 44 },
  { id: 'c3', name: 'Council Tax', amount: 233 },
  { id: 'c4', name: 'Power', amount: 92.5 },
  { id: 'c5', name: 'Gas', amount: 92.5 },
  { id: 'c6', name: 'Gym', amount: 52 },
  { id: 'c7', name: 'Fuel', amount: 50 },
  { id: 'c8', name: 'Food & Grocery', amount: 600 },
  { id: 'c9', name: 'Entertainment', amount: 100 },
  { id: 'c10', name: 'Commute', amount: 250 },
]

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { value: number; name: string }[] }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
        <p className="text-white font-semibold">{payload[0]?.name}</p>
        <p className="text-slate-400 text-sm">£{payload[0]?.value?.toLocaleString()}</p>
      </div>
    )
  }
  return null
}

export function Expenses() {
  const { budgets, updateBudgetCategory } = useApp()
  const budget = budgets.uk
  const total = budget.reduce((s, b) => s + b.amount, 0)

  const chartData = useMemo(() => {
    return budget.map((b, i) => ({
      name: b.name,
      value: b.amount,
      color: COLORS[i % COLORS.length]
    }))
  }, [budget])

  const handleUpdateCategory = (id: string, updates: { name?: string; amount?: number }) => {
    updateBudgetCategory(id, updates)
  }

  const handleRestoreDefaults = () => {
    alert('Button clicked!')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Expenses</h1>
              <p className="text-xs text-slate-500">Monthly budget by category</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors" onClick={() => {alert('Working!'); localStorage.removeItem('personal-fin-app-budgets'); window.location.reload();}}>
              <RotateCcw className="w-4 h-4" />
              Restore Defaults
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors">
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto" {...fadeInUp}>
        {/* Total Budget Card */}
        <motion.div variants={fadeInUp} className="bg-gradient-to-r from-rose-600 to-orange-600 rounded-3xl p-8 mb-6">
          <p className="text-rose-100 text-sm mb-2">Total Monthly Budget</p>
          <p className="text-5xl font-bold text-white">{formatMoney(total, 'GBP')}</p>
          <div className="flex items-center gap-2 mt-4 text-rose-100">
            <Calendar className="w-4 h-4" />
            <span className="text-sm">Monthly</span>
          </div>
        </motion.div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Pie Chart */}
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <PieIcon className="w-5 h-5 text-rose-400" />
              Budget Breakdown
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                    {chartData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Bar Chart */}
          <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Categories
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <XAxis type="number" tick={{ fill: '#64748B', fontSize: 12 }} tickFormatter={(v) => `£${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 12 }} width={80} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" fill="#6366F1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>

        {/* Budget List - Editable */}
        <motion.div variants={fadeInUp} className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800">
            <h3 className="text-lg font-semibold">Categories - Edit</h3>
          </div>
          <div className="divide-y divide-slate-800">
            {budget.map((b, i) => {
              const pct = (b.amount / total) * 100
              return (
                <motion.div 
                  key={b.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-4 hover:bg-slate-800/50"
                >
                  <input
                    type="text"
                    value={b.name}
                    onChange={(e) => handleUpdateCategory(b.id, { name: e.target.value })}
                    className="flex-1 bg-transparent border-none text-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-2 py-1"
                  />
                  <div className="flex items-center gap-4">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={b.amount || ''}
                      onChange={(e) => handleUpdateCategory(b.id, { amount: parseFloat(e.target.value) || 0 })}
                      className="w-24 bg-slate-800 border border-slate-700 rounded px-3 py-1 text-right text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-slate-400 text-sm w-8">£</span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      </main>
    </div>
  )
}
