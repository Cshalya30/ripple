import * as Popover from '@radix-ui/react-popover'
import {
  ArrowsInLineHorizontalIcon as ArrowsInLineHorizontal, ArrowsOutLineHorizontalIcon as ArrowsOutLineHorizontal, BellIcon as Bell,
  BookOpenIcon as BookOpen, CalendarCheckIcon as CalendarCheck, CubeIcon as Cube, GearIcon as Gear, GraphIcon, NotebookIcon as Notebook,
  PackageIcon as Package, SunIcon as Sun,
} from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { clock, dayDate, daysBetween, rupees, shortDate } from '../lib/format'
import { useAlerts, useMe, useRisk, useRun } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me } from '../lib/types'
import { CommandPalette } from './CommandPalette'
import { Glyph, Logo } from './Glyph'
import { Composer } from './Composer'
import { MunimPanel } from './Munim'
import { PartyDrawer } from './PartyDrawer'
import { PaymentDialog } from './PaymentDialog'
import { VoiceCallDialog } from './VoiceCallDialog'
import { Status, Toasts } from './ui'

const NAV = [
  { to: '/app/today', key: 'today', icon: CalendarCheck, roles: ['OWNER', 'ACCOUNTANT'] },
  { to: '/app/engine', key: 'engine', icon: GraphIcon, roles: ['OWNER', 'ACCOUNTANT'] },
  { to: '/app/book', key: 'book', icon: BookOpen, roles: ['OWNER', 'ACCOUNTANT'] },
  { to: '/app/khata', key: 'khata', icon: Notebook, roles: ['OWNER', 'ACCOUNTANT'] },
  { to: '/app/orders', key: 'orders', icon: Package, roles: ['OWNER', 'ACCOUNTANT', 'SUPERVISOR'] },
  { to: '/app/inventory', key: 'inventory', icon: Cube, roles: ['OWNER', 'ACCOUNTANT', 'SUPERVISOR'] },
] as const

export function Shell({ children, me }: { children: ReactNode; me: Me }) {
  const { t } = useTranslation()
  const ui = useUI()
  const location = useLocation()
  const finance = me.user.role !== 'SUPERVISOR'
  const engineRoute = location.pathname.startsWith('/app/engine')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        ui.setCommandOpen(true)
      } else if (e.key === 'm' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        ui.setMunimOpen(!useUI.getState().munimOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui])

  return (
    <div className={`app${ui.railCollapsed ? ' rail-collapsed' : ''}${engineRoute ? ' engine-route' : ''}`}>
      <aside className="rail" aria-label="Main">
        <Link to={finance ? '/app/today' : '/app/orders'} className="rail-brand" aria-label="Ripple home"><Logo /></Link>
        <nav>
          {NAV.filter((n) => (n.roles as readonly string[]).includes(me.user.role)).map((n) => (
            <NavLink key={n.to} to={n.to} className="rail-link" aria-current={location.pathname.startsWith(n.to) ? 'page' : undefined}>
              <n.icon size={20} />
              <span className="rail-text">{t(`nav.${n.key}`)}</span>
            </NavLink>
          ))}
          <NavLink to="/app/settings" className="rail-link show-mobile" aria-current={location.pathname.startsWith('/app/settings') ? 'page' : undefined}>
            <Gear size={20} /><span className="rail-text">{t('nav.settings')}</span>
          </NavLink>
        </nav>
        <div className="rail-foot">
          <NavLink to="/app/settings" className="rail-link" aria-current={location.pathname.startsWith('/app/settings') ? 'page' : undefined}>
            <Gear size={20} /><span className="rail-text">{t('nav.settings')}</span>
          </NavLink>
          <ThemeSwitch me={me} />
          <button className="rail-link" style={{ border: 0, background: 'transparent', cursor: 'pointer', width: '100%' }} onClick={ui.toggleRail}
            aria-label={ui.railCollapsed ? 'Expand menu' : 'Collapse menu'}>
            {ui.railCollapsed ? <ArrowsOutLineHorizontal size={20} /> : <ArrowsInLineHorizontal size={20} />}
            <span className="rail-text">Collapse</span>
          </button>
        </div>
      </aside>

      <header className="topbar">
        <div className="topbar-biz">
          <strong className="truncate">{me.business.name}</strong>
          <span>{dayDate(me.today)} · Day {ui.scenario || engineRoute ? ui.day : 0}</span>
        </div>
        <button className="cmdline" onClick={() => ui.setCommandOpen(true)} aria-label="Open command line">
          <span className="prompt">›</span><span className="truncate">ENG, BOOK, PAY KAVERI, DAY 34</span><kbd>/</kbd>
        </button>
        <span className="spacer" />
        {ui.scenario && (
          <span className="scenario-chip" role="status">
            <span className="truncate" style={{ maxWidth: 260 }}>Scenario: {ui.scenario.label}</span>
            <button onClick={() => ui.setScenario(null)}>Exit</button>
          </span>
        )}
        {finance && <AlertsMenu />}
        <button className={`btn btn-sm ${ui.munimOpen ? 'btn-secondary' : 'btn-quiet'}`} onClick={() => ui.setMunimOpen(!ui.munimOpen)} aria-pressed={ui.munimOpen}>
          <Glyph name="NIB" /> <span className="hide-mobile">Munim</span>
        </button>
      </header>

      <main className={`main${engineRoute ? '' : ' density-simple'}`} id="main">{children}</main>
      {ui.munimOpen && <aside className="munim-dock density-simple" aria-label="Munim"><MunimPanel me={me} /></aside>}
      {finance ? <FinanceStatusBar /> : <footer className="statusbar">Supervisor view · amounts are hidden by the server</footer>}

      <CommandPalette me={me} />
      {finance && <Composer />}
      {finance && <PaymentDialog />}
      {finance && <VoiceCallDialog />}
      {finance && <PartyDrawer me={me} />}
      <Toasts />
    </div>
  )
}

