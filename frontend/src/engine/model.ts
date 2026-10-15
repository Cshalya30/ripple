import { rupees } from '../lib/format'
import type { EngineEvent, StockSeries } from '../lib/types'
import type { Tone } from '../components/ui'

export const PX_PER_DAY = 32
export const LANE_ROW = 76
export const NODE_W = 152
export const NODE_H = 52

export const REASON_TEXT: Record<string, string> = {
  INSUFFICIENT_CASH: 'not enough cash',
  INSUFFICIENT_INVENTORY: 'not enough material',
  DEPENDENCY_PENDING: 'waiting for an earlier step',
  LAG_NOT_ELAPSED: 'waiting for the agreed gap',
  NOT_YET_ELIGIBLE: 'not yet due',
  UNSUPPORTED_MULTIPLE_DRAWDOWNS: 'facility already drawn',
}

export function stateTone(e: EngineEvent): Tone {
  if (e.state === 'BLOCKED') return 'out'
  if (e.state === 'WAITING' || e.state === 'LATER') return 'wait'
  if (e.lateness_days && e.lateness_days > 0) return 'attn'
  return 'in'
}

/** Footer line: the state, written out. */
export function stateText(e: EngineEvent, byId: Map<string, EngineEvent>): string {
  if (e.state === 'EXECUTED') {
    return e.lateness_days ? `Executed D${e.executed_day}, ${e.lateness_days}d late` : `Executed D${e.executed_day}`
  }
  if (e.state === 'BLOCKED') {
    const last = e.waits.filter((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY').at(-1)
    return last ? `Blocked: ${REASON_TEXT[last.code]}` : 'Blocked'
  }
  if (e.state === 'WAITING') {
    const pending = e.depends_on.map((d) => byId.get(d.event_id)).find((p) => p && p.state !== 'EXECUTED')
    return pending ? `Waiting: needs ${pending.label}` : 'Waiting'
  }
  return 'After the forecast window'
}

export function amountText(e: EngineEvent, stock: StockSeries[]): string {
  if (e.amount_paise) return rupees(e.direction === 'OUT' ? -e.amount_paise : e.amount_paise, { sign: e.direction === 'IN' })
  if (e.quantity && e.material_id) {
    const m = stock.find((s) => s.material_id === e.material_id)
    const value = m ? e.quantity / (m.unit_factor || 1) : e.quantity
    return `+${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${m?.unit ?? ''}`
  }
  return e.detail
}

/** The chain of predecessors that explains when an event happened (transitive depends_on). */
export function upstreamChain(id: string, byId: Map<string, EngineEvent>): Set<string> {
  const chain = new Set<string>([id])
  const walk = (current: string) => {
    for (const dep of byId.get(current)?.depends_on ?? []) {
      if (!chain.has(dep.event_id)) {
        chain.add(dep.event_id)
        walk(dep.event_id)
      }
    }
  }
  walk(id)
  return chain
}

export function downstreamChain(id: string, byId: Map<string, EngineEvent>): EngineEvent[] {
  const out: EngineEvent[] = []
  const seen = new Set<string>()
  const walk = (current: string) => {
    for (const next of byId.get(current)?.unblocks ?? []) {
      if (seen.has(next.event_id)) continue
      seen.add(next.event_id)
      const e = byId.get(next.event_id)
      if (e) {
        out.push(e)
        walk(e.id)
      }
    }
  }
  walk(id)
  return out
}

/**
 * Production starts in other orders that waited for the same material that this
 * event's chain delivers: the shared stock pool connecting unrelated orders.
 */
export function alsoDelays(id: string, events: EngineEvent[], byId: Map<string, EngineEvent>): EngineEvent[] {
  const downstream = downstreamChain(id, byId)
  const materials = new Set(downstream.filter((e) => e.type === 'INVENTORY_ARRIVAL' && e.material_id).map((e) => e.material_id!))
  const own = new Set(downstream.map((e) => e.id))
  const self = byId.get(id)
  // Only waits that overlap this event's own delay can be caused by it.
  const from = self?.waited_from_day ?? self?.due_day ?? 0
  return events.filter((e) => e.type === 'PRODUCTION_START' && !own.has(e.id)
    && e.waits.some((w) => w.code === 'INSUFFICIENT_INVENTORY' && materials.has(w.first_details.material_id) && w.to_day >= from))
}

export function issueDays(events: EngineEvent[], breachDay: number | null): number[] {
  const days = new Set<number>()
  for (const e of events) {
    for (const w of e.waits) {
      if (w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY') days.add(w.from_day)
    }
  }
  if (breachDay !== null) days.add(breachDay)
  return [...days].sort((a, b) => a - b)
}


// ---------------------------------------------------------------- playback: what is happening on a given day

/** Where an event stands on a chosen day: already happened, happening now, held up right now, or still to come. */
export type Phase = 'done' | 'active' | 'waiting' | 'upcoming'

const RESOURCE = ['INSUFFICIENT_CASH', 'INSUFFICIENT_INVENTORY'] as const

/** The cash or material hold that covers this day, if any. */
export function waitOn(e: EngineEvent, day: number) {
  return e.waits.find((w) => (RESOURCE as readonly string[]).includes(w.code) && w.from_day <= day && day <= w.to_day)
}

export function phaseAt(e: EngineEvent, day: number): Phase {
  if (e.executed_day !== null) {
    if (e.executed_day < day) return 'done'
    if (e.executed_day === day) return 'active'
  }
  return waitOn(e, day) ? 'waiting' : 'upcoming'
}

/** Days worth stopping on while playing: something runs, something gets held up, or the first shortfall. Always includes the first and last day. */
export function stopDays(events: EngineEvent[], horizon: number, firstShortfallDay: number | null): number[] {
  const days = new Set<number>([0, Math.max(0, horizon - 1)])
  for (const e of events) {
    if (e.executed_day !== null && e.executed_day < horizon) days.add(e.executed_day)
    for (const w of e.waits) if ((RESOURCE as readonly string[]).includes(w.code) && w.from_day < horizon) days.add(w.from_day)
  }
  if (firstShortfallDay !== null) days.add(firstShortfallDay)
  return [...days].sort((a, b) => a - b)
}

export const nextStop = (stops: number[], day: number): number | null => stops.find((d) => d > day) ?? null
export const prevStop = (stops: number[], day: number): number | null => [...stops].reverse().find((d) => d < day) ?? null

/** How an event differs between the baseline run and a what-if run. */
export interface Change { kind: 'moved' | 'new'; deltaDays: number | null }

export function changeOf(e: EngineEvent, baseline: Map<string, EngineEvent> | null, horizon: number): Change | null {
  if (!baseline) return null
  const b = baseline.get(e.id)
  if (!b) return { kind: 'new', deltaDays: null }
  if (b.executed_day === e.executed_day) return null
  if (b.executed_day === null || e.executed_day === null) return { kind: 'moved', deltaDays: (e.executed_day ?? horizon) - (b.executed_day ?? horizon) }
  return { kind: 'moved', deltaDays: e.executed_day - b.executed_day }
}

export function deltaText(days: number | null): string {
  if (days === null) return 'new'
  if (days === 0) return 'same day'
  return `${days > 0 ? '+' : '−'}${Math.abs(days)}d`
}
