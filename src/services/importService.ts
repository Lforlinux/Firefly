/**
 * Import service: handles data fetching from multiple sources
 */

import { ImportedTransaction, ImportPreview, ImportError } from '@/types/import'
import {
  parseInvestEngineCSV,
  parseTrading212CSV,
  mapTrading212ToTransaction,
  validateTransaction,
} from '@/utils/importMappers'
import { jsonFetch } from './api'

/**
 * Load and preview InvestEngine CSV file
 */
export async function previewInvestEngineCSV(file: File): Promise<ImportPreview> {
  try {
    const text = await file.text()
    // Robust auto-detect: run both parsers and pick the one yielding usable rows.
    const t212 = parseTrading212CSV(text)
    const ie = parseInvestEngineCSV(text)
    const hasTrading212Markers = /no\.?\s*of\s*shares/i.test(text) || /\baction\b/i.test(text)

    const parsed =
      (t212.transactions.length > 0 && t212.transactions.length >= ie.transactions.length) ||
      (hasTrading212Markers && t212.transactions.length > 0)
        ? t212
        : ie
    const source = parsed === t212 ? 'trading212' : 'investengine'
    const { transactions, errors } = parsed

    // Validate each transaction
    const validRecords = transactions.filter((tx) => validateTransaction(tx).length === 0).length

    return {
      source,
      totalRecords: transactions.length + errors.length,
      validRecords,
      errorRecords: errors,
      transactions,
    }
  } catch (e) {
    return {
      source: 'investengine',
      totalRecords: 0,
      validRecords: 0,
      errorRecords: [{ rowIndex: 0, message: (e as Error).message }],
      transactions: [],
    }
  }
}

/**
 * Fetch Trading 212 data via MCP connector, then normalize via backend
 * 1. Calls window.cowork.callMcpTool to fetch live positions
 * 2. POSTs to /api/import/trading212 for normalization
 */
export async function fetchTrading212Data(options?: {
  owner?: string
}): Promise<ImportPreview> {
  try {
    // Check if we have access to the MCP tool
    if (typeof window === 'undefined' || !window.cowork?.callMcpTool) {
      throw new Error('MCP tools not available. This must run in a Cowork/Claude session.')
    }

    // Fetch live positions from Trading 212 MCP
    const positions = await window.cowork.callMcpTool('mcp__t212-mcp__fetch-open-positions', {})

    if (!Array.isArray(positions)) {
      throw new Error('Invalid response from Trading 212 MCP')
    }

    // Send to backend for normalization and validation
    const response = await jsonFetch('/api/import/trading212', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positions,
        owner: options?.owner || 'Default',
      }),
    })

    // Backend returns normalized transactions
    const { transactions, errorRecords } = response as {
      transactions: ImportedTransaction[]
      errorRecords: ImportError[]
    }

    const validRecords = transactions.filter((tx) => validateTransaction(tx).length === 0).length

    return {
      source: 'trading212',
      totalRecords: positions.length,
      validRecords,
      errorRecords,
      transactions,
    }
  } catch (e) {
    return {
      source: 'trading212',
      totalRecords: 0,
      validRecords: 0,
      errorRecords: [{ rowIndex: 0, message: (e as Error).message }],
      transactions: [],
    }
  }
}

/**
 * Import transactions into portfolio
 * POST /api/import/commit
 */
export async function commitImport(
  source: 'investengine' | 'trading212',
  transactions: ImportedTransaction[],
): Promise<{ imported: number; failed: number; errors: string[] }> {
  try {
    return await jsonFetch('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, transactions }),
    })
  } catch (e) {
    throw new Error(`Failed to import transactions: ${(e as Error).message}`)
  }
}