function ThemeSwitch({ me }: { me: Me }) {
  const qc = useQueryClient()
  const order = ['night', 'day', 'lamp'] as const
  const next = order[(order.indexOf(me.prefs.theme) + 1) % order.length]
  return (
    <button className="rail-link" style={{ border: 0, background: 'transparent', cursor: 'pointer', width: '100%' }}
      onClick={async () => { qc.setQueryData(['me'], await api.put<Me>('/me/prefs', { theme: next })) }} aria-label={`Theme: ${me.prefs.theme}. Switch to ${next}`}>
      <Sun size={20} /><span className="rail-text" style={{ textTransform: 'capitalize' }}>{me.prefs.theme}</span>
    </button>
  )
}

function AlertsMenu() {
  const { data } = useAlerts()
  const navigate = useNavigate()
  const openParty = useUI((s) => s.openParty)
  const count = data?.count ?? 0
  return (
    <Popover.Root>
      <Popover.Trigger className="icon-btn" aria-label={`${count} alerts`} style={{ width: 'auto', padding: '0 6px', gap: 6 }}>
        <Bell size={18} />{count > 0 && <span className="badge-count">{count}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="end" sideOffset={6}>
          <div className="label" style={{ padding: '10px 14px 6px' }}>Alerts</div>
          {count === 0 && <div className="small muted" style={{ padding: '4px 14px 14px' }}>Nothing needs attention.</div>}
          {data?.alerts.map((a) => (
            <Popover.Close asChild key={a.id}>
              <button className="list-row" style={{ width: '100%', border: 0, borderTop: '1px solid var(--rule)', background: 'transparent', textAlign: 'left', padding: '8px 14px', cursor: 'pointer' }}
                onClick={() => (a.party_id ? openParty(a.party_id) : navigate(a.link))}>
                <span className="grow small">{alertText(a)}</span>
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function alertText(a: any): ReactNode {
  switch (a.kind) {
    case 'BUFFER_BREACH':
      return a.shortfall_date
        ? <><Status tone="out">Shortfall</Status> {rupees(a.shortfall_paise)} on {dayDate(a.shortfall_date)}</>
        : <><Status tone="attn">Buffer</Status> Net position falls below buffer on {dayDate(a.date)}</>
    case 'OVERDUE':
      return <><Status tone="attn">{a.days_overdue}d late</Status> {a.party_name} owes {rupees(a.amount_paise)} ({a.invoice})</>
    case 'DUE_SOON':
      return <><Status tone="attn">Due {shortDate(a.date)}</Status> Pay {a.party_name} {rupees(a.amount_paise)}</>
    case 'STOCK_SHORT':
      return <><Status tone="out">Short</Status> {a.material}{a.orders?.length ? ` for ${a.orders.join(', ')}` : ''}</>
    case 'RISK':
      return <><Status tone={a.severity === 'out' ? 'out' : 'attn'}>Risk</Status> {Math.round(a.chance * 100)}% chance of a shortfall within 30 days</>
    default:
      return a.kind
  }
}

function FinanceStatusBar() {
  const scenario = useUI((s) => s.scenario)
  const setScenario = useUI((s) => s.setScenario)
  const run = useRun()
  const risk = useRisk()
  const r = run.data
  // A scenario is a copy of one version of the books; any write makes it stale.
  useEffect(() => {
    if (scenario && r && scenario.run.data_version !== r.data_version) setScenario(null)
  }, [scenario, r, setScenario])
  return (
    <footer className="statusbar" aria-label="Data source">
      {r ? (
        <>
          <span>{r.engine_version}</span><span className="sep">·</span>
          <span>schema {r.schema_version}</span><span className="sep">·</span>
          <span>last run {clock(r.created_at)}</span><span className="sep">·</span>
          <span>{r.event_count} events</span><span className="sep">·</span>
          <span>{scenario ? `scenario ${scenario.key}` : 'baseline'}</span><span className="sep">·</span>
          <span>{risk.data?.status === 'READY' ? `risk seed ${risk.data.seed} · ${risk.data.n_samples} samples` : `risk ${(risk.data?.status ?? 'loading').toLowerCase()}`}</span>
          <span className="sep">·</span>
          <span className={run.isError ? 'bad' : 'ok'}>API {run.isError ? 'error' : 'ok'}</span>
          {r.as_of && <span className="hide-mobile">· horizon {r.horizon_days}d to {shortDate(addHorizon(r.as_of, r.horizon_days))}</span>}
        </>
      ) : run.isError ? <span className="bad">Couldn't reach the engine.</span> : <span>Loading engine run</span>}
    </footer>
  )
}

function addHorizon(asOf: string, days: number) {
  const d = new Date(asOf + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days - 1)
  return d.toISOString().slice(0, 10)
}

export function useDayLabel() {
  const me = useMe().data
  return (iso: string) => (me ? `D${daysBetween(me.today, iso)}` : '')
}
