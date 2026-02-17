import { useState } from 'react'
import { useApp } from '@/context/AppContext'
import { formatMoney, formatPercent, formatUnits } from '@/utils/format'
import { currentValue, gainLoss, gainLossPercent } from '@/utils/calculations'
import {
  fetchQuote,
  getTwelveDataUsage,
  REFRESH_ALL_DELAY_MS_TWELVEDATA,
} from '@/services/priceApi'
import { parseTradesCsv, parseTradesCsvTrading212, aggregateTradesToHoldings, buildUkPortfolioHistoryDailyFromTrades, type HoldingFromTrades, type TradeRow } from '@/utils/csvTrades'
import type { Holding, Exchange, AssetCategory } from '@/types'
import { Plus, RefreshCw, Trash2, Upload } from 'lucide-react'

const EXCHANGES: { value: Exchange; label: string }[] = [
  { value: 'NASDAQ', label: 'NASDAQ' },
  { value: 'LSE', label: 'LSE (London)' },
]

const CATEGORIES: AssetCategory[] = ['Equity', 'ETF', 'Gold', 'Debt', 'Cash']

export function Investments() {
  const {
    ukHoldings,
    totalPortfolioHistory,
    addHolding,
    replaceHoldingsByBroker,
    clearPortfolio,
    setUkPortfolioHistoryFromCsv,
    setTotalPortfolioHistoryFromCsv,
    removeHolding,
    updateHoldingPrice,
    updateHoldingBroker,
    updateHoldingAddedDate,
    getCashAddedDate,
    getPriceApiKey,
    getTwelveDataKey,
  } = useApp()
  const [showAdd, setShowAdd] = useState(false)
  const [showImportCsv, setShowImportCsv] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'KLN' | 'Priya'>('all')

  const filteredHoldings =
    ownerFilter === 'all'
      ? ukHoldings
      : ukHoldings.filter((h) => h.owner === ownerFilter)

  const handleClearUk = () => {
    if (ukHoldings.length === 0) return
    if (window.confirm(`Clear all ${ukHoldings.length} UK portfolio holdings? You can then import fresh from CSV.`)) {
      clearPortfolio('uk')
    }
  }

  return (
    <div className="p-4 w-full min-w-0">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Investments</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Add holdings & fetch prices</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Portfolio owner"
            className="flex p-1 bg-gray-200 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600"
          >
            {(['all', 'KLN', 'Priya'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                role="tab"
                aria-selected={ownerFilter === opt}
                onClick={() => setOwnerFilter(opt)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  ownerFilter === opt
                    ? 'bg-primary text-white shadow'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {opt === 'all' ? 'All' : opt}
              </button>
            ))}
          </div>
          {ukHoldings.length > 0 && (
            <button
              type="button"
              onClick={handleClearUk}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-sm font-medium"
            >
              Clear UK portfolio
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowImportCsv(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </button>
        </div>
      </header>

      <HoldingsTable
        portfolio="uk"
        holdings={filteredHoldings}
        onAdd={() => setShowAdd(true)}
        onRemove={removeHolding}
        onRefreshPrice={updateHoldingPrice}
        onUpdateBroker={updateHoldingBroker}
        onUpdateAddedDate={updateHoldingAddedDate}
        getCashAddedDate={getCashAddedDate}
        getPriceApiKey={getPriceApiKey}
        getTwelveDataKey={getTwelveDataKey}
      />

      {showAdd && (
        <AddHoldingModal
          portfolio="uk"
          onClose={() => setShowAdd(false)}
          onAdd={addHolding}
          getPriceApiKey={getPriceApiKey}
          getTwelveDataKey={getTwelveDataKey}
        />
      )}
      {showImportCsv && (
        <ImportCsvModal
          ukHoldings={ukHoldings}
          totalPortfolioHistory={totalPortfolioHistory}
          onClose={() => setShowImportCsv(false)}
          onReplaceByBroker={replaceHoldingsByBroker}
          onUkHistoryFromCsv={setUkPortfolioHistoryFromCsv}
          onTotalHistoryFromCsv={setTotalPortfolioHistoryFromCsv}
        />
      )}
    </div>
  )
}

function mergePortfolioHistoryByDate(
  existing: { date: string; valueGBP: number }[],
  newPoints: { date: string; valueGBP: number }[],
  today: string,
  valueToday: number
): { date: string; valueGBP: number }[] {
  const byDate = new Map<string, number>()
  for (const p of existing) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.valueGBP)
  for (const p of newPoints) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.valueGBP)
  byDate.set(today, valueToday)
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, valueGBP]) => ({ date, valueGBP }))
}

