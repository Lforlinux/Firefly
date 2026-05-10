import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { AppLayout } from '@/components/AppLayout'
import { Overview } from '@/pages/Overview'
import { Holdings } from '@/pages/Holdings'
import { Liabilities } from '@/pages/Liabilities'
import { Snapshots } from '@/pages/Snapshots'
import { Allocation } from '@/pages/Allocation'
import { Goals } from '@/pages/Goals'
import { Essentials } from '@/pages/Essentials'
import { Import } from '@/pages/Import'
import { Settings } from '@/pages/Settings'
import { NetWorthProgress } from '@/pages/NetWorthProgress'
import { Analytics } from '@/pages/Analytics'
import { DailyMovement } from '@/pages/DailyMovement'
import { SignupForm } from '@/components/SignupForm'
import { LoginForm } from '@/components/LoginForm'

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
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) return <Navigate to="/auth" replace />

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/assets" element={<Holdings />} />
        <Route path="/liabilities" element={<Liabilities />} />
        <Route path="/snapshots" element={<Snapshots />} />
        <Route path="/allocation" element={<Allocation />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/essentials" element={<Essentials />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/networth-progress" element={<NetWorthProgress />} />
        <Route path="/daily-movement" element={<DailyMovement />} />
        <Route path="/import" element={<Import />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/holdings" element={<Navigate to="/assets" replace />} />
        <Route path="/performance" element={<Navigate to="/snapshots" replace />} />
        <Route path="/sectors" element={<Navigate to="/allocation" replace />} />
        <Route path="/dividends" element={<Navigate to="/" replace />} />
        <Route path="/transactions" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
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
