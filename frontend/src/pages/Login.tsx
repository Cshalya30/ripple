import { EyeIcon, EyeSlashIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '../components/Glyph'
import { LoginRipple } from '../components/LoginRipple'
import { ErrorNote } from '../components/ui'
import { api, errorText } from '../lib/api'
import type { Me } from '../lib/types'

export function Login() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [name, setName] = useState('')
  const [signup, setSignup] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<'login' | 'signup' | 'demo' | null>(null)

  const done = (me: Me, destination?: string) => {
    qc.clear()
    qc.setQueryData(['me'], me)
    // After a session ended mid-use, go back to the page the person was on. Only an internal /app path from router state is accepted.
    const from = (location.state as { from?: unknown } | null)?.from
    const back = typeof from === 'string' && /^\/app\/[a-z]/.test(from) ? from : null
    navigate(destination ?? back ?? (me.user.role === 'SUPERVISOR' ? '/app/orders' : '/app/today'))
  }

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('signup')
    setError(null)
    try {
      const me = await api.post<Me>('/auth/signup', { name: name.trim(), email: email.trim(), password, password_confirmation: passwordConfirmation })
      done(me, '/setup')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
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
    <div className="density-simple login-page" style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
      <LoginRipple />
      <main className="login-content" style={{ width: 'min(360px, 100%)' }}>
        <div className="login-logo" style={{ marginBottom: 28 }}><Logo /></div>
        <h1 className="h1">{signup ? 'Create your account' : 'Sign in'}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{signup ? 'Create your owner account, then tell Ripple about your business.' : 'See how one late payment travels through your business, before it does.'}</p>
        <form className="stack" style={{ gap: 14, marginTop: 20 }} onSubmit={signup ? createAccount : login}>
          {signup && (
            <label className="field">
              <span className="field-label">Your name</span>
              <input className="input" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          )}
          <label className="field">
            <span className="field-label">Email</span>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id={signup ? 'new-password' : 'current-password'}
                name="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
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
          {signup && (
            <label className="field">
              <span className="field-label">Confirm password</span>
              <input className="input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirmation} onChange={(e) => setPasswordConfirmation(e.target.value)} required />
            </label>
          )}
          {error !== null && <ErrorNote text={errorText(error)} />}
          <button className="btn btn-primary" disabled={busy !== null}>{busy === 'login' ? 'Signing in' : busy === 'signup' ? 'Creating account' : signup ? 'Create account' : 'Sign in'}</button>
        </form>
        {!signup && <><hr className="rule" style={{ margin: '24px 0' }} />
        <button className="btn btn-secondary" style={{ width: '100%' }} onClick={demo} disabled={busy !== null}>
          {busy === 'demo' ? 'Opening' : 'Open demo business: Mahalakshmi Fabrics'}
        </button>
        <p className="micro faint" style={{ marginTop: 8 }}>Opens your own private copy of the demo. It is deleted after 24 hours.</p>
        </>}
        <button className="btn btn-quiet" style={{ width: '100%', marginTop: 20 }} onClick={() => { setSignup((current) => !current); setError(null) }} disabled={busy !== null}>
          {signup ? 'Already have an account? Sign in' : 'New to Ripple? Create an account'}
        </button>
        <nav className="small row-wrap" aria-label="Legal" style={{ marginTop: 20 }}>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </main>
      <style>{`
        .login-page { position: relative; isolation: isolate; overflow: hidden; }
        .login-ripple { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
        .login-ripple-glow {
          position: absolute;
          left: -22vw;
          bottom: -25vw;
          width: 64vw;
          aspect-ratio: 1;
          border-radius: 50%;
          background: radial-gradient(circle, var(--haldi-wash), transparent 64%);
        }
        .login-ripple-wave {
          position: absolute;
          left: -28vw;
          bottom: -31vw;
          width: 72vw;
          aspect-ratio: 1;
          border: 1px solid var(--rule-strong);
          opacity: 0.36;
          border-radius: 50%;
          transform: scale(0.35);
          transform-origin: 50% 50%;
          animation: login-ripple-expand 16s cubic-bezier(0.25, 0.1, 0.2, 1) infinite;
        }
        .login-ripple-wave-1 { animation-delay: -1s; }
        .login-ripple-wave-2 { animation-delay: -4.2s; }
        .login-ripple-wave-3 { animation-delay: -7.4s; }
        .login-ripple-wave-4 { animation-delay: -10.6s; }
        .login-ripple-wave-5 { animation-delay: -13.8s; }
        .login-ripple-logo {
          position: absolute;
          left: 13px;
          bottom: 13px;
          transform: rotate(-45deg);
          transform-origin: center;
          filter: drop-shadow(0 0 10px var(--haldi-wash));
        }
        .login-content { position: relative; z-index: 1; animation: login-content-settle 900ms var(--ease) both; }
        @keyframes login-ripple-expand {
          0% { opacity: 0; transform: scale(0.35); }
          12% { opacity: 0.5; }
          68% { opacity: 0.2; }
          100% { opacity: 0; transform: scale(1.55); }
        }
        @keyframes login-content-settle {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 600px) {
          .login-ripple-glow { left: -42vw; bottom: -35vw; width: 105vw; }
          .login-ripple-wave { left: -48vw; bottom: -40vw; width: 118vw; }
          .login-ripple-logo { left: 7px; bottom: 7px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .login-ripple-wave { animation: none; opacity: 0.2; transform: scale(0.88); }
          .login-content { animation: none; }
        }
      `}</style>
    </div>
  )
}
