import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { AppLayout } from '@/components/AppLayout'
import { Overview } from '@/pages/Overview'
import { Holdings } from '@/pages/Holdings'
import { Performance } from '@/pages/Performance'
import { Sectors } from '@/pages/Sectors'
import { Dividends } from '@/pages/Dividends'
import { Transactions } from '@/pages/Transactions'
import { Import } from '@/pages/Import'
import { Settings } from '@/pages/Settings'
import { SignupForm } from '@/components/SignupForm'
import { LoginForm } from '@/components/LoginForm'
import { LogoutButton } from '@/components/LogoutButton'

function AuthLayout() {
  const { isLoading, isAuthenticated } = useAuth()
  const [showLogin, setShowLogin] = useState(true)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    )
  }
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {showLogin ? (
        <div className="flex flex-col items-center justify-center min-h-screen">
          <LoginForm />
          <p className="mt-4 text-center text-gray-600 dark:text-gray-400">
            Don't have an account?{' '}
            <button
              onClick={() => setShowLogin(false)}
              className="text-blue-600 hover:underline font-medium"
            >
              Sign up
            </button>
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-screen">
          <SignupForm />
          <p className="mt-4 text-center text-gray-600 dark:text-gray-400">
            Already have an account?{' '}
            <button
              onClick={() => setShowLogin(true)}
              className="text-blue-600 hover:underline font-medium"
            >
              Log in
            </button>
          </p>
        </div>
      )}
    </div>
  )
}

function ProtectedRoutes() {
  const { isAuthenticated, email } = useAuth()

  if (!isAuthenticated) return <Navigate to="/auth" replace />

  return (
    <>
      <div className="flex justify-between items-center p-4 border-b dark:border-gray-700">
        <h1 className="text-2xl font-bold">Firefly</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600 dark:text-gray-400">{email}</span>
          <LogoutButton />
        </div>
      </div>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/sectors" element={<Sectors />} />
          <Route path="/dividends" element={<Dividends />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/import" element={<Import />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/auth" element={<AuthLayout />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  )
}
