import { useState } from 'react'
import { useApp } from '@/context/AppContext'
import { formatMoney } from '@/utils/format'
import { yearsToFire, fireNumber, currentValue } from '@/utils/calculations'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/Tabs'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

export function Goals() {
  return (
    <div className="p-4 w-full min-w-0">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Goals</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">FIRE, emergency fund & savings</p>
      </header>

      <Tabs defaultValue="fire">
        <TabsList>
          <TabsTrigger value="fire">FIRE Calculator</TabsTrigger>
          <TabsTrigger value="emergency">Emergency Fund</TabsTrigger>
          <TabsTrigger value="savings">Savings Goals</TabsTrigger>
        </TabsList>
        <TabsContent value="fire">
          <FIRECalculator />
        </TabsContent>
        <TabsContent value="emergency">
          <EmergencyFund />
        </TabsContent>
        <TabsContent value="savings">
          <SavingsGoals />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FIRECalculator() {
  const { ukHoldings, annualExpensesGBP } = useApp()
  const combinedGBP = ukHoldings.reduce((s, h) => s + currentValue(h.unitPrice, h.units), 0)

  const [monthlySavings, setMonthlySavings] = useState(3322)
  const [growthRate, setGrowthRate] = useState(12)
  const [multiplier, setMultiplier] = useState(30)

  const ONE_MILLION = 1_000_000
  const fireTarget = fireNumber(annualExpensesGBP, multiplier)
  const yearsTo1M = yearsToFire(combinedGBP, ONE_MILLION, monthlySavings, growthRate)
  const years = yearsToFire(combinedGBP, fireTarget, monthlySavings, growthRate)
  const pctTo1M = Math.min(100, (combinedGBP / ONE_MILLION) * 100)

  const projection: { year: number; total: number }[] = []
  let balance = combinedGBP
  for (let y = 0; y <= Math.min(Math.max(years, yearsTo1M) + 5, 40); y++) {
    projection.push({ year: new Date().getFullYear() + y, total: Math.round(balance) })
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + growthRate / 100 / 12) + monthlySavings
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Current (UK portfolio)</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{formatMoney(combinedGBP, 'GBP')}</p>
        </div>
        <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">FIRE target ({multiplier}x)</p>
          <p className="text-xl font-bold text-primary">{formatMoney(fireTarget, 'GBP')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {multiplier === 25 ? 'Lean' : multiplier === 30 ? 'Standard' : 'Fat'} FIRE
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Monthly savings (£)
        </label>
        <input
          type="number"
          value={monthlySavings}
          onChange={(e) => setMonthlySavings(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-white"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Expected growth rate (%)
        </label>
        <input
          type="number"
          value={growthRate}
          onChange={(e) => setGrowthRate(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-white"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          FIRE multiplier (25x Lean, 30x Standard, 50x Fat)
        </label>
        <select
          value={multiplier}
          onChange={(e) => setMultiplier(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-white"
        >
          <option value={25}>25x — Lean FIRE</option>
          <option value={30}>30x — Standard FIRE</option>
          <option value={50}>50x — FAT FIRE</option>
        </select>
      </div>

      {/* 1M goal + projection (under FIRE multiplier) */}
      <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">1M goal</h3>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Target</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{formatMoney(ONE_MILLION, 'GBP')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Years to £1M (approx.)</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {combinedGBP >= ONE_MILLION ? '0' : yearsTo1M} years
            </p>
          </div>
          {combinedGBP < ONE_MILLION && (
            <div className="flex-1 min-w-[120px]">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Progress</p>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${pctTo1M}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{pctTo1M.toFixed(0)}%</p>
            </div>
          )}
        </div>
        <div className="h-48">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Projection to £1M</p>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projection}>
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [formatMoney(v, 'GBP'), 'Portfolio']} labelFormatter={(y) => `Year ${y}`} />
              <ReferenceLine y={ONE_MILLION} stroke="#10b981" strokeDasharray="4 4" label={{ value: '£1M', position: 'right', fontSize: 10 }} />
              <Line type="monotone" dataKey="total" stroke="#4A90E2" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4 bg-primary/10 dark:bg-primary/20 rounded-xl border border-primary/30">
        <p className="text-sm text-gray-600 dark:text-gray-400">Years to FIRE (approx.)</p>
        <p className="text-2xl font-bold text-primary">{years} years</p>
      </div>

      <div className="h-56">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Projection</p>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={projection}>
            <XAxis dataKey="year" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => [formatMoney(v, 'GBP'), 'Portfolio']} labelFormatter={(y) => `Year ${y}`} />
            <Line type="monotone" dataKey="total" stroke="#4A90E2" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function EmergencyFund() {
  const { budgets, ukHoldings } = useApp()
  const monthlyExpense = budgets.uk.reduce((s, b) => s + b.amount, 0)
  const target6 = monthlyExpense * 6
  const balanceFromCash = ukHoldings
    .filter((h) => h.category === 'Cash' || h.symbol === 'CASH')
    .reduce((s, h) => s + currentValue(h.unitPrice, h.units), 0)
  const pct = target6 > 0 ? (balanceFromCash / target6) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Current balance (from Cash holdings)</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatMoney(balanceFromCash, 'GBP')}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Add Cash in Investments (e.g. Plum, HSBC) to update.</p>
      </div>
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-success' : pct >= 66 ? 'bg-warning' : 'bg-error'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Target: monthly expense (£{monthlyExpense.toLocaleString('en-GB', { maximumFractionDigits: 0 })}) × 6 = {formatMoney(target6, 'GBP')}
      </p>
    </div>
  )
}

const TARGET_100K = 100_000
const TARGET_200K = 200_000

function SavingsGoals() {
  const { ukHoldings } = useApp()
  const totalPortfolioGBP = ukHoldings.reduce((s, h) => s + currentValue(h.unitPrice, h.units), 0)

  const pct100k = Math.min(100, (totalPortfolioGBP / TARGET_100K) * 100)
  const pct200k = Math.min(100, (totalPortfolioGBP / TARGET_200K) * 100)

  return (
    <div className="space-y-6">
      <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Total portfolio (used for progress)</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white">{formatMoney(totalPortfolioGBP, 'GBP')}</p>
      </div>

      <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">£100k progress</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${pct100k}%` }}
              />
            </div>
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
            {pct100k.toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {formatMoney(totalPortfolioGBP, 'GBP')} of {formatMoney(TARGET_100K, 'GBP')} target
        </p>
      </div>

      <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">£200k progress</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${pct200k}%` }}
              />
            </div>
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
            {pct200k.toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {formatMoney(totalPortfolioGBP, 'GBP')} of {formatMoney(TARGET_200K, 'GBP')} target
        </p>
      </div>
    </div>
  )
}
