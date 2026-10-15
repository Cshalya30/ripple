/**
 * Input checks shared by the forms. Each returns a plain-language problem or a clean value, never both.
 * Money is parsed from text to integer paise without floating point, so ₹0.10 + ₹0.20 never drifts.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): Parsed<never> => ({ ok: false, error })

/** "1,50,000", "₹ 12500.5", "0.99" -> paise. Rejects blanks, negatives, exponents, more than 2 decimals. */
export function parseMoney(text: string, opts: { label?: string; max?: number; min?: number; allowZero?: boolean } = {}): Parsed<number> {
  const label = opts.label ?? 'Amount'
  const cleaned = text.replace(/[₹,\s]/g, '')
  if (!cleaned) return fail(`${label} is required.`)
  if (/^-/.test(cleaned)) return fail(`${label} cannot be negative.`)
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return fail(`${label} must be a number, like 12500 or 12500.50.`)
  const [whole, fraction = ''] = cleaned.split('.')
  if (fraction.length > 2) return fail(`${label} can have at most 2 decimal places.`)
  if (whole.length > 11) return fail(`${label} is too large.`)
  const paise = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'))
  if (paise === 0 && !opts.allowZero) return fail(`${label} must be more than zero.`)
  if (opts.max !== undefined && paise > opts.max) return fail(`${label} is too large.`)
  if (opts.min !== undefined && paise < opts.min) return fail(`${label} is too small.`)
  return { ok: true, value: paise }
}

/** Whole numbers inside a range: days, day of month, safety days. */
export function parseWhole(text: string, min: number, max: number, label: string): Parsed<number> {
  const cleaned = text.trim()
  if (!cleaned) return fail(`${label} is required.`)
  if (!/^\d+$/.test(cleaned)) return fail(`${label} must be a whole number.`)
  const n = Number(cleaned)
  if (n < min || n > max) return fail(`${label} must be between ${min} and ${max}.`)
  return { ok: true, value: n }
}

/** A decimal quantity (up to `decimals` places) in display units. */
export function parseQuantity(text: string, label: string, opts: { decimals?: number; allowZero?: boolean; max?: number } = {}): Parsed<number> {
  const cleaned = text.replace(/,/g, '').trim()
  if (!cleaned) return fail(`${label} is required.`)
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return fail(`${label} must be a number.`)
  const decimals = opts.decimals ?? 3
  const fraction = cleaned.split('.')[1] ?? ''
  if (fraction.length > decimals) return fail(decimals === 0 ? `${label} must be a whole number.` : `${label} can have at most ${decimals} decimal places.`)
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return fail(`${label} must be a number.`)
  if (n === 0 && !opts.allowZero) return fail(`${label} must be more than zero.`)
  if (opts.max !== undefined && n > opts.max) return fail(`${label} is too large.`)
  return { ok: true, value: n }
}

/** Interest rate in percent -> basis points. */
export function parsePercentToBps(text: string, label = 'Rate'): Parsed<number> {
  const cleaned = text.replace(/[%\s]/g, '')
  if (!cleaned) return { ok: true, value: 0 }
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return fail(`${label} must be a number, like 11.5.`)
  const [whole, fraction = ''] = cleaned.split('.')
  if (fraction.length > 2) return fail(`${label} can have at most 2 decimal places.`)
  const bps = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'))
  if (bps > 10_000) return fail(`${label} cannot be above 100%.`)
  return { ok: true, value: bps }
}

// ---------------------------------------------------------------- GSTIN and Udyam

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_SHAPE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/

export const normaliseGstin = (value: string) => value.replace(/[\s-]/g, '').toUpperCase()
export const normaliseUdyam = (value: string) => value.replace(/\s/g, '').toUpperCase()

/** The 15th character of a real GSTIN is a check character over the first 14. */
export function gstinCheckCharacter(first14: string): string {
  let total = 0
  for (let i = 0; i < 14; i += 1) {
    const value = GST_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    total += Math.floor(value / 36) + (value % 36)
  }
  return GST_CHARS[(36 - (total % 36)) % 36]
}

export interface Checked { error: string | null; warning: string | null; value: string | null }

export function checkGstin(raw: string): Checked {
  const value = normaliseGstin(raw)
  if (!value) return { error: null, warning: null, value: null }
  if (value.length !== 15) return { error: `GSTIN has 15 characters; you have typed ${value.length}.`, warning: null, value }
  const match = GSTIN_SHAPE.exec(value)
  if (!match) return { error: 'GSTIN looks like 33AAJFM4721K1Z9: 2-digit state code, 10-character PAN, a number or letter, Z, then a check character.', warning: null, value }
  const state = Number(match[1])
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return { error: `${match[1]} is not a GST state code.`, warning: null, value }
  if (gstinCheckCharacter(value.slice(0, 14)) !== value[14]) {
    return { error: null, warning: 'The last character does not match the others. Check for a typo before relying on this number.', value }
  }
  return { error: null, warning: null, value }
}

export function checkUdyam(raw: string): Checked {
  const value = normaliseUdyam(raw)
  if (!value) return { error: null, warning: null, value: null }
  if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(value)) return { error: 'Udyam number looks like UDYAM-TN-08-0012345: state, district, then 7 digits.', warning: null, value }
  return { error: null, warning: null, value }
}

export function checkEmail(raw: string): string | null {
  const value = raw.trim()
  if (!value) return 'Email is required.'
  if (value.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'Enter a valid email, like name@shop.in.'
  return null
}

export function checkName(raw: string, label: string, max = 120): string | null {
  const value = raw.trim()
  if (!value) return `${label} is required.`
  if (value.length > max) return `${label} can be at most ${max} characters.`
  return null
}
