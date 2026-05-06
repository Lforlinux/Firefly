import { useMemo, useRef, useState } from 'react'
import { usePortfolio, useUi } from '@/context/AppContext'
import { formatRelative, formatDate } from '@/utils/format'
import { Card, Loading, PageBody, PageHeader } from '@/components/ui'
import { LogoutButton } from '@/components/LogoutButton'
import { loadLiabilities, saveLiabilities } from '@/utils/liabilities'
import { savePortfolio, flushHoldings, syncTrading212 } from '@/services/api'

export function Settings() {
  const { data, isLoading, refetch } = usePortfolio()
  const { theme, toggleTheme, visualStyle, toggleVisualStyle, privacyMode, togglePrivacyMode, selectedOwner } = useUi()
  const importRef = useRef<HTMLInputElement>(null)
  const [importState, setImportState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [importMsg, setImportMsg] = useState('')

  // Flush holdings state
  const [flushAll, setFlushAll] = useState(false)
  const [flushT212, setFlushT212] = useState(false)
  const [flushIE, setFlushIE] = useState(false)
  const [flushConfirm, setFlushConfirm] = useState(false)
  const [flushState, setFlushState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [flushMsg, setFlushMsg] = useState('')

  // T212 sync state
  const [t212State, setT212State] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [t212Msg, setT212Msg] = useState('')

  const fxRows = useMemo(() => {
    if (!data) return []
    return Object.entries(data.fxRates || {}).map(([pair, v]) => ({ pair, ...v }))
  }, [data])

  const exportBundle = useMemo(() => {
    if (!data) return null
    let goals: unknown[] = []
    let essentials: Record<string, unknown> = {}
    let firePlanner: Record<string, unknown> = {}
    let uiPreferences: Record<string, unknown> = {}
    try {
      goals = JSON.parse(localStorage.getItem('firefly.goals') || '[]')
      essentials = JSON.parse(localStorage.getItem('firefly.essentials') || '{}')
      firePlanner = JSON.parse(localStorage.getItem('firefly.firePlanner') || '{}')
      uiPreferences = {
        theme: localStorage.getItem('firefly.theme') || theme,
        visualStyle: localStorage.getItem('firefly.visualStyle') || visualStyle,
        privacyMode: localStorage.getItem('firefly.privacy') === '1' || privacyMode,
        selectedOwner: localStorage.getItem('firefly.owner') || selectedOwner,
      }
    } catch {
      // keep defaults
    }
    return {
      exportedAt: new Date().toISOString(),
      app: 'Firefly',
      schemaVersion: 1,
      preferences: uiPreferences,
      firePlanner,
      portfolio: data,
      liabilities: loadLiabilities(),
      goals,
      essentials,
    }
  }, [data, theme, visualStyle, privacyMode, selectedOwner])

  function downloadFile(content: string, fileName: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function exportJson() {
    if (!exportBundle) return
    downloadFile(
      JSON.stringify(exportBundle, null, 2),
      `firefly-export-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    )
  }

  function toCsvRow(values: Array<string | number | boolean | null | undefined>) {
    return values
      .map((value) => {
        const s = value == null ? '' : String(value)
        return `"${s.replace(/"/g, '""')}"`
      })
      .join(',')
  }

  function exportCsv() {
    if (!exportBundle) return
    const lines: string[] = []
    lines.push(toCsvRow(['entity', 'id', 'name', 'category', 'amount', 'currency', 'notes', 'date']))

    for (const h of exportBundle.portfolio.holdings || []) {
      lines.push(toCsvRow(['asset', h.id, h.name, h.type, h.shares, h.currency, h.notes, '']))
    }
    for (const l of exportBundle.liabilities || []) {
      lines.push(toCsvRow(['liability', l.id, l.name, l.category, l.outstandingBalance, l.currency, l.notes, '']))
    }
    for (const s of exportBundle.portfolio.snapshots || []) {
      lines.push(toCsvRow(['snapshot', '', 'Net Worth Snapshot', '', s.valueGBP, exportBundle.portfolio.settings.baseCurrency, '', s.date]))
    }
    for (const g of (exportBundle.goals as Array<Record<string, unknown>>) || []) {
      lines.push(toCsvRow(['goal', g.id as string, g.title as string, '', g.targetAmount as number, exportBundle.portfolio.settings.baseCurrency, '', '']))
    }

    downloadFile(
      `${lines.join('\n')}\n`,
      `firefly-export-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
    )
  }

  async function importJson(file: File) {
    setImportState('loading')
    setImportMsg('')
    try {
      const text = await file.text()
      const bundle = JSON.parse(text)
      if (bundle.app !== 'Firefly' || !bundle.portfolio) throw new Error('Not a valid Firefly export file')

      const { portfolio, liabilities, goals, essentials, firePlanner, preferences } = bundle

      await savePortfolio({
        holdings: portfolio.holdings || [],
        snapshots: portfolio.snapshots || [],
        transactions: portfolio.transactions || [],
        settings: portfolio.settings,
      })

      if (Array.isArray(liabilities)) saveLiabilities(liabilities)
      if (goals) localStorage.setItem('firefly.goals', JSON.stringify(goals))
      if (essentials) localStorage.setItem('firefly.essentials', JSON.stringify(essentials))
      if (firePlanner) localStorage.setItem('firefly.firePlanner', JSON.stringify(firePlanner))
      if (preferences) {
        if (preferences.theme) localStorage.setItem('firefly.theme', preferences.theme)
        if (preferences.visualStyle) localStorage.setItem('firefly.visualStyle', preferences.visualStyle)
        if (preferences.selectedOwner) localStorage.setItem('firefly.owner', preferences.selectedOwner)
      }

      await refetch()
      setImportState('done')
      setImportMsg(`Imported ${portfolio.holdings?.length ?? 0} holdings, ${portfolio.snapshots?.length ?? 0} snapshots, ${portfolio.transactions?.length ?? 0} transactions.`)
    } catch (e) {
      setImportState('error')
      setImportMsg(e instanceof Error ? e.message : 'Import failed')
    }
    if (importRef.current) importRef.current.value = ''
  }

  async function doFlush() {
    const sources: ('all' | 'trading212' | 'investengine')[] = []
    if (flushAll) sources.push('all')
    else {
      if (flushT212) sources.push('trading212')
      if (flushIE) sources.push('investengine')
    }
    if (sources.length === 0) return
    setFlushState('loading')
    setFlushMsg('')
    try {
      const result = await flushHoldings(sources)
      setFlushState('done')
      setFlushMsg(`Deleted ${result.deleted.holdings} holding(s).`)
      setFlushConfirm(false)
      setFlushAll(false)
      setFlushT212(false)
      setFlushIE(false)
      await refetch()
    } catch (e) {
      setFlushState('error')
      setFlushMsg(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function doT212Sync() {
    setT212State('loading')
    setT212Msg('')
    try {
      const result = await syncTrading212()
      setT212State('done')
      setT212Msg(`Synced ${result.synced} position(s), ${result.pricesUpdated} prices updated.`)
      await refetch()
    } catch (e) {
      setT212State('error')
      setT212Msg(e instanceof Error ? e.message : 'Sync failed')
    }
  }

  if (isLoading) return <Loading />
  if (!data) return null

  return (
    <>
      <PageHeader title="Settings" subtitle="Preferences, privacy, and data status" right={<LogoutButton />} />
      <PageBody>
        <Card tone="elevated">
          <h3 className="text-sm font-semibold">Export Data</h3>
          <p className="mt-1 text-xs text-slate-500">Export all your Firefly data as JSON or CSV at any time.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="ff-settings-btn rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={exportJson}
              className="ff-settings-btn rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              Export JSON
            </button>
          </div>
        </Card>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">Import Data</h3>
          <p className="mt-1 text-xs text-slate-500">Restore from a Firefly JSON export. This replaces all current holdings, snapshots, and transactions.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700">
              {importState === 'loading' ? 'Importing…' : 'Choose JSON file'}
              <input
                ref={importRef}
                type="file"
                accept=".json"
                className="hidden"
                disabled={importState === 'loading'}
                onChange={(e) => { if (e.target.files?.[0]) importJson(e.target.files[0]) }}
              />
            </label>
            {importState === 'done' && <span className="text-xs text-emerald-600">✓ {importMsg}</span>}
            {importState === 'error' && <span className="text-xs text-rose-600">✗ {importMsg}</span>}
          </div>
        </Card>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">Data Management</h3>
          <p className="mt-1 text-xs text-slate-500">Permanently delete holdings by source. Transactions cascade-delete automatically.</p>
          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={flushAll}
                onChange={(e) => { setFlushAll(e.target.checked); setFlushConfirm(false); setFlushState('idle') }}
                className="rounded"
              />
              All holdings
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={flushAll || flushT212}
                disabled={flushAll}
                onChange={(e) => { setFlushT212(e.target.checked); setFlushConfirm(false); setFlushState('idle') }}
                className="rounded"
              />
              Trading 212 only
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={flushAll || flushIE}
                disabled={flushAll}
                onChange={(e) => { setFlushIE(e.target.checked); setFlushConfirm(false); setFlushState('idle') }}
                className="rounded"
              />
              InvestEngine only
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!flushConfirm ? (
              <button
                type="button"
                disabled={!flushAll && !flushT212 && !flushIE}
                onClick={() => setFlushConfirm(true)}
                className="ff-settings-btn rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-900/40"
              >
                Delete selected
              </button>
            ) : (
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-rose-600 dark:text-rose-400">Are you sure? This cannot be undone.</span>
                <button
                  type="button"
                  disabled={flushState === 'loading'}
                  onClick={doFlush}
                  className="ff-settings-btn rounded-lg border border-rose-400 bg-rose-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 dark:bg-rose-700 dark:hover:bg-rose-800"
                >
                  {flushState === 'loading' ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setFlushConfirm(false)}
                  className="text-xs text-slate-500 hover:underline"
                >
                  Cancel
                </button>
              </span>
            )}
            {flushState === 'done' && <span className="text-xs text-emerald-600">✓ {flushMsg}</span>}
            {flushState === 'error' && <span className="text-xs text-rose-600">✗ {flushMsg}</span>}
          </div>
        </Card>

        <Card tone="elevated">
          <h3 className="text-sm font-semibold">Trading 212 Sync</h3>
          <p className="mt-1 text-xs text-slate-500">
            Sync positions directly from your Trading 212 account. Requires T212_API_KEY set in Vercel environment variables.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={t212State === 'loading'}
              onClick={doT212Sync}
              className="ff-settings-btn rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {t212State === 'loading' ? 'Syncing…' : 'Sync from Trading 212'}
            </button>
            {t212State === 'done' && <span className="text-xs text-emerald-600">✓ {t212Msg}</span>}
            {t212State === 'error' && (
              <span className="text-xs text-rose-600">
                {t212Msg.includes('T212_API_KEY not configured')
                  ? 'T212_API_KEY not set — add it to your Vercel project environment variables and redeploy.'
                  : t212Msg}
              </span>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card tone="elevated">
            <h3 className="text-sm font-semibold">General</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Base currency</dt>
                <dd className="font-mono font-semibold">{data.settings.baseCurrency}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Theme</dt>
                <dd>
                  <button type="button" onClick={toggleTheme} className="ff-settings-pill rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700">
                    {theme}
                  </button>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Visual style</dt>
                <dd>
                  <button type="button" onClick={toggleVisualStyle} className="ff-settings-pill rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700">
                    {visualStyle === 'premium3d' ? '3D premium' : 'Minimal'}
                  </button>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Privacy mode</dt>
                <dd>
                  <button type="button" onClick={togglePrivacyMode} className="ff-settings-pill rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700">
                    {privacyMode ? 'Masked' : 'Visible'}
                  </button>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Last data update</dt>
                <dd className="tabular-nums">{formatDate(data.settings.lastUpdated)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Last price refresh</dt>
                <dd className="tabular-nums">{formatRelative(data.lastRefresh)}</dd>
              </div>
            </dl>
          </Card>

          <Card tone="elevated">
            <h3 className="text-sm font-semibold">Data status</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Holdings</dt>
                <dd className="tabular-nums">{data.holdings.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Snapshots</dt>
                <dd className="tabular-nums">{data.snapshots.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Goals</dt>
                <dd className="tabular-nums">Managed locally</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Cached prices</dt>
                <dd className="tabular-nums">{Object.keys(data.prices || {}).length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">FX pairs</dt>
                <dd className="tabular-nums">{Object.keys(data.fxRates || {}).length}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <Card tone="elevated" className="!p-0">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold">FX rates</h3>
            <p className="text-xs text-slate-500">Refreshed by the sidebar Refresh button</p>
          </div>
          {fxRows.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">No FX rates cached yet</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3">Pair</th>
                  <th className="px-5 py-3 text-right">Rate</th>
                  <th className="px-5 py-3 text-right">As of</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {fxRows.map((r) => (
                  <tr key={r.pair}>
                    <td className="px-5 py-2.5 font-mono">{r.pair.replace('_', ' → ')}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{r.rate.toFixed(6)}</td>
                    <td className="px-5 py-2.5 text-right text-slate-500">{formatRelative(r.asOf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </PageBody>
    </>
  )
}
