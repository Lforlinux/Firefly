export type Currency = 'GBP'
export type Exchange = 'NASDAQ' | 'LSE'
export type AssetCategory = 'Equity' | 'ETF' | 'Gold' | 'Debt' | 'Cash'
export type AssetSubCategory = 'Large Cap' | 'Mid and small cap' | 'Stock' | 'Debt/Fixed' | 'Physical'

export interface Holding {
  id: string
  name: string
  symbol: string
  exchange: Exchange
  category: AssetCategory
  subCategory?: AssetSubCategory
  unitPrice: number
  units: number
  averageCost: number
  currency: Currency
  owner?: 'KLN' | 'Priya'
  broker?: 'InvestEngine' | 'Trading212'
  bank?: 'Plum' | 'HSBC' | 'Lloyds'
  addedDate?: string
  lastUpdated?: string
}

export interface NetworthSnapshot {
  month: string
  ukPortfolioGBP: number
  totalGBP: number
  cash: number
  debt: number
  equity: number
  gold: number
}

/** Single date snapshot of UK portfolio value (for growth chart) */
export interface UkPortfolioSnapshot {
  date: string
  valueGBP: number
}

export interface FIREMilestone {
  name: string
  multiplier: number
  targetAmount: number
  currentProgress: number
  yearsToReach: number
}

export interface BudgetCategory {
  id: string
  name: string
  amount: number
  currency: Currency
  spent?: number
}

export interface Expense {
  id: string
  date: string
  amount: number
  currency: Currency
  item: string
  category: string
  paymentMode?: string
  notes?: string
}

export interface DebtItem {
  id: string
  name: string
  monthlyPayment: number
  totalMonths: number
  monthsCompleted: number
  totalRemaining: number
  interestRate?: number
  currency: Currency
}

export interface Mortgage {
  loanAmount: number
  annualRate: number
  termMonths: number
  monthlyPayment: number
  extraMonthlyPayment?: number
  startDate: string
  currency: Currency
}

export interface SIP {
  id: string
  name: string
  symbol: string
  monthlyAmount: number
  investmentDate: number
  currency: Currency
  status: 'Active' | 'Paused'
  platform?: string
}

export interface IdealAllocation {
  cash: number
  debt: number
  gold: number
  pf: number
}

export interface AppState {
  ukHoldings: Holding[]
  networthHistory: NetworthSnapshot[]
  ukPortfolioHistory: UkPortfolioSnapshot[]
  totalPortfolioHistory: UkPortfolioSnapshot[]
  expenses: Expense[]
  budgets: { uk: BudgetCategory[] }
  debts: DebtItem[]
  mortgage: Mortgage | null
  emergencyFund: { balance: number; targetMonths: number; currency: Currency }
  annualExpensesGBP: number
  idealAllocation: IdealAllocation
  sipList: SIP[]
  cashAddedDatesVersion: number
  cashAddedDates: Record<string, string>
  selectedPortfolio: 'all' | 'KLN' | 'Priya'
}
