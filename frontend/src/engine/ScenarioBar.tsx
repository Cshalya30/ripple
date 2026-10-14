import { useEffect, useMemo, useState } from 'react'
import { api, errorText } from '../lib/api'
import { addDays, rupees } from '../lib/format'
import { useUI } from '../lib/store'
import type { Evaluation, RunPayload } from '../lib/types'
import { ErrorNote } from '../components/ui'

type Kind = 'MOVE_RECEIPT_DATE' | 'DELAY_ARRIVAL' | 'SPLIT_CUSTOMER_COLLECTION' | 'SPLIT_SUPPLIER_PAYMENT' | 'ADD_CREDIT_BRIDGE'

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'MOVE_RECEIPT_DATE', label: 'A customer pays later or earlier' },
  { kind: 'DELAY_ARRIVAL', label: 'Material arrives late' },
  { kind: 'SPLIT_CUSTOMER_COLLECTION', label: 'Ask a customer for a deposit' },
  { kind: 'SPLIT_SUPPLIER_PAYMENT', label: 'Pay a supplier in parts' },
  { kind: 'ADD_CREDIT_BRIDGE', label: 'Borrow to bridge' },
]

export function ScenarioBar({ run, facilities }: { run: RunPayload; facilities: { id: string; label: string }[] }) {
  const ui = useUI()
  const selected = ui.selectedEventId ? run.events.find((e) => e.id === ui.selectedEventId) : undefined
  const initialKind: Kind = selected?.type === 'SUPPLIER_PAYMENT' ? 'SPLIT_SUPPLIER_PAYMENT' : selected?.type === 'INVENTORY_ARRIVAL' ? 'DELAY_ARRIVAL' : 'MOVE_RECEIPT_DATE'
  const [kind, setKind] = useState<Kind>(initialKind)
  const [eventId, setEventId] = useState(selected?.id ?? '')
  const [date, setDate] = useState('')
  const [days, setDays] = useState('7')
  const [amount, setAmount] = useState('')
  const [facility, setFacility] = useState(facilities[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const options = useMemo(() => {
    const type = kind === 'MOVE_RECEIPT_DATE' || kind === 'SPLIT_CUSTOMER_COLLECTION' ? 'CASH_RECEIPT' : kind === 'DELAY_ARRIVAL' ? 'INVENTORY_ARRIVAL' : 'SUPPLIER_PAYMENT'
    return run.events.filter((e) => e.type === type)
  }, [kind, run.events])

  useEffect(() => {
    if (!options.some((o) => o.id === eventId)) setEventId(options[0]?.id ?? '')
  }, [options, eventId])

  const target = run.events.find((e) => e.id === eventId)
  useEffect(() => {
    if (!target) return
    if (kind === 'MOVE_RECEIPT_DATE') setDate(addDays(run.as_of, Math.max(1, Math.min(run.horizon_days - 1, (target.executed_day ?? 10) - 14))))
    if (kind === 'SPLIT_CUSTOMER_COLLECTION') { setDate(addDays(run.as_of, 5)); setAmount(String(Math.round((target.amount_paise ?? 0) * 0.3 / 100))) }
    if (kind === 'SPLIT_SUPPLIER_PAYMENT') { setAmount(String(Math.round((target.amount_paise ?? 0) / 2 / 100))); setDays('14') }
    if (kind === 'DELAY_ARRIVAL') setDays('7')
  }, [eventId, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (kind === 'ADD_CREDIT_BRIDGE') {
      const s = run.summary.first_shortfall
      setDate(addDays(run.as_of, Math.max(0, (s?.day ?? 1) - 1)))
      setAmount(String(Math.ceil(((s?.shortfall_paise ?? 0) + run.summary.buffer_paise) / 1_000_000) * 10_000))
    }
  }, [kind, run])

  const run_ = async () => {
    setBusy(true)
    setError(null)
    const paise = Math.round(Number(amount.replace(/,/g, '')) * 100)
    const body: Record<string, unknown> = { kind }
    if (kind !== 'ADD_CREDIT_BRIDGE') body.event_id = eventId
    if (kind === 'MOVE_RECEIPT_DATE') body.date = date
    if (kind === 'DELAY_ARRIVAL') body.days = Number(days)
    if (kind === 'SPLIT_CUSTOMER_COLLECTION') Object.assign(body, { amount_paise: paise, date })
    if (kind === 'SPLIT_SUPPLIER_PAYMENT') Object.assign(body, { amount_paise: paise, days: Number(days) })
    if (kind === 'ADD_CREDIT_BRIDGE') Object.assign(body, { facility_id: facility, amount_paise: paise, date })
    try {
      const res = await api.post<{ key: string; evaluation: Evaluation; run: RunPayload }>('/engine/scenario', body)
      const label = describe(kind, target?.label, { date, days, amount: paise })
      ui.setScenario({ key: res.key, label, evaluation: res.evaluation, run: res.run })
      ui.setDiff(true)
      ui.setEngineView('flow')
      ui.setScenarioBarOpen(false)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--rule)', background: 'var(--surface)' }}>
      <div className="row-wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field" style={{ minWidth: 220 }}>
          <span className="field-label">What if</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
        </label>
        {kind !== 'ADD_CREDIT_BRIDGE' && (
          <label className="field" style={{ minWidth: 240, flex: 1 }}>
            <span className="field-label">Which</span>
            <select className="select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.amount_paise ? ` · ${rupees(o.amount_paise)}` : ''}</option>)}
            </select>
          </label>
        )}
        {kind === 'ADD_CREDIT_BRIDGE' && (
          <label className="field" style={{ minWidth: 220 }}>
            <span className="field-label">Approved facility</span>
            <select className="select" value={facility} onChange={(e) => setFacility(e.target.value)}>
              {facilities.length === 0 && <option value="">No approved facility in Settings</option>}
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        )}
        {(kind === 'MOVE_RECEIPT_DATE' || kind === 'SPLIT_CUSTOMER_COLLECTION' || kind === 'ADD_CREDIT_BRIDGE') && (
          <label className="field"><span className="field-label">{kind === 'MOVE_RECEIPT_DATE' ? 'Pays on' : kind === 'ADD_CREDIT_BRIDGE' ? 'Draw on' : 'Deposit by'}</span>
            <input className="input mono" type="date" value={date} min={run.as_of} max={addDays(run.as_of, run.horizon_days - 1)} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {(kind === 'DELAY_ARRIVAL' || kind === 'SPLIT_SUPPLIER_PAYMENT') && (
          <label className="field" style={{ width: 120 }}><span className="field-label">{kind === 'DELAY_ARRIVAL' ? 'Days late' : 'Second part after (days)'}</span>
            <input className="input mono" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        )}
        {(kind === 'SPLIT_CUSTOMER_COLLECTION' || kind === 'SPLIT_SUPPLIER_PAYMENT' || kind === 'ADD_CREDIT_BRIDGE') && (
          <label className="field" style={{ width: 160 }}><span className="field-label">{kind === 'SPLIT_SUPPLIER_PAYMENT' ? 'First part, ₹' : kind === 'ADD_CREDIT_BRIDGE' ? 'Borrow, ₹' : 'Deposit, ₹'}</span>
            <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        <button className="btn btn-primary" onClick={run_} disabled={busy || (kind !== 'ADD_CREDIT_BRIDGE' && !eventId)}>{busy ? 'Running engine' : 'Run scenario'}</button>
        <button className="btn btn-quiet" onClick={() => ui.setScenarioBarOpen(false)}>Close</button>
      </div>
      {error !== null && <div style={{ marginTop: 8 }}><ErrorNote text={errorText(error)} /></div>}
    </div>
  )
}

function describe(kind: Kind, label: string | undefined, v: { date: string; days: string; amount: number }) {
  const who = label ?? ''
  switch (kind) {
    case 'MOVE_RECEIPT_DATE': return `${who.replace(' pays ', ' pays ')} on ${v.date}`
    case 'DELAY_ARRIVAL': return `${who}, ${v.days} days late`
    case 'SPLIT_CUSTOMER_COLLECTION': return `deposit ${rupees(v.amount)} on ${who}`
    case 'SPLIT_SUPPLIER_PAYMENT': return `${who} in two parts`
    case 'ADD_CREDIT_BRIDGE': return `borrow ${rupees(v.amount)} on ${v.date}`
  }
}
