import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react'
import type { AppState, Holding, Exchange, UkPortfolioSnapshot } from '@/types'

function cashAddedDateKey(h: Holding): string {
  if (h.category === 'Cash' || h.symbol === 'CASH') {
    return `cash-${h.bank ?? h.name}-${h.owner ?? ''}`
  }
  return h.id
}

function normalizeToYYYYMMDD(s: string | undefined): string | undefined {
  if (!s || s.trim() === '') return undefined
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = new Date(t)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return undefined
}

import {
  ukHoldings,
  networthHistory,
  sampleExpenses,
  ukBudgetTemplate,
  sampleDebts,
  sampleMortgage,
  sampleSIPs,
  idealAllocation,
  annualExpensesGBP,
  emergencyFundBalance,
  emergencyFundTargetMonths,
} from '@/data/sampleData'

const STORAGE_KEY = 'personal-fin-app-state'
const BUDGETS_STORAGE_KEY = 'personal-fin-app-budgets'
const EMERGENCY_FUND_STORAGE_KEY = 'personal-fin-app-emergency-fund'
const UK_PORTFOLIO_HISTORY_KEY = 'personal-fin-app-uk-portfolio-history'
const TOTAL_PORTFOLIO_HISTORY_KEY = 'personal-fin-app-total-portfolio-history'
const API_KEY_KEY = 'personal-fin-app-alpha-vantage-key'
const TWELVEDATA_KEY_KEY = 'personal-fin-app-twelvedata-key'
const CASH_ADDED_DATES_KEY = 'personal-fin-app-cash-added-dates'
const SELECTED_PORTFOLIO_KEY = 'personal-fin-app-selected-portfolio'

function ensureHoldingHasExchange(h: Holding): Holding {
  if ('exchange' in h && (h as Holding).exchange) return h as Holding
  return { ...h, exchange: 'LSE' as Exchange } as Holding
}

function loadSavedHoldings(): { uk: Holding[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const uk = parsed?.ukHoldings ?? parsed?.uk
      if (Array.isArray(uk)) {
        const result = uk.map((h: Holding) => ensureHoldingHasExchange(h))
        result.forEach((h: Holding) => {
          if ((h.category === 'Cash' || h.symbol === 'CASH') && h.addedDate) {
            persistCashAddedDate(cashAddedDateKey(h), h.addedDate)
          }
        })
        return { uk: result }
      }
    }
  } catch {
    /* ignore */
  }
  return { uk: ukHoldings }
}

function getCashAddedDatesFromStorage(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CASH_ADDED_DATES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>
    }
  } catch {
    /* ignore */
  }
  return {}
}

function persistCashAddedDate(holdingId: string, date: string | undefined) {
  try {
    const map = getCashAddedDatesFromStorage()
    if (date) map[holdingId] = date
    else delete map[holdingId]
    localStorage.setItem(CASH_ADDED_DATES_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

function loadSelectedPortfolio(): AppState['selectedPortfolio'] {
  try {
    const raw = localStorage.getItem(SELECTED_PORTFOLIO_KEY)
    if (raw === 'KLN' || raw === 'Priya' || raw === 'all') return raw
  } catch {
    /* ignore */
  }
  return 'all'
}

function loadSavedBudgets(): AppState['budgets'] {
  try {
    const raw = localStorage.getItem(BUDGETS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const uk = parsed?.uk ?? parsed?.ukBudget
      if (Array.isArray(uk)) return { uk }
    }
  } catch {
    /* ignore */
  }
  return { uk: ukBudgetTemplate }
}

function persistBudgets(budgets: AppState['budgets']) {
  try {
    localStorage.setItem(BUDGETS_STORAGE_KEY, JSON.stringify(budgets))
  } catch {
    /* ignore */
  }
}

function loadSavedEmergencyFund(): AppState['emergencyFund'] {
  try {
    const raw = localStorage.getItem(EMERGENCY_FUND_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.balance === 'number' && typeof parsed.targetMonths === 'number') {
        return {
          balance: parsed.balance,
          targetMonths: parsed.targetMonths,
          currency: (parsed.currency as AppState['emergencyFund']['currency']) || 'GBP',
        }
      }
    }
  } catch {
    /* ignore */
  }
  return {
    balance: emergencyFundBalance,
    targetMonths: emergencyFundTargetMonths,
    currency: 'GBP',
  }
}

function persistEmergencyFund(ef: AppState['emergencyFund']) {
  try {
    localStorage.setItem(EMERGENCY_FUND_STORAGE_KEY, JSON.stringify(ef))
  } catch {
    /* ignore */
  }
}

function loadUkPortfolioHistory(): UkPortfolioSnapshot[] {
  try {
    const raw = localStorage.getItem(UK_PORTFOLIO_HISTORY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((p: unknown) => typeof p === 'object' && p !== null && 'date' in p && 'valueGBP' in p)) {
        return (parsed as UkPortfolioSnapshot[]).sort((a, b) => a.date.localeCompare(b.date))
      }
    }
  } catch {
    /* ignore */
  }
  // No seed: chart builds only from real snapshots (one per day when you open the dashboard)
  return []
}

function persistUkPortfolioHistory(history: UkPortfolioSnapshot[]) {
  try {
    localStorage.setItem(UK_PORTFOLIO_HISTORY_KEY, JSON.stringify(history))
  } catch {
    /* ignore */
  }
}

function loadTotalPortfolioHistory(): UkPortfolioSnapshot[] {
  try {
    const raw = localStorage.getItem(TOTAL_PORTFOLIO_HISTORY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((p: unknown) => typeof p === 'object' && p !== null && 'date' in p && 'valueGBP' in p)) {
        return (parsed as UkPortfolioSnapshot[]).sort((a, b) => a.date.localeCompare(b.date))
      }
    }
  } catch {
    /* ignore */
  }
  return []
}

