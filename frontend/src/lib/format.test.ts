import { describe, expect, it } from 'vitest'
import { addDays, compact, daysBetween, MINUS, percent, rupees, setNumberFormat, shortDate } from './format'

describe('rupees (the only money formatter)', () => {
  it('divides paise by 100 exactly once and uses Indian grouping', () => {
    expect(rupees(14_500_000)).toBe('₹1,45,000')
    expect(rupees(23_000_000)).toBe('₹2,30,000')
    expect(rupees(1_000_000_000)).toBe('₹1,00,00,000')
    expect(rupees(99_900)).toBe('₹999')
  })
  it('uses the true minus sign and an explicit plus when asked', () => {
    expect(rupees(-13_955_000)).toBe(`${MINUS}₹1,39,550`)
    expect(rupees(5_000_000, { sign: true })).toBe('+₹50,000')
    expect(rupees(0, { sign: true })).toBe('₹0')
  })
  it('shows paise only when present', () => {
    expect(rupees(431_357)).toBe('₹4,313.57')
    expect(rupees(431_300)).toBe('₹4,313')
  })
  it('switches to international grouping', () => {
    setNumberFormat('international')
    expect(rupees(14_500_000)).toBe('₹145,000')
    setNumberFormat('indian')
  })
  it('renders missing values as a dot, never as zero', () => {
    expect(rupees(null)).toBe('·')
    expect(rupees(undefined)).toBe('·')
  })
})

describe('axis and percent helpers', () => {
  it('abbreviates only for axes', () => {
    expect(compact(13_000_000)).toBe('₹1.3L')
    expect(compact(5_000_000)).toBe('₹50k')
    expect(compact(-26_000_000)).toBe(`${MINUS}₹2.6L`)
  })
  it('rounds shares to whole percent', () => {
    expect(percent(0.7677)).toBe('77%')
    expect(percent(null)).toBe('·')
  })
})

describe('dates', () => {
  it('adds and counts days in UTC without drift', () => {
    expect(addDays('2026-10-14', 34)).toBe('2026-11-17')
    expect(daysBetween('2026-10-14', '2026-11-24')).toBe(41)
    expect(shortDate('2026-11-17')).toBe('17 Nov')
  })
})
