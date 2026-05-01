/**
 * Small UI primitives shared across pages.
 */
import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp, Loader2 } from 'lucide-react'
import { formatMoney, formatPercent } from '@/utils/format'
import type { CurrencyCode } from '@/types'

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-2 border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </header>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'neutral' | 'gain' | 'loss'
  icon?: ReactNode
}) {
  const valueClass =
    tone === 'gain' ? 'text-emerald-500' : tone === 'loss' ? 'text-rose-500' : 'text-slate-900 dark:text-slate-50'
  return (
    <Card>
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        {icon}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </Card>
  )
}

export function GainLossBadge({
  amount,
  pct,
  currency = 'GBP',
  size = 'sm',
}: {
  amount: number
  pct: number
  currency?: CurrencyCode
  size?: 'sm' | 'md'
}) {
  const positive = amount >= 0
  const cls = positive
    ? 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/20'
    : 'bg-rose-500/10 text-rose-500 ring-rose-500/20'
  const sizeCls = size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'
  const Icon = positive ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset tabular-nums ${cls} ${sizeCls}`}>
      <Icon className="h-3.5 w-3.5" />
      {formatMoney(amount, currency)} ({formatPercent(pct)})
    </span>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: ReactNode
  action?: ReactNode
}) {
  return (
    <Card className="py-12 text-center">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Card>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="space-y-6 px-6 py-6">{children}</div>
}
