#!/usr/bin/env node
/**
 * Firefly — one-time CSV → data.json importer.
 *
 * Usage:
 *   node scripts/import-from-sheets.js <csv> [<csv> ...] [flags]
 *
 * Example:
 *   node scripts/import-from-sheets.js \
 *     "google-sheet-csv/KLN-Finance-Master - UK-Investments.csv" \
 *     "google-sheet-csv/KLN-Finance-Master - MF & Stocks.csv"
 *
 * Flags:
 *   --dry-run         Print what would be imported; don't touch data.json.
 *   --force           Overwrite an existing non-empty holdings array.
 *   --out <path>      Output file (default: ./data.json).
 *   -h, --help        This help.
 *
 * Supported sheet shapes (auto-detected by header row):
 *
 *   UK-Investments (GBP):
 *     "",Symbol,Owner,Category,Sub-cateogry,Unit Price,Avg Cost,Units,Amount,...
 *
 *   MF & Stocks (INR):
 *     Name,Symbol,Category,Sub-cateogry,Unit Price,Units,Avg Cost,Ab Returns,XIRR,Amount,Allocation %,Remarks,...
 *
 * Behaviour:
 *   - Ticker normalised to Yahoo format:
 *       LON:X   -> X.L
 *       NSE:X   -> X.NS
 *       BSE:X   -> X.BO
 *       NASDAQ:X / NYSE:X / NYSEARCA:X -> X
 *     Concatenated-exchange corruption (e.g. "NASDAQ:GOOGNASDAQ:AMZN") keeps the
 *     first exchange:ticker chunk only.
 *   - Type inferred from Category + Symbol:
 *       Cash/DEBT category     -> "cash"
 *       Gold category          -> "commodity"
 *       Fund-code pattern
 *         (UTI_*, MIRA_*, etc.) or known LSE ETF (VUAG, EQQQ, VEUA, VDPG,
 *         CSJP, EMIM, SGLN, ...)  -> "etf"
 *       Everything else         -> "stock"
 *   - Sector = Sub-cateogry, falling back to Category.
 *   - Cash rows (no Symbol, Category in {Cash, DEBT}) imported as
 *     { type: "cash", shares: 1, avgCost: Amount, ticker: "CASH:<OWNER>:<slug>" }.
 *   - Existing data.json is backed up to data.json.bak.<timestamp> before overwrite.
 *   - Refuses to overwrite a non-empty holdings array unless --force is passed.
 *   - Snapshots / transactions / settings in an existing data.json are preserved.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { v4 as uuidv4 } from 'uuid'

// ---------- CLI -----------------------------------------------------------

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  const msg = `Usage: node scripts/import-from-sheets.js <csv> [<csv> ...] [flags]

Flags:
  --dry-run       Print what would be imported; don't write data.json.
  --force         Overwrite an existing non-empty holdings array.
  --out <path>    Output file (default: ./data.json).
  -h, --help      This help.`
  process.stdout.write(msg + '\n')
  process.exit(argv.length === 0 ? 1 : 0)
}

const flags = { dryRun: false, force: false, out: path.resolve('data.json') }
const csvPaths = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dry-run') flags.dryRun = true
  else if (a === '--force') flags.force = true
  else if (a === '--out') {
    const v = argv[++i]
    if (!v) die(`--out needs a path`)
    flags.out = path.resolve(v)
  } else if (a.startsWith('-')) die(`Unknown flag: ${a}`)
  else csvPaths.push(path.resolve(a))
}
if (csvPaths.length === 0) die('No CSV files provided.')

// ---------- helpers -------------------------------------------------------

function die(msg, code = 2) {
  process.stderr.write(msg + '\n')
  process.exit(code)
}

function cleanCell(raw) {
  if (raw == null) return ''
  return String(raw).replace(/\s+/g, ' ').trim()
}

function parseNumber(raw) {
  if (raw == null) return null
  let s = String(raw).trim()
  if (s === '' || s === '—' || s === '-' || /^#(N\/A|REF!|DIV\/0!|ERROR!|VALUE!|NAME\?)/i.test(s)) return null
  s = s.replace(/[£$€₹,\s]/g, '').replace(/%$/, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const KNOWN_UK_ETFS = new Set([
  'VUAG', 'EQQQ', 'VEUA', 'VDPG', 'CSJP', 'EMIM', 'SGLN',
  'VWRP', 'VEUR', 'VAPX', 'VUSA', 'VHVG', 'VMID', 'IWDA',
])
const FUND_CODE_RE = /^(UTI|MIRA|DSP|AXIS|ZERO|HDFC|SBI|ICIC|KOTK|NIPP|PARA)_/i

const EXCHANGES = ['NASDAQ', 'NYSEARCA', 'NYSE', 'AMEX', 'LON', 'NSE', 'BSE']
const EXCH_ALT = EXCHANGES.join('|')
// ^EXCH:<ticker>  where <ticker> is lazy and stops at the start of the next
// known exchange prefix (handling corruption like "NASDAQ:GOOGNASDAQ:AMZN")
// or end of string.
const EXCH_RE = new RegExp(`^(${EXCH_ALT}):(.+?)(?=(?:${EXCH_ALT}):|$)`, 'i')

function normaliseTicker(rawSymbol) {
  const s = cleanCell(rawSymbol)
  if (!s) return ''
  let exch = '', sym = ''
  const m = s.match(EXCH_RE)
  if (m) {
    exch = m[1]
    sym = m[2]
  } else if (s.includes(':')) {
    const [e, ...rest] = s.split(':')
    exch = e
    sym = rest.join(':')
  } else {
    return s
  }
  sym = sym.trim().toUpperCase()
  if (!sym) return s
  switch (exch.toUpperCase()) {
    case 'LON': return `${sym}.L`
    case 'NSE': return `${sym}.NS`
    case 'BSE': return `${sym}.BO`
    case 'NASDAQ':
    case 'NYSE':
    case 'NYSEARCA':
    case 'AMEX':
      return sym
    default: return s
  }
}

function inferType({ categoryRaw, tickerNorm, rawSymbol }) {
  const cat = cleanCell(categoryRaw).toLowerCase()
  if (cat === 'cash' || cat === 'debt' || cat.startsWith('debt')) return 'cash'
  if (cat === 'gold' || cat.startsWith('gold')) return 'commodity'
  const sym = cleanCell(rawSymbol)
  if (FUND_CODE_RE.test(sym)) return 'etf'
  const bare = tickerNorm.replace(/\.(L|NS|BO)$/i, '').toUpperCase()
  if (KNOWN_UK_ETFS.has(bare)) return 'etf'
  // Gold ETF on NSE (GOLDBEES) already caught by Gold category. Safety:
  if (/GOLD/i.test(bare)) return 'commodity'
  return 'stock'
}

function slug(s) {
  return cleanCell(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'row'
}

function detectShape(header) {
  const cells = header.map(c => cleanCell(c).toLowerCase())
  if (cells[0] === '' && cells[1] === 'symbol' && cells[2] === 'owner') return 'uk'
  if (cells[0] === 'name' && cells[1] === 'symbol' && cells[2] === 'category') return 'india'
  return null
}

// ---------- per-file import ----------------------------------------------

function importFile(csvPath) {
  if (!fs.existsSync(csvPath)) return { path: csvPath, shape: null, holdings: [], warnings: [`File not found: ${csvPath}`] }

  const raw = fs.readFileSync(csvPath, 'utf8')
  let records
  try {
    records = parse(raw, { columns: false, skip_empty_lines: false, relax_column_count: true, relax_quotes: true })
  } catch (e) {
    return { path: csvPath, shape: null, holdings: [], warnings: [`csv-parse error: ${e.message}`] }
  }
  if (records.length < 2) return { path: csvPath, shape: null, holdings: [], warnings: ['File has fewer than 2 rows'] }

  const shape = detectShape(records[0])
  if (!shape) return { path: csvPath, shape: null, holdings: [], warnings: [`Unrecognised header: ${JSON.stringify(records[0]).slice(0, 200)}`] }

  const idx = shape === 'uk'
    ? { name: 0, symbol: 1, owner: 2, category: 3, sub: 4, unitPrice: 5, avgCost: 6, units: 7, amount: 8 }
    : { name: 0, symbol: 1, category: 2, sub: 3, unitPrice: 4, units: 5, avgCost: 6, amount: 9, remarks: 11 }

  const baseCcy = shape === 'uk' ? 'GBP' : 'INR'
  const holdings = []
  const warnings = []

  for (let i = 1; i < records.length; i++) {
    const row = records[i]
    const name = cleanCell(row[idx.name])
    const symbol = cleanCell(row[idx.symbol])
    const category = cleanCell(row[idx.category])
    const sub = cleanCell(row[idx.sub])
    const owner = shape === 'uk' ? cleanCell(row[idx.owner]) : ''
    const remarks = shape === 'india' ? cleanCell(row[idx.remarks]) : ''
    const units = parseNumber(row[idx.units])
    const avgCost = parseNumber(row[idx.avgCost])
    const amount = parseNumber(row[idx.amount])

    // Skip dashboard-pivot junk and empty rows: no name AND no symbol AND no numbers.
    if (!name && !symbol && units == null && amount == null) continue

    const catLc = category.toLowerCase()
    const isCashCategory = catLc === 'cash' || catLc === 'debt' || catLc.startsWith('debt')
    const isCash = !symbol && units == null && isCashCategory

    let holding
    if (isCash) {
      if (amount == null) { warnings.push(`Cash row dropped (no Amount): "${name}"`); continue }
      const ownerPart = (owner || 'KLN').toUpperCase()
      holding = {
        id: uuidv4(),
        ticker: `CASH:${ownerPart}:${slug(name)}`,
        name: name || 'Cash',
        type: 'cash',
        sector: sub || category || 'Cash',
        shares: 1,
        avgCost: amount,
        currency: baseCcy,
        notes: [owner ? `Owner: ${owner}` : '', remarks].filter(Boolean).join(' | '),
      }
    } else {
      if (!symbol && !name) continue
      if (units == null) { warnings.push(`Instrument row dropped (no Units): "${name || symbol}"`); continue }
      const tickerNorm = normaliseTicker(symbol) || cleanCell(name).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12)
      if (!tickerNorm) { warnings.push(`Instrument row dropped (no usable ticker): "${name}"`); continue }
      const type = inferType({ categoryRaw: category, tickerNorm, rawSymbol: symbol })
      const noteParts = []
      if (owner) noteParts.push(`Owner: ${owner}`)
      if (remarks) noteParts.push(remarks)
      if (!symbol) noteParts.push('WARN: ticker guessed from name')
      else if ((symbol.match(/[A-Z]{2,}:/g) || []).length > 1) noteParts.push(`WARN: source symbol corrupted ("${symbol}")`)
      holding = {
        id: uuidv4(),
        ticker: tickerNorm,
        name: name || symbol,
        type,
        sector: sub || category || '',
        shares: units,
        avgCost: avgCost ?? 0,
        currency: baseCcy,
        notes: noteParts.join(' | '),
      }
    }
    holdings.push(holding)
  }

  return { path: csvPath, shape, holdings, warnings }
}

// ---------- main ----------------------------------------------------------

let existing = null
if (fs.existsSync(flags.out)) {
  try { existing = JSON.parse(fs.readFileSync(flags.out, 'utf8')) } catch { existing = null }
}
const existingHoldings = Array.isArray(existing?.holdings) ? existing.holdings : []
if (existingHoldings.length > 0 && !flags.force && !flags.dryRun) {
  die(`Refusing to overwrite ${flags.out}: holdings already has ${existingHoldings.length} entries.\nRe-run with --force to overwrite, or --dry-run to preview.`, 3)
}

const perFile = csvPaths.map(importFile)
const allHoldings = perFile.flatMap(f => f.holdings)
const typeCounts = allHoldings.reduce((a, h) => ((a[h.type] = (a[h.type] || 0) + 1), a), {})
const ccyCounts = allHoldings.reduce((a, h) => ((a[h.currency] = (a[h.currency] || 0) + 1), a), {})
const flaggedForReview = allHoldings.filter(h => /WARN:/.test(h.notes || ''))

process.stdout.write('--- Firefly import summary ---\n')
for (const f of perFile) {
  process.stdout.write(`  ${path.basename(f.path)}  shape=${f.shape ?? 'UNKNOWN'}  rows=${f.holdings.length}  warnings=${f.warnings.length}\n`)
}
process.stdout.write(`  Total holdings: ${allHoldings.length}\n`)
process.stdout.write(`  By type:        ${JSON.stringify(typeCounts)}\n`)
process.stdout.write(`  By currency:    ${JSON.stringify(ccyCounts)}\n`)
process.stdout.write(`  Flagged rows:   ${flaggedForReview.length} (check notes for "WARN:")\n`)

for (const f of perFile) {
  if (f.warnings.length) {
    process.stdout.write(`\n[${path.basename(f.path)}] warnings:\n`)
    for (const w of f.warnings) process.stdout.write(`  - ${w}\n`)
  }
}

if (flaggedForReview.length) {
  process.stdout.write('\nRows needing manual review (imported, but flagged):\n')
  for (const h of flaggedForReview) {
    process.stdout.write(`  - ${h.name} (ticker=${h.ticker})  ${h.notes}\n`)
  }
}

if (flags.dryRun) {
  process.stdout.write('\n(--dry-run — data.json not touched)\n')
  process.exit(0)
}

const out = {
  holdings: allHoldings,
  snapshots: Array.isArray(existing?.snapshots) ? existing.snapshots : [],
  transactions: Array.isArray(existing?.transactions) ? existing.transactions : [],
  settings: {
    baseCurrency: existing?.settings?.baseCurrency || 'GBP',
    lastUpdated: new Date().toISOString(),
  },
}

if (fs.existsSync(flags.out)) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const bak = `${flags.out}.bak.${ts}`
  fs.copyFileSync(flags.out, bak)
  process.stdout.write(`\nBacked up existing data.json -> ${path.basename(bak)}\n`)
}

const tmp = `${flags.out}.tmp`
fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n')
fs.renameSync(tmp, flags.out)
process.stdout.write(`Wrote ${flags.out} (${allHoldings.length} holdings)\n`)
