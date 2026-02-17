import { useApp } from '@/context/AppContext'
import { formatMoney } from '@/utils/format'
import { Plus } from 'lucide-react'
import type { BudgetCategory } from '@/types'

export function Expenses() {
  return (
    <div className="p-4 w-full min-w-0">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Budget by category (GBP) — edit name and value</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">
          <Plus className="h-4 w-4" />
          Add
        </button>
      </header>

      <BudgetView />
    </div>
  )
}

function BudgetView() {
  const { budgets, updateBudgetCategory } = useApp()
  const budget = budgets.uk
  const total = budget.reduce((s, b) => s + b.amount, 0)

  return (
    <div className="space-y-4">
      <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">Total monthly budget (GBP)</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatMoney(total, 'GBP')}
        </p>
      </div>
      <div className="space-y-2">
        {budget.map((b) => (
          <BudgetRow
            key={b.id}
            category={b}
            onUpdate={(updates) => updateBudgetCategory(b.id, updates)}
          />
        ))}
      </div>
    </div>
  )
}

function BudgetRow({
  category,
  onUpdate,
}: {
  category: BudgetCategory
  onUpdate: (updates: { name?: string; amount?: number }) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <input
        type="text"
        value={category.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        className="flex-1 min-w-[120px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-900 dark:text-white"
        placeholder="Category name"
      />
      <input
        type="number"
        min={0}
        step={1}
        value={category.amount || ''}
        onChange={(e) => {
          const v = e.target.value === '' ? 0 : parseFloat(e.target.value)
          if (!Number.isNaN(v)) onUpdate({ amount: v })
        }}
        className="w-28 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-right text-gray-900 dark:text-white"
        placeholder="0"
      />
      <span className="text-sm text-gray-500 dark:text-gray-400 w-8">£</span>
    </div>
  )
}
