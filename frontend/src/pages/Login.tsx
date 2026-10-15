import { EyeIcon, EyeSlashIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '../components/Glyph'
import { ErrorNote } from '../components/ui'
import { api, errorText } from '../lib/api'
import type { Me } from '../lib/types'

export function Login() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null)

  const done = (me: Me) => {
    qc.clear()
    qc.setQueryData(['me'], me)
    // After a session ended mid-use, go back to the page the person was on. Only an internal /app path from router state is accepted.
    const from = (location.state as { from?: unknown } | null)?.from
    const back = typeof from === 'string' && /^\/app\/[a-z]/.test(from) ? from : null
    navigate(back ?? (me.user.role === 'SUPERVISOR' ? '/app/orders' : '/app/today'))
  }

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('login')
    setError(null)
    try {
      done(await api.post<Me>('/auth/login', { email: email.trim(), password }))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  const demo = async () => {
    setBusy('demo')
    setError(null)
    try {
      done(await api.post<Me>('/auth/demo'))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="density-simple" style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
      <main style={{ width: 'min(360px, 100%)' }}>
        <div style={{ marginBottom: 28 }}><Logo /></div>
        <h1 className="h1">Sign in</h1>
        <p className="muted" style={{ marginTop: 6 }}>See how one late payment travels through your business, before it does.</p>
        <form className="stack" style={{ gap: 14, marginTop: 20 }} onSubmit={login}>
          <label className="field">
            <span className="field-label">Email</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="current-password"
                name="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: 48 }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 0,
                  minWidth: 44,
                  minHeight: 44,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  color: 'var(--text-3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--r-1)',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
              >
                {showPassword ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
          </label>
          {error !== null && <ErrorNote text={errorText(error)} />}
          <button className="btn btn-primary" disabled={busy !== null}>{busy === 'login' ? 'Signing in' : 'Sign in'}</button>
        </form>
        <hr className="rule" style={{ margin: '24px 0' }} />
        <button className="btn btn-secondary" style={{ width: '100%' }} onClick={demo} disabled={busy !== null}>
          {busy === 'demo' ? 'Opening' : 'Open demo business: Mahalakshmi Fabrics'}
        </button>
        <p className="micro faint" style={{ marginTop: 8 }}>Opens your own private copy of the demo. It is deleted after 24 hours.</p>
        <div className="small muted" style={{ marginTop: 20 }}>
          <div className="label" style={{ marginBottom: 6 }}>Demo accounts (shared business), password <span className="mono">ripple-demo-2026</span></div>
          <table className="table dense">
            <tbody>
              <tr><td className="mono small">owner@ripple.demo</td><td className="small">Owner, sees everything</td></tr>
              <tr><td className="mono small">accountant@ripple.demo</td><td className="small">Accountant, everything except team</td></tr>
              <tr><td className="mono small">supervisor@ripple.demo</td><td className="small">Supervisor, orders and stock only, no amounts</td></tr>
            </tbody>
          </table>
        </div>
        <nav className="small row-wrap" aria-label="Legal" style={{ marginTop: 20 }}>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </main>
    </div>
  )
}
