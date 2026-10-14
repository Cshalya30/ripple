import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Shell } from './components/Shell'
import { SkeletonRows } from './components/ui'
import { onUnauthorized } from './lib/api'
import { setDateLanguage, setNumberFormat } from './lib/format'
import i18n from './lib/i18n'
import { useMe } from './lib/queries'
import type { Me } from './lib/types'
import { Book } from './pages/Book'
import { Khata } from './pages/Khata'
import { Login } from './pages/Login'
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

function Loading() {
  return <div className="page"><SkeletonRows rows={10} /></div>
}

function Protected() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  useEffect(() => onUnauthorized(() => { qc.clear(); navigate('/login') }), [qc, navigate])
  useEffect(() => { if (me.data) applyPrefs(me.data) }, [me.data])
  if (me.isLoading) return <Loading />
  if (me.isError || !me.data) return <Navigate to="/login" replace />
  const finance = me.data.user.role !== 'SUPERVISOR'
  const home = finance ? '/app/today' : '/app/orders'
  return (
    <Shell me={me.data}>
      <Suspense fallback={<Loading />}>
        <Routes>
          {finance && <Route path="today" element={<Today />} />}
          {finance && <Route path="engine" element={<Engine />} />}
          {finance && <Route path="book" element={<Book me={me.data} />} />}
          {finance && <Route path="khata" element={<Khata me={me.data} />} />}
          <Route path="orders" element={<Orders me={me.data} />} />
          <Route path="inventory" element={<Inventory me={me.data} />} />
          <Route path="settings" element={<Settings me={me.data} />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Suspense fallback={<Loading />}><Setup /></Suspense>} />
      <Route path="/app/*" element={<Protected />} />
      <Route path="*" element={<Navigate to="/app/today" replace />} />
    </Routes>
  )
}
