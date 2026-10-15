import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../lib/types'
import { changeOf, deltaText, nextStop, phaseAt, prevStop, stopDays, waitOn } from './model'

const event = (over: Partial<EngineEvent>): EngineEvent => ({
  id: 'e', type: 'CASH_RECEIPT', group: 'BRING_IN', label: 'e', detail: '', lane: 'l', party_id: null, party_name: null, order_id: null, record_type: null, record_id: null,
  amount_paise: null, direction: 'IN', quantity: null, material_id: null, materials: null, earliest_date: null, earliest_day: 0, due_date: null, due_day: null,
  executed_date: null, executed_day: null, state: 'EXECUTED', status: '', lateness_days: null, waited_from_day: null, waits: [], depends_on: [], unblocks: [], assumptions: [], x_day: 0, row: 0,
  ...over,
})

const cashWait = (from: number, to: number) => ({ code: 'INSUFFICIENT_CASH', from_day: from, to_day: to, first_details: {}, details: {} })

describe('phaseAt: where an event stands on the chosen day', () => {
  const paid = event({ executed_day: 10 })
  it('is upcoming before, active on, and done after its day', () => {
    expect(phaseAt(paid, 9)).toBe('upcoming')
    expect(phaseAt(paid, 10)).toBe('active')
    expect(phaseAt(paid, 11)).toBe('done')
  })
  it('is waiting on every day of a cash hold, and active on the day the hold ends', () => {
    const held = event({ executed_day: 14, waits: [cashWait(10, 13)] })
    expect(phaseAt(held, 9)).toBe('upcoming')
    expect(phaseAt(held, 10)).toBe('waiting')
    expect(phaseAt(held, 13)).toBe('waiting')
    expect(phaseAt(held, 14)).toBe('active')
    expect(phaseAt(held, 15)).toBe('done')
  })
  it('stays waiting to the end when it never runs', () => {
    const stuck = event({ executed_day: null, state: 'BLOCKED', waits: [cashWait(34, 89)] })
    expect(phaseAt(stuck, 33)).toBe('upcoming')
    expect(phaseAt(stuck, 60)).toBe('waiting')
    expect(waitOn(stuck, 60)?.code).toBe('INSUFFICIENT_CASH')
  })
  it('ignores waits that are only about timing', () => {
    const lagged = event({ executed_day: 20, waits: [{ code: 'DEPENDENCY_PENDING', from_day: 5, to_day: 19, first_details: {}, details: {} }] })
    expect(phaseAt(lagged, 10)).toBe('upcoming')
  })
})

describe('playback stops', () => {
  const events = [event({ id: 'a', executed_day: 2 }), event({ id: 'b', executed_day: 2 }), event({ id: 'c', executed_day: 9, waits: [cashWait(5, 8)] }), event({ id: 'd', executed_day: null })]
  it('lists the first day, the last day, each execution day and each hold start, once', () => {
    expect(stopDays(events, 30, 20)).toEqual([0, 2, 5, 9, 20, 29])
  })
  it('steps forward and back through them', () => {
    const stops = stopDays(events, 30, null)
    expect(nextStop(stops, 0)).toBe(2)
    expect(nextStop(stops, 3)).toBe(5)
    expect(nextStop(stops, 29)).toBeNull()
    expect(prevStop(stops, 9)).toBe(5)
    expect(prevStop(stops, 0)).toBeNull()
  })
  it('ignores events beyond a shortened window', () => {
    expect(stopDays([event({ executed_day: 80 })], 30, null)).toEqual([0, 29])
  })
})

describe('what-if changes', () => {
  const base = new Map([['a', event({ id: 'a', executed_day: 34 })], ['same', event({ id: 'same', executed_day: 5 })], ['out', event({ id: 'out', executed_day: 5 })]])
  it('is null for an event that did not move, and when there is no baseline', () => {
    expect(changeOf(event({ id: 'same', executed_day: 5 }), base, 90)).toBeNull()
    expect(changeOf(event({ id: 'a', executed_day: 5 }), null, 90)).toBeNull()
  })
  it('reports how many days an event moved, in either direction', () => {
    expect(changeOf(event({ id: 'a', executed_day: 41 }), base, 90)).toEqual({ kind: 'moved', deltaDays: 7 })
    expect(changeOf(event({ id: 'a', executed_day: 30 }), base, 90)).toEqual({ kind: 'moved', deltaDays: -4 })
  })
  it('flags new events, and events pushed out of the window', () => {
    expect(changeOf(event({ id: 'fresh', executed_day: 3 }), base, 90)).toEqual({ kind: 'new', deltaDays: null })
    expect(changeOf(event({ id: 'out', executed_day: null }), base, 90)).toEqual({ kind: 'moved', deltaDays: 85 })
  })
  it('writes the chip text', () => {
    expect(deltaText(7)).toBe('+7d')
    expect(deltaText(-3)).toBe('−3d')
    expect(deltaText(0)).toBe('same day')
    expect(deltaText(null)).toBe('new')
  })
})
