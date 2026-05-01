import { useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Coins,
  Flame,
  LayoutDashboard,
  LineChart,
  Moon,
  PieChart,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  Table,
  Upload,
  Users,
  Wallet,
} from 'lucide-react'
import { usePortfolio, useRefreshPrices, useUi } from '@/context/AppContext'
import { listOwners } from '@/utils/calculations'
import { formatRelative } from '@/utils/format'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }
const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/holdings', label: 'Holdings', icon: Table },
  { to: '/performance', label: 'Performance', icon: LineChart },
  { to: '/sectors', label: 'Sectors', icon: PieChart },
  { to: '/dividends', label: 'Dividends', icon: Coins },
  { to: '/transactions', label: 'Transactions', icon: BarChart3 },
  { to: '/import', label: 'Import', icon: Upload },
]

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const { theme, toggleTheme, selectedOwner, setSelectedOwner } = useUi()
  const { data: portfolio } = usePortfolio()
  const refresh = useRefreshPrices()

  const owners = useMemo(() => (portfolio ? listOwners(portfolio.holdings) : []), [portfolio])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
      isActive
        ? 'bg-emerald-500/15 text-emerald-400'
        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100',
    ].join(' ')

  const ownerBtnClass = (active: boolean) =>
    [
      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
      active ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100',
    ].join(' ')

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside
        className="sticky top-0 z-40 flex h-screen flex-col border-r border-slate-800 bg-slate-900 text-slate-200 transition-[width] duration-200"
        style={{ width: collapsed ? 72 : 248 }}
      >
        {/* Brand */}
        <div className="flex h-14 items-center justify-between border-b border-slate-800 px-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <Flame className="h-6 w-6 shrink-0 text-amber-400" />
            {!collapsed && <span className="truncate text-sm font-semibold tracking-tight text-white">Firefly</span>}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Refresh button */}
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
            {!collapsed && <span>{refresh.isPending ? 'Refreshing…' : 'Refresh prices'}</span>}
          </button>
          {!collapsed && (
            <p className="mt-2 text-[11px] text-slate-500">
              Last: {formatRelative(portfolio?.lastRefresh || null)}
            </p>
          )}
          {!collapsed && refresh.isError && (
            <p className="mt-1 text-[11px] text-rose-400">{(refresh.error as Error).message}</p>
          )}
        </div>

        {/* Owner filter */}
        {!collapsed && owners.length > 0 && (
          <div className="border-y border-slate-800 px-2 py-3">
            <div className="mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Users className="h-3.5 w-3.5" />
              Portfolio
            </div>
            <div className="space-y-0.5">
              <button type="button" onClick={() => setSelectedOwner('all')} className={ownerBtnClass(selectedOwner === 'all')}>
                All
              </button>
              {owners.map((o) => (
                <button key={o} type="button" onClick={() => setSelectedOwner(o)} className={ownerBtnClass(selectedOwner === o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass}>
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 px-2 py-3">
          <NavLink to="/settings" className={navLinkClass}>
            <SettingsIcon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Settings</span>}
          </NavLink>
          <button
            type="button"
            onClick={toggleTheme}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-100"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
          </button>
        </div>

        {!collapsed && (
          <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
            <Wallet className="mr-1 inline h-3 w-3" />
            Base: {portfolio?.settings?.baseCurrency || 'GBP'}
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
