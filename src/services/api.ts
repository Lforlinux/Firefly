/**
 * Thin fetch wrappers for the Firefly API. The hooks live in AppContext;
 * this file is just the typed network layer.
 *
 * All requests include credentials: 'include' to send HTTP-only JWT cookies
 * with every request for user authentication.
 */
import type { Portfolio, PriceCache, Holding, Transaction, Snapshot, Settings } from '@/types'

export async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: 'include', // Send HTTP-only JWT cookie
  })
  const text = await res.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).error)
      : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as T
}

// Legacy endpoints (may still be used elsewhere)
export function getPortfolio(): Promise<Portfolio> {
  return jsonFetch<Portfolio>('/api/portfolio')
}

export function savePortfolio(next: Pick<Portfolio, 'holdings' | 'snapshots' | 'transactions' | 'settings'>): Promise<{ ok: true; settings: Portfolio['settings'] }> {
  return jsonFetch('/api/portfolio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
}

// Phase 7 API endpoints (user-scoped)
export function fetchHoldings(): Promise<{ holdings: Holding[] }> {
  return jsonFetch<{ holdings: Holding[] }>('/api/portfolio/holdings')
}

export function createHolding(holding: Omit<Holding, 'id'>): Promise<{ holding: Holding }> {
  return jsonFetch('/api/portfolio/holdings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(holding),
  })
}

export function updateHolding(id: string, updates: Partial<Omit<Holding, 'id'>>): Promise<{ holding: Holding }> {
  return jsonFetch('/api/portfolio/holdings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  })
}

export function deleteHolding(id: string): Promise<{ ok: true }> {
  return jsonFetch('/api/portfolio/holdings', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export function fetchTransactions(): Promise<{ transactions: Transaction[] }> {
  return jsonFetch<{ transactions: Transaction[] }>('/api/portfolio/transactions')
}

export function createTransaction(transaction: Omit<Transaction, 'id'>): Promise<{ transaction: Transaction }> {
  return jsonFetch('/api/portfolio/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transaction),
  })
}

export function updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<{ transaction: Transaction }> {
  return jsonFetch('/api/portfolio/transactions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  })
}

export function deleteTransaction(id: string): Promise<{ ok: true }> {
  return jsonFetch('/api/portfolio/transactions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export function fetchSnapshots(): Promise<{ snapshots: Snapshot[] }> {
  return jsonFetch<{ snapshots: Snapshot[] }>('/api/portfolio/snapshots')
}

export function createSnapshot(snapshot: Omit<Snapshot, 'id'>): Promise<{ snapshot: Snapshot }> {
  return jsonFetch('/api/portfolio/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
}

export function updateSnapshot(id: string, updates: Partial<Omit<Snapshot, 'id'>>): Promise<{ snapshot: Snapshot }> {
  return jsonFetch('/api/portfolio/snapshots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  })
}

export function deleteSnapshot(id: string): Promise<{ ok: true }> {
  return jsonFetch('/api/portfolio/snapshots', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export function fetchSettings(): Promise<{ settings: Settings }> {
  return jsonFetch<{ settings: Settings }>('/api/portfolio/settings')
}

export function updateSettings(updates: Partial<Settings>): Promise<{ settings: Settings }> {
  return jsonFetch('/api/portfolio/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export interface RefreshResult {
  ok: true
  lastRefresh: string
  tickersRefreshed: number
  fxPairs: number
  errors: { ticker?: string; pair?: string; error: string }[]
  cache: PriceCache
}

export function refreshPrices(): Promise<RefreshResult> {
  return jsonFetch<RefreshResult>('/api/refresh-prices', { method: 'POST' })
}

export function postSnapshot(date: string, valueGBP: number): Promise<{ ok: true; count: number }> {
  return jsonFetch('/api/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, valueGBP }),
  })
}

export function postDailyMovement(
  date: string,
  owner: string,
  movementGBP: number,
  portfolioValueGBP: number | null,
): Promise<{ ok: true }> {
  return jsonFetch('/api/portfolio/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'movement', date, owner, movementGBP, portfolioValueGBP }),
  })
}

export function flushHoldings(sources: ('all' | 'trading212' | 'investengine')[]): Promise<{ ok: true; deleted: { holdings: number } }> {
  return jsonFetch('/api/portfolio', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources }),
  })
}

export function syncTrading212(): Promise<{ ok: true; synced: number; pricesUpdated: number; errors: string[] }> {
  return jsonFetch('/api/import/t212-sync', { method: 'POST' })
}

export type KiteHoldingPayload = {
  tradingsymbol: string
  quantity: number
  average_price: number
  last_price?: number
  exchange?: string
}

export function syncKite(positions: KiteHoldingPayload[], owner = 'KLN'): Promise<{ ok: true; synced: number; pricesUpdated: number; errors: string[] }> {
  return jsonFetch('/api/import/kite-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions, owner }),
  })
}
