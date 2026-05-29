import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HandCoins, RefreshCw, Trash2, X, ChevronRight } from 'lucide-react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { loadLiabilities } from '@/utils/liabilities'
import { fetchGoals, addLiability, removeLiability, updateLiability } from '@/services/api'
import type { LiabilityItem } from '@/services/api'
import type { CurrencyCode } from '@/types'

const MIGRATED_KEY = 'firefly.liabilities.migrated'
type LiabilityCategory = 'mortgage' | 'credit-card' | 'student-loan' | 'personal-loan' | 'car-loan' | 'custom'

// ─── PCP types & helpers ───────────────────────────────────────────────────────

interface PcpMeta {
  refBalance: number
  refDate: string             // YYYY-MM-DD — balance after this date's payment
  monthlyPayment: number
  aprPct: number
  finalPayment: number        // balloon / GFV
  remainingAtRef: number      // regular payments left as of refDate
  totalRegularPayments: number
  firstPaymentDate: string    // YYYY-MM-DD
  paymentDay: number
  actualPayee?: string
  agreementNumber?: string
  vehicleReg?: string
  vin?: string
  totalPayable?: number
}

interface ScheduleRow {
  n: number
  date: string
  payment: number
  interest: number
  principal: number
  balance: number
  isPast: boolean
  isBalloon: boolean
}

function parsePcp(notes: string): PcpMeta | null {
  try {
    const obj = JSON.parse(notes || '{}')
    if (obj?.pcp?.refBalance && obj?.pcp?.refDate) return obj.pcp as PcpMeta
  } catch { /* ignore */ }
  return null
}

function pcpCurrentBalance(meta: PcpMeta) {
  const monthlyRate = meta.aprPct / 100 / 12
  let balance = meta.refBalance
  let remaining = meta.remainingAtRef
  const today = new Date()
  const ref = new Date(meta.refDate + 'T12:00:00Z')
  const next = new Date(ref)
  next.setMonth(next.getMonth() + 1)
  next.setDate(meta.paymentDay)
  let paymentsApplied = 0
  while (remaining > 0 && next <= today) {
    balance = Math.max(0, balance - (meta.monthlyPayment - balance * monthlyRate))
    remaining--
    paymentsApplied++
    next.setMonth(next.getMonth() + 1)
  }
  return {
    balance: Math.round(balance * 100) / 100,
    remaining,
    nextPaymentDate: next.toISOString().slice(0, 10),
    paymentsApplied,
  }
}

/** Build the complete amortisation schedule — both past and future payments. */
function buildFullSchedule(meta: PcpMeta): ScheduleRow[] {
  const r = meta.aprPct / 100 / 12
  const today = new Date()

  // Estimate original loan: work backwards from refBalance through the payments already made
  const paymentsMade = meta.totalRegularPayments - meta.remainingAtRef
  let origBalance = meta.refBalance
  for (let i = 0; i < paymentsMade; i++) {
    origBalance = (origBalance + meta.monthlyPayment) / (1 + r)
  }

  let balance = origBalance
  const rows: ScheduleRow[] = []

  for (let i = 0; i < meta.totalRegularPayments; i++) {
    const dt = new Date(meta.firstPaymentDate + 'T12:00:00Z')
    dt.setMonth(dt.getMonth() + i)
    const interest = balance * r
    const principal = meta.monthlyPayment - interest
    balance = Math.max(0, balance - principal)
    rows.push({
      n: i + 1,
      date: dt.toISOString().slice(0, 10),
      payment: meta.monthlyPayment,
      interest: Math.round(interest * 100) / 100,
      principal: Math.round(principal * 100) / 100,
      balance: Math.round(balance * 100) / 100,
      isPast: dt <= today,
      isBalloon: false,
    })
  }

  // Balloon / final payment
  const balloonDt = new Date(meta.firstPaymentDate + 'T12:00:00Z')
  balloonDt.setMonth(balloonDt.getMonth() + meta.totalRegularPayments)
  rows.push({
    n: meta.totalRegularPayments + 1,
    date: balloonDt.toISOString().slice(0, 10),
    payment: meta.finalPayment,
    interest: 0,
    principal: meta.finalPayment,
    balance: 0,
    isPast: false,
    isBalloon: true,
  })

  return rows
}

function fmtShortDate(d: string) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}
function fmtFullDate(d: string) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── PCP Detail Modal ─────────────────────────────────────────────────────────

