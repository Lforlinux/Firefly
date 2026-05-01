/**
 * Multi-source portfolio import types
 * Supports InvestEngine CSV and Trading 212 API/CSV formats
 */

// Raw import record — varies by source format
export interface RawImportRecord {
  source: 'investengine' | 'trading212'
  data: Record<string, unknown>
}

// Normalized transaction ready for import
export interface ImportedTransaction {
  date: string // ISO 8601 (YYYY-MM-DD)
  type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal'
  ticker?: string
  isin?: string
  name?: string
  quantity?: number
  price?: number
  priceCurrency?: string
  total: number
  totalCurrency: string
  fees?: number
  feesCurrency?: string
  taxes?: number
  taxesCurrency?: string
  exchangeRate?: number // if transaction in foreign currency
  notes?: string
  source: 'investengine' | 'trading212'
  sourceId?: string // unique identifier from source
}

// Import preview result
export interface ImportPreview {
  source: 'investengine' | 'trading212'
  totalRecords: number
  validRecords: number
  errorRecords: ImportError[]
  transactions: ImportedTransaction[]
}

// Import error detail
export interface ImportError {
  rowIndex: number
  field?: string
  value?: unknown
  message: string
}

// InvestEngine CSV structure
export interface InvestEngineRow {
  'Security / ISIN': string
  'Transaction Type': string
  Quantity: string
  'Share Price': string
  'Total Trade Value': string
  'Trade Date/Time': string
  'Settlement Date': string
  Broker: string
}

// Trading 212 CSV structure (subset of relevant fields)
export interface Trading212Row {
  Action: string
  Time: string
  ISIN: string
  Ticker: string
  Name: string
  Notes: string
  ID: string
  'No. of shares': string
  'Price / share': string
  'Currency (Price / share)': string
  'Exchange rate': string
  Result: string
  Currency: string // Result/Total currency
  Total: string
  'Currency (Total)': string
  'Withholding tax': string
  'Currency (Withholding tax)': string
  'Currency conversion fee': string
  'Currency (Currency conversion fee)': string
}

// Import context — what user selected
export interface ImportContext {
  source: 'investengine' | 'trading212'
  file?: File // for CSV uploads
  dateRange?: {
    start?: string
    end?: string
  }
}
