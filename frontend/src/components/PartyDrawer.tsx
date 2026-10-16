import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { percent, rupees, shortDate, whatsappNumber } from '../lib/format'
import { useParty, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me } from '../lib/types'
import { DatasheetButton } from './DatasheetButton'
import { Amount, Drawer, ErrorNote, Section, SkeletonRows, Status, StripCell } from './ui'

export function PartyDrawer({ me }: { me: Me }) {
  const id = useUI((s) => s.drawerPartyId)
  const ui = useUI()
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useParty(id)
  const [note, setNote] = useState('')
  const addNote = useWrite((text: string) => api.post(`/parties/${encodeURIComponent(id!)}/notes`, { text }))
  if (!id) return null
  const p = data?.party
  const customer = p?.kind === 'CUSTOMER'

  return (
    <Drawer open onClose={() => ui.openParty(null)} title={p?.name ?? 'Loading'}
      head={p && (
        <div className="small muted" style={{ marginTop: 4 }}>
          {customer ? 'Customer' : 'Supplier'}{p.since ? ` · since ${shortDate(p.since)} ${p.since.slice(0, 4)}` : ''}
          <br />
          {[p.description, p.city].filter(Boolean).join(', ')}
          {p.gstin && <> · <span className="mono">GSTIN {p.gstin}</span></>}
          {p.phone && <> · <span className="mono">{p.phone}</span>{whatsappNumber(p.phone) && <> <a className="btn-quiet" href={`https://wa.me/${whatsappNumber(p.phone)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}</>}
        </div>
      )}>
      {isLoading && <SkeletonRows rows={8} />}
      {isError && <ErrorNote text={errorText(error)} />}
      {p && data && (
        <>
          <div className="strip compact">
            <StripCell label="Billed">{rupees(data.billed_paise)}</StripCell>
            <StripCell label="Outstanding"><Amount paise={p.outstanding_paise} direction={customer ? 'IN' : 'OUT'} sign={false} /></StripCell>
            {customer ? (
              <>
                <StripCell label="On time">{p.n_payments ? percent(p.on_time_share) : '·'}</StripCell>
                <StripCell label="Pays">{p.avg_delay_days === null || p.avg_delay_days === undefined ? '·' : `${p.avg_delay_days > 0 ? '+' : ''}${p.avg_delay_days} days`}</StripCell>
              </>
            ) : (
              <>
                <StripCell label="Terms">{p.terms_type === 'CREDIT' ? `${p.terms_days} days` : p.terms_type === 'ADVANCE' ? 'Advance' : 'On delivery'}</StripCell>
                <StripCell label="Lead time">{p.lead_time_days} days</StripCell>
              </>
            )}
          </div>
          {customer && (
            <p className="small muted" style={{ marginTop: 10 }}>
              {p.n_payments
                ? <>Payment delay used by risk: <span className="mono">P50 {signed(p.p50_days)} days · P90 {signed(p.p90_days)} days</span> (from {p.n_payments} payments, blended with all customers' history at weight {p.n_payments}/({p.n_payments}+{data.risk_model?.k ?? 5})).</>
                : <>No payment history. Risk uses the average of other customers: <span className="mono">P50 {signed(p.p50_days)} · P90 {signed(p.p90_days)} days</span>.</>}
            </p>
          )}
          {!customer && p.msme_category && (
            <p className="small muted" style={{ marginTop: 10 }}>
              {p.msme_category === 'MEDIUM' ? 'Medium enterprise.' : `${p.msme_category === 'MICRO' ? 'Micro' : 'Small'} enterprise. Pay within 45 days. Late payment delays your tax deduction (43B(h)).`}
            </p>
          )}

          <Section title="Open items">
            {data.open_items.length === 0 && <p className="small muted">Nothing open.</p>}
            {data.open_items.map((item) => (
              <div className="list-row" key={item.id}>
                <div className="grow">
                  <div className="mono small">{item.number}</div>
                  <span className="sub">{item.description}</span>
                </div>
                <div className="right">
                  <Amount paise={item.amount_paise} direction={customer ? 'IN' : 'OUT'} sign={false} />
                  <span className="sub">
                    due {shortDate(item.due_date)}{item.promised_date ? ` · promised ${shortDate(item.promised_date)}` : ''}
                  </span>
                </div>
                <div style={{ width: 92 }}>{item.days_overdue > 0 ? <Status tone="attn">{item.days_overdue}d late</Status> : <Status tone="wait">Open</Status>}</div>
                <div className="row" style={{ gap: 4 }}>
                  {customer && <button className="btn btn-sm btn-secondary" onClick={() => ui.openComposer({ partyId: p.id, intent: 'reminder', invoiceId: item.id })}>Remind</button>}
                  <button className="btn btn-sm btn-quiet" onClick={() => ui.openPayment({ partyId: p.id, invoiceId: item.id, amountPaise: item.amount_paise })}>Record</button>
                </div>
              </div>
            ))}
          </Section>

          {data.forecast.length > 0 && (
            <Section title="In the forecast">
              <table className="table dense">
                <tbody>
                  {data.forecast.filter((f) => f.direction !== 'NONE').map((f) => (
                    <tr key={f.id} className="clickable" onClick={() => { ui.selectEvent(f.id); ui.setEngineView('flow'); ui.openParty(null); navigate('/app/engine') }}>
                      <td className="small">{f.label}</td>
                      <td className="mono small">{f.executed_date ? shortDate(f.executed_date) : 'not in window'}</td>
                      <td>{f.lateness_days ? <Status tone="attn">{f.lateness_days}d late</Status> : f.state === 'EXECUTED' ? <Status tone="in">On time</Status> : <Status tone="out">{f.state.toLowerCase()}</Status>}</td>
                      <td className="money"><Amount paise={f.amount_paise} direction={f.direction as 'IN' | 'OUT'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section title="History">
            {data.history.length === 0 && <p className="small muted">No payments recorded.</p>}
            <table className="table dense">
              <tbody>
                {data.history.slice(0, 20).map((h) => (
                  <tr key={h.id}>
                    <td className="mono small nowrap">{shortDate(h.date)} {h.date.slice(2, 4)}</td>
                    <td className="small">{h.direction === 'IN' ? 'Received' : 'Paid'} <span className="faint">{h.medium}{h.reference ? ` · ${h.reference.slice(0, 6)}…` : ''}</span></td>
                    <td className="small mono faint">{h.invoice}</td>
                    <td>{h.status === 'PENDING' ? <Status tone="wait">Pending</Status> : h.days_late === null ? null : h.days_late <= 0 ? <Status tone="in">On time</Status> : <Status tone="attn">+{h.days_late}d</Status>}</td>
                    <td className="money"><Amount paise={h.amount_paise} direction={h.direction as 'IN' | 'OUT'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Notes">
            {p.notes.map((n, i) => <p key={i} className="small" style={{ margin: '6px 0' }}>“{n.text}” <span className="faint">({n.by}, {shortDate(n.date)})</span></p>)}
            <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(note.trim(), { onSuccess: () => setNote('') }) }}>
              <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" aria-label="Add a note" />
              <button className="btn btn-secondary" disabled={!note.trim() || addNote.isPending}>Add</button>
            </form>
          </Section>

          <div className="row-wrap" style={{ marginTop: 24 }}>
            {me.user.role !== 'SUPERVISOR' && <DatasheetButton target={{ kind: 'party', id: p.id, name: p.name }} label={`Download ${customer ? 'customer' : 'supplier'} datasheet (CSV)`} className="btn btn-primary" />}
            {me.user.role !== 'SUPERVISOR' && (
              <button className="btn btn-secondary" onClick={() => { ui.selectParty(p.id); ui.setEngineView('network'); ui.openParty(null); navigate('/app/engine') }}>Show in Engine</button>
            )}
            <button className="btn btn-secondary" onClick={() => { ui.askMunim(`Tell me about ${p.name}`, { party_id: p.id }); ui.openParty(null) }}>Ask Munim about {p.name.split(' ')[0]}</button>
          </div>
        </>
      )}
    </Drawer>
  )
}

function signed(n: number | null | undefined) {
  if (n === null || n === undefined) return '·'
  return n > 0 ? `+${n}` : String(n)
}
