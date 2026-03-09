import { useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, Download, Upload, Database, CreditCard, FileText, Shield, Info } from 'lucide-react'

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
}

const BACKUP_KEYS = [
  'personal-fin-app-state',
  'personal-fin-app-budgets',
  'personal-fin-app-emergency-fund',
  'personal-fin-app-uk-portfolio-history',
  'personal-fin-app-total-portfolio-history',
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
  a.download = `firefly-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importBackup() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      let restored = 0

      // Full Firefly backup (Export format)
      if (data._version) {
        BACKUP_KEYS.forEach((key) => {
          if (data[key]) {
            localStorage.setItem(key, data[key])
            restored++
          }
        })
      } else {
        // Plain holdings backup: array or { ukHoldings: [...] }
        const holdings =
          Array.isArray(data)
            ? data
            : Array.isArray(data?.ukHoldings)
              ? data.ukHoldings
              : Array.isArray(data?.uk)
                ? data.uk
                : null
        if (holdings?.length) {
          const stateKey = BACKUP_KEYS[0] // 'personal-fin-app-state'
          localStorage.setItem(stateKey, JSON.stringify({ ukHoldings: holdings }))
          restored = 1
        } else {
          alert('Invalid backup file: expected Firefly export or holdings array / { ukHoldings: [...] }')
          return
        }
      }

      // Push restored holdings to server so localhost and LAN IP both see the same data
      try {
        const stateRaw = localStorage.getItem(BACKUP_KEYS[0])
        if (stateRaw) {
          const parsed = JSON.parse(stateRaw)
          const toSync = parsed?.ukHoldings ?? parsed?.uk
          if (Array.isArray(toSync) && toSync.length > 0) {
            await fetch('/api/sync-holdings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ukHoldings: toSync })
            })
          }
        }
      } catch {}

      alert(`Successfully restored ${restored} item(s)! Reloading…`)
      window.location.reload()
    } catch (err) {
      alert('Failed to import backup: ' + err)
    }
  }
  input.click()
}

export function More() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">More</h1>
              <p className="text-xs text-slate-500">Settings & utilities</p>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-2xl mx-auto" {...fadeInUp}>
        {/* Data Management */}
        <motion.div variants={fadeInUp} className="mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-400" />
            Data Management
          </h2>
          <div className="space-y-3">
            <button 
              onClick={downloadBackup}
              className="w-full flex items-center justify-between p-4 bg-slate-900 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Download className="w-5 h-5 text-slate-400" />
                <div className="text-left">
                  <p className="font-medium">Export Backup</p>
                  <p className="text-xs text-slate-400">Download all data as JSON</p>
                </div>
              </div>
            </button>
            <button 
              onClick={importBackup}
              className="w-full flex items-center justify-between p-4 bg-slate-900 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Upload className="w-5 h-5 text-slate-400" />
                <div className="text-left">
                  <p className="font-medium">Import Backup</p>
                  <p className="text-xs text-slate-400">Restore from backup file</p>
                </div>
              </div>
            </button>
          </div>
        </motion.div>

        {/* Account Settings */}
        <motion.div variants={fadeInUp} className="mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-purple-400" />
            API Keys
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-slate-900 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 text-slate-400 text-xs">📈</div>
                <div>
                  <p className="font-medium">Alpha Vantage</p>
                  <p className="text-xs text-slate-400">Stock price data</p>
                </div>
              </div>
              <span className="text-xs text-slate-500">Not configured</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-900 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 text-slate-400 text-xs">📊</div>
                <div>
                  <p className="font-medium">Twelve Data</p>
                  <p className="text-xs text-slate-400">Real-time quotes</p>
                </div>
              </div>
              <span className="text-xs text-slate-500">Not configured</span>
            </div>
          </div>
        </motion.div>

        {/* About */}
        <motion.div variants={fadeInUp}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Info className="w-5 h-5 text-emerald-400" />
            About
          </h2>
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <span className="text-xl">🔥</span>
              </div>
              <div>
                <p className="font-bold">Firefly</p>
                <p className="text-xs text-slate-400">FIRE Portfolio Tracker</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Version</span>
                <span>0.0.9</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Built with</span>
                <span>React + Vite + Tailwind</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Data storage</span>
                <span>Local (Browser)</span>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
