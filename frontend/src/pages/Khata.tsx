import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DatasheetButton } from '../components/DatasheetButton'
import { Amount, Dialog, ErrorNote, LastSix, SkeletonRows, Status } from '../components/ui'
import { api, errorText } from '../lib/api'
import { percent, rupees, shortDate } from '../lib/format'
import { useParties, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me, PartyRow } from '../lib/types'
import { parseWhole } from '../lib/validate'

export function Khata({ me }: { me: Me }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER')
  const [adding, setAdding] = useState(false)
  const parties = useParties(tab)
  const ui = useUI()

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="h1">{t('nav.khata')}</h1>
        <span className="spacer" />
        <button className="btn btn-secondary" onClick={() => setAdding(true)}>Add {tab === 'CUSTOMER' ? 'customer' : 'supplier'}</button>
        <button className="btn btn-primary" onClick={() => ui.openPayment({})}>{t('common.recordPayment')}</button>
      </div>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'CUSTOMER'} onClick={() => setTab('CUSTOMER')}>Customers</button>
        <button className="tab" role="tab" aria-selected={tab === 'SUPPLIER'} onClick={() => setTab('SUPPLIER')}>Suppliers</button>
      </div>
      {parties.isLoading && <SkeletonRows rows={8} h={48} />}
      {parties.isError && <ErrorNote text={errorText(parties.error)} retry={() => parties.refetch()} />}
      {parties.data && (tab === 'CUSTOMER'
        ? <Customers rows={parties.data.parties} total={parties.data.total_outstanding_paise} msme={!!me.business.udyam_number} />
        : <Suppliers rows={parties.data.parties} total={parties.data.total_outstanding_paise} />)}
      <AddParty open={adding} kind={tab} onClose={() => setAdding(false)} />
    </div>
  )
}

function Customers({ rows, total, msme }: { rows: PartyRow[]; total: number; msme: boolean }) {
  const ui = useUI()
  return (
    <div className="table-wrap">
      <table className="table tight">
        <thead>
          <tr>
            <th>#</th><th>Customer</th><th className="hide-narrow">Buys</th><th>Terms</th><th className="money money-first">Outstanding</th>
            <th>Oldest due</th><th className="hide-mobile">Pays, avg</th><th className="hide-mobile">Last 6</th>{msme && <th className="hide-mobile">45-day clock</th>}<th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.id} className="clickable" onClick={() => ui.openParty(p.id)}>
              <td className="mono faint">{i + 1}</td>
              <td className="wrap">{p.name}<span className="sub">{p.city}{p.risk_share ? ` · ${percent(p.risk_share)} of risk` : ''}</span></td>
              <td className="small muted hide-narrow">{p.tags.slice(0, 3).join(', ')}</td>
              <td className="small nowrap">{p.terms_days} days</td>
              <td className="money money-first"><Amount paise={p.outstanding_paise} direction="IN" sign={false} /></td>
              <td className="wrap small">
                {p.oldest_due ? <span className="mono">{shortDate(p.oldest_due)}</span> : <span className="faint">·</span>}
                {p.days_overdue > 0 && <span className="sub" style={{ color: 'var(--out)' }}>{p.days_overdue} days late</span>}
              </td>
              <td className="small hide-mobile nowrap" title={p.n_payments ? `Pays ${p.avg_delay_days} days late on average over ${p.n_payments} payments` : 'No payment history'}>
                {p.n_payments ? (p.avg_delay_days! > 0 ? <span className="mono">+{p.avg_delay_days} days</span> : 'on time') : <span className="faint">no history</span>}
              </td>
              <td className="hide-mobile"><LastSix delays={p.last6 ?? []} /></td>
              {msme && (
                <td className="small hide-mobile">
                  {p.msme_clock_days_left === undefined ? <span className="faint">·</span>
                    : p.msme_clock_days_left < 0 ? <Status tone="out">Over 45 days</Status>
                      : <Status tone={p.msme_clock_days_left <= 7 ? 'attn' : 'wait'}>{p.msme_clock_days_left} days left</Status>}
                </td>
              )}
              <td className="right" onClick={(e) => e.stopPropagation()}><div className="row-actions">
                {p.outstanding_paise > 0 && <button className="btn btn-sm btn-secondary" onClick={() => ui.openComposer({ partyId: p.id, intent: 'reminder' })}>Remind</button>}{' '}
                <button className="btn btn-sm btn-quiet" onClick={() => ui.openPayment({ partyId: p.id, direction: 'IN' })}>Record</button>{' '}
                <DatasheetButton compact className="btn btn-sm btn-quiet" label="Download customer datasheet (CSV)" target={{ kind: 'party', id: p.id, name: p.name }} />
              </div></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td /><td className="small muted">Total outstanding</td><td className="hide-narrow" /><td /><td className="money money-first"><span>{rupees(total)}</span></td><td colSpan={msme ? 5 : 4} /></tr>
        </tfoot>
      </table>
    </div>
  )
}

