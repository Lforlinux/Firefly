/**
 * App-wide context: react-query client + UI prefs (theme, owner filter).
 * Server data flows through `usePortfolio()` and the mutation hooks.
 */
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getPortfolio, savePortfolio, refreshPrices, postSnapshot } from '@/services/api'
import type { OwnerFilter, Portfolio } from '@/types'
import { AuthProvider } from './AuthContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

const THEME_KEY = 'firefly.theme'
const OWNER_KEY = 'firefly.owner'

type Theme = 'light' | 'dark'

interface UiState {
  theme: Theme
  toggleTheme: () => void
  selectedOwner: OwnerFilter
  setSelectedOwner: (o: OwnerFilter) => void
}

const UiContext = createContext<UiState | null>(null)

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch { /* ignore */ }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function loadOwner(): OwnerFilter {
  try {
    const v = localStorage.getItem(OWNER_KEY)
    if (v) return v
  } catch { /* ignore */ }
  return 'all'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

function UiProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [selectedOwner, setSelectedOwnerState] = useState<OwnerFilter>(() => loadOwner())

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  const setSelectedOwner = useCallback((o: OwnerFilter) => {
    setSelectedOwnerState(o)
    try { localStorage.setItem(OWNER_KEY, o) } catch { /* ignore */ }
  }, [])

  const value = useMemo<UiState>(
    () => ({ theme, toggleTheme, selectedOwner, setSelectedOwner }),
    [theme, toggleTheme, selectedOwner, setSelectedOwner],
  )
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UiProvider>{children}</UiProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export function useUi(): UiState {
  const v = useContext(UiContext)
  if (!v) throw new Error('useUi must be used inside AppProvider')
  return v
}

// ---------- data hooks ---------------------------------------------------

export function usePortfolio() {
  return useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: getPortfolio,
  })
}

export function useRefreshPrices() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: refreshPrices,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portfolio'] }) },
  })
}

export function useSavePortfolio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: savePortfolio,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portfolio'] }) },
  })
}

export function usePostSnapshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ date, valueGBP }: { date: string; valueGBP: number }) => postSnapshot(date, valueGBP),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portfolio'] }) },
  })
}
