import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Card, PageHeader, PageBody, Loading } from '@/components/ui'
import { ImportPreview } from '@/types/import'
import { previewInvestEngineCSV, commitImport } from '@/services/importService'
import { formatMoney } from '@/utils/format'

type ImportStep = 'select-source' | 'configure' | 'preview' | 'confirming' | 'done'
const OWNERS = ['KLN', 'Priya'] as const
type OwnerName = typeof OWNERS[number]

function withOwnerNote(existingNotes: string | undefined, owner: OwnerName): string {
  const withoutOwner = (existingNotes || '').replace(/(^|\s*\|\s*)Owner:\s*[A-Za-z0-9 _'-]+/gi, '').trim()
  return withoutOwner ? `Owner: ${owner} | ${withoutOwner}` : `Owner: ${owner}`
}

export function Import() {
  const [step, setStep] = useState<ImportStep>('select-source')
  const [source, setSource] = useState<'investengine' | 'trading212' | 'manual' | null>(null)
  const [owner, setOwner] = useState<OwnerName>('KLN')
  const [investengineFile, setInvestengineFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importResult, setImportResult] = useState<{
    imported: number
    skipped?: number
    failed: number
    errors: string[]
  } | null>(null)

  // Load InvestEngine CSV
  async function handleInvestengineUpload(file: File) {
    setInvestengineFile(file)
    setStep('preview')
    try {
      const p = await previewInvestEngineCSV(file)
      setPreview(p)
      setSource(p.source)
    } catch (e) {
      setPreview({
        source: 'investengine',
        totalRecords: 0,
        validRecords: 0,
        errorRecords: [{ rowIndex: 0, message: (e as Error).message }],
        transactions: [],
      })
    }
  }


  // Commit import
  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!preview || !source) throw new Error('No preview or source selected')
      const tagged = preview.transactions.map((tx) => ({
        ...tx,
        notes: withOwnerNote(tx.notes, owner),
      }))
      return commitImport(source, tagged)
    },
    onSuccess: (data) => {
      setImportResult(data)
      setStep('done')
    },
  })

  // Step: Select source
  if (step === 'select-source') {
    return (
      <>
        <PageHeader title="Import Portfolio Data" subtitle="Choose your data source" />
        <PageBody>
          <Card tone="soft" className="p-4 mb-4">
            <div className="text-xs text-slate-500 font-medium mb-2">Owner (required)</div>
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value as OwnerName)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900"
            >
              {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {/* CSV Upload */}
            <Card tone="elevated" className="p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSource('investengine')}>
              <div className="space-y-3">
                <h3 className="font-semibold">Portfolio CSV</h3>
                <p className="text-sm text-slate-500">Upload holdings or transactions</p>
                <div className="space-y-2">
                  <label className="ff-upload-picker flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 cursor-pointer dark:bg-slate-900 dark:border-slate-800 dark:hover:bg-slate-800">
                    <Upload className="h-4 w-4" />
                    <span className="text-sm">Choose file</span>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          setSource('investengine')
                          handleInvestengineUpload(e.target.files[0])
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {investengineFile && <p className="text-xs text-emerald-600">✓ {investengineFile.name}</p>}
                </div>
              </div>
            </Card>

          </div>
        </PageBody>
      </>
    )
  }

  // Step: Preview
  if (step === 'preview' && preview) {
    const validPct = preview.totalRecords > 0 ? Math.round((preview.validRecords / preview.totalRecords) * 100) : 0

    return (
      <>
        <PageHeader
          title="Preview: Portfolio CSV"
          subtitle={`${preview.validRecords} of ${preview.totalRecords} records valid · Owner: ${owner}`}
        />
        <PageBody>
          {/* Status cards */}
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <Card tone="elevated" className="p-4">
              <div className="text-xs text-slate-500 font-medium mb-1">Total Records</div>
              <div className="text-2xl font-bold">{preview.totalRecords}</div>
            </Card>
            <Card tone="elevated" className="p-4">
              <div className="text-xs text-slate-500 font-medium mb-1">Valid</div>
              <div className="text-2xl font-bold text-emerald-600">{preview.validRecords}</div>
            </Card>
            <Card tone="elevated" className="p-4">
              <div className="text-xs text-slate-500 font-medium mb-1">Success Rate</div>
              <div className="text-2xl font-bold">{validPct}%</div>
            </Card>
          </div>

          {/* Errors */}
          {preview.errorRecords.length > 0 && (
            <Card tone="soft" className="p-4 mb-6 bg-rose-50 border-rose-200 dark:bg-rose-950 dark:border-rose-800">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-rose-900 dark:text-rose-100 mb-2">Errors</h4>
                  <div className="space-y-1 text-sm text-rose-800 dark:text-rose-200">
                    {preview.errorRecords.slice(0, 5).map((e, i) => (
                      <div key={i}>
                        <strong>Row {e.rowIndex}:</strong> {e.message}
                      </div>
                    ))}
                    {preview.errorRecords.length > 5 && <div>... and {preview.errorRecords.length - 5} more</div>}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Transactions table */}
          {preview.transactions.length > 0 && (
            <Card tone="elevated" className="!p-0 mb-6 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Ticker/ISIN</th>
                      <th className="px-4 py-3">Quantity</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.transactions.slice(0, 10).map((tx, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td className="px-4 py-2 font-mono text-xs">{tx.date}</td>
                        <td className="px-4 py-2">
                          <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <div>{tx.ticker || tx.isin || '—'}</div>
                          {tx.name && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{tx.name}</div>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{tx.quantity?.toFixed(4) || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {tx.price ? `${tx.price.toFixed(2)} ${tx.priceCurrency}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                          {formatMoney(tx.total, tx.totalCurrency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.transactions.length > 10 && (
                <div className="px-4 py-3 text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/50">
                  ... and {preview.transactions.length - 10} more
                </div>
              )}
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setStep('select-source')
                setPreview(null)
                setSource(null)
              }}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            >
              Back
            </button>
            {preview.validRecords > 0 && (
              <button
                onClick={() => {
                  setStep('confirming')
                  commitMutation.mutate()
                }}
                disabled={commitMutation.isPending}
                className="px-4 py-2 rounded-lg bg-slate-900 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {commitMutation.isPending ? 'Importing...' : `Import ${preview.validRecords} transactions`}
              </button>
            )}
          </div>
        </PageBody>
      </>
    )
  }

  // Step: Done
  if (step === 'done' && importResult) {
    return (
      <>
        <PageHeader title="Import Complete" subtitle="Portfolio data has been imported" />
        <PageBody>
          <Card tone="elevated" className="p-6 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
            <div>
              <div className="text-3xl font-bold text-emerald-600">{importResult.imported}</div>
              <div className="text-sm text-slate-500">transactions imported successfully</div>
            </div>
            {(importResult.skipped || 0) > 0 && (
              <div className="rounded bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-200">
                {importResult.skipped} transactions skipped as duplicates
              </div>
            )}

            {importResult.failed > 0 && (
              <div className="rounded bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">
                {importResult.failed} transactions failed
              </div>
            )}

            {importResult.errors.length > 0 && (
              <div className="rounded bg-slate-50 p-3 text-left text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                <div className="font-semibold mb-2">Errors:</div>
                {importResult.errors.map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            )}

            <button
              onClick={() => {
                setStep('select-source')
                setPreview(null)
                setSource(null)
                setImportResult(null)
              }}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Import more data
            </button>
          </Card>
        </PageBody>
      </>
    )
  }

  return <Loading label="Loading import interface…" />
}
