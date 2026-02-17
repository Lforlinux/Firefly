import { useState, useRef } from 'react'
import { useApp } from '@/context/AppContext'
import { FileText, Settings, Download, Upload } from 'lucide-react'

const BACKUP_KEYS = [
  'personal-fin-app-state',
  'personal-fin-app-budgets',
  'personal-fin-app-emergency-fund',
  'personal-fin-app-uk-portfolio-history',
  'personal-fin-app-total-portfolio-history',
  'personal-fin-app-alpha-vantage-key',
  'personal-fin-app-twelvedata-key',
  'personal-fin-app-cash-added-dates',
  'personal-fin-app-selected-portfolio',
] as const

function downloadBackup() {
  const data: Record<string, string | null> = { _version: '1', _exportedAt: new Date().toISOString() }
  BACKUP_KEYS.forEach((key) => {
    data[key] = localStorage.getItem(key)
  })
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `personal-finance-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function restoreBackup(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as Record<string, string | null>
        BACKUP_KEYS.forEach((key) => {
          if (data[key] != null) localStorage.setItem(key, data[key]!)
        })
        resolve()
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export function More() {
  const { getPriceApiKey, setPriceApiKey, getTwelveDataKey, setTwelveDataKey } = useApp()
  const [apiKey, setApiKey] = useState(() => getPriceApiKey() ?? '')
  const [twelveDataKey, setTwelveDataKeyInput] = useState(() => getTwelveDataKey() ?? '')
  const [keySaved, setKeySaved] = useState(false)
  const [tdKeySaved, setTdKeySaved] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreSuccess, setRestoreSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setRestoreError(null)
    setRestoreSuccess(false)
    if (!file) return
    try {
      await restoreBackup(file)
      setRestoreSuccess(true)
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Invalid backup file')
    }
  }

  return (
    <div className="p-4 w-full min-w-0">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">More</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Settings & backup</p>
      </header>

      <section className="space-y-3">
        <SectionTitle icon={<FileText className="h-5 w-5" />}>Backup & restore</SectionTitle>
        <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            If the app or browser data is lost, you can restore from a backup. Download a backup regularly and keep it somewhere safe (e.g. cloud drive).
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={downloadBackup}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
            >
              <Download className="h-4 w-4" />
              Download backup
            </button>
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
              <Upload className="h-4 w-4" />
              Restore from file
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleRestore}
              />
            </label>
          </div>
          {restoreSuccess && <p className="text-sm text-success">Restored. Reloading…</p>}
          {restoreError && <p className="text-sm text-red-600 dark:text-red-400">{restoreError}</p>}
        </div>
      </section>

      <section className="space-y-3 mt-8">
        <SectionTitle icon={<Settings className="h-5 w-5" />}>Settings</SectionTitle>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="p-4 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Settings className="h-5 w-5 text-gray-500" />
                <span className="font-medium text-gray-700 dark:text-gray-300">Price API — Twelve Data</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                800 requests/day free. Get a key at twelvedata.com — used first for live prices.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={twelveDataKey}
                  onChange={(e) => { setTwelveDataKeyInput(e.target.value); setTdKeySaved(false) }}
                  placeholder="Twelve Data API key"
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => { setTwelveDataKey(twelveDataKey); setTdKeySaved(true) }}
                  className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium"
                >
                  Save
                </button>
              </div>
              {tdKeySaved && <p className="text-xs text-success mt-1">Saved.</p>}
            </div>
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Alpha Vantage (fallback)</span>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                25 requests/day. Used when Twelve Data has no quote (e.g. EQQQ.L on LSE). alphavantage.co
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setKeySaved(false) }}
                  placeholder="Alpha Vantage API key"
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => { setPriceApiKey(apiKey); setKeySaved(true) }}
                  className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium"
                >
                  Save
                </button>
              </div>
              {keySaved && <p className="text-xs text-success mt-1">Saved.</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 font-medium">
      {icon}
      {children}
    </div>
  )
}
