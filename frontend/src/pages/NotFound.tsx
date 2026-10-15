import { Link } from 'react-router-dom'
import { Logo } from '../components/Glyph'

/** Shown for any address that is not a page. `inApp` keeps the sidebar and offers the way back to the user's own home. */
export function NotFound({ home = '/login', inApp = false }: { home?: string; inApp?: boolean }) {
  const body = (
    <div role="alert" style={{ maxWidth: 440 }}>
      {!inApp && <div style={{ marginBottom: 24 }}><Logo /></div>}
      <p className="label">404</p>
      <h1 className="h1" style={{ marginTop: 6 }}>This page does not exist</h1>
      <p className="muted" style={{ marginTop: 8 }}>The address may be mistyped, or the page may have moved.</p>
      <div className="row-wrap" style={{ marginTop: 20 }}>
        <Link className="btn btn-primary" to={home}>{inApp ? 'Back to your home screen' : 'Go to sign in'}</Link>
      </div>
    </div>
  )
  return inApp ? <div className="page">{body}</div> : <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}><main>{body}</main></div>
}
