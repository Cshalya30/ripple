import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Shell } from './components/Shell'
import { SkeletonRows } from './components/ui'
import { onUnauthorized } from './lib/api'
import { setDateLanguage, setNumberFormat } from './lib/format'
import i18n from './lib/i18n'
import { useMe } from './lib/queries'
import type { Me } from './lib/types'
import { CookieNotice } from './components/CookieNotice'
import { Book } from './pages/Book'
import { Khata } from './pages/Khata'
import { Privacy, Terms } from './pages/Legal'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { Today } from './pages/Today'

const Engine = lazy(() => import('./pages/Engine'))
const Orders = lazy(() => import('./pages/Orders'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Settings = lazy(() => import('./pages/Settings'))
const Setup = lazy(() => import('./pages/Setup'))

function applyPrefs(me: Me) {
  const root = document.documentElement
  root.setAttribute('data-theme', me.prefs.theme)
  root.setAttribute('data-size', me.prefs.text_size)
  root.setAttribute('data-motion', me.prefs.reduce_motion ? 'reduce' : 'auto')
  root.setAttribute('data-contrast', me.prefs.high_contrast ? 'high' : 'normal')
  root.setAttribute('data-targets', me.prefs.large_targets ? 'large' : 'normal')
  root.setAttribute('lang', me.prefs.language_ui === 'en' ? 'en-IN' : me.prefs.language_ui)
  try { localStorage.setItem('ripple-theme', me.prefs.theme) } catch { /* private mode */ }
  setNumberFormat(me.prefs.number_format)
  setDateLanguage(me.prefs.language_ui)
  if (i18n.language !== me.prefs.language_ui) void i18n.changeLanguage(me.prefs.language_ui)
}

const TITLES: Record<string, string> = {
  '/login': 'Sign in', '/setup': 'Set up your business', '/privacy': 'Privacy', '/terms': 'Terms of use',
  '/app/today': 'Today', '/app/engine': 'Engine', '/app/book': 'Book', '/app/khata': 'Khata', '/app/orders': 'Orders',
  '/app/inventory': 'Inventory', '/app/settings': 'Settings',
}
const DESCRIPTIONS: Record<string, string> = {
  '/login': 'Sign in to Ripple, or open a private demo business, to see how one late payment travels through a small business.',
  '/privacy': 'What Ripple stores, where your text goes, and how long it is kept.',
  '/terms': 'The terms for using Ripple: demo data, forecasts are estimates, and no financial advice.',
}
const DEFAULT_DESCRIPTION = 'Ripple shows how one late payment travels through a small business, before it does.'

/** One title per screen (so tabs and history are readable) and a description on the public pages. */
function PageMeta() {
  const { pathname } = useLocation()
  useEffect(() => {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
    const known = path in TITLES
    document.title = known ? `${TITLES[path]} · Ripple` : path === '/' ? 'Ripple' : 'Page not found · Ripple'
    document.querySelector('meta[name="description"]')?.setAttribute('content', DESCRIPTIONS[path] ?? DEFAULT_DESCRIPTION)
  }, [pathname])
  return null
}

function Loading() {
  return <div className="page"><SkeletonRows rows={10} /></div>
}

function Protected() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => onUnauthorized(() => { qc.clear(); navigate('/login', { replace: true, state: { from: window.location.pathname + window.location.search } }) }), [qc, navigate])
  useEffect(() => { if (me.data) applyPrefs(me.data) }, [me.data])
  if (me.isLoading) return <Loading />
  if (me.isError || !me.data) return <Navigate to="/login" replace />
  const finance = me.data.user.role !== 'SUPERVISOR'
  const home = finance ? '/app/today' : '/app/orders'
  return (
    <Shell me={me.data}>
      <ErrorBoundary resetKey={location.pathname + location.search} home={home}>
      <Suspense fallback={<Loading />}>
        <Routes>
          {finance && <Route path="today" element={<Today />} />}
          {finance && <Route path="engine" element={<Engine />} />}
          {finance && <Route path="book" element={<Book me={me.data} />} />}
          {finance && <Route path="khata" element={<Khata me={me.data} />} />}
          <Route path="orders" element={<Orders me={me.data} />} />
          <Route path="inventory" element={<Inventory me={me.data} />} />
          <Route path="settings" element={<Settings me={me.data} />} />
          {!finance && <Route path="today" element={<Navigate to={home} replace />} />}
          {!finance && <Route path="engine" element={<Navigate to={home} replace />} />}
          {!finance && <Route path="book" element={<Navigate to={home} replace />} />}
          {!finance && <Route path="khata" element={<Navigate to={home} replace />} />}
          <Route index element={<Navigate to={home} replace />} />
          <Route path="*" element={<NotFound home={home} inApp />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </Shell>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <ErrorBoundary resetKey={location.pathname}>
    <PageMeta />
    <Routes>
      <Route path="/login" element={<><Login /><CookieNotice /></>} />
      <Route path="/privacy" element={<><Privacy /><CookieNotice /></>} />
      <Route path="/terms" element={<><Terms /><CookieNotice /></>} />
      <Route path="/setup" element={<Suspense fallback={<Loading />}><Setup /></Suspense>} />
      <Route path="/app/*" element={<Protected />} />
      <Route path="/" element={<Navigate to="/app/today" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </ErrorBoundary>
  )
}
