import { ApiError } from './api'

/** Filename from a Content-Disposition header, or the fallback. */
export function filenameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
  const raw = match?.[1] ?? match?.[2]
  if (!raw) return fallback
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Fetch a file with the session cookie and hand it to the browser as a download.
 * A failure throws an ApiError, so the caller can show the usual plain-language message
 * instead of the browser saving an error page as a ".csv".
 */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'X-Ripple': '1' } })
  if (!response.ok) {
    let code = `HTTP_${response.status}`
    try {
      code = (await response.json())?.error?.code ?? code
    } catch { /* not JSON */ }
    throw new ApiError(response.status, code, undefined)
  }
  const blob = await response.blob()
  const name = filenameFrom(response.headers.get('Content-Disposition'), fallbackName)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return name
}
