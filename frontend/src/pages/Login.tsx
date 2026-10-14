import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '../components/Glyph'
import { ErrorNote } from '../components/ui'
import { api, errorText } from '../lib/api'
import type { Me } from '../lib/types'

export function Login() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null)

  const done = (me: Me) => {
    qc.clear()
    qc.setQueryData(['me'], me)
    navigate(me.user.role === 'SUPERVISOR' ? '/app/orders' : '/app/today')
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
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
      </main>
    </div>
  )
}
