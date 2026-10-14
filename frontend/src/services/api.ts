/**
 * HTTP client for the FastAPI backend.
 *
 * - Production build served by FastAPI: same origin, so the base URL is ''.
 * - `npm run dev`: talks to http://localhost:8000 unless VITE_API_URL is set.
 * - Every request carries a per-browser workspace id, so each visitor gets
 *   their own copy of the demo khata on the server.
 */

type Env = { DEV?: boolean; VITE_API_URL?: string }
const env: Env = ((import.meta as unknown as { env?: Env }).env) ?? {}

export const API_BASE: string = (env.VITE_API_URL ?? (env.DEV ? 'http://localhost:8000' : '')).replace(/\/+$/, '')

const WORKSPACE_KEY = 'ripple-workspace'
let memoryWorkspace = ''

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function workspaceId(): string {
  try {
    let id = localStorage.getItem(WORKSPACE_KEY)
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = randomId()
      localStorage.setItem(WORKSPACE_KEY, id)
    }
    return id
  } catch {
    // Storage blocked (private mode etc.): keep one id for this page load.
    if (!memoryWorkspace) memoryWorkspace = randomId()
    return memoryWorkspace
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init.headers)
  headers.set('X-Workspace-Id', workspaceId())
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal })
    if (!res.ok) {
      let code = 'HTTP_ERROR'
      let message = `Request failed (${res.status})`
      try {
        const body = await res.json()
        code = body?.error?.code ?? code
        message = body?.error?.message ?? message
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, code, message)
    }
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function api<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const res = await request(path, init, timeoutMs)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Same as api(), but returns the raw text body (used for CSV downloads). */
export async function apiText(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<string> {
  const res = await request(path, init, timeoutMs)
  return res.text()
}

const warned = new Set<string>()

/** Log a backend problem once per call site, then let the caller use its offline fallback. */
export function warnFallback(where: string, err: unknown): void {
  if (warned.has(where)) return
  warned.add(where)
  const reason = err instanceof Error ? err.message : String(err)
  console.warn(`[ripple] ${where}: backend unavailable (${reason}). Using built-in sample data.`)
}
