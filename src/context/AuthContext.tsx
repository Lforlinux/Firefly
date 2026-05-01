/**
 * Authentication context: cookie-based JWT, session restoration on mount.
 * Handles signup, login, logout, and automatic token refresh from cookies.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface AuthState {
  userId: string | null
  email: string | null
  isAuthenticated: boolean
  isLoading: boolean
  signup: (email: string, password: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Restore session from cookies on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const res = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include', // Auto-send cookie with request
        })
        if (res.ok) {
          const data = await res.json()
          setUserId(data.userId)
          setEmail(data.email)
        }
      } catch (err) {
        console.error('Failed to restore session:', err)
      } finally {
        setIsLoading(false)
      }
    }

    restoreSession()
  }, [])

  const signup = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Signup failed')
    }

    const data = await res.json()
    setUserId(data.userId)
    setEmail(data.email)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Login failed')
    }

    const data = await res.json()
    setUserId(data.userId)
    setEmail(data.email)
  }, [])

  const logout = useCallback(async () => {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })

    if (!res.ok) {
      throw new Error('Logout failed')
    }

    setUserId(null)
    setEmail(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      userId,
      email,
      isAuthenticated: userId !== null,
      isLoading,
      signup,
      login,
      logout,
    }),
    [userId, email, isLoading, signup, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

export { AuthProvider }
