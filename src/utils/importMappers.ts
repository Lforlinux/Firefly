/**
 * Mappers for InvestEngine CSV and Trading 212 data
 * Normalize both formats to ImportedTransaction
 */

import { ImportedTransaction, ImportError, InvestEngineRow, Trading212Row } from '@/types/import'
import Papa from 'papaparse'

/**
 * Parse and validate InvestEngine CSV
 */
export function parseInvestEngineCSV(
  csvText: string,
): { transactions: ImportedTransaction[]; errors: ImportError[] } {
  const transactions: ImportedTransaction[] = []
  const errors: ImportError[] = []

  const lines = csvText.split('\n').map((l) => l.trim())
  if (lines.length < 2) {
    errors.push({ rowIndex: 0, message: 'CSV is empty or too short' })
    return { transactions, errors }
  }

  // Skip header row (1) — row 0 is the statement label
  const headers = lines[1].split(',').map((h) => h.trim())
  const expectedHeaders = [
    'Security / ISIN',
    'Transaction Type',
    'Quantity',
    'Share Price',
    'Total Trade Value',
    'Trade Date/Time',
    'Settlement Date',
    'Broker',
  ]

  if (!expectedHeaders.every((h) => headers.includes(h))) {
    errors.push({ rowIndex: 1, message: `Headers don't match. Expected: ${expectedHeaders.join(', ')}` })
    return { transactions, errors }
  }

  // Parse data rows (starting from row 2)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    try {
      // Simple CSV parse for InvestEngine (careful with commas in security names)
      const row = parseInvestEngineRow(line, headers)
      if (!row) {
        errors.push({ rowIndex: i + 1, message: 'Could not parse row' })
        continue
      }

      const tx = mapInvestEngineToTransaction(row, i + 1)
      if (tx instanceof Error) {
        errors.push({ rowIndex: i + 1, message: tx.message })
      } else {
        transactions.push(tx)
      }
    } catch (e) {
      errors.push({ rowIndex: i + 1, message: (e as Error).message })
    }
  }

  return { transactions, errors }
}

/**
 * Parse and validate Trading 212 CSV export
 */
export function parseTrading212CSV(
  csvText: string,
): { transactions: ImportedTransaction[]; errors: ImportError[] } {
  const transactions: ImportedTransaction[] = []
  const errors: ImportError[] = []

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.errors?.length) {
    for (const e of parsed.errors) {
      errors.push({ rowIndex: (e.row || 0) + 1, message: e.message })
    }
  }

  const rows = parsed.data || []
  if (rows.length === 0) {
    errors.push({ rowIndex: 0, message: 'CSV is empty or has no data rows' })
    return { transactions, errors }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as unknown as Trading212Row
    const tx = mapTrading212ToTransaction(row, i + 2)
    if (tx instanceof Error) errors.push({ rowIndex: i + 2, message: tx.message })
    else transactions.push(tx)
  }

  return { transactions, errors }
}

function parseInvestEngineRow(line: string, headers: string[]): InvestEngineRow | null {
  // InvestEngine CSVs can have commas in security names, so we need careful parsing
  // Use papaparse for robustness
  const result = Papa.parse(line, { header: false })
  if (!result.data || !Array.isArray(result.data[0])) return null

  const values = result.data[0] as string[]
  if (values.length < headers.length) return null

  const row: Record<string, string> = {}
  headers.forEach((h, i) => {
    row[h] = values[i]?.trim() || ''
  })

  return row as unknown as InvestEngineRow
}

