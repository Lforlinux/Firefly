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
import { getPortfolio, savePortfolio, refreshPrices, postSnapshot, postDailyMovement } from '@/services/api'
import type { CountryFilter, OwnerFilter, Portfolio } from '@/types'
import { AuthProvider } from './AuthContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,   // 5 min — consider data fresh for 5 min
      gcTime:    30 * 60_000,  // keep cache warm for 30 min of inactivity
      refetchOnWindowFocus: true,  // re-fetch when user returns to tab
      refetchOnReconnect: true,    // re-fetch when network comes back
      retry: 1,
    },
  },
})

const THEME_KEY = 'firefly.theme'
const OWNER_KEY = 'firefly.owner'
const PRIVACY_KEY = 'firefly.privacy'
const VISUAL_STYLE_KEY = 'firefly.visualStyle'
const COUNTRY_KEY = 'firefly.country'

type Theme = 'light' | 'dark'
type VisualStyle = 'minimal' | 'premium3d'

interface UiState {
  theme: Theme
  toggleTheme: () => void
  visualStyle: VisualStyle
  toggleVisualStyle: () => void
  privacyMode: boolean
  togglePrivacyMode: () => void
  selectedOwner: OwnerFilter
  setSelectedOwner: (o: OwnerFilter) => void
  selectedCountry: CountryFilter
  setSelectedCountry: (c: CountryFilter) => void
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

function loadPrivacyMode(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === '1'
  } catch {
    return false
  }
}

function loadCountry(): CountryFilter {
  try {
    const v = localStorage.getItem(COUNTRY_KEY)
    if (v === 'UK' || v === 'India') return v
  } catch { /* ignore */ }
  return 'UK' // Default to UK — India is explicitly opt-in via flag
}

function loadVisualStyle(): VisualStyle {
  try {
    const v = localStorage.getItem(VISUAL_STYLE_KEY)
    if (v === 'minimal' || v === 'premium3d') return v
  } catch {
    // ignore
  }
  return 'premium3d'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

function applyVisualStyle(style: VisualStyle) {
  const root = document.documentElement
  if (style === 'premium3d') root.classList.add('ff-3d')
  else root.classList.remove('ff-3d')
}

function UiProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(() => loadVisualStyle())
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => loadPrivacyMode())
  const [selectedOwner, setSelectedOwnerState] = useState<OwnerFilter>(() => loadOwner())
  const [selectedCountry, setSelectedCountryState] = useState<CountryFilter>(() => loadCountry())

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    applyVisualStyle(visualStyle)
    try { localStorage.setItem(VISUAL_STYLE_KEY, visualStyle) } catch { /* ignore */ }
  }, [visualStyle])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  const toggleVisualStyle = useCallback(() => setVisualStyle((v) => (v === 'minimal' ? 'premium3d' : 'minimal')), [])
  const togglePrivacyMode = useCallback(() => {
    setPrivacyMode((v) => {
      const next = !v
      try { localStorage.setItem(PRIVACY_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const setSelectedOwner = useCallback((o: OwnerFilter) => {
    setSelectedOwnerState(o)
    try { localStorage.setItem(OWNER_KEY, o) } catch { /* ignore */ }
  }, [])
  const setSelectedCountry = useCallback((c: CountryFilter) => {
    setSelectedCountryState(c)
    try { localStorage.setItem(COUNTRY_KEY, c) } catch { /* ignore */ }
  }, [])

  const value = useMemo<UiState>(
    () => ({ theme, toggleTheme, visualStyle, toggleVisualStyle, privacyMode, togglePrivacyMode, selectedOwner, setSelectedOwner, selectedCountry, setSelectedCountry }),
    [theme, toggleTheme, visualStyle, toggleVisualStyle, privacyMode, togglePrivacyMode, selectedOwner, setSelectedOwner, selectedCountry, setSelectedCountry],
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
    refetchInterval: 15 * 60_000, // poll every 15 min so cron updates appear automatically
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

export function usePostDailyMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ date, owner, movementGBP, portfolioValueGBP }: {
      date: string; owner: string; movementGBP: number; portfolioValueGBP: number | null
    }) => postDailyMovement(date, owner, movementGBP, portfolioValueGBP),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portfolio'] }) },
  })
}
