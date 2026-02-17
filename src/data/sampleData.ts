import type { Holding, NetworthSnapshot, Expense, BudgetCategory, DebtItem, Mortgage, SIP, IdealAllocation } from '@/types'

export const ukHoldings: Holding[] = [
  { id: '1', name: 'Vanguard S&P 500', symbol: 'VUAG', exchange: 'LSE', category: 'ETF', unitPrice: 98.5, units: 50, averageCost: 92.1, currency: 'GBP', owner: 'KLN' },
  { id: '2', name: 'iShares Nasdaq 100', symbol: 'EQQQ', exchange: 'LSE', category: 'ETF', unitPrice: 52.3, units: 100, averageCost: 48.2, currency: 'GBP', owner: 'KLN' },
  { id: '3', name: 'NVIDIA', symbol: 'NVDA', exchange: 'NASDAQ', category: 'Equity', subCategory: 'Large Cap', unitPrice: 128.5, units: 10, averageCost: 115.0, currency: 'GBP', owner: 'KLN' },
  { id: '4', name: 'Vanguard FTSE All-World', symbol: 'VWRP', exchange: 'LSE', category: 'ETF', unitPrice: 102.0, units: 30, averageCost: 98.5, currency: 'GBP', owner: 'Priya' },
]

export const networthHistory: NetworthSnapshot[] = (() => {
  const months: NetworthSnapshot[] = []
  let uk = 18_000
  const start = new Date(2023, 11, 1)
  for (let i = 0; i < 15; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    uk *= 1 + (0.006 + Math.random() * 0.008)
    months.push({
      month: d.toISOString().slice(0, 7),
      ukPortfolioGBP: Math.round(uk),
      totalGBP: Math.round(uk),
      cash: Math.round(4000 + i * 50),
      debt: Math.round(12000 - i * 200),
      equity: Math.round(uk * 0.8),
      gold: Math.round(800),
    })
  }
  return months
})()

export const sampleExpenses: Expense[] = [
  { id: 'e1', date: '2025-02-01', amount: 2399, currency: 'GBP', item: 'House Rent', category: 'House Rent', notes: 'Monthly' },
  { id: 'e2', date: '2025-02-05', amount: 44, currency: 'GBP', item: 'Internet', category: 'Utility Bills' },
  { id: 'e3', date: '2025-02-08', amount: 52, currency: 'GBP', item: 'Gym', category: 'Fitness & sports' },
  { id: 'e4', date: '2025-02-10', amount: 35, currency: 'GBP', item: 'Chipotle London', category: 'Food' },
  { id: 'e5', date: '2025-02-12', amount: 150, currency: 'GBP', item: 'Groceries', category: 'Grocery' },
]

export const ukBudgetTemplate: BudgetCategory[] = [
  { id: 'c1', name: 'House Rent/Mortgage', amount: 2399, currency: 'GBP' },
  { id: 'c2', name: 'Internet', amount: 44, currency: 'GBP' },
  { id: 'c3', name: 'Council Tax', amount: 233, currency: 'GBP' },
  { id: 'c4', name: 'Power', amount: 92.5, currency: 'GBP' },
  { id: 'c5', name: 'Gas', amount: 92.5, currency: 'GBP' },
  { id: 'c6', name: 'Gym', amount: 52, currency: 'GBP' },
  { id: 'c7', name: 'Fuel', amount: 50, currency: 'GBP' },
  { id: 'c8', name: 'Food & Grocery', amount: 600, currency: 'GBP' },
  { id: 'c9', name: 'Entertainment', amount: 100, currency: 'GBP' },
  { id: 'c10', name: 'Commute', amount: 250, currency: 'GBP' },
]

export const sampleDebts: DebtItem[] = []
export const sampleMortgage: Mortgage | null = null
export const sampleSIPs: SIP[] = []

export const idealAllocation: IdealAllocation = {
  cash: 8,
  debt: 14,
  gold: 8,
  pf: 0,
}

export const annualExpensesGBP = 58736.04
export const emergencyFundBalance = 4601.02
export const emergencyFundTargetMonths = 6