function persistTotalPortfolioHistory(history: UkPortfolioSnapshot[]) {
  try {
    localStorage.setItem(TOTAL_PORTFOLIO_HISTORY_KEY, JSON.stringify(history))
  } catch {
    /* ignore */
  }
}

const { uk: initialUk } = loadSavedHoldings()
const initialBudgets = loadSavedBudgets()
const initialEmergencyFund = loadSavedEmergencyFund()

const defaultState: AppState = {
  ukHoldings: initialUk,
  networthHistory,
  ukPortfolioHistory: loadUkPortfolioHistory(),
  totalPortfolioHistory: loadTotalPortfolioHistory(),
  expenses: sampleExpenses,
  budgets: initialBudgets,
  debts: sampleDebts,
  mortgage: sampleMortgage,
  emergencyFund: initialEmergencyFund,
  annualExpensesGBP,
  idealAllocation,
  sipList: sampleSIPs,
  cashAddedDatesVersion: 0,
  cashAddedDates: getCashAddedDatesFromStorage(),
  selectedPortfolio: loadSelectedPortfolio(),
}

type Portfolio = 'uk'

type AppContextValue = AppState & {
  addHolding: (portfolio: Portfolio, holding: Omit<Holding, 'id'>) => void
  importHoldings: (portfolio: Portfolio, holdings: Omit<Holding, 'id'>[]) => void
  replaceHoldingsByBroker: (portfolio: Portfolio, broker: 'InvestEngine' | 'Trading212', holdings: Omit<Holding, 'id'>[]) => void
  clearPortfolio: (portfolio: Portfolio) => void
  removeHolding: (portfolio: Portfolio, id: string) => void
  updateHoldingPrice: (portfolio: Portfolio, id: string, unitPrice: number) => void
  updateHoldingBroker: (portfolio: Portfolio, id: string, broker: 'InvestEngine' | 'Trading212' | null) => void
  updateHoldingAddedDate: (portfolio: Portfolio, id: string, addedDate: string | undefined) => void
  getCashAddedDate: (holding: Holding) => string | undefined
  updateBudgetCategory: (id: string, updates: { name?: string; amount?: number }) => void
  setEmergencyFundBalance: (balance: number) => void
  recordUkPortfolioSnapshot: (valueGBP: number) => void
  recordTotalPortfolioSnapshot: (valueGBP: number) => void
  setUkPortfolioHistoryFromCsv: (snapshots: UkPortfolioSnapshot[]) => void
  setTotalPortfolioHistoryFromCsv: (snapshots: UkPortfolioSnapshot[]) => void
  getPriceApiKey: () => string | undefined
  setPriceApiKey: (key: string) => void
  getTwelveDataKey: () => string | undefined
  setTwelveDataKey: (key: string) => void
  setSelectedPortfolio: (p: AppState['selectedPortfolio']) => void
}

