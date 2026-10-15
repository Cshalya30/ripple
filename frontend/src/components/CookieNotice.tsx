import { useState } from 'react'
import { Link } from 'react-router-dom'

const KEY = 'ripple-cookie-notice'

function seen(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/** One strictly necessary cookie, no tracking: this is a notice, not a consent choice. Shown on the public pages until dismissed. */
export function CookieNotice() {
  const [hidden, setHidden] = useState(seen)
  if (hidden) return null
  const dismiss = () => {
    try { localStorage.setItem(KEY, '1') } catch { /* private mode: it will show again next visit */ }
    setHidden(true)
  }
  return (
    <aside className="cookie-notice notice row" role="region" aria-label="Cookie notice">
      <span className="grow">Ripple uses one cookie to keep you signed in. No tracking or advertising. <Link to="/privacy">Privacy</Link></span>
      <button className="btn btn-sm btn-secondary" onClick={dismiss}>OK</button>
    </aside>
  )
}
