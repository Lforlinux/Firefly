import { useMemo } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Brain,
  Eye,
  EyeOff,
  Flame,
  Goal,
  HandCoins,
  Home,
  Layers3,
  LogOut,
  Moon,
  PieChart,
  PlusCircle,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  Upload,
  Vault,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { usePortfolio, useRefreshPrices, useUi } from '@/context/AppContext'
import type { CountryFilter } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { listOwners } from '@/utils/calculations'
import { formatRelative } from '@/utils/format'

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean }
const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Home, end: true },
  { to: '/assets', label: 'Assets', icon: Vault },
  { to: '/liabilities', label: 'Liabilities', icon: HandCoins },
  { to: '/snapshots', label: 'Wealth Timeline', icon: PlusCircle },
  { to: '/allocation', label: 'Allocation', icon: PieChart },
  { to: '/goals', label: 'Goals', icon: Goal },
  { to: '/essentials', label: 'Essentials', icon: ShieldCheck },
  { to: '/analytics', label: 'Analytics', icon: Brain },
  { to: '/import', label: 'Import', icon: Upload },
]
const MOBILE_NAV = NAV.slice(0, 5)

export function AppLayout() {
  const { theme, toggleTheme, visualStyle, privacyMode, togglePrivacyMode, selectedOwner, setSelectedOwner, selectedCountry, setSelectedCountry } = useUi()
  const { logout } = useAuth()
  const { data: portfolio } = usePortfolio()
  const refresh = useRefreshPrices()
  const owners = useMemo(() => (portfolio ? listOwners(portfolio.holdings) : []), [portfolio])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    visualStyle === 'premium3d'
      ? [
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-indigo-500/30 text-cyan-200 shadow-[0_0_16px_rgba(59,130,246,0.35)]'
            : 'text-cyan-200/85 hover:bg-indigo-500/20 hover:text-cyan-100',
        ].join(' ')
      : [
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white',
        ].join(' ')

  const mobileNavClass = ({ isActive }: { isActive: boolean }) =>
    visualStyle === 'premium3d'
      ? [
          'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-all',
          isActive ? 'bg-indigo-500/25 text-cyan-100' : 'text-cyan-200/75',
        ].join(' ')
      : [
          'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-all',
          isActive
            ? 'bg-slate-100 text-slate-900 dark:bg-slate-800/80 dark:text-white'
            : 'text-slate-500 dark:text-slate-400',
        ].join(' ')

  const ownerBtnClass = (active: boolean) =>
    visualStyle === 'premium3d'
      ? [
          'rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all',
          active
            ? 'border-indigo-300/40 bg-indigo-800/65 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_10px_22px_rgba(37,99,235,0.3)]'
            : 'border-indigo-300/30 bg-indigo-900/45 text-cyan-100/90 hover:bg-indigo-800/55',
        ].join(' ')
      : [
          'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
          active
            ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80',
        ].join(' ')

  return (
    <div className={
      visualStyle === 'premium3d'
        ? 'min-h-screen text-indigo-50 bg-[radial-gradient(circle_at_10%_10%,rgba(79,70,229,0.30),transparent_32%),radial-gradient(circle_at_90%_15%,rgba(37,99,235,0.24),transparent_28%),radial-gradient(circle_at_55%_70%,rgba(99,102,241,0.22),transparent_36%),linear-gradient(180deg,#050816_0%,#0b1028_45%,#060a1a_100%)]'
        : 'min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100'
    }>
      {visualStyle === 'premium3d' && (
        <>
          <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <div className="absolute -left-24 top-16 h-72 w-72 animate-pulse rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="absolute right-0 top-1/4 h-80 w-80 animate-pulse rounded-full bg-blue-500/15 blur-3xl [animation-delay:800ms]" />
            <div className="absolute bottom-8 left-1/3 h-64 w-64 animate-pulse rounded-full bg-fuchsia-500/10 blur-3xl [animation-delay:1400ms]" />
          </div>
          <div className="pointer-events-none fixed inset-0 -z-10 opacity-40">
            <div className="absolute left-[12%] top-[18%] h-1 w-1 rounded-full bg-indigo-200 shadow-[0_0_10px_rgba(165,180,252,0.8)] [animation:pulse_3s_ease-in-out_infinite]" />
            <div className="absolute left-[28%] top-[42%] h-1 w-1 rounded-full bg-sky-200 shadow-[0_0_10px_rgba(125,211,252,0.8)] [animation:pulse_4s_ease-in-out_infinite]" />
            <div className="absolute left-[47%] top-[22%] h-1 w-1 rounded-full bg-fuchsia-200 shadow-[0_0_10px_rgba(245,208,254,0.8)] [animation:pulse_3.6s_ease-in-out_infinite]" />
            <div className="absolute right-[22%] top-[30%] h-1 w-1 rounded-full bg-indigo-100 shadow-[0_0_10px_rgba(224,231,255,0.9)] [animation:pulse_4.4s_ease-in-out_infinite]" />
            <div className="absolute right-[14%] top-[56%] h-1 w-1 rounded-full bg-sky-100 shadow-[0_0_10px_rgba(224,242,254,0.9)] [animation:pulse_5s_ease-in-out_infinite]" />
            <div className="absolute left-[36%] bottom-[20%] h-1 w-1 rounded-full bg-fuchsia-100 shadow-[0_0_10px_rgba(250,232,255,0.9)] [animation:pulse_4.2s_ease-in-out_infinite]" />
          </div>
        </>
      )}
      <div className="mx-auto flex max-w-screen-2xl">
        <aside className={
          visualStyle === 'premium3d'
            ? 'sticky top-0 hidden h-screen w-72 border-r p-4 backdrop-blur lg:flex lg:flex-col border-indigo-400/30 bg-indigo-950/75 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_45px_rgba(15,23,42,0.55)]'
            : 'sticky top-0 hidden h-screen w-72 border-r border-slate-200/80 bg-white/85 p-4 backdrop-blur dark:border-slate-800/90 dark:bg-slate-950/85 lg:flex lg:flex-col'
        }>
          <div className="flex items-center gap-2 px-2">
            <Flame className="h-5 w-5 text-amber-500" />
            <span className={`text-sm font-semibold tracking-tight ${visualStyle === 'premium3d' ? 'text-cyan-100' : ''}`}>Firefly</span>
          </div>

          <div className={[
            'mt-4 rounded-xl border border-slate-200/80 bg-white/70 p-2 dark:border-slate-800 dark:bg-slate-900/50',
            visualStyle === 'premium3d' ? 'ff-refresh-shell border-indigo-400/35 bg-indigo-950/65' : '',
          ].join(' ')}>
            <button
              type="button"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className={[
                'ff-refresh-btn inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-60',
                visualStyle === 'premium3d'
                  ? 'border-cyan-300/35 bg-indigo-900/80 text-cyan-100 hover:bg-indigo-800/85'
                  : 'border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
              {refresh.isPending ? 'Refreshing' : 'Refresh data'}
            </button>
            <div className={`ff-refresh-meta px-1 pt-2 text-xs ${visualStyle === 'premium3d' ? 'text-cyan-100/95' : 'text-slate-500'}`}>
              Last refresh: {formatRelative(portfolio?.lastRefresh || null)}
            </div>
          </div>

          <div className={[
            'mt-5 rounded-xl border border-slate-200/80 bg-white/65 p-2 dark:border-slate-800 dark:bg-slate-900/40',
            visualStyle === 'premium3d'
              ? 'border-indigo-400/30 bg-gradient-to-br from-indigo-900/55 to-slate-900/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_28px_rgba(15,23,42,0.42)]'
              : '',
          ].join(' ')}>
            <div className={`px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider ${visualStyle === 'premium3d' ? 'text-cyan-200/90' : 'text-slate-500'}`}>Country</div>
            <div className="flex gap-2">
              {(['UK', 'India'] as CountryFilter[]).map((c) => {
                const flag = c === 'UK' ? '🇬🇧' : '🇮🇳'
                const active = selectedCountry === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedCountry(c as CountryFilter)}
                    title={`${c} holdings`}
                    className={[
                      'flex-1 rounded-lg py-1.5 text-lg leading-none transition-all',
                      visualStyle === 'premium3d'
                        ? active
                          ? 'bg-indigo-700/70 shadow-[0_0_10px_rgba(99,102,241,0.5)] ring-1 ring-indigo-300/40'
                          : 'opacity-40 hover:opacity-80 hover:bg-indigo-900/40'
                        : active
                          ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100'
                          : 'opacity-40 hover:opacity-80 hover:bg-slate-100 dark:hover:bg-slate-800',
                    ].join(' ')}
                  >
                    {flag}
                  </button>
                )
              })}
            </div>
          </div>

          {owners.length > 0 && (
            <div className={[
              'mt-3 rounded-xl border border-slate-200/80 bg-white/65 p-2 dark:border-slate-800 dark:bg-slate-900/40',
              visualStyle === 'premium3d'
                ? 'border-indigo-400/30 bg-gradient-to-br from-indigo-900/55 to-slate-900/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_28px_rgba(15,23,42,0.42)]'
                : '',
            ].join(' ')}>
              <div className={`px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider ${visualStyle === 'premium3d' ? 'text-cyan-200/90' : 'text-slate-500'}`}>Portfolio</div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setSelectedOwner('all')} className={ownerBtnClass(selectedOwner === 'all')}>ALL</button>
                {owners.map((o) => (
                  <button key={o} type="button" onClick={() => setSelectedOwner(o)} className={ownerBtnClass(selectedOwner === o)}>{o.toUpperCase()}</button>
                ))}
              </div>
            </div>
          )}

          <nav className="mt-5 space-y-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClass}>
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-1 border-t border-slate-200/80 pt-4 dark:border-slate-800/90">
            <NavLink to="/settings" className={navLinkClass}>
              <SettingsIcon className="h-4 w-4" />
              <span>Settings</span>
            </NavLink>
            <button type="button" onClick={togglePrivacyMode} className={navLinkClass({ isActive: false })}>
              {privacyMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              <span>{privacyMode ? 'Show balances' : 'Hide balances'}</span>
            </button>
            <button type="button" onClick={toggleTheme} className={navLinkClass({ isActive: false })}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button type="button" onClick={() => logout()} className={navLinkClass({ isActive: false })}>
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>

          <div className={`mt-3 px-2 text-[11px] ${visualStyle === 'premium3d' ? 'text-indigo-200/80' : 'text-slate-500'}`}>
            <Wallet className="mr-1 inline h-3 w-3" />
            Base: {portfolio?.settings?.baseCurrency || 'GBP'}
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>

      <nav className={
        visualStyle === 'premium3d'
          ? 'fixed inset-x-0 bottom-0 z-40 border-t px-2 py-1 backdrop-blur lg:hidden border-indigo-400/30 bg-indigo-950/90 safe-area-pb'
          : 'fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 px-2 py-1 backdrop-blur dark:border-slate-800/90 dark:bg-slate-950/95 lg:hidden safe-area-pb'
      }>
        <div className="flex items-end gap-1">
          {MOBILE_NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={mobileNavClass}>
              <Icon className="h-4 w-4" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
          <NavLink to="/settings" className={mobileNavClass}>
            <Layers3 className="h-4 w-4" />
            <span>More</span>
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
