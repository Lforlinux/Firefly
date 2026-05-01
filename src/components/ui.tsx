/**
 * Small UI primitives shared across pages.
 */
import type { ReactNode } from 'react'
import type { HTMLAttributes } from 'react'
import { TrendingDown, TrendingUp, Loader2 } from 'lucide-react'
import { formatMoney, formatPercent } from '@/utils/format'
import type { CurrencyCode } from '@/types'

type SurfaceTone = 'base' | 'soft' | 'elevated'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

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
    <header className="ff-page-header flex flex-col gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/90 sm:px-6 sm:py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-[1.65rem]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </header>
  )
}

export function Card({
  children,
  className = '',
  tone = 'base',
  ...props
}: {
  children: ReactNode
  className?: string
  tone?: SurfaceTone
} & HTMLAttributes<HTMLDivElement>) {
  const toneClass =
    tone === 'elevated'
      ? 'bg-white shadow-md shadow-slate-200/70 dark:bg-slate-900 dark:shadow-none'
      : tone === 'soft'
        ? 'bg-slate-50/80 dark:bg-slate-900/70'
        : 'bg-white dark:bg-slate-900'
  return (
    <div
      {...props}
      className={cx(
        'ff-card rounded-2xl border border-slate-200/80 p-5 shadow-sm shadow-slate-200/60 transition-all duration-200 dark:border-slate-800/90 dark:shadow-none',
        toneClass,
        className,
      )}
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
  className = '',
  valueClassName = '',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'neutral' | 'gain' | 'loss'
  icon?: ReactNode
  className?: string
  valueClassName?: string
}) {
  const valueClass =
    tone === 'gain' ? 'text-emerald-500' : tone === 'loss' ? 'text-rose-500' : 'text-slate-900 dark:text-slate-50'
  return (
    <Card
      tone="elevated"
      className={`ff-kpi-card relative overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        {icon}
      </div>
      <div className={`mt-2.5 text-2xl font-semibold tabular-nums sm:text-[1.65rem] ${valueClass} ${valueClassName}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
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
    <Card tone="soft" className="py-12 text-center">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Card>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="ff-page-body space-y-4 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6 lg:space-y-7">{children}</div>
}
