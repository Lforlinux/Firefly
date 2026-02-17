import type { Currency } from '@/types'

export function formatMoney(amount: number, _currency: Currency): string {
  return '£' + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function formatPercent(value: number): string {
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return sign + n.toFixed(1) + '%'
}

/** Format units (shares/quantity) with up to 4 decimal places, no long floats. */
export function formatUnits(units: number): string {
  return parseFloat(units.toFixed(4)).toLocaleString()
}

export function formatShortMoney(amount: number, currency: Currency): string {
  if (amount >= 1000) return `£${(amount / 1000).toFixed(1)}K`
  return formatMoney(amount, currency)
}
