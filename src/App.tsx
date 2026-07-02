import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TrendingUp, Target, ShieldCheck, Sparkles } from 'lucide-react'
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
import { AssetDetail } from '@/pages/AssetDetail'
import { SignupForm } from '@/components/SignupForm'
import { LoginForm } from '@/components/LoginForm'

const AUTH_HIGHLIGHTS = [
  {
    icon: TrendingUp,
    title: 'See your whole net worth',
    body: 'Every holding — index funds, EPF, cash — valued together in one live picture.',
  },
  {
    icon: Target,
    title: 'Track your path to FIRE',
    body: 'Projections and goals that show exactly how close you are to financial independence.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Your data stays yours. Nothing leaves your account without you asking.',
  },
]

function AuthLayout() {
  const { isLoading, isAuthenticated } = useAuth()
  const [showLogin, setShowLogin] = useState(true)

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050816]">
        <div className="flex items-center gap-3 text-indigo-200/80">
          <Sparkles className="h-5 w-5 animate-pulse text-cyan-300" />
          <p className="text-lg">Loading…</p>
        </div>
      </div>
    )
  }
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-indigo-50 bg-[radial-gradient(circle_at_10%_10%,rgba(79,70,229,0.30),transparent_32%),radial-gradient(circle_at_90%_15%,rgba(37,99,235,0.24),transparent_28%),radial-gradient(circle_at_55%_75%,rgba(99,102,241,0.22),transparent_36%),linear-gradient(180deg,#050816_0%,#0b1028_45%,#060a1a_100%)]">
      {/* Ambient glow + firefly particles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-16 h-72 w-72 animate-pulse rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -right-20 bottom-10 h-80 w-80 animate-pulse rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute left-[12%] top-[18%] h-1 w-1 rounded-full bg-indigo-200 shadow-[0_0_10px_rgba(165,180,252,0.8)] [animation:pulse_3s_ease-in-out_infinite]" />
        <div className="absolute right-[22%] top-[30%] h-1 w-1 rounded-full bg-indigo-100 shadow-[0_0_10px_rgba(224,231,255,0.9)] [animation:pulse_4.4s_ease-in-out_infinite]" />
        <div className="absolute left-[40%] top-[60%] h-1 w-1 rounded-full bg-cyan-200 shadow-[0_0_10px_rgba(103,232,249,0.9)] [animation:pulse_5s_ease-in-out_infinite]" />
        <div className="absolute right-[35%] bottom-[20%] h-1.5 w-1.5 rounded-full bg-cyan-100 shadow-[0_0_12px_rgba(165,243,252,0.9)] [animation:pulse_3.6s_ease-in-out_infinite]" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:gap-16">
        {/* Brand / hero panel */}
        <div className="hidden flex-col justify-center lg:flex">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 shadow-[0_8px_24px_rgba(37,99,235,0.45)]">
              <Sparkles className="h-6 w-6 text-white" />
            </span>
            <span className="text-2xl font-bold tracking-tight text-white">Firefly</span>
          </div>

          <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight text-white">
            Your journey to{' '}
            <span className="bg-gradient-to-r from-cyan-300 to-indigo-300 bg-clip-text text-transparent">
              financial independence
            </span>
            , in one clear view.
          </h1>
          <p className="mt-4 max-w-md text-indigo-200/70">
            Firefly brings every account, asset, and goal together so you always know
            where you stand — and how far you have to go.
          </p>

          <ul className="mt-9 space-y-5">
            {AUTH_HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-400/25 bg-indigo-900/50 text-cyan-300">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-semibold text-white">{title}</p>
                  <p className="text-sm text-indigo-200/65">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Form panel */}
        <div className="flex flex-col items-center justify-center">
          {/* Compact brand for mobile */}
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 shadow-[0_8px_24px_rgba(37,99,235,0.45)]">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <span className="text-xl font-bold tracking-tight text-white">Firefly</span>
          </div>

          <div className="w-full max-w-sm rounded-3xl border border-indigo-400/25 bg-indigo-950/55 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_60px_rgba(5,8,22,0.65)] backdrop-blur-xl sm:p-8">
            {showLogin ? <LoginForm /> : <SignupForm />}

            <div className="mt-6 border-t border-indigo-400/15 pt-5 text-center text-sm text-indigo-200/70">
              {showLogin ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    onClick={() => setShowLogin(false)}
                    className="font-semibold text-cyan-300 transition hover:text-cyan-200"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={() => setShowLogin(true)}
                    className="font-semibold text-cyan-300 transition hover:text-cyan-200"
                  >
                    Log in
                  </button>
                </>
              )}
            </div>
          </div>

          <p className="mt-6 max-w-sm text-center text-xs text-indigo-300/45">
            Track index funds, EPF, cash and more — all in one place.
          </p>
        </div>
      </div>
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
        <Route path="/assets/:ticker" element={<AssetDetail />} />
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