function ImportCsvModal({
  ukHoldings,
  totalPortfolioHistory,
  onClose,
  onReplaceByBroker,
  onUkHistoryFromCsv,
  onTotalHistoryFromCsv,
}: {
  ukHoldings: Holding[]
  totalPortfolioHistory: { date: string; valueGBP: number }[]
  onClose: () => void
  onReplaceByBroker: (portfolio: 'uk', broker: 'InvestEngine' | 'Trading212', holdings: Omit<Holding, 'id'>[]) => void
  onUkHistoryFromCsv?: (snapshots: { date: string; valueGBP: number }[]) => void
  onTotalHistoryFromCsv?: (snapshots: { date: string; valueGBP: number }[]) => void
}) {
  const [broker, setBroker] = useState<'InvestEngine' | 'Trading212'>('InvestEngine')
  const [defaultOwner, setDefaultOwner] = useState<'KLN' | 'Priya' | 'from-csv'>('KLN')
  const [file, setFile] = useState<File | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [aggregated, setAggregated] = useState<HoldingFromTrades[] | null>(null)
  const [lastParsedRows, setLastParsedRows] = useState<TradeRow[] | null>(null)
  const [imported, setImported] = useState(false)

  const preview = aggregated ? aggregated.filter((h) => h.currency === 'GBP') : []

  const runParse = (text: string, owner: 'KLN' | 'Priya' | 'from-csv') => {
    const { rows, errors } = broker === 'Trading212'
      ? parseTradesCsvTrading212(text)
      : parseTradesCsv(text)
    setLastParsedRows(rows.length > 0 ? rows : null)
    if (rows.length === 0 && errors.length > 0) {
      setParseError(errors.join(' '))
      setAggregated(null)
      return
    }
    const ownerOverride = owner === 'from-csv' ? undefined : owner
    const agg = aggregateTradesToHoldings(rows, ownerOverride)
    setAggregated(agg)
    if (agg.length === 0 && rows.length > 0) {
      setParseError('No open positions found (all positions are closed or invalid).')
    } else {
      setParseError(null)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    setFile(f ?? null)
    setAggregated(null)
    setParseError(null)
    setImported(false)
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      runParse(text, defaultOwner)
    }
    reader.readAsText(f, 'UTF-8')
  }

  const handleImport = () => {
    if (preview.length === 0) return
    const holdings: Omit<Holding, 'id'>[] = preview.map((h) => ({
      name: h.name,
      symbol: h.symbol,
      exchange: h.exchange,
      category: h.category,
      unitPrice: h.averageCost,
      units: h.units,
      averageCost: h.averageCost,
      currency: h.currency,
      ...(h.owner && { owner: h.owner }),
      broker,
    }))
    onReplaceByBroker('uk', broker, holdings)
    if (lastParsedRows && lastParsedRows.length > 0) {
      const today = new Date().toISOString().slice(0, 10)
      const costFromThisCsv = preview.reduce((s, h) => s + h.units * h.averageCost, 0)
      const costFromOtherHoldings = ukHoldings.filter((h) => h.broker !== broker).reduce((s, h) => s + h.averageCost * h.units, 0)
      const fullPortfolioCost = costFromOtherHoldings + costFromThisCsv
      const newCsvHistory = buildUkPortfolioHistoryDailyFromTrades(lastParsedRows, today, undefined)
      let history: { date: string; valueGBP: number }[]
      if (totalPortfolioHistory.length > 0 && newCsvHistory.length > 0) {
        history = mergePortfolioHistoryByDate(totalPortfolioHistory, newCsvHistory, today, Math.round(fullPortfolioCost))
      } else {
        history = buildUkPortfolioHistoryDailyFromTrades(lastParsedRows, today, fullPortfolioCost)
      }
      if (history.length > 0) {
        onUkHistoryFromCsv?.(history)
        onTotalHistoryFromCsv?.(history)
      }
    }
    setImported(true)
    setTimeout(() => onClose(), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Import from trade history (CSV)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Upload a CSV of buys/sells. We aggregate to open positions and add them as holdings.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Required: date, symbol, action (Buy/Sell), quantity, price, currency. Optional: name, exchange, owner (KLN/Priya), category.
          </p>
          <a
            href="data:text/csv;charset=utf-8,date%2Csymbol%2Cname%2Caction%2Cquantity%2Cprice%2Ccurrency%2Cowner%0A2023-01-15%2CVUAG%2CVanguard%20S%26P%20500%2CBuy%2C10%2C85.5%2CGBP%2CKLN%0A2024-06-01%2CVUAG%2CVanguard%20S%26P%20500%2CBuy%2C5%2C92%2CGBP%2CKLN"
            download="trades-template.csv"
            className="inline-block text-xs text-primary hover:underline mt-1"
          >
            Download template CSV
          </a>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Broker</label>
              <select
                value={broker}
                onChange={(e) => {
                  const v = e.target.value as 'InvestEngine' | 'Trading212'
                  setBroker(v)
                  setFile(null)
                  setAggregated(null)
                  setParseError(null)
                }}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="InvestEngine">InvestEngine</option>
                <option value="Trading212">Trading 212</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Owner for this file</label>
              <select
                value={defaultOwner}
                onChange={(e) => {
                  const newOwner = e.target.value as 'KLN' | 'Priya' | 'from-csv'
                  setDefaultOwner(newOwner)
                  if (file) {
                    const reader = new FileReader()
                    reader.onload = () => runParse(String(reader.result ?? ''), newOwner)
                    reader.readAsText(file)
                  }
                }}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="KLN">KLN</option>
                <option value="Priya">Priya</option>
                <option value="from-csv">Use owner from CSV column (if present)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CSV file</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => { handleFileChange(e); (e.target.value = '') }}
                className="block text-sm text-gray-500 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border file:border-gray-300 file:bg-gray-100 dark:file:bg-gray-800 dark:file:border-gray-600 file:text-gray-700 dark:file:text-gray-300"
              />
            </div>
          </div>
          {broker === 'Trading212' && (
            <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              Use a CSV exported from Trading 212 (Account → History → Export). Market buy/sell rows are imported; deposits and dividends are skipped.
            </p>
          )}
          {parseError && (
            <p className="text-sm text-red-600 dark:text-red-400">{parseError}</p>
          )}
          {aggregated && aggregated.length > 0 && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {preview.length > 0
                  ? `${preview.length} open position(s) will replace this broker’s holdings for the same owner(s) only; other brokers and owners are kept. You can fetch live prices after import.`
                  : 'No GBP positions in this file. Use a UK broker CSV (InvestEngine or Trading 212).'}
                {preview.length > 0 && lastParsedRows && lastParsedRows.length > 0 && (
                  <span className="block mt-1">Import also builds Dashboard “UK investment growth” and “Portfolio growth (total)” from the CSV dates (cost basis by month).</span>
                )}
              </p>
              {preview.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">Symbol</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-right p-2 font-medium">Units</th>
                      <th className="text-right p-2 font-medium">Avg cost</th>
                      <th className="text-left p-2 font-medium">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((h, i) => (
                      <tr key={i} className="border-t border-gray-200 dark:border-gray-700">
                        <td className="p-2">{h.symbol}</td>
                        <td className="p-2 truncate max-w-[120px]" title={h.name}>{h.name}</td>
                        <td className="p-2 text-right">{formatUnits(h.units)}</td>
                        <td className="p-2 text-right">£{h.averageCost.toFixed(2)}</td>
                        <td className="p-2">{h.owner ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={preview.length === 0}
                  className="px-3 py-2 rounded-lg bg-primary text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {imported ? 'Imported' : `Import ${preview.length} holdings`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function AddHoldingModal({
  onClose,
  onAdd,
  getPriceApiKey,
  getTwelveDataKey,
}: {
  portfolio?: 'uk'
  onClose: () => void
  onAdd: (portfolio: 'uk', holding: Omit<Holding, 'id'>) => void
  getPriceApiKey?: () => string | undefined
  getTwelveDataKey?: () => string | undefined
}) {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [exchange, setExchange] = useState<Exchange>('LSE')
  const [category, setCategory] = useState<AssetCategory>('Equity')
  const [units, setUnits] = useState('')
  const [averageCost, setAverageCost] = useState('')
  const [owner, setOwner] = useState<'KLN' | 'Priya'>('KLN')
  const [bank, setBank] = useState<'Plum' | 'HSBC' | 'Lloyds'>('Plum')
  const todayForCash = new Date().toISOString().slice(0, 10)
  const [cashAddedDate, setCashAddedDate] = useState(todayForCash)
  const [cashAmount, setCashAmount] = useState('')
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [fetchedPrice, setFetchedPrice] = useState<number | null>(null)

  const handleFetchPrice = async () => {
    if (!symbol.trim()) return
    setPriceError(null)
    setFetchedPrice(null)
    setFetchingPrice(true)
    const result = await fetchQuote(symbol.trim(), exchange, getTwelveDataKey?.(), getPriceApiKey?.())
    setFetchingPrice(false)
    if (result.error) {
      setPriceError(result.error)
      return
    }
    setFetchedPrice(result.price)
    if (!averageCost || parseFloat(averageCost) === 0) setAverageCost(String(result.price))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (category === 'Cash') {
      const amount = parseFloat(cashAmount)
      if (Number.isNaN(amount) || amount < 0) return
      onAdd('uk', {
        name: bank,
        symbol: 'CASH',
        exchange: 'LSE',
        category: 'Cash',
        unitPrice: amount,
        units: 1,
        averageCost: amount,
        currency: 'GBP',
        owner,
        bank,
        addedDate: cashAddedDate || todayForCash,
      })
      onClose()
      return
    }
    const u = parseFloat(units)
    const ac = parseFloat(averageCost)
    if (!name.trim() || !symbol.trim() || isNaN(u) || u <= 0 || isNaN(ac) || ac < 0) return
    const price = fetchedPrice ?? ac
    onAdd('uk', {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      exchange,
      category,
      unitPrice: price,
      units: u,
      averageCost: ac,
      currency: 'GBP',
      owner,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Add UK holding
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AssetCategory)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {category === 'Cash' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Owner</label>
                <select
                  value={owner}
                  onChange={(e) => setOwner(e.target.value as 'KLN' | 'Priya')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                >
                  <option value="KLN">KLN</option>
                  <option value="Priya">Priya</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bank</label>
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value as 'Plum' | 'HSBC' | 'Lloyds')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                >
                  <option value="Plum">Plum</option>
                  <option value="HSBC">HSBC</option>
                  <option value="Lloyds">Lloyds</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date added</label>
                <input
                  type="date"
                  value={cashAddedDate}
                  onChange={(e) => setCashAddedDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Used so the growth chart steps on this date.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (£)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                  required={category === 'Cash'}
                />
              </div>
            </>
          ) : (
            <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vanguard S&P 500"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Exchange</label>
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value as Exchange)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
            >
              {EXCHANGES.map((ex) => (
                <option key={ex.value} value={ex.value}>{ex.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g. VUAG, NVDA, ITC"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                required
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleFetchPrice}
                disabled={fetchingPrice || !symbol.trim()}
                className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
              >
                {fetchingPrice ? '…' : 'Get price'}
              </button>
            </div>
          </div>
          {priceError && <p className="text-sm text-error">{priceError}</p>}
          {fetchedPrice != null && (
            <p className="text-sm text-success">Current price: {formatMoney(fetchedPrice, 'GBP')}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Units</label>
              <input
                type="number"
                min="0"
                step="any"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Avg cost</label>
              <input
                type="number"
                min="0"
                step="any"
                value={averageCost}
                onChange={(e) => setAverageCost(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Owner</label>
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value as 'KLN' | 'Priya')}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
            >
              <option value="KLN">KLN</option>
              <option value="Priya">Priya</option>
            </select>
          </div>
            </>
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg bg-primary text-white font-medium"
            >
              Add holding
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function HoldingsTable({
  portfolio,
  holdings,
  onAdd,
  onRemove,
  onRefreshPrice,
  onUpdateBroker,
  onUpdateAddedDate,
  getCashAddedDate,
  getPriceApiKey,
  getTwelveDataKey,
}: {
  portfolio: 'uk'
  holdings: Holding[]
  onAdd: () => void
  onRemove: (portfolio: 'uk', id: string) => void
  onRefreshPrice: (portfolio: 'uk', id: string, unitPrice: number) => void
  onUpdateBroker: (portfolio: 'uk', id: string, broker: 'InvestEngine' | 'Trading212' | null) => void
  onUpdateAddedDate: (portfolio: 'uk', id: string, addedDate: string | undefined) => void
  getCashAddedDate?: (holding: Holding) => string | undefined
  getPriceApiKey?: () => string | undefined
  getTwelveDataKey?: () => string | undefined
}) {
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const getUsage = () => getTwelveDataUsage()
  const [usage, setUsage] = useState(getUsage)

  const totalValue = holdings.reduce((s, h) => s + currentValue(h.unitPrice, h.units), 0)
  const totalInvested = holdings.reduce((s, h) => s + h.averageCost * h.units, 0)
  const gain = gainLoss(totalValue, totalInvested)
  const gainPct = gainLossPercent(totalValue, totalInvested)

  const display = (v: number) => v
  const displayCurr: 'GBP' = 'GBP'

  const refreshOne = async (h: Holding) => {
    setError(null)
    if (h.category === 'Cash' || h.symbol === 'CASH') return
    setRefreshingId(h.id)
    const result = await fetchQuote(h.symbol, h.exchange, getTwelveDataKey?.(), getPriceApiKey?.())
    setRefreshingId(null)
    setUsage(getUsage())
    if (result.error) {
      setError(result.error)
      return
    }
    onRefreshPrice(portfolio, h.id, result.price)
  }

  const [refreshProgress, setRefreshProgress] = useState<{
    current: number
    total: number
    estimatedSecondsRemaining: number
    currentSymbol: string
  } | null>(null)

  const delayMs = REFRESH_ALL_DELAY_MS_TWELVEDATA

  function formatEta(seconds: number): string {
    if (seconds <= 0) return 'finishing…'
    const min = Math.floor(seconds / 60)
    const sec = seconds % 60
    if (min === 0) return `~${sec} sec remaining`
    if (sec === 0) return `~${min} min remaining`
    return `~${min} min ${sec} sec remaining`
  }

  const refreshAll = async () => {
    setError(null)
    setRefreshingAll(true)
    const toRefresh = holdings.filter(
      (h) => h.category !== 'Cash' && h.symbol !== 'CASH'
    )
    const total = toRefresh.length
    for (let i = 0; i < total; i++) {
      const h = toRefresh[i]
      const remainingAfterThis = total - (i + 1)
      const estimatedSec = Math.ceil((remainingAfterThis * delayMs) / 1000)
      setRefreshProgress({
        current: i + 1,
        total,
        estimatedSecondsRemaining: estimatedSec,
        currentSymbol: h.symbol,
      })
      const result = await fetchQuote(h.symbol, h.exchange, getTwelveDataKey?.(), getPriceApiKey?.())
      setUsage(getUsage())
      if (result.error) {
        setError(result.error)
        setRefreshProgress(null)
        setRefreshingAll(false)
        return
      }
      onRefreshPrice(portfolio, h.id, result.price)
    }
    setRefreshProgress(null)
    setRefreshingAll(false)
    setUsage(getUsage())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add holding
        </button>
        {holdings.length > 0 && (
          <>
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshingAll}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshingAll ? 'animate-spin' : ''}`} />
              Refresh all prices
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400" title="Only counts requests from this app today">
              ~{usage.remaining} of {usage.limit} requests left today (8/min)
            </span>
          </>
        )}
      </div>
      {refreshingAll && refreshProgress && (
        <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 space-y-2">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Refreshing prices — {refreshProgress.currentSymbol} ({refreshProgress.current}/{refreshProgress.total})
          </p>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${(refreshProgress.current / refreshProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {formatEta(refreshProgress.estimatedSecondsRemaining)}
            {' · '}
            8/min rate limit
          </p>
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex justify-between items-center p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
        <span className="text-sm text-gray-500 dark:text-gray-400">Total value</span>
        <span className="font-semibold text-gray-900 dark:text-white">
          {formatMoney(display(totalValue), displayCurr)}
        </span>
      </div>
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-500">Gain/Loss</span>
        <span className={gain >= 0 ? 'text-success' : 'text-error'}>
          {formatMoney(display(gain), displayCurr)} ({formatPercent(gainPct)})
        </span>
      </div>
      {holdings.some((h) => !h.lastUpdated) && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          G/L is 0 until you refresh prices. Avg cost is from your CSV; use Refresh to fetch live Price and see real G/L.
        </p>
      )}

      {holdings.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
          <p>No holdings yet. Add one using the exchange and symbol (e.g. NASDAQ: NVDA, LSE: VUAG, NSE: ITC).</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-300">Name</th>
                  <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-300">Category</th>
                  <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-300">Broker / Bank</th>
                  <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-300">Date added</th>
                  <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-300">Exchange</th>
                  <th className="text-right p-3 font-medium text-gray-700 dark:text-gray-300">Avg cost</th>
                  <th className="text-right p-3 font-medium text-gray-700 dark:text-gray-300">Price</th>
                  <th className="text-right p-3 font-medium text-gray-700 dark:text-gray-300">Units</th>
                  <th className="text-right p-3 font-medium text-gray-700 dark:text-gray-300">Value</th>
                  <th className="text-right p-3 font-medium text-gray-700 dark:text-gray-300">G/L %</th>
                  <th className="w-20 p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {holdings.map((h) => {
                  const value = currentValue(h.unitPrice, h.units)
                  const inv = h.averageCost * h.units
                  const pct = gainLossPercent(value, inv)
                  const isRefreshing = refreshingId === h.id
                  return (
                    <tr key={h.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="p-3">
                        <div className="font-medium text-gray-900 dark:text-white">{h.name}</div>
                        <div className="text-xs text-gray-500">{h.symbol} {h.owner && `· ${h.owner}`}</div>
                      </td>
                      <td className="p-3 text-gray-600 dark:text-gray-400">{h.category === 'Cash' || h.symbol === 'CASH' ? 'Cash' : h.category}</td>
                      <td className="p-3">
                        {(h.category === 'Cash' || h.symbol === 'CASH') ? (
                          <span className="text-gray-700 dark:text-gray-300">{h.bank ?? '—'}</span>
                        ) : (
                          <select
                            value={h.broker ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              onUpdateBroker(portfolio, h.id, v === '' ? null : (v as 'InvestEngine' | 'Trading212'))
                            }}
                            className="text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white py-1 px-2"
                          >
                            <option value="">Other</option>
                            <option value="InvestEngine">InvestEngine</option>
                            <option value="Trading212">Trading 212</option>
                          </select>
                        )}
                      </td>
                      <td className="p-3">
                        {(h.category === 'Cash' || h.symbol === 'CASH') ? (
                          <input
                            type="date"
                            value={getCashAddedDate?.(h) ?? h.addedDate ?? ''}
                            onChange={(e) => onUpdateAddedDate(portfolio, h.id, e.target.value || undefined)}
                            className="text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white py-1 px-2"
                            title="Date added (growth chart steps on this date)"
                          />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-gray-600 dark:text-gray-400">
                        {(h.category === 'Cash' || h.symbol === 'CASH') ? '—' : h.exchange}
                      </td>
                      <td className="p-3 text-right text-gray-600 dark:text-gray-400">
                        {formatMoney(display(h.averageCost), displayCurr)}
                      </td>
                      <td className="p-3 text-right">
                        {formatMoney(display(h.unitPrice), displayCurr)}
                        {h.lastUpdated && (
                          <div className="text-xs text-gray-400">
                            {new Date(h.lastUpdated).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">{formatUnits(h.units)}</td>
                      <td className="p-3 text-right font-medium">{formatMoney(display(value), displayCurr)}</td>
                      <td className={`p-3 text-right ${pct >= 0 ? 'text-success' : 'text-error'}`}>
                        {formatPercent(pct)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {h.category !== 'Cash' && h.symbol !== 'CASH' && (
                            <button
                              type="button"
                              onClick={() => refreshOne(h)}
                              disabled={isRefreshing}
                              className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                              title="Refresh price"
                            >
                              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onRemove(portfolio, h.id)}
                            className="p-1.5 rounded text-gray-500 hover:bg-red-50 dark:hover:bg-gray-800 hover:text-error"
                            title="Remove"
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
          </div>
        </div>
      )}
    </div>
  )
}
