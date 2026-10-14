import type { Party } from '../types'
import { mockParties } from '../data/parties'
import { sampleRows } from '../data/uploadSample'
import { isoFromOffset } from '../lib/dates'

/**
 * Thin service layer. Today it returns mock data; swap the bodies for fetch() calls
 * to the FastAPI backend later and no component needs to change.
 */
const tick = <T,>(value: T, ms = 120): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

let counter = 0
const newId = (kind: Party['kind']) => `${kind.slice(0, 3)}-new-${Date.now().toString(36)}-${counter++}`

export type NewParty = Omit<Party, 'id' | 'owedAmount'>

export async function listParties(): Promise<Party[]> {
  return tick(mockParties.map((p) => ({ ...p })))
}

export async function createParty(input: NewParty): Promise<Party> {
  const party: Party = { ...input, id: newId(input.kind), owedAmount: Math.max(0, input.totalAmount - input.paidAmount) }
  return tick(party, 80)
}

/** Mock import: always produces the 24 sample rows from the preview. */
export async function importSampleFile(): Promise<Party[]> {
  const parties = sampleRows.map((r): Party => {
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
  return tick(parties, 400)
}