function mapInvestEngineToTransaction(
  row: InvestEngineRow,
  lineNumber: number,
): ImportedTransaction | Error {
  try {
    // Extract ISIN from security field (e.g., "iShares MSCI Japan / ISIN IE00B53QDK08")
    const isinMatch = row['Security / ISIN'].match(/ISIN\s+([A-Z]{2}[A-Z0-9]{9}[0-9])/i)
    const isin = isinMatch ? isinMatch[1] : undefined

    const securityName = row['Security / ISIN'].split('/')[0]?.trim() || ''

    const quantity = parseFloat(row.Quantity)
    const price = parseMoney(row['Share Price']) // "£160.7070"
    const total = parseMoney(row['Total Trade Value']) // "£32.84"

    if (isNaN(quantity) || isNaN(price) || isNaN(total)) {
      return new Error(`Invalid numeric fields at row ${lineNumber}`)
    }

    const tradeDate = parseDate(row['Trade Date/Time']) // "06/12/24 14:58:14"
    if (!tradeDate) {
      return new Error(`Invalid trade date: ${row['Trade Date/Time']}`)
    }

    // Honour the statement's Buy/Sell column — never assume 'buy', or a Sell
    // (e.g. an iShares Physical Gold disposal) gets booked as a phantom holding.
    const txType: 'buy' | 'sell' = /sell/i.test(row['Transaction Type'] || '') ? 'sell' : 'buy'

    return {
      date: tradeDate,
      type: txType,
      name: securityName,
      isin,
      quantity,
      price,
      priceCurrency: 'GBP',
      total,
      totalCurrency: 'GBP',
      source: 'investengine',
      sourceId: `ie-${tradeDate}-${securityName.substring(0, 3).toLowerCase()}-${txType}-${quantity}`,
      notes: `Settlement: ${row['Settlement Date']}`,
    }
  } catch (e) {
    return new Error(`Failed to map row ${lineNumber}: ${(e as Error).message}`)
  }
}

/**
 * Map Trading 212 row to ImportedTransaction
 * (For CSV parsing; for API data, structure is already consistent)
 */
export function mapTrading212ToTransaction(
  row: Trading212Row,
  lineNumber: number,
): ImportedTransaction | Error {
  try {
    const action = (row.Action || '').toLowerCase().trim()

    // Trading 212 "positions snapshot" CSV format:
    // Ticker,Name,Type,Sector,Shares,Avg Cost,Currency,Owner
    // No action/date columns, so we synthesize a BUY on today's date.
    const snapshotShares = parseFloat((row as unknown as Record<string, string>).Shares || '')
    const snapshotAvgCost = parseFloat((row as unknown as Record<string, string>)['Avg Cost'] || '')
    if (!action && row.Ticker && Number.isFinite(snapshotShares) && Number.isFinite(snapshotAvgCost)) {
      const ticker = normalizeTicker(row.Ticker)
      if (!ticker) return new Error(`Missing ticker in row ${lineNumber}`)
      if (snapshotShares <= 0) return new Error(`Invalid shares in row ${lineNumber}`)
      if (snapshotAvgCost <= 0) return new Error(`Invalid avg cost in row ${lineNumber}`)

      const ccy = row.Currency || 'GBP'
      const owner = (row as unknown as Record<string, string>).Owner
      return {
        date: new Date().toISOString().slice(0, 10),
        type: 'buy',
        ticker,
        name: row.Name || undefined,
        quantity: snapshotShares,
        price: snapshotAvgCost,
        priceCurrency: ccy,
        total: snapshotShares * snapshotAvgCost,
        totalCurrency: ccy,
        source: 'trading212',
        sourceId: `t212-pos-${ticker}-${lineNumber}`,
        notes: owner ? `Owner: ${owner}` : 'Imported from Trading 212 positions snapshot',
      }
    }

    // Determine transaction type
    let type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal'
    if (action.includes('buy')) type = 'buy'
    else if (action.includes('sell')) type = 'sell'
    else if (action.includes('dividend')) type = 'dividend'
    else if (action.includes('deposit')) type = 'deposit'
    else if (action.includes('withdrawal')) type = 'withdrawal'
    else return new Error(`Unknown action: ${action}`)

    const date = parseDate(row.Time) // "2025-05-06 11:54:06"
    if (!date) return new Error(`Invalid date: ${row.Time}`)

    const quantity = parseFloat(row['No. of shares'])
    const price = parseFloat(row['Price / share'])
    const total = parseFloat(row.Total)

    const result: ImportedTransaction = {
      date,
      type,
      ticker: normalizeTicker(row.Ticker) || undefined,
      isin: row.ISIN || undefined,
      name: row.Name || undefined,
      quantity: isNaN(quantity) ? undefined : quantity,
      price: isNaN(price) ? undefined : price,
      priceCurrency: row['Currency (Price / share)'] || 'GBP',
      total: isNaN(total) ? 0 : total,
      totalCurrency: row['Currency (Total)'] || 'GBP',
      source: 'trading212',
      sourceId: row.ID || undefined,
      notes: row.Notes || undefined,
    }

    // Fees
    if (row['Currency conversion fee']) {
      const fee = parseFloat(row['Currency conversion fee'])
      if (!isNaN(fee) && fee > 0) {
        result.fees = fee
        result.feesCurrency = row['Currency (Currency conversion fee)'] || 'GBP'
      }
    }

    // Taxes (withholding tax on dividends)
    if (row['Withholding tax']) {
      const tax = parseFloat(row['Withholding tax'])
      if (!isNaN(tax) && tax > 0) {
        result.taxes = tax
        result.taxesCurrency = row['Currency (Withholding tax)'] || 'GBP'
      }
    }

    // Exchange rate if applicable
    if (row['Exchange rate']) {
      const rate = parseFloat(row['Exchange rate'])
      if (!isNaN(rate) && rate > 0) {
        result.exchangeRate = rate
      }
    }

    return result
  } catch (e) {
    return new Error(`Failed to map row ${lineNumber}: ${(e as Error).message}`)
  }
}

