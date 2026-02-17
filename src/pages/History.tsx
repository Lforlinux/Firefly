import { useMemo } from 'react'
import { useApp } from '@/context/AppContext'
import type { Holding } from '@/types'

/** Format GBP with 2 decimals for ledger-style display */
function formatGbp(amount: number): string {
  return '£' + amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return sign + value.toFixed(1) + '%'
}

function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Build same time series as Dashboard: snapshots + steps on cash added dates so £10k on 03/04/2024 appears in April 2024, not in latest month */
function buildDisplayPoints(
  totalPortfolioHistory: { date: string; valueGBP: number }[],
  cashHoldings: Holding[],
  getCashAddedDate: (h: Holding) => string | undefined,
  todayStr: string
): { date: string; valueGBP: number }[] {
  const toYYYYMMDD = (s: string): string => {
    const t = s.trim()
    if (!t) return todayStr
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
    const d = new Date(t)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return todayStr
  }
  const effectiveAddedDate = (h: Holding): string => {
    const fromHolding = h.addedDate?.trim() ? toYYYYMMDD(h.addedDate) : ''
    const fromState = getCashAddedDate(h) ? toYYYYMMDD(getCashAddedDate(h) ?? '') : ''
    return fromHolding || fromState || todayStr
  }
  const cashAddedByDate = (date: string) =>
    cashHoldings
      .filter((h) => effectiveAddedDate(h) <= date)
      .reduce((s, h) => s + h.averageCost * h.units, 0)
  const baseValueAt = (date: string) => {
    const prev = totalPortfolioHistory.filter((p) => p.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0]
    return prev ? prev.valueGBP : 0
  }
  const dayBefore = (date: string) => {
    const d = new Date(date + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }

  const byDate = new Map<string, number>()
  for (const p of totalPortfolioHistory) {
    const value = p.date === todayStr ? p.valueGBP : p.valueGBP + cashAddedByDate(p.date)
    byDate.set(p.date, value)
  }
  for (const h of cashHoldings) {
    const d = effectiveAddedDate(h)
    if (d !== todayStr) byDate.set(d, baseValueAt(d) + cashAddedByDate(d))
    const dayBeforeD = dayBefore(d)
    if (!byDate.has(dayBeforeD)) byDate.set(dayBeforeD, baseValueAt(dayBeforeD) + cashAddedByDate(dayBeforeD))
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, valueGBP]) => ({ date, valueGBP }))
}

export function History() {
  const { totalPortfolioHistory, ukHoldings, getCashAddedDate } = useApp()

  const monthlyRows = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const cashHoldings = ukHoldings.filter((h) => h.category === 'Cash' || h.symbol === 'CASH')
    const displayPoints = buildDisplayPoints(
      totalPortfolioHistory,
      cashHoldings,
      getCashAddedDate ?? (() => undefined),
      todayStr
    )
    if (!displayPoints.length) return []

    const lastInMonth = new Map<string, { date: string; valueGBP: number }>()
    const firstInMonth = new Map<string, { date: string; valueGBP: number }>()
    for (const p of displayPoints) {
      const ym = p.date.slice(0, 7)
      const curLast = lastInMonth.get(ym)
      if (!curLast || p.date > curLast.date) lastInMonth.set(ym, { date: p.date, valueGBP: p.valueGBP })
      const curFirst = firstInMonth.get(ym)
      if (!curFirst || p.date < curFirst.date) firstInMonth.set(ym, { date: p.date, valueGBP: p.valueGBP })
    }

    const months = [...lastInMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    let prevClose: number | null = null
    return months.map(([ym]) => {
      const first = firstInMonth.get(ym)
      const last = lastInMonth.get(ym)
      if (!last) return null
      const open = prevClose ?? first?.valueGBP ?? 0
      const closing = last.valueGBP
      const change = closing - open
      const growthPct = open > 0 ? (change / open) * 100 : 0
      prevClose = closing
      return {
        monthKey: ym,
        monthLabel: formatMonthLabel(last.date),
        gbpOpen: open,
        change,
        monthClosing: closing,
        growthPct,
      }
    }).filter((r): r is NonNullable<typeof r> => r != null)
  }, [totalPortfolioHistory, ukHoldings, getCashAddedDate])

  return (
    <div className="p-4 w-full min-w-0">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">History</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Monthly movement of combined KLN + Priya portfolio (GBP)
        </p>
      </header>

      {monthlyRows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center text-gray-500 dark:text-gray-400">
          No portfolio history yet. Use the Portfolio page to import or record snapshots; values will appear here as you add data.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
          <p className="text-xs text-gray-500 dark:text-gray-400 px-4 pt-3 pb-1">
            Amount (cost basis) at end of month and growth vs previous month.
          </p>
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/80 text-left text-gray-600 dark:text-gray-400">
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="p-3 font-medium">Month</th>
                  <th className="p-3 font-medium text-right">Amount</th>
                  <th className="p-3 font-medium text-right">Growth</th>
                  <th className="p-3 font-medium text-right">Growth %</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row) => (
                  <tr
                    key={row.monthKey}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30"
                  >
                    <td className="p-3 text-gray-900 dark:text-gray-100">{row.monthLabel}</td>
                    <td className="p-3 text-right text-gray-900 dark:text-gray-100 tabular-nums font-medium">
                      {formatGbp(row.monthClosing)}
                    </td>
                    <td className={`p-3 text-right tabular-nums ${row.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {row.change >= 0 ? '+' : '−'}{formatGbp(Math.abs(row.change))}
                    </td>
                    <td className={`p-3 text-right tabular-nums ${row.growthPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {row.growthPct >= 0 ? '+' : ''}{formatPercent(row.growthPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
