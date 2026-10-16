import { describe, expect, it } from 'vitest'
import { ApiError, errorText } from './api'

// Every error code the mounted backend can return for a screen action must read as a sentence, never as `Could not complete that (CODE).`
const REACHABLE = [
  'AMOUNT_AND_DATE_REQUIRED', 'DAY_OUT_OF_RANGE', 'DRAFT_NOT_READY', 'DUE_BEFORE_INVOICE', 'EXPLICIT_APPROVAL_REQUIRED', 'FIX_OR_KIND_REQUIRED',
  'INTENT_DOES_NOT_FIT_PARTY', 'INVALID_STATUS', 'INVOICE_MISMATCH', 'NOT_EARLIER', 'NOT_PENDING', 'NO_OPEN_INVOICE', 'NO_OPEN_ORDER',
  'SNAPSHOT_TOO_LARGE', 'STALE_DRAFT_VERSION', 'UNKNOWN_BUSINESS', 'UNKNOWN_DRAFT', 'UNKNOWN_RULE', 'UNSUPPORTED_FIX',
  'RATE_LIMITED', 'DATE_OUTSIDE_HORIZON', 'MISSING_FIELDS', 'UNKNOWN_FIX', 'UNKNOWN_EVENT', 'NOT_FOUND',
  'CANNOT_INVITE', 'NOT_ENOUGH_STOCK', 'SHARED_DEMO_PROTECTED', 'DUPLICATE_INVOICE_NUMBER', 'BODY_TOO_LARGE',
]

describe('errorText', () => {
  it.each(REACHABLE)('says something useful for %s', (code) => {
    const text = errorText(new ApiError(422, code, {}))
    expect(text).not.toContain(code)
    expect(text).not.toMatch(/Could not complete that/)
    expect(text.length).toBeGreaterThan(15)
  })

  it('falls back to a generic sentence for a code it does not know, and keeps the code for support', () => {
    expect(errorText(new ApiError(500, 'SOMETHING_NEW', {}))).toContain('SOMETHING_NEW')
  })

  it('treats anything that is not an API error as a generic problem', () => {
    expect(errorText(new TypeError('Failed to fetch'))).toBe('Something went wrong. Try again.')
  })
})
