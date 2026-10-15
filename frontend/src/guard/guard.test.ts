import { describe, expect, it } from 'vitest'
import { niceStep, parseYield } from './logic'

describe('niceStep', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(1)).toBe(1)
    expect(niceStep(1.4)).toBe(2)
    expect(niceStep(3)).toBe(5)
    expect(niceStep(5.1)).toBe(10)
    expect(niceStep(12_000_00)).toBe(2_000_000)
  })
  it('never returns zero for tiny or zero spans', () => {
    expect(niceStep(0)).toBeGreaterThan(0)
    expect(niceStep(0.2)).toBeGreaterThan(0)
  })
})

describe('parseYield', () => {
  it('accepts a percentage with up to two decimals and converts to basis points', () => {
    expect(parseYield('6.5')).toEqual({ ok: true, bp: 650 })
    expect(parseYield(' 7% ')).toEqual({ ok: true, bp: 700 })
    expect(parseYield('0')).toEqual({ ok: true, bp: 0 })
    expect(parseYield('12.25')).toEqual({ ok: true, bp: 1225 })
  })
  it('rejects blanks, text, negatives, too many decimals and anything above 30', () => {
    for (const bad of ['', 'abc', '-1', '6.555', '6,5', '31', '100', '1e3']) expect(parseYield(bad).ok).toBe(false)
  })
})
