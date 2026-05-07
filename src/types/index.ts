/**
 * Firefly schema types — the single source of truth for the frontend.
 * Mirrors data.json + data.cache.json (server merges them in /api/portfolio).
 */

export type CurrencyCode = string // 'GBP' | 'INR' | 'USD' | 'EUR' | ...

export type HoldingType = 'stock' | 'etf' | 'cash' | 'commodity' | 'crypto' | 'bond'

export interface Holding {
  id: string
  ticker: string
  name: string
  type: HoldingType
  sector: string
  shares: number
  avgCost: number
  currency: CurrencyCode
  notes: string
}

export interface Snapshot {
  date: string // YYYY-MM-DD
  valueGBP: number
}

export interface Transaction {
  id: string
  date: string // YYYY-MM-DD
  ticker: string
  side: 'buy' | 'sell' | 'dividend' | 'split' | 'fee'
  shares: number
  price: number
  currency: CurrencyCode
  notes: string
}

export interface PriceQuote {
  price: number
  currency: CurrencyCode
  asOf: string // ISO timestamp
  prevClose?: number
  prevCloseAsOf?: string
}

export interface FxRate {
  rate: number
  asOf: string // ISO timestamp
}

export interface Settings {
  baseCurrency: CurrencyCode
  lastUpdated: string
}

/** Server-managed cache (data.cache.json). Wipeable. */
export interface PriceCache {
  prices: Record<string, PriceQuote>          // keyed by ticker
  fxRates: Record<string, FxRate>             // keyed by `${FROM}_${TO}`
  lastRefresh: string
}

export interface IsaSummary {
  fy: { start: string; end: string; label: string }
  byOwner: Record<string, Record<string, number>>
}

/** Shape returned by GET /api/portfolio — data.json + data.cache.json merged. */
export interface Portfolio extends PriceCache {
  holdings: Holding[]
  snapshots: Snapshot[]
  transactions: Transaction[]
  settings: Settings
  isa?: IsaSummary
}

/** UI-derived: a holding plus its computed price/value/G&L in base currency. */
export interface HoldingRow extends Holding {
  /** Owner extracted from notes ("Owner: KLN" → "KLN"). undefined if not tagged. */
  owner?: string
  /** Last fetched price in the *security's listing currency*. null if no refresh yet. */
  livePrice: number | null
  livePriceCcy: CurrencyCode | null
  livePriceAt: string | null
  /** Value in base currency: shares × livePrice × fx[livePriceCcy → base], or cost basis fallback. */
  valueBase: number
  /** True if `valueBase` was computed from cost basis because no live price was available. */
  valueIsCost: boolean
  /** Cost basis in base currency: shares × avgCost × fx[holding.currency → base]. */
  costBase: number
  /** valueBase − costBase. */
  gainLoss: number
  /** % gain or loss vs cost basis. 0 when costBase is 0 (cash). */
  gainLossPct: number
  /** valueBase as a fraction of total portfolio value (0..1). Filled by the consumer. */
  weight: number
}

export type OwnerFilter = 'all' | string