const AppContext = createContext<AppContextValue | null>(null)

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function persistHoldings(uk: Holding[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ukHoldings: uk }))
  } catch {
    /* ignore */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState)

  const addHolding = useCallback((_portfolio: Portfolio, holding: Omit<Holding, 'id'>) => {
    const h: Holding = { ...holding, id: generateId() }
    if ((h.category === 'Cash' || h.symbol === 'CASH') && h.addedDate) {
      persistCashAddedDate(cashAddedDateKey(h), h.addedDate)
      persistCashAddedDate(h.id, h.addedDate)
    }
    setState((s) => {
      const uk = [...s.ukHoldings, h]
      persistHoldings(uk)
      let nextCashDates = s.cashAddedDates
      if ((h.category === 'Cash' || h.symbol === 'CASH') && h.addedDate) {
        nextCashDates = { ...s.cashAddedDates, [cashAddedDateKey(h)]: h.addedDate, [h.id]: h.addedDate }
      }
      return {
        ...s,
        ukHoldings: uk,
        cashAddedDatesVersion: (h.category === 'Cash' || h.symbol === 'CASH') && h.addedDate ? s.cashAddedDatesVersion + 1 : s.cashAddedDatesVersion,
        cashAddedDates: nextCashDates,
      }
    })
  }, [])

  const importHoldings = useCallback((_portfolio: Portfolio, holdings: Omit<Holding, 'id'>[]) => {
    if (holdings.length === 0) return
    const withIds = holdings.map((h) => ({ ...h, id: generateId() } as Holding))
    setState((s) => {
      const uk = [...s.ukHoldings, ...withIds]
      persistHoldings(uk)
      return { ...s, ukHoldings: uk }
    })
  }, [])

  const replaceHoldingsByBroker = useCallback(
    (_portfolio: Portfolio, broker: 'InvestEngine' | 'Trading212', holdings: Omit<Holding, 'id'>[]) => {
      const ownersInImport = new Set(holdings.map((h) => h.owner ?? undefined))
      const withIds = holdings.map((h) => ({ ...h, id: generateId(), broker } as Holding))
      setState((s) => {
        const rest = s.ukHoldings.filter(
          (h) => h.broker !== broker || !ownersInImport.has(h.owner ?? undefined)
        )
        const uk = [...rest, ...withIds]
        persistHoldings(uk)
        return { ...s, ukHoldings: uk }
      })
    },
    []
  )

  const clearPortfolio = useCallback((_portfolio: Portfolio) => {
    setState((s) => {
      persistHoldings([])
      persistUkPortfolioHistory([])
      persistTotalPortfolioHistory([])
      try {
        localStorage.setItem(CASH_ADDED_DATES_KEY, '{}')
      } catch {
        /* ignore */
      }
      return {
        ...s,
        ukHoldings: [],
        ukPortfolioHistory: [],
        totalPortfolioHistory: [],
        cashAddedDates: {},
      }
    })
  }, [])

  const removeHolding = useCallback((_portfolio: Portfolio, id: string) => {
    setState((s) => {
      const uk = s.ukHoldings.filter((x) => x.id !== id)
      persistHoldings(uk)
      return { ...s, ukHoldings: uk }
    })
  }, [])

  const updateHoldingPrice = useCallback((_portfolio: Portfolio, id: string, unitPrice: number) => {
    const now = new Date().toISOString()
    setState((s) => {
      const uk = s.ukHoldings.map((x) => (x.id === id ? { ...x, unitPrice, lastUpdated: now } : x))
      persistHoldings(uk)
      return { ...s, ukHoldings: uk }
    })
  }, [])

  const updateHoldingBroker = useCallback((_portfolio: Portfolio, id: string, broker: 'InvestEngine' | 'Trading212' | null) => {
    setState((s) => {
      const uk = s.ukHoldings.map((x) => (x.id === id ? { ...x, broker: broker ?? undefined } : x))
      persistHoldings(uk)
      return { ...s, ukHoldings: uk }
    })
  }, [])

  const updateHoldingAddedDate = useCallback((_portfolio: Portfolio, id: string, addedDate: string | undefined) => {
    const normalized = normalizeToYYYYMMDD(addedDate ?? '') ?? undefined
    setState((s) => {
      const holding = s.ukHoldings.find((x) => x.id === id)
      const key = holding ? cashAddedDateKey(holding) : id
      persistCashAddedDate(key, normalized)
      if (holding) persistCashAddedDate(holding.id, normalized)
      const nextCashDates = { ...s.cashAddedDates }
      if (normalized) nextCashDates[key] = normalized
      else delete nextCashDates[key]
      if (holding) {
        if (normalized) nextCashDates[holding.id] = normalized
        else delete nextCashDates[holding.id]
      }
      const uk = s.ukHoldings.map((x) => (x.id === id ? { ...x, addedDate: normalized } : x))
      persistHoldings(uk)
      return {
        ...s,
        ukHoldings: uk,
        cashAddedDatesVersion: s.cashAddedDatesVersion + 1,
        cashAddedDates: nextCashDates,
      }
    })
  }, [])

  const getCashAddedDate = useCallback(
    (h: Holding) => {
      const key = cashAddedDateKey(h)
      return state.cashAddedDates[key] ?? state.cashAddedDates[h.id]
    },
    [state.cashAddedDates]
  )

  const getPriceApiKey = useCallback(() => {
    try {
      const stored = localStorage.getItem(API_KEY_KEY)
      if (stored) return stored.trim()
    } catch {
      /* ignore */
    }
    const env = import.meta.env.VITE_ALPHA_VANTAGE_KEY
    return typeof env === 'string' ? env.trim() : env
  }, [])

  const setPriceApiKey = useCallback((key: string) => {
    try {
      localStorage.setItem(API_KEY_KEY, key.trim())
    } catch {
      /* ignore */
    }
  }, [])

  const getTwelveDataKey = useCallback(() => {
    try {
      const stored = localStorage.getItem(TWELVEDATA_KEY_KEY)
      if (stored) return stored.trim()
    } catch {
      /* ignore */
    }
    const env = import.meta.env.VITE_TWELVEDATA_KEY
    return typeof env === 'string' ? env.trim() : env
  }, [])

  const setTwelveDataKey = useCallback((key: string) => {
    try {
      localStorage.setItem(TWELVEDATA_KEY_KEY, key.trim())
    } catch {
      /* ignore */
    }
  }, [])

  const setSelectedPortfolio = useCallback((p: AppState['selectedPortfolio']) => {
    try {
      localStorage.setItem(SELECTED_PORTFOLIO_KEY, p)
    } catch {
      /* ignore */
    }
    setState((s) => ({ ...s, selectedPortfolio: p }))
  }, [])

  const updateBudgetCategory = useCallback(
    (id: string, updates: { name?: string; amount?: number }) => {
      setState((s) => {
        const uk = s.budgets.uk.map((b) =>
          b.id === id ? { ...b, ...(updates.name !== undefined && { name: updates.name }), ...(updates.amount !== undefined && { amount: updates.amount }) } : b
        )
        persistBudgets({ uk })
        return { ...s, budgets: { uk } }
      })
    },
    []
  )

  const setEmergencyFundBalance = useCallback((balance: number) => {
    setState((s) => {
      const next = { ...s.emergencyFund, balance }
      persistEmergencyFund(next)
      return { ...s, emergencyFund: next }
    })
  }, [])

  const recordUkPortfolioSnapshot = useCallback((valueGBP: number) => {
    const today = new Date().toISOString().slice(0, 10)
    setState((s) => {
      const existing = s.ukPortfolioHistory.find((p) => p.date === today)
      const next = existing
        ? s.ukPortfolioHistory.map((p) => (p.date === today ? { ...p, valueGBP } : p))
        : [...s.ukPortfolioHistory, { date: today, valueGBP }].sort((a, b) => a.date.localeCompare(b.date))
      persistUkPortfolioHistory(next)
      return { ...s, ukPortfolioHistory: next }
    })
  }, [])

  const recordTotalPortfolioSnapshot = useCallback((valueGBP: number) => {
    const today = new Date().toISOString().slice(0, 10)
    setState((s) => {
      const existing = s.totalPortfolioHistory.find((p) => p.date === today)
      const next = existing
        ? s.totalPortfolioHistory.map((p) => (p.date === today ? { ...p, valueGBP } : p))
        : [...s.totalPortfolioHistory, { date: today, valueGBP }].sort((a, b) => a.date.localeCompare(b.date))
      persistTotalPortfolioHistory(next)
      return { ...s, totalPortfolioHistory: next }
    })
  }, [])

  const setUkPortfolioHistoryFromCsv = useCallback((snapshots: UkPortfolioSnapshot[]) => {
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
    setState((s) => {
      persistUkPortfolioHistory(sorted)
      return { ...s, ukPortfolioHistory: sorted }
    })
  }, [])

  const setTotalPortfolioHistoryFromCsv = useCallback((snapshots: UkPortfolioSnapshot[]) => {
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
    setState((s) => {
      persistTotalPortfolioHistory(sorted)
      return { ...s, totalPortfolioHistory: sorted }
    })
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      addHolding,
      importHoldings,
      replaceHoldingsByBroker,
      clearPortfolio,
      removeHolding,
      updateHoldingPrice,
      updateHoldingBroker,
      updateHoldingAddedDate,
      getCashAddedDate,
      updateBudgetCategory,
      setEmergencyFundBalance,
      recordUkPortfolioSnapshot,
      recordTotalPortfolioSnapshot,
      setUkPortfolioHistoryFromCsv,
      setTotalPortfolioHistoryFromCsv,
      getPriceApiKey,
      setPriceApiKey,
      getTwelveDataKey,
      setTwelveDataKey,
      setSelectedPortfolio,
    }),
    [state, addHolding, importHoldings, replaceHoldingsByBroker, clearPortfolio, removeHolding, updateHoldingPrice, updateHoldingBroker, updateHoldingAddedDate, getCashAddedDate, updateBudgetCategory, setEmergencyFundBalance, recordUkPortfolioSnapshot, recordTotalPortfolioSnapshot, setUkPortfolioHistoryFromCsv, setTotalPortfolioHistoryFromCsv, getPriceApiKey, setPriceApiKey, getTwelveDataKey, setTwelveDataKey, setSelectedPortfolio]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
