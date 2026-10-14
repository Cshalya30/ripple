import type { Party } from '../types'
import { mockParties } from '../data/parties'
import { sampleRows } from '../data/uploadSample'
import { isoFromOffset } from '../lib/dates'
import { api, apiText, warnFallback } from './api'

/**
 * Party service backed by the FastAPI khata (`/api/parties`).
 * If the backend can't be reached, it falls back to the original in-browser
 * sample data so the UI keeps working offline.
 */
const tick = <T,>(value: T, ms = 120): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

let counter = 0
const newId = (kind: Party['kind']) => `${kind.slice(0, 3)}-new-${Date.now().toString(36)}-${counter++}`

export type NewParty = Omit<Party, 'id' | 'owedAmount'>

// ── remember the file the user picked in the upload dialog ───────────────
// The upload dialog hands us no file, so we note the last spreadsheet the
// user selected or dropped on the page and send that to the backend.
let pickedFile: { file: File; at: number } | null = null
const SHEET = /\.(xlsx|xlsm|csv)$/i

if (typeof document !== 'undefined') {
  document.addEventListener(
    'change',
    (e) => {
      const input = e.target
      if (input instanceof HTMLInputElement && input.type === 'file') {
        const file = input.files?.[0]
        if (file && SHEET.test(file.name)) pickedFile = { file, at: Date.now() }
      }
    },
    true,
  )
  document.addEventListener(
    'drop',
    (e) => {
      const file = e.dataTransfer?.files?.[0]
      if (file && SHEET.test(file.name)) pickedFile = { file, at: Date.now() }
    },
    true,
  )
}

function takePickedFile(): File | null {
  const picked = pickedFile
  pickedFile = null
  return picked && Date.now() - picked.at < 15 * 60_000 ? picked.file : null
}

// ── API ──────────────────────────────────────────────────────────────────

export async function listParties(): Promise<Party[]> {
  try {
    return await api<Party[]>('/api/parties')
  } catch (err) {
    warnFallback('listParties', err)
    return tick(mockParties.map((p) => ({ ...p })))
  }
}

export async function createParty(input: NewParty): Promise<Party> {
  try {
    return await api<Party>('/api/parties', { method: 'POST', body: JSON.stringify(input) })
  } catch (err) {
    warnFallback('createParty', err)
    const party: Party = { ...input, id: newId(input.kind), owedAmount: Math.max(0, input.totalAmount - input.paidAmount) }
    return tick(party, 80)
  }
}

export async function deleteParty(partyId: string): Promise<void> {
  try {
    await api<void>(`/api/parties/${encodeURIComponent(partyId)}`, { method: 'DELETE' })
  } catch (err) {
    warnFallback('deleteParty', err)
  }
}

function sampleAsParties(): Party[] {
  return sampleRows.map((r): Party => {
    const kind: Party['kind'] = r.type === 'Customer' ? 'customer' : 'supplier'
    return {
      id: newId(kind),
      kind,
      name: r.party,
      phone: r.phone,
      details: `${kind === 'customer' ? 'Retail shop' : 'Supplier'}, ${r.place}`,
      products: [r.item],
      quantity: r.qty,
      totalAmount: r.bill,
      paidAmount: r.settled,
      owedAmount: Math.max(0, r.bill - r.settled),
      transactionDate: isoFromOffset(-r.billedDaysAgo),
      dueDate: isoFromOffset(r.dueIn),
    }
  })
}

interface ImportResult {
  added: Party[]
  skipped: { row: number; reason: string }[]
}

/**
 * Imports the spreadsheet the user picked. The backend parses it and saves every
 * valid row. If no file can be read (or the backend rejects it), the sample rows
 * shown in the preview are imported instead.
 */
export async function importSampleFile(): Promise<Party[]> {
  const file = takePickedFile()
  if (file) {
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api<ImportResult>('/api/parties/upload', { method: 'POST', body: form }, 30_000)
      if (res.skipped.length) console.warn(`[ripple] Skipped ${res.skipped.length} row(s) from ${file.name}:`, res.skipped)
      return res.added
    } catch (err) {
      console.warn(`[ripple] Couldn't import ${file.name}; importing the preview rows instead.`, err)
    }
  }
  const rows = sampleAsParties()
  try {
    const payload = rows.map(({ id: _id, owedAmount: _owed, ...rest }) => rest)
    const res = await api<ImportResult>('/api/parties/import', { method: 'POST', body: JSON.stringify({ parties: payload }) }, 30_000)
    return res.added
  } catch (err) {
    warnFallback('importSampleFile', err)
    return tick(rows, 400)
  }
}

// ── export ───────────────────────────────────────────────────────────────

const EXPORT_HEADERS = ['Party name', 'Type', 'Phone', 'Details', 'Item', 'Qty', 'Bill amount', 'Received / Paid', 'Still owed', 'Bill date', 'Due date']

function csvCell(value: string | number): string {
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}` // no spreadsheet formulas
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Build the CSV in the browser (used only when the backend can't be reached). */
function partiesToCsv(parties: Party[]): string {
  const rows = parties.map((p) =>
    [
      p.name,
      p.kind === 'customer' ? 'Customer' : 'Supplier',
      p.phone.replace(/^\+91\s*/, ''),
      p.details,
      p.products.join(', '),
      p.quantity,
      p.totalAmount,
      p.paidAmount,
      p.owedAmount,
      p.transactionDate,
      p.dueDate,
    ]
      .map(csvCell)
      .join(','),
  )
  return '\ufeff' + [EXPORT_HEADERS.join(','), ...rows].join('\r\n') + '\r\n'
}

/**
 * Everything in the khata as CSV, in the same columns the upload accepts,
 * so the file can be edited in Excel and uploaded again.
 */
export async function exportPartiesCsv(current: Party[]): Promise<string> {
  try {
    const csv = await apiText('/api/parties/export.csv')
    // fetch() strips the byte-order mark; put it back so Excel reads ₹ and names correctly.
    return csv.startsWith('\ufeff') ? csv : '\ufeff' + csv
  } catch (err) {
    warnFallback('exportPartiesCsv', err)
    return partiesToCsv(current)
  }
}
