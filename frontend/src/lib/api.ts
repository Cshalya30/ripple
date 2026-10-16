export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  constructor(status: number, code: string, details: unknown) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn)
  return () => {
    unauthorizedListeners.delete(fn)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { 'X-Ripple': '1' } : { 'Content-Type': 'application/json', 'X-Ripple': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; details?: unknown } } | null)?.error
    if (response.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((fn) => fn())
    throw new ApiError(response.status, error?.code ?? `HTTP_${response.status}`, error?.details)
  }
  return data as T
}

async function upload<T>(path: string, file: File): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Ripple': '1', 'X-Filename': file.name },
    body: file,
  })
  const text = await response.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; details?: unknown } } | null)?.error
    if (response.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((fn) => fn())
    throw new ApiError(response.status, error?.code ?? `HTTP_${response.status}`, error?.details)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload,
}

/** Pydantic's "loc" -> a field name people recognise. */
const FIELD_NAME: Record<string, string> = {
  name: 'Name', owner_name: 'Owner name', address: 'Address', gstin: 'GSTIN', udyam_number: 'Udyam number', msme_category: 'MSME category',
  fy_start: 'Financial year start', safety_buffer_paise: 'Safety buffer', horizon_days: 'Forecast horizon', label: 'Name', amount_paise: 'Amount',
  day_of_month: 'Day of month', approved_limit_paise: 'Limit', annual_rate_bps: 'Interest rate', drawdown_fee_paise: 'Fee', available_from: 'Available from',
  repayment_date: 'Repay by', email: 'Email', qty: 'Quantity', opening_qty: 'Opening stock', cost_paise: 'Cost', sku: 'SKU', unit: 'Unit',
  default_customer_terms_days: 'Customer credit days', default_supplier_terms_days: 'Supplier credit days', reorder_safety_days: 'Safety days',
}

export interface FieldIssue { field: string; message: string }

/** Per-field problems from a 422 VALIDATION_ERROR, so a form can put each next to its input. */
export function fieldIssues(error: unknown): FieldIssue[] {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return []
  return (error.details as { loc?: (string | number)[]; msg?: string }[]).map((d) => {
    const field = String((d.loc ?? []).filter((x) => x !== 'body').at(-1) ?? '')
    const message = String(d.msg ?? 'Not valid').replace(/^Value error, /, '')
    return { field, message }
  })
}