function Suppliers({ rows, total }: { rows: PartyRow[]; total: number }) {
  const ui = useUI()
  const terms = (p: PartyRow) => (p.terms_type === 'ADVANCE' ? 'Advance' : p.terms_type === 'ON_DELIVERY' ? 'On delivery' : `${p.terms_days} days credit`)
  return (
    <div className="table-wrap">
      <table className="table tight">
        <thead>
          <tr><th>#</th><th>Supplier</th><th className="hide-mobile">Supplies</th><th>Terms</th><th className="money money-first">You owe</th><th>Next due</th><th className="hide-mobile">Lead time</th><th className="hide-mobile">MSME status</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.id} className="clickable" onClick={() => ui.openParty(p.id)}>
              <td className="mono faint">{i + 1}</td>
              <td className="wrap">{p.name}<span className="sub">{p.city}</span></td>
              <td className="small muted hide-mobile">{p.tags.slice(0, 3).join(', ')}</td>
              <td className="small">{terms(p)}</td>
              <td className="money money-first"><Amount paise={p.outstanding_paise} direction="OUT" /></td>
              <td className="wrap small">{p.next_due ? <><span className="mono">{shortDate(p.next_due.date)}</span><span className="sub">{rupees(p.next_due.amount_paise)}</span></> : <span className="faint">·</span>}</td>
              <td className="small hide-mobile">{p.lead_time_days} days</td>
              <td className="small wrap hide-mobile">
                {p.msme_category ? (p.msme_category === 'MEDIUM' ? 'Medium' : <>{p.msme_category === 'MICRO' ? 'Micro' : 'Small'}<span className="sub">Pay within 45 days. Late payment delays your tax deduction (43B(h)).</span></>) : <span className="faint">Not registered</span>}
              </td>
              <td className="right" onClick={(e) => e.stopPropagation()}><div className="row-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => ui.openPayment({ partyId: p.id, direction: 'OUT' })}>Pay</button>{' '}
                <DatasheetButton compact className="btn btn-sm btn-quiet" label="Download supplier datasheet (CSV)" target={{ kind: 'party', id: p.id, name: p.name }} />
              </div></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td /><td className="small muted">Total you owe</td><td className="hide-mobile" /><td /><td className="money money-first"><span>{rupees(total)}</span></td><td colSpan={4} /></tr>
        </tfoot>
      </table>
    </div>
  )
}

const EMPTY_PARTY = { name: '', city: '', phone: '', terms_type: 'CREDIT', terms_days: '30', lead_time_days: '0', msme_category: '', tags: '' }

function AddParty({ open, kind, onClose }: { open: boolean; kind: 'CUSTOMER' | 'SUPPLIER'; onClose: () => void }) {
  const [form, setForm] = useState(EMPTY_PARTY)
  const write = useWrite((body: unknown) => api.post('/parties', body))
  const days = parseWhole(form.terms_days, 0, 365, 'Credit days')
  const lead = parseWhole(form.lead_time_days, 0, 365, 'Lead time')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!days.ok || !lead.ok || write.isPending) return
    try {
      await write.mutateAsync({
        kind, name: form.name.trim(), city: form.city.trim() || null, phone: form.phone.trim() || null, terms_type: form.terms_type,
        terms_days: days.value, lead_time_days: lead.value,
        msme_category: form.msme_category || null, tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8) : [],
      })
    } catch {
      return // the error is shown in the dialog; keep what was typed
    }
    setForm(EMPTY_PARTY)
    write.reset()
    onClose()
  }
  const close = () => { setForm(EMPTY_PARTY); write.reset(); onClose() }
  return (
    <Dialog open={open} onClose={close} title={`Add ${kind === 'CUSTOMER' ? 'customer' : 'supplier'}`}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field" style={{ gridColumn: '1 / -1' }}><span className="field-label">Name</span><input className="input" required maxLength={120} value={form.name} onChange={set('name')} /></label>
          <label className="field"><span className="field-label">City</span><input className="input" maxLength={80} value={form.city} onChange={set('city')} /></label>
          <label className="field"><span className="field-label">WhatsApp number</span><input className="input mono" maxLength={24} pattern="[0-9+ ()-]*" value={form.phone} onChange={set('phone')} /></label>
          <label className="field"><span className="field-label">Terms</span>
            <select className="select" value={form.terms_type} onChange={set('terms_type')}>
              <option value="CREDIT">Credit</option>{kind === 'SUPPLIER' && <option value="ADVANCE">Advance</option>}{kind === 'SUPPLIER' && <option value="ON_DELIVERY">On delivery</option>}
            </select>
          </label>
          <label className="field"><span className="field-label">Credit days</span><input className="input mono" inputMode="numeric" aria-invalid={!days.ok} value={form.terms_days} onChange={set('terms_days')} />{!days.ok && <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{days.error}</span>}</label>
          {kind === 'SUPPLIER' && <label className="field"><span className="field-label">Lead time, days</span><input className="input mono" inputMode="numeric" aria-invalid={!lead.ok} value={form.lead_time_days} onChange={set('lead_time_days')} />{!lead.ok && <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{lead.error}</span>}</label>}
          {kind === 'SUPPLIER' && (
            <label className="field"><span className="field-label">MSME category</span>
              <select className="select" value={form.msme_category} onChange={set('msme_category')}><option value="">Not registered</option><option value="MICRO">Micro</option><option value="SMALL">Small</option><option value="MEDIUM">Medium</option></select>
            </label>
          )}
          <label className="field" style={{ gridColumn: '1 / -1' }}><span className="field-label">{kind === 'CUSTOMER' ? 'Buys' : 'Supplies'} (comma separated)</span><input className="input" maxLength={200} value={form.tags} onChange={set('tags')} /></label>
        </div>
        {write.isError && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(write.error)} /></div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
          <button className="btn btn-primary" disabled={write.isPending || !form.name.trim() || !days.ok || !lead.ok}>Add</button>
        </div>
      </form>
    </Dialog>
  )
}
