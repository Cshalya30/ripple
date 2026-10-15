import { describe, expect, it } from 'vitest'
import { checkEmail, checkGstin, checkUdyam, gstinCheckCharacter, parseMoney, parsePercentToBps, parseQuantity, parseWhole } from './validate'

describe('parseMoney', () => {
  it('reads Indian grouping and rupee signs into exact paise', () => {
    expect(parseMoney('1,50,000')).toEqual({ ok: true, value: 15_000_000 })
    expect(parseMoney('₹ 12500.5')).toEqual({ ok: true, value: 1_250_050 })
    expect(parseMoney('0.99')).toEqual({ ok: true, value: 99 })
    expect(parseMoney('.5')).toEqual({ ok: true, value: 50 })
  })
  it('never drifts on classic float traps', () => {
    expect(parseMoney('1.15')).toEqual({ ok: true, value: 115 })
    expect(parseMoney('4.35')).toEqual({ ok: true, value: 435 })
  })
  it('rejects blanks, negatives, exponents, junk and a third decimal', () => {
    for (const bad of ['', '  ', '-5', '1e5', 'abc', '12.345', '.', '1.2.3', '12,5,0x']) expect(parseMoney(bad).ok).toBe(false)
  })
  it('treats zero as an error unless allowed', () => {
    expect(parseMoney('0').ok).toBe(false)
    expect(parseMoney('0', { allowZero: true })).toEqual({ ok: true, value: 0 })
  })
  it('applies a maximum in paise', () => {
    expect(parseMoney('11', { max: 1000 }).ok).toBe(false)
    expect(parseMoney('10', { max: 1000 }).ok).toBe(true)
  })
})

describe('parseWhole / parseQuantity / parsePercentToBps', () => {
  it('keeps whole numbers in range', () => {
    expect(parseWhole('31', 1, 31, 'Day')).toEqual({ ok: true, value: 31 })
    for (const bad of ['0', '32', '1.5', '-1', 'x', '']) expect(parseWhole(bad, 1, 31, 'Day').ok).toBe(false)
  })
  it('limits decimals on quantities', () => {
    expect(parseQuantity('2.5', 'Qty')).toEqual({ ok: true, value: 2.5 })
    expect(parseQuantity('2.5', 'Qty', { decimals: 0 }).ok).toBe(false)
    expect(parseQuantity('0', 'Qty').ok).toBe(false)
    expect(parseQuantity('0', 'Qty', { allowZero: true }).ok).toBe(true)
    expect(parseQuantity('1.2345', 'Qty').ok).toBe(false)
  })
  it('turns percent into basis points and caps at 100', () => {
    expect(parsePercentToBps('11.5')).toEqual({ ok: true, value: 1150 })
    expect(parsePercentToBps('')).toEqual({ ok: true, value: 0 })
    expect(parsePercentToBps('100.01').ok).toBe(false)
    expect(parsePercentToBps('abc').ok).toBe(false)
  })
})

describe('GSTIN and Udyam', () => {
  it('accepts a real-shaped GSTIN with a matching check character', () => {
    expect(gstinCheckCharacter('33AAJFM4721K1Z')).toBe('9')
    expect(checkGstin('33aajfm4721k1z9')).toEqual({ error: null, warning: null, value: '33AAJFM4721K1Z9' })
    expect(checkGstin('27AAPFU0939F1ZV').warning).toBeNull()
  })
  it('warns, not blocks, on a check-character typo', () => {
    const r = checkGstin('33AAJFM4721K1Z8')
    expect(r.error).toBeNull()
    expect(r.warning).toMatch(/last character/)
  })
  it('blocks wrong length, shape and state code', () => {
    expect(checkGstin('12345').error).toMatch(/15 characters/)
    expect(checkGstin('33AAJFM4721K1X9').error).toMatch(/looks like/)
    expect(checkGstin('00AAJFM4721K1Z9').error).toMatch(/state code/)
    expect(checkGstin('').error).toBeNull()
  })
  it('checks Udyam', () => {
    expect(checkUdyam('udyam-tn-08-0012345').value).toBe('UDYAM-TN-08-0012345')
    expect(checkUdyam('UDYAM-TN-8-12').error).toMatch(/looks like/)
    expect(checkUdyam('').value).toBeNull()
  })
  it('checks email', () => {
    expect(checkEmail('a@b.co')).toBeNull()
    expect(checkEmail('a@b')).not.toBeNull()
    expect(checkEmail('')).not.toBeNull()
  })
})
