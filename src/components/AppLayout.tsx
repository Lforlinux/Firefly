import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import {
  Home,
  TrendingUp,
  Receipt,
  History as HistoryIcon,
  Target,
  Menu,
  ChevronDown,
  ChevronRight,
  User,
  RefreshCw,
} from 'lucide-react'

const SIDEBAR_WIDTH = 260

export function AppLayout() {
  const { selectedPortfolio, setSelectedPortfolio } = useApp()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [portfoliosOpen, setPortfoliosOpen] = useState(true)

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-emerald-600/20 text-emerald-400'
        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
    }`

  return (
    <div className="flex min-h-screen bg-gray-200 dark:bg-gray-950 text-gray-900">
      {/* Dark sidebar - full height with gradient fill so no empty flat area */}
      <aside
        className="fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-gray-700 bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 text-gray-300 transition-[width] duration-200 md:static md:h-auto"
        style={{ width: sidebarCollapsed ? 72 : SIDEBAR_WIDTH }}
      >
        {/* Brand / account */}
        <div className="flex h-14 items-center justify-between border-b border-gray-800 px-3">
          {!sidebarCollapsed && (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="rounded p-1 hover:bg-gray-800"
                aria-label="Collapse sidebar"
              >
                <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
              </button>
              <span className="truncate text-sm font-semibold text-white">
                KLN Retirement and Wealth
              </span>
            </div>
          )}
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="rounded p-2 hover:bg-gray-800"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Portfolios + Nav - scrollable, fills space */}
        <div className="flex-1 overflow-y-auto py-4 min-h-0">
          {!sidebarCollapsed && (
            <>
              <button
                type="button"
                onClick={() => setPortfoliosOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:bg-gray-800/50"
              >
                Portfolios
                {portfoliosOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {portfoliosOpen && (
                <div className="space-y-0.5 px-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolio('KLN')}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      selectedPortfolio === 'KLN'
                        ? 'bg-emerald-600/20 text-emerald-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    <User className="h-4 w-4 shrink-0" />
                    <span>KLN</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolio('Priya')}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      selectedPortfolio === 'Priya'
                        ? 'bg-emerald-600/20 text-emerald-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    <User className="h-4 w-4 shrink-0" />
                    <span>Priya</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolio('all')}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      selectedPortfolio === 'all'
                        ? 'bg-emerald-600/20 text-emerald-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    <RefreshCw className="h-4 w-4 shrink-0" />
                    <span>All</span>
                  </button>
                </div>
              )}
            </>
          )}

          {/* Main nav */}
          <nav className="mt-4 space-y-0.5 px-2">
            <NavLink to="/" className={navLinkClass}>
              <Home className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>Dashboard</span>}
            </NavLink>
            <NavLink to="/investments" className={navLinkClass}>
              <TrendingUp className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>Portfolio</span>}
            </NavLink>
            <NavLink to="/expenses" className={navLinkClass}>
              <Receipt className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>Expenses</span>}
            </NavLink>
            <NavLink to="/history" className={navLinkClass}>
              <HistoryIcon className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>History</span>}
            </NavLink>
            <NavLink to="/goals" className={navLinkClass}>
              <Target className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>Goals</span>}
            </NavLink>
            <NavLink to="/more" className={navLinkClass}>
              <Menu className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>More</span>}
            </NavLink>
          </nav>
        </div>

        {/* Sidebar footer - always visible so bottom never looks empty */}
        <div className="shrink-0 border-t border-gray-700/80 px-3 py-3 bg-gray-950/50">
          {!sidebarCollapsed ? (
            <p className="text-xs text-gray-500">Personal finance</p>
          ) : (
            <p className="text-[10px] text-gray-600 text-center font-medium" title="Personal finance">PF</p>
          )}
        </div>
      </aside>

      {/* Main content - single unified panel with border so it doesn't clash with sidebar */}
      <div
        className={`flex min-w-0 flex-1 flex-col min-h-screen border-l border-gray-200 bg-white shadow-sm ${sidebarCollapsed ? 'pl-[72px]' : 'pl-[260px]'} md:pl-0`}
      >
        <Outlet />
      </div>
    </div>
  )
}