/** Plain-language message for an API error. */
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.'
  const d = (error.details ?? {}) as Record<string, any>
  const map: Record<string, string> = {
    BAD_CREDENTIALS: 'Email or password is wrong',
    PASSWORD_MISMATCH: 'Passwords do not match.',
    RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
    AMOUNT_EXCEEDS_OUTSTANDING: d.pending_cheques_paise ? 'That is more than is still free on this bill: a pending cheque already covers part of it. Clear or bounce that cheque first.' : 'That is more than is outstanding on this bill.',
    FUTURE_DATE: 'A payment cannot be dated in the future.',
    DIRECTION_MISMATCH: 'Customers pay you; you pay suppliers. Check the direction.',
    NOT_ENOUGH_MATERIAL: 'Not enough material in stock to start this order.',
    INVALID_TRANSITION: 'That step is not possible from the current stage.',
    DATE_OUTSIDE_HORIZON: 'Pick a date inside the forecast window.',
    PROVIDER_UNAVAILABLE: 'The AI service did not answer. Your text is still here. Try again in a minute, or load the demo business.',
    MISSING_PROVIDER_CONFIGURATION: 'The AI service is not set up on this server (no GROQ_API_KEY). Load the demo business, or add the key and try again.',
    AUTHENTICATION_FAILED: 'The AI service rejected the server key. Load the demo business, or try later.',
    CONFIRMATION_MISMATCH: 'Type the business name exactly to confirm.',
    FORBIDDEN_FOR_ROLE: 'Your role cannot do this.',
    NOTE_REQUIRED: 'Stock adjustments need a note.',
    DEMO_CAPACITY: 'Too many demo copies right now. Sign in with the demo owner account instead.',
    EMAIL_TAKEN: 'That email already has an account.',
    CANNOT_INVITE: 'That email cannot be invited. Use a different address.',
    SHARED_DEMO_PROTECTED: 'This is the shared demo business, so its team and data cannot be changed. Use Open demo business for your own copy.',
    DUPLICATE_INVOICE_NUMBER: `This party already has a bill numbered ${d.number ?? 'that'}. Use a different number.`,
    BODY_TOO_LARGE: 'That is too large to send. Shorten it and try again.',
    INVOICE_HAS_PAYMENTS: `Payments are already recorded against ${d.invoice ?? 'the invoice'}, so this step cannot be undone.`,
    ORDER_ALREADY_PAID: `This order is already paid${d.invoice ? ` (${d.invoice})` : ''}, so it cannot be moved back.`,
    NOT_ENOUGH_STOCK: 'There is less than that in stock, so it cannot be taken out. Check the count and try again.',
    NOT_ENOUGH_FINISHED_STOCK: 'The finished pieces from this order are no longer in stock (they were sold or adjusted), so it cannot go back.',
    NOT_ENOUGH_MATERIAL_TO_REVERSE: 'Some of that material has already been used or adjusted, so the delivery cannot be undone.',
    MATERIAL_EXISTS: 'A material with that name already exists.',
    SKU_EXISTS: 'That SKU is already used by another material.',
    QUANTITY_TOO_PRECISE: `That quantity has more decimals than ${d.unit ?? 'the unit'} allows.`,
    NOT_A_SUPPLIER: 'Pick a supplier.',
    MATERIAL_IN_USE: `This material is still used${d.recipes ? ` in ${d.recipes} recipe line(s)` : ''}${d.purchase_orders ? `, ${d.purchase_orders} purchase order(s)` : ''}${d.stock_movements ? `, ${d.stock_movements} stock movement(s)` : ''}${d.orders ? `, ${d.orders} order(s)` : ''}, so it cannot be deleted.`,
    DUPLICATE_MATERIAL: 'A material appears twice in this recipe.',
    SCENARIO_EXPIRED: 'Your records changed after this what-if was run. Run it again.',
    REPAYMENT_BEFORE_AVAILABLE: 'The repay-by date has to be after the available-from date.',
    MISSING_FIELDS: 'Fill in every field for this what-if.',
    INVALID_SPLIT: 'Choose a part that is smaller than the whole amount.',
    NOT_A_SUPPLIER_PAYMENT: 'Pick a supplier payment for this what-if.',
    UNKNOWN_EVENT: 'That event is no longer in the forecast. Pick another.',
    UNKNOWN_FIX: 'That fix is no longer available.',
    PROMISED_DATE_IN_PAST: 'The promised date has to be after today.',
    CANNOT_REMOVE_SELF: 'You cannot remove yourself.',
    ZERO_QUANTITY: 'The change cannot be zero.',
    NOT_FOUND: 'That record no longer exists. Refresh and try again.',
    NOT_SIGNED_IN: 'Your session ended. Sign in again.',
    INTERNAL_ERROR: 'The server hit a problem. Nothing was saved. Try again.',
    AMOUNT_AND_DATE_REQUIRED: 'Give an amount and a date, or pick a bill to check.',
    DAY_OUT_OF_RANGE: 'That day is outside the forecast window.',
    DRAFT_NOT_READY: 'The description still has open questions. Answer them before approving.',
    DUE_BEFORE_INVOICE: 'The due date cannot be before the invoice date.',
    EXPLICIT_APPROVAL_REQUIRED: 'Review the facts and approve them before saving.',
    FIX_OR_KIND_REQUIRED: 'Pick a fix, or choose what you want to change.',
    INTENT_DOES_NOT_FIT_PARTY: 'That kind of message does not fit this customer or supplier.',
    INVALID_STATUS: 'That status is not possible for this order.',
    INVOICE_MISMATCH: 'That bill belongs to a different party, or to the other direction. Pick the right bill.',
    NOT_EARLIER: 'Pick a date earlier than the one it has now.',
    NOT_PENDING: 'Only a pending cheque can be changed this way.',
    NO_OPEN_INVOICE: 'This party has no open bill to write about.',
    NO_OPEN_ORDER: 'This customer has no open order, so there is nothing to ask a deposit on.',
    SNAPSHOT_TOO_LARGE: 'That is too much to simulate at once. Shorten the description or the horizon.',
    STALE_DRAFT_VERSION: 'The draft changed while you were editing. Reload it and try again.',
    UNKNOWN_BUSINESS: 'That business was not found. Sign in again.',
    UNKNOWN_DRAFT: 'That draft no longer exists. Start again.',
    UNKNOWN_RULE: 'That check does not exist.',
    UNSUPPORTED_FIX: 'That kind of fix is not available.',
  }
  if (error.code === 'VALIDATION_ERROR') {
    const issues = fieldIssues(error)
    if (issues.length) return issues.map((i) => `${FIELD_NAME[i.field] ?? i.field}: ${i.message}`).join(' ')
    return 'Some of those values are not valid. Check them and try again.'
  }
  if (map[error.code]) return map[error.code]
  if (error.status === 502) return map.PROVIDER_UNAVAILABLE
  return `Could not complete that (${error.code}).`
}
