import { Command } from 'cmdk'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { rupees } from '../lib/format'
import { useParties } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me } from '../lib/types'
import { Glyph } from './Glyph'

const SCREENS = [
  { mnemonic: 'TODAY', label: 'Today', to: '/app/today', finance: true },
  { mnemonic: 'ENG', label: 'Engine', to: '/app/engine', finance: true },
  { mnemonic: 'BOOK', label: 'Book', to: '/app/book', finance: true },
  { mnemonic: 'KHATA', label: 'Khata', to: '/app/khata', finance: true },
  { mnemonic: 'ORD', label: 'Orders', to: '/app/orders', finance: false },
  { mnemonic: 'INV', label: 'Inventory', to: '/app/inventory', finance: false },
  { mnemonic: 'SET', label: 'Settings', to: '/app/settings', finance: false },
]

export function CommandPalette({ me }: { me: Me }) {
  const ui = useUI()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const finance = me.user.role !== 'SUPERVISOR'
  const customers = useParties('CUSTOMER', finance && ui.commandOpen)
  const suppliers = useParties('SUPPLIER', finance && ui.commandOpen)
  if (!ui.commandOpen) return null
  const close = () => { ui.setCommandOpen(false); setQuery('') }
  const go = (to: string) => { navigate(to); close() }
  const dayMatch = query.match(/^\s*(?:day|d)\s*(\d{1,3})\s*$/i)
  const payMatch = query.match(/^\s*pay\s+(\S.*)$/i)
  const parties = finance ? [...(customers.data?.parties ?? []), ...(suppliers.data?.parties ?? [])] : []

  return (
    <>
      <div className="overlay" onClick={close} />
      <Command label="Command line" loop shouldFilter={!dayMatch} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <span className="cmdk-prompt">›</span>
        <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Party, screen, DAY 34, PAY KAVERI, FIX" />
        <Command.List>
          <Command.Empty>No match. Try a party name, a screen, or DAY 34.</Command.Empty>
          {finance && dayMatch && (
            <Command.Group heading="Days">
              <Command.Item value={`day ${dayMatch[1]}`} onSelect={() => { ui.setDay(Number(dayMatch[1])); ui.setEngineView('decisions'); go('/app/engine') }}>
                <span className="mono">DAY {dayMatch[1]}</span><span className="muted">Open the engine's decisions for this day</span>
              </Command.Item>
            </Command.Group>
          )}
          {finance && payMatch && (
            <Command.Group heading="Actions">
              {parties.filter((p) => p.name.toLowerCase().includes(payMatch[1].trim().toLowerCase())).slice(0, 5).map((p) => (
                <Command.Item key={p.id} value={`pay ${p.name}`} onSelect={() => { ui.openPayment({ partyId: p.id, direction: p.kind === 'CUSTOMER' ? 'IN' : 'OUT' }); close() }}>
                  <Glyph name={p.kind === 'CUSTOMER' ? 'CASH_RECEIPT' : 'SUPPLIER_PAYMENT'} />
                  {p.kind === 'CUSTOMER' ? `Record payment from ${p.name}` : `Pay ${p.name}`}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Screens">
            {SCREENS.filter((s) => finance || !s.finance).map((s) => (
              <Command.Item key={s.to} value={`${s.mnemonic} ${s.label}`} onSelect={() => go(s.to)}>
                <span className="mono" style={{ width: 54, color: 'var(--haldi)' }}>{s.mnemonic}</span>{s.label}
              </Command.Item>
            ))}
          </Command.Group>
          {finance && (
            <Command.Group heading="Actions">
              <Command.Item value="FIX ways to fix try a fix" onSelect={() => go('/app/book#fixes')}>
                <span className="mono" style={{ width: 54, color: 'var(--haldi)' }}>FIX</span>Ways to fix the shortfall
              </Command.Item>
              <Command.Item value="SCEN scenario what if" onSelect={() => { ui.setScenarioBarOpen(true); go('/app/engine') }}>
                <span className="mono" style={{ width: 54, color: 'var(--haldi)' }}>SCEN</span>Try a what-if in the engine
              </Command.Item>
              <Command.Item value="PAY record payment" onSelect={() => { ui.openPayment({}); close() }}>
                <span className="mono" style={{ width: 54, color: 'var(--haldi)' }}>PAY</span>Record a payment
              </Command.Item>
              <Command.Item value="NEW order can I take this order" onSelect={() => go('/app/orders?tab=new')}>
                <span className="mono" style={{ width: 54, color: 'var(--haldi)' }}>NEW</span>Can I take this order?
              </Command.Item>
              <Command.Item value="MUNIM ask assistant" onSelect={() => { ui.setMunimOpen(true); close() }}>
                <span className="mono" style={{ width: 54, color: 'var(--haldi)' }}>M</span>Ask Munim
              </Command.Item>
            </Command.Group>
          )}
          {finance && !payMatch && parties.length > 0 && (
            <Command.Group heading="Parties">
              {parties.map((p) => (
                <Command.Item key={p.id} value={`${p.name} ${p.city ?? ''}`} onSelect={() => { ui.openParty(p.id); close() }}>
                  <Glyph name={p.kind === 'CUSTOMER' ? 'CUSTOMER' : 'SUPPLIER'} />
                  <span className="grow truncate">{p.name}<span className="faint"> · {p.city}</span></span>
                  <span className={`amt ${p.kind === 'CUSTOMER' ? 'amt-in' : 'amt-out'}`}>{rupees(p.kind === 'CUSTOMER' ? p.outstanding_paise : -p.outstanding_paise, { sign: true })}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </>
  )
}
