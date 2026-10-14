import { useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { rupees } from '../lib/format'
import { useMe, useParties, useParty, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import { Dialog, ErrorNote } from './ui'

const MEDIUMS = ['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE'] as const

/** Record payment (PRD 8.5). Amount typed in rupees, sent as integer paise. */
export function PaymentDialog() {
  const state = useUI((s) => s.payment)
  const close = useUI((s) => s.openPayment)
  const toast = useUI((s) => s.toast)
  const me = useMe().data
  const customers = useParties('CUSTOMER', !!state)
  const suppliers = useParties('SUPPLIER', !!state)
  const [partyId, setPartyId] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [medium, setMedium] = useState<(typeof MEDIUMS)[number]>('UPI')
  const [reference, setReference] = useState('')
  const party = useParty(partyId || null)

  useEffect(() => {
    if (!state) return
    setPartyId(state.partyId ?? '')
    setInvoiceId(state.invoiceId ?? '')
    setAmount(state.amountPaise ? String(state.amountPaise / 100) : '')
    setDate(me?.today ?? '')
    setMedium('UPI')
    setReference('')
  }, [state, me?.today])

  useEffect(() => {
    if (!state?.invoiceId && party.data && !invoiceId && party.data.open_items.length) {
      const first = party.data.open_items[0]
      setInvoiceId(first.id)
      if (!amount) setAmount(String(first.amount_paise / 100))
    }
  }, [party.data, state?.invoiceId, invoiceId, amount])

  const write = useWrite((body: unknown) => api.post<{ summary: any }>('/transactions', body))
  if (!state) return null

  const all = [...(customers.data?.parties ?? []), ...(suppliers.data?.parties ?? [])]
  const selected = all.find((p) => p.id === partyId)
  const direction = selected?.kind === 'SUPPLIER' ? 'OUT' : 'IN'
  const paise = Math.round(Number(amount.replace(/,/g, '')) * 100)
  const valid = !!selected && Number.isFinite(paise) && paise > 0 && !!date
  const item = party.data?.open_items.find((i) => i.id === invoiceId)

  const submit = async () => {
    try {
      const result = await write.mutateAsync({
        party_id: partyId, direction, amount_paise: paise, date, medium, reference: reference || null, invoice_id: invoiceId || null,
      })
      const s = result.summary
      toast(medium === 'CHEQUE'
        ? `Cheque recorded as pending. It counts as cash once you mark it cleared.`
        : `Payment recorded. Forecast recalculated: ${s.first_shortfall ? `first shortfall ${s.first_shortfall.date}` : 'no shortfall in the forecast'}.`)
      close(null)
    } catch {
      /* shown below */
    }
  }

  return (
    <Dialog open onClose={() => close(null)} title="Record payment" description="Saving recalculates the forecast. Cheques stay out of cash until marked cleared.">
      <div className="form-grid">
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span className="field-label">Party</span>
          <select className="select" value={partyId} onChange={(e) => { setPartyId(e.target.value); setInvoiceId(''); setAmount('') }}>
            <option value="">Choose a customer or supplier</option>
            <optgroup label="Customers (money in)">{customers.data?.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
            <optgroup label="Suppliers (money out)">{suppliers.data?.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          </select>
        </label>
        {party.data && party.data.open_items.length > 0 && (
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">Against</span>
            <select className="select" value={invoiceId} onChange={(e) => {
              setInvoiceId(e.target.value)
              const it = party.data!.open_items.find((i) => i.id === e.target.value)
              if (it) setAmount(String(it.amount_paise / 100))
            }}>
              <option value="">No specific bill</option>
              {party.data.open_items.map((i) => <option key={i.id} value={i.id}>{i.number} · {rupees(i.amount_paise)} outstanding · due {i.due_date}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Amount in rupees ({direction === 'IN' ? 'money in' : 'money out'})</span>
          <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="145000" />
          {item && paise > item.amount_paise && <span className="error-text">More than the {rupees(item.amount_paise)} outstanding.</span>}
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input className="input mono" type="date" value={date} max={me?.today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Medium</span>
          <select className="select" value={medium} onChange={(e) => setMedium(e.target.value as (typeof MEDIUMS)[number])}>
            {MEDIUMS.map((m) => <option key={m} value={m}>{m === 'CASH' ? 'Cash' : m === 'CHEQUE' ? 'Cheque' : m}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{medium === 'CHEQUE' ? 'Cheque number' : 'UTR or reference'}</span>
          <input className="input mono" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      {write.isError && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(write.error)} /></div>}
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={() => close(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid || write.isPending} onClick={submit}>{write.isPending ? 'Saving' : 'Save and recalculate'}</button>
      </div>
    </Dialog>
  )
}