function PcpDetailModal({ item, pcp, onClose }: {
  item: LiabilityItem & { outstandingBalance: number }
  pcp: PcpMeta
  onClose: () => void
}) {
  const schedule = useMemo(() => buildFullSchedule(pcp), [pcp])
  const today = new Date().toISOString().slice(0, 10)

  const paymentsMade = pcp.totalRegularPayments - pcp.remainingAtRef
  const paidRows = schedule.filter((r) => r.isPast && !r.isBalloon)
  const futureRows = schedule.filter((r) => !r.isPast && !r.isBalloon)
  const balloonRow = schedule.find((r) => r.isBalloon)!

  const totalPaid = paidRows.reduce((s, r) => s + r.payment, 0)
  const totalInterestPaid = paidRows.reduce((s, r) => s + r.interest, 0)
  const totalInterestRemaining = futureRows.reduce((s, r) => s + r.interest, 0)
  const totalInterestAll = totalInterestPaid + totalInterestRemaining
  const origBalance = schedule[0] ? schedule[0].balance + schedule[0].principal : pcp.refBalance
  const totalRegularCost = pcp.totalRegularPayments * pcp.monthlyPayment

  // Find the row just before "today"
  const lastPastIdx = schedule.findIndex((r) => !r.isPast) - 1

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative my-8 w-full max-w-4xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6 dark:border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{item.name}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {pcp.agreementNumber && `Agreement ${pcp.agreementNumber}`}
              {pcp.vehicleReg && ` · ${pcp.vehicleReg}`}
              {pcp.vin && ` · VIN ${pcp.vin}`}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {pcp.aprPct}% APR · {pcp.actualPayee} · {item.lender}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary grid */}
        <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-6 border-b border-slate-100 dark:border-slate-800">
          {[
            { label: 'Original loan', value: formatMoney(origBalance, 'GBP'), sub: 'estimated' },
            { label: 'Total paid', value: formatMoney(totalPaid, 'GBP'), sub: `${paymentsMade} payments` },
            { label: 'Interest paid', value: formatMoney(totalInterestPaid, 'GBP'), sub: 'so far', color: 'text-rose-600 dark:text-rose-400' },
            { label: 'Outstanding', value: formatMoney(item.outstandingBalance, 'GBP'), sub: 'current balance', color: 'text-amber-600 dark:text-amber-400' },
            { label: 'Interest remaining', value: formatMoney(totalInterestRemaining, 'GBP'), sub: `${pcp.remainingAtRef} payments`, color: 'text-rose-500 dark:text-rose-400' },
            { label: 'Total interest', value: formatMoney(totalInterestAll, 'GBP'), sub: 'full tenure', color: 'text-rose-600 dark:text-rose-400 font-semibold' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{s.label}</div>
              <div className={`mt-1 text-base font-semibold tabular-nums ${s.color ?? 'text-slate-900 dark:text-slate-50'}`}>{s.value}</div>
              <div className="text-[10px] text-slate-400">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>{paymentsMade} / {pcp.totalRegularPayments} regular payments made</span>
            <span>{((paymentsMade / pcp.totalRegularPayments) * 100).toFixed(0)}% through term</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${(paymentsMade / pcp.totalRegularPayments) * 100}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
            <span>Started {fmtFullDate(pcp.firstPaymentDate)}</span>
            <span>Final payment {fmtFullDate(balloonRow.date)}</span>
          </div>
        </div>

        {/* Next payment due */}
        <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/20 px-6 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex-1">
            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Next payment: </span>
            <span className="text-xs text-indigo-600 dark:text-indigo-400">
              {formatMoney(pcp.monthlyPayment, 'GBP')} due {fmtFullDate(futureRows[0]?.date ?? today)} · {pcp.remainingAtRef} regular payments + £{pcp.finalPayment.toLocaleString()} balloon remaining
            </span>
          </div>
        </div>

        {/* Amortisation table */}
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5 text-right">Payment</th>
                <th className="px-4 py-2.5 text-right">Interest</th>
                <th className="px-4 py-2.5 text-right">Principal</th>
                <th className="px-4 py-2.5 text-right">Balance</th>
                <th className="px-4 py-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {schedule.map((row, idx) => {
                const isToday = idx === lastPastIdx + 1
                const isMostRecentPast = idx === lastPastIdx

                return (
                  <>
                    {isToday && (
                      <tr key="divider">
                        <td colSpan={7} className="px-4 py-1.5 text-center text-[10px] font-semibold text-indigo-500 bg-indigo-50/60 dark:bg-indigo-900/20 dark:text-indigo-400">
                          ── TODAY · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ──
                        </td>
                      </tr>
                    )}
                    <tr
                      key={row.n}
                      className={[
                        row.isPast ? 'bg-emerald-50/40 dark:bg-emerald-900/10' : '',
                        row.isBalloon ? 'bg-amber-50/60 dark:bg-amber-900/15 font-semibold' : '',
                        isMostRecentPast ? 'ring-1 ring-inset ring-indigo-300 dark:ring-indigo-700' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <td className="px-4 py-2 tabular-nums text-slate-400">{row.n}</td>
                      <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-300">{fmtShortDate(row.date)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {formatMoney(row.payment, 'GBP')}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${row.isBalloon ? 'text-slate-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {row.isBalloon ? '—' : formatMoney(row.interest, 'GBP')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatMoney(row.principal, 'GBP')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                        {row.balance > 0 ? formatMoney(row.balance, 'GBP') : '£0.00'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {row.isBalloon ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">Balloon</span>
                        ) : row.isPast ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">✓ Paid</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-400">Due</span>
                        )}
                      </td>
                    </tr>
                  </>
                )
              })}
            </tbody>
            {/* Totals footer */}
            <tfoot className="sticky bottom-0 bg-slate-100 dark:bg-slate-800 border-t-2 border-slate-300 dark:border-slate-600">
              <tr>
                <td colSpan={2} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Totals</td>
                <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatMoney(totalRegularCost + pcp.finalPayment, 'GBP')}
                </td>
                <td className="px-4 py-2.5 text-right font-bold tabular-nums text-rose-600 dark:text-rose-400">
                  {formatMoney(totalInterestAll, 'GBP')}
                </td>
                <td className="px-4 py-2.5 text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatMoney(origBalance, 'GBP')}
                </td>
                <td colSpan={2} className="px-4 py-2.5 text-right text-[10px] text-slate-400">
                  Total interest over full tenure: <span className="font-semibold text-rose-500">{formatMoney(totalInterestAll, 'GBP')}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800">
          Interest calculated using {pcp.aprPct}% APR (monthly rate {(pcp.aprPct / 12).toFixed(4)}%). Original loan estimated from reference balance.
          Balloon payment of {formatMoney(pcp.finalPayment, 'GBP')} is optional — you may return the vehicle or part-exchange instead.
        </div>
      </div>
    </div>
  )
}