function normalizeTicker(raw: string | undefined): string {
  const t = (raw || '').trim().toUpperCase()
  if (!t) return ''
  // Example from holdings export: NVDA_US_EQ -> NVDA
  const m = t.match(/^([A-Z0-9.\-]+)_[A-Z]{2}_[A-Z]{2}$/)
  if (m?.[1]) return m[1]
  return t
}

/**
 * Utility: parse GBP/USD/currency string "£160.7070" → 160.7070
 */
function parseMoney(str: string): number {
  const cleaned = str.replace(/[^0-9.]/g, '')
  return parseFloat(cleaned)
}

/**
 * Utility: parse date strings
 * InvestEngine: "06/12/24 14:58:14" → 2024-12-06
 * Trading 212: "2025-05-06 11:54:06" → 2025-05-06
 */
function parseDate(dateStr: string): string | null {
  try {
    // Try Trading 212 format first (ISO-like)
    if (dateStr.includes('-')) {
      const [y, m, d] = dateStr.split(' ')[0].split('-')
      if (y && m && d) return `${y}-${m}-${d}`
    }

    // Try InvestEngine format (DD/MM/YY)
    if (dateStr.includes('/')) {
      const parts = dateStr.split(' ')[0].split('/')
      if (parts.length === 3) {
        let [d, m, y] = parts
        // Convert YY to YYYY
        const year = parseInt(y)
        const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year
        return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Validate ImportedTransaction for completeness
 */
export function validateTransaction(tx: ImportedTransaction): string[] {
  const errors: string[] = []

  if (!tx.date) errors.push('Missing date')
  if (!tx.type) errors.push('Missing transaction type')

  switch (tx.type) {
    case 'buy':
    case 'sell':
      if (!tx.ticker && !tx.isin) errors.push('Missing ticker or ISIN')
      if (!tx.quantity || tx.quantity <= 0) errors.push('Invalid quantity')
      if (!tx.price || tx.price <= 0) errors.push('Invalid price')
      break
    case 'dividend':
      if (!tx.ticker && !tx.isin) errors.push('Missing ticker or ISIN')
      if (tx.total === undefined || tx.total < 0) errors.push('Invalid dividend amount')
      break
    case 'deposit':
    case 'withdrawal':
      if (tx.total === undefined || tx.total < 0) errors.push('Invalid amount')
      break
  }

  return errors
}
