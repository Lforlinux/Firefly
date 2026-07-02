import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export function LoginForm() {
  const { login, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-white">Welcome back</h2>
        <p className="text-sm text-indigo-200/70">
          Sign in to pick up where you left off.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2.5 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wide text-indigo-200/70">
          Email
        </label>
        <div className="group relative">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-300/60 transition-colors group-focus-within:text-cyan-300" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-xl border border-indigo-400/25 bg-indigo-950/40 py-2.5 pl-10 pr-3.5 text-white placeholder-indigo-300/40 outline-none transition focus:border-cyan-300/50 focus:bg-indigo-950/60 focus:ring-2 focus:ring-cyan-400/20"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wide text-indigo-200/70">
          Password
        </label>
        <div className="group relative">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-300/60 transition-colors group-focus-within:text-cyan-300" />
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full rounded-xl border border-indigo-400/25 bg-indigo-950/40 py-2.5 pl-10 pr-11 text-white placeholder-indigo-300/40 outline-none transition focus:border-cyan-300/50 focus:bg-indigo-950/60 focus:ring-2 focus:ring-cyan-400/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-indigo-300/60 transition hover:bg-indigo-500/20 hover:text-cyan-200"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 py-2.5 font-semibold text-white shadow-[0_10px_30px_rgba(37,99,235,0.35)] transition hover:from-cyan-400 hover:to-indigo-400 hover:shadow-[0_12px_36px_rgba(37,99,235,0.5)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? 'Signing in…' : 'Sign In'}
        {!isLoading && (
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>
    </form>
  )
}
