import { useMemo } from 'react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { buildPortfolio } from '@/utils/calculations'
import { formatMoney } from '@/utils/format'
import { Card, EmptyState, Loading, PageBody, PageHeader } from '@/components/ui'

/**
 * Dividend tracker — placeholder until dividend data lands in data.json.
 * Once `transactions[]` includes `side: 'dividend'` rows, this page sums
 * them, computes yield-on-cost per holding, and projects annual income.
 */
export function Dividends() {
  const { data, isLoading, error } = usePortfolio()
  const { selectedOwner } = useUi()

  const view = useMemo(() => {
    if (!data) return null
    const filtered = selectedOwner === 'all'
      ? data.holdings
      : data.holdings.filter((h) => (h.notes || '').match(new RegExp(`Owner:\\s*${selectedOwner}`, 'i')))
    const built = buildPortfolio(filtered, data.prices, data.fxRates, data.settings.baseCurrency || 'GBP')
    const dividendTxs = data.transactions.filter((t) => t.side === 'dividend')
    const totalReceived = dividendTxs.reduce((a, t) => a + t.shares * t.price, 0)
    return { built, dividendTxs, totalReceived, base: data.settings.baseCurrency || 'GBP' }
  }, [data, selectedOwner])

  if (isLoading) return <Loading />
  if (error) return <PageBody><EmptyState title="Couldn't load dividends" body={(error as Error).message} /></PageBody>
  if (!data || !view) return null

  return (
    <>
      <PageHeader title="Dividend Tracker" subtitle="Yield on cost, annual income, payment history" />
      <PageBody>
        {view.dividendTxs.length === 0 ? (
          <EmptyState
            title="No dividend transactions yet"
            body="Add dividend payouts to data.json transactions[] (side: 'dividend') and they'll appear here. Yield on cost, annual estimates and next payments populate automatically once you have at least one full year of history."
          />
        ) : (
          <Card>
            <h3 className="text-sm font-semibold">Total received</h3>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{formatMoney(view.totalReceived, view.base)}</div>
            <p className="mt-1 text-xs text-slate-500">Across {view.dividendTxs.length} dividend events</p>
          </Card>
        )}
      </PageBody>
    </>
  )
}
