/**
 * Display formatters. Currency-aware, locale-en-GB.
 */
import type { CurrencyCode } from '@/types'

const moneyFmtCache = new Map<string, Intl.NumberFormat>()
function moneyFormatter(currency: CurrencyCode, fractionDigits = 0): Intl.NumberFormat {
  const key = `${currency}|${fractionDigits}`
  let f = moneyFmtCache.get(key)
  if (!f) {
    // Use en-IN locale for INR so grouping follows the Indian system (21,48,339 not 2,148,339)
    const locale = (currency as string).toUpperCase() === 'INR' ? 'en-IN' : 'en-GB'
    try {
      f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      })
    } catch {
      // Unknown currency code — fall back to plain decimal formatting.
      f = new Intl.NumberFormat(locale, {
        style: 'decimal',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      })
    }
    moneyFmtCache.set(key, f)
  }
  return f
}

/** £12,345 / ₹21,48,339 / $1,234. Whole-number by default. */
export function formatMoney(amount: number, currency: CurrencyCode = 'GBP', fractionDigits = 0): string {
  if (!Number.isFinite(amount)) return '—'
  return moneyFormatter(currency, fractionDigits).format(amount)
}

/** Compact: £12K / £1.2M for GBP; ₹12L / ₹1.2Cr for INR. */
export function formatMoneyCompact(amount: number, currency: CurrencyCode = 'GBP'): string {
  if (!Number.isFinite(amount)) return '—'
  const abs = Math.abs(amount)
  if ((currency as string).toUpperCase() === 'INR') {
    if (abs >= 1_00_00_000) return formatMoney(amount / 1_00_00_000, currency, 1).replace(/\.0(?=\D|$)/, '') + 'Cr'
    if (abs >= 1_00_000) return formatMoney(amount / 1_00_000, currency, 1).replace(/\.0(?=\D|$)/, '') + 'L'
    return formatMoney(amount, currency, 0)
  }
  if (abs >= 1_000_000) return formatMoney(amount / 1_000_000, currency, 1).replace(/\.0(?=\D|$)/, '') + 'M'
  if (abs >= 1_000) return formatMoney(amount / 1_000, currency, 1).replace(/\.0(?=\D|$)/, '') + 'K'
  return formatMoney(amount, currency, 0)
}

/** Signed percent. +12.3% / −4.1%. */
export function formatPercent(value: number, fractionDigits = 1, withSign = true): string {
  if (!Number.isFinite(value)) return '—'
  const sign = withSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(fractionDigits)}%`
}

/** 135.81 / 8,526 / 0.058 — show up to 4 decimals, drop trailing zeros. */
export function formatShares(units: number): string {
  if (!Number.isFinite(units)) return '—'
  const fixed = parseFloat(units.toFixed(4))
  return fixed.toLocaleString('en-GB', { maximumFractionDigits: 4 })
}

/** "2h ago", "yesterday", "12 Apr 2026". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'never'
  const diffSec = (Date.now() - t) / 1000
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`
  if (diffSec < 86400 * 2) return 'yesterday'
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** ISO date as 25 Apr 2026. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
