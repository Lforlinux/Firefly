export interface LiabilityItem {
  id: string
  name: string
  category: 'mortgage' | 'credit-card' | 'student-loan' | 'personal-loan' | 'car-loan' | 'custom'
  lender: string
  outstandingBalance: number
  currency: string
  notes: string
}

const KEY = 'firefly.liabilities'

export function loadLiabilities(): LiabilityItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((row) => ({
      id: String(row.id || crypto.randomUUID?.() || Date.now()),
      name: String(row.name || ''),
      category: (row.category || 'custom') as LiabilityItem['category'],
      lender: String(row.lender || ''),
      outstandingBalance: Number(row.outstandingBalance || 0),
      currency: String(row.currency || 'GBP'),
      notes: String(row.notes || ''),
    }))
  } catch {
    return []
  }
}

export function saveLiabilities(items: LiabilityItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // ignore quota failures
  }
}

export function totalLiabilitiesBase(items: LiabilityItem[], baseCurrency: string): number {
  return items
    .filter((l) => (l.currency || '').toUpperCase() === baseCurrency.toUpperCase())
    .reduce((sum, l) => sum + (Number.isFinite(l.outstandingBalance) ? l.outstandingBalance : 0), 0)
}
