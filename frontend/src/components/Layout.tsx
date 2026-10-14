import { useState } from 'react'
import { NavLink, useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, Search, Settings, TrendingUp, Workflow } from 'lucide-react'
import { Logo, LogoMark } from './Logo'
import { ThemeToggle } from './ThemeToggle'
import { NotificationsMenu } from './NotificationsMenu'
import { SettingsModal } from './SettingsModal'
import { AssistantWidget } from './AssistantWidget'
import { ToastHost } from './ToastHost'
import { useApp } from '../context/AppContext'
import { APP_NAME } from '../lib/brand'

const nav = [
  { to: '/', label: 'Home', icon: Workflow, title: 'The Engine' },
  { to: '/forecast', label: 'Forecast', icon: TrendingUp, title: 'Cash forecast' },
  { to: '/khata', label: 'Khata', icon: BookOpen, title: 'Khata' },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
    isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-sunken hover:text-ink'
  }`

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

export default function Layout() {
  const location = useLocation()
  const outlet = useOutlet()
  const { businessName } = useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const current = nav.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))) ?? nav[0]

  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand">
        Skip to content
      </a>

      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <div className="px-2 pb-6">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={linkClass}>
              <n.icon size={18} aria-hidden="true" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <button type="button" onClick={() => setSettingsOpen(true)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-sunken hover:text-ink">
            <Settings size={18} aria-hidden="true" />
            Settings
          </button>
          <ThemeToggle showLabel />
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="lg:hidden">
            <LogoMark size={30} />
            <span className="sr-only">{APP_NAME}</span>
          </div>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold sm:text-xl">{current.title}</h1>
          <div className="relative hidden md:block">
            <label htmlFor="global-search" className="sr-only">
              Search customers, suppliers and payments
            </label>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input id="global-search" type="search" placeholder="Search parties, payments" className="field w-64 py-2 pl-9" />
          </div>
          <NotificationsMenu />
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1.5 pl-1.5 pr-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-xs font-bold text-on-brand" aria-hidden="true">
              {initials(businessName)}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:block">{businessName}</span>
          </div>
        </header>

        <main id="main" className="flex-1 px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pb-12" tabIndex={-1}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-muted'}`}
          >
            <n.icon size={20} aria-hidden="true" />
            {n.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setSettingsOpen(true)} className="flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium text-muted">
          <Settings size={20} aria-hidden="true" />
          Settings
        </button>
        <div className="flex flex-col items-center text-[11px] font-medium text-muted">
          <ThemeToggle />
          <span className="-mt-1.5">Theme</span>
        </div>
      </nav>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AssistantWidget />
      <ToastHost />
    </div>
  )
}