// ─── Main Liabilities page ────────────────────────────────────────────────────

export function Liabilities() {
  const { data, isLoading: portfolioLoading, error: portfolioError } = usePortfolio()
  const { selectedCountry } = useUi()
  const qc = useQueryClient()
  const migratedRef = useRef(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: goalsData, isLoading: liabLoading } = useQuery({
    queryKey: ['goals', 'UK'],
    queryFn: () => fetchGoals('UK'),
    staleTime: 5 * 60_000,
  })

  const items: LiabilityItem[] = goalsData?.liabilities ?? []

  // One-time localStorage → DB migration
  useMemo(() => {
    if (migratedRef.current) return
    if (localStorage.getItem(MIGRATED_KEY)) return
    if (liabLoading) return
    if (items.length > 0) { localStorage.setItem(MIGRATED_KEY, '1'); migratedRef.current = true; return }
    migratedRef.current = true
    const legacy = loadLiabilities()
    if (legacy.length === 0) { localStorage.setItem(MIGRATED_KEY, '1'); return }
    Promise.all(legacy.map((l) => addLiability({ name: l.name, category: l.category, lender: l.lender, outstandingBalance: l.outstandingBalance, currency: l.currency, notes: l.notes })))
      .then(() => { qc.invalidateQueries({ queryKey: ['goals'] }); localStorage.setItem(MIGRATED_KEY, '1') })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liabLoading, items.length])

  // Auto-patch DB balance when PCP formula shows a payment has occurred
  const patchMutation = useMutation({
    mutationFn: ({ id, outstandingBalance }: { id: string; outstandingBalance: number }) =>
      updateLiability(id, { outstandingBalance }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals', 'portfolio'] }),
  })
  const syncedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const item of items) {
      const pcp = parsePcp(item.notes)
      if (!pcp || syncedRef.current.has(item.id)) continue
      const { balance } = pcpCurrentBalance(pcp)
      if (Math.abs(balance - item.outstandingBalance) > 0.5) {
        syncedRef.current.add(item.id)
        patchMutation.mutate({ id: item.id, outstandingBalance: balance })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const addMutation = useMutation({
    mutationFn: (item: Omit<LiabilityItem, 'id'>) => addLiability(item),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => removeLiability(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  const [draft, setDraft] = useState({
    name: '', category: 'custom' as LiabilityCategory, lender: '',
    outstandingBalance: '', currency: selectedCountry === 'India' ? 'INR' : 'GBP', notes: '',
  })

  const view = useMemo(() => {
    if (!data) return null
    const base = selectedCountry === 'India' ? 'INR' : (data.settings.baseCurrency || 'GBP')
    const enriched = items.map((item) => {
      const pcp = parsePcp(item.notes)
      if (!pcp) return { ...item, pcp: null, computed: null }
      const computed = pcpCurrentBalance(pcp)
      return { ...item, pcp, computed, outstandingBalance: computed.balance }
    })
    const visibleItems = selectedCountry === 'India'
      ? enriched.filter((i) => i.currency.toUpperCase() === 'INR')
      : selectedCountry === 'UK'
        ? enriched.filter((i) => i.currency.toUpperCase() !== 'INR')
        : enriched
    const total = visibleItems.filter((i) => i.currency.toUpperCase() === base.toUpperCase())
      .reduce((a, i) => a + i.outstandingBalance, 0)
    return { base, total, visibleItems }
  }, [data, items, selectedCountry])

  function submitAdd() {
    const outstanding = Number(draft.outstandingBalance)
    if (!draft.name.trim() || !Number.isFinite(outstanding) || outstanding <= 0) return
    addMutation.mutate({ name: draft.name.trim(), category: draft.category, lender: draft.lender.trim(), outstandingBalance: outstanding, currency: draft.currency.toUpperCase() || 'GBP', notes: draft.notes.trim() })
    setDraft({ name: '', category: 'custom', lender: '', outstandingBalance: '', currency: 'GBP', notes: '' })
  }

  if (portfolioLoading || liabLoading) return <Loading />
  if (portfolioError) return <PageBody><EmptyState title="Couldn't load liabilities" body={(portfolioError as Error).message} /></PageBody>
  if (!view) return null

  // Find the item shown in modal
  const modalItem = expandedId ? view.visibleItems.find((i) => i.id === expandedId) : null
  const modalPcp = modalItem ? parsePcp(modalItem.notes) : null

  return (
    <>
      <PageHeader title="Liabilities" subtitle="Track debt and obligations in one place." />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Total liabilities</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(view.total, view.base)}</div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Active items</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{view.visibleItems.length}</div>
          </Card>
          <Card tone="elevated">
            <div className="text-xs uppercase tracking-wider text-slate-500">Debt health</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{view.total > 0 ? 'Watch' : 'Clear'}</div>
          </Card>
        </div>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">Add liability</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && submitAdd()} placeholder="Liability name" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <input value={draft.lender} onChange={(e) => setDraft((d) => ({ ...d, lender: e.target.value }))} placeholder="Lender (optional)" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as LiabilityCategory }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <option value="mortgage">Mortgage</option>
              <option value="credit-card">Credit card</option>
              <option value="student-loan">Student loan</option>
              <option value="personal-loan">Personal loan</option>
              <option value="car-loan">Car loan</option>
              <option value="custom">Custom</option>
            </select>
            <input value={draft.outstandingBalance} onChange={(e) => setDraft((d) => ({ ...d, outstandingBalance: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && submitAdd()} type="number" placeholder="Outstanding balance" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <input value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} placeholder="Currency (GBP / INR)" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
            <button type="button" onClick={submitAdd} disabled={addMutation.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
              <HandCoins className="h-4 w-4" />
              {addMutation.isPending ? 'Adding…' : 'Add liability'}
            </button>
          </div>
          <input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Notes (optional)" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800" />
        </Card>

        {view.visibleItems.length === 0 ? (
          <EmptyState title="No liabilities added yet" body="Add mortgages, loans, and cards to get a complete net worth view." />
        ) : (
          <Card tone="elevated" className="!p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Lender</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {view.visibleItems.map((item) => {
                  const hasPcp = !!item.pcp
                  return (
                    <tr
                      key={item.id}
                      className={hasPcp ? 'cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-900/20 transition-colors' : ''}
                      onClick={hasPcp ? () => setExpandedId(item.id) : undefined}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                          {item.name}
                          {hasPcp && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                              <RefreshCw className="h-2.5 w-2.5" />
                              Auto
                            </span>
                          )}
                        </div>
                        {item.pcp && item.computed && (
                          <div className="mt-0.5 text-xs text-slate-400">
                            {item.computed.remaining} payments left · next {item.computed.nextPaymentDate}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-600 dark:text-slate-400">
                        {item.category.replace('-', ' ')}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-slate-500">
                        {item.lender || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(item.outstandingBalance, item.currency as CurrencyCode)}
                        </div>
                        {hasPcp && <div className="text-[10px] text-slate-400">auto-calculated</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {hasPcp && <ChevronRight className="h-4 w-4 text-indigo-400" />}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeMutation.mutate(item.id) }}
                            disabled={removeMutation.isPending}
                            className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                            aria-label={`Delete ${item.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {view.visibleItems.some((i) => i.pcp) && (
              <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100 dark:border-slate-800">
                Click any auto-tracked row to see full payment history and amortisation schedule
              </div>
            )}
          </Card>
        )}
      </PageBody>

      {/* Detail modal */}
      {modalItem && modalPcp && (
        <PcpDetailModal
          item={modalItem}
          pcp={modalPcp}
          onClose={() => setExpandedId(null)}
        />
      )}
    </>
  )
}
