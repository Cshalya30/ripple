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

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

/** Plain-language message for an API error code. */
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.'
  const map: Record<string, string> = {
    BAD_CREDENTIALS: 'Email or password is wrong',
    RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
    AMOUNT_EXCEEDS_OUTSTANDING: 'That is more than is outstanding on this bill.',
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
  }
  if (map[error.code]) return map[error.code]
  if (error.status === 502) return map.PROVIDER_UNAVAILABLE
  return `Could not complete that (${error.code}).`
}
