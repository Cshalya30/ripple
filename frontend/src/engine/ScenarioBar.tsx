import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote } from '../components/ui'
import { api, errorText } from '../lib/api'
import { addDays, dayDate, rupees } from '../lib/format'
import { useUI } from '../lib/store'
import type { ChanceAfter, Evaluation, RunPayload } from '../lib/types'
import { parseMoney, parseWhole } from '../lib/validate'

type Kind = 'MOVE_RECEIPT_DATE' | 'DELAY_ARRIVAL' | 'SPLIT_CUSTOMER_COLLECTION' | 'SPLIT_SUPPLIER_PAYMENT' | 'EXTENSION' | 'ADD_CREDIT_BRIDGE'

const KINDS: { kind: Kind; label: string; help: string; type: string | null }[] = [
  { kind: 'MOVE_RECEIPT_DATE', label: 'A customer pays later or earlier', help: 'Pick the payment and the day it really arrives.', type: 'CASH_RECEIPT' },
  { kind: 'SPLIT_CUSTOMER_COLLECTION', label: 'Ask a customer for a deposit', help: 'Part of a payment comes sooner as a deposit.', type: 'CASH_RECEIPT' },
  { kind: 'DELAY_ARRIVAL', label: 'Material arrives late', help: 'A delivery slips by some days.', type: 'INVENTORY_ARRIVAL' },
  { kind: 'SPLIT_SUPPLIER_PAYMENT', label: 'Pay a supplier in parts', help: 'Pay part now and the rest later.', type: 'SUPPLIER_PAYMENT' },
  { kind: 'EXTENSION', label: 'A supplier gives more time to pay', help: 'The due date moves out by some days.', type: 'SUPPLIER_PAYMENT' },
  { kind: 'ADD_CREDIT_BRIDGE', label: 'Borrow to bridge', help: 'Draw on an approved facility on a chosen day.', type: null },
]

export interface ScenarioStarted { key: string; evaluation: Evaluation; run: RunPayload; chance_after?: ChanceAfter }

export function ScenarioBar({ run, facilities }: { run: RunPayload; facilities: { id: string; label: string }[] }) {
  const ui = useUI()
  const selected = ui.selectedEventId ? run.events.find((e) => e.id === ui.selectedEventId) : undefined
  const kindFor = (type?: string): Kind => (type === 'SUPPLIER_PAYMENT' ? 'SPLIT_SUPPLIER_PAYMENT' : type === 'INVENTORY_ARRIVAL' ? 'DELAY_ARRIVAL' : 'MOVE_RECEIPT_DATE')
  const [kind, setKind] = useState<Kind>(kindFor(selected?.type))
  const [eventId, setEventId] = useState(selected?.id ?? '')
  const [date, setDate] = useState('')
  const [days, setDays] = useState('7')
  const [amount, setAmount] = useState('')
  const [facility, setFacility] = useState(facilities[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const meta = KINDS.find((k) => k.kind === kind)!

  const options = useMemo(() => (meta.type ? run.events.filter((e) => e.type === meta.type) : []), [meta.type, run.events])

  // Clicking an event in the flow while this form is open points the form at it.
  useEffect(() => {
    if (!selected) return
    if (['CASH_RECEIPT', 'SUPPLIER_PAYMENT', 'INVENTORY_ARRIVAL'].includes(selected.type)) {
      if (!options.some((o) => o.id === selected.id)) setKind(kindFor(selected.type))
      setEventId(selected.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  useEffect(() => {
    if (kind !== 'ADD_CREDIT_BRIDGE' && !options.some((o) => o.id === eventId)) setEventId(options[0]?.id ?? '')
  }, [options, eventId, kind])

  const target = run.events.find((e) => e.id === eventId)
  const lastDate = addDays(run.as_of, run.horizon_days - 1)

  // Sensible starting values each time the choice changes.
  useEffect(() => {
    if (!target) return
    if (kind === 'MOVE_RECEIPT_DATE') setDate(addDays(run.as_of, Math.max(1, Math.min(run.horizon_days - 1, (target.executed_day ?? 10) - 14))))
    if (kind === 'SPLIT_CUSTOMER_COLLECTION') { setDate(addDays(run.as_of, 5)); setAmount(String(Math.round((target.amount_paise ?? 0) * 0.3 / 100))) }
    if (kind === 'SPLIT_SUPPLIER_PAYMENT') { setAmount(String(Math.round((target.amount_paise ?? 0) / 2 / 100))); setDays('14') }
    if (kind === 'DELAY_ARRIVAL') setDays('7')
    if (kind === 'EXTENSION') setDays('14')
    setTouched(false); setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, kind])

  useEffect(() => {
    if (kind === 'ADD_CREDIT_BRIDGE') {
      const s = run.summary.first_shortfall
      setDate(addDays(run.as_of, Math.max(0, (s?.day ?? 1) - 1)))
      setAmount(String(Math.ceil(((s?.shortfall_paise ?? 0) + run.summary.buffer_paise) / 1_000_000) * 10_000))
    }
  }, [kind, run])

  const money = parseMoney(amount, { label: kind === 'SPLIT_SUPPLIER_PAYMENT' ? 'First part' : kind === 'ADD_CREDIT_BRIDGE' ? 'Amount to borrow' : 'Deposit', max: 10 ** 12 })
  const dayCount = parseWhole(days, 1, 365, kind === 'DELAY_ARRIVAL' ? 'Days late' : kind === 'EXTENSION' ? 'Extra days' : 'Days until the second part')
  const needsDate = kind === 'MOVE_RECEIPT_DATE' || kind === 'SPLIT_CUSTOMER_COLLECTION' || kind === 'ADD_CREDIT_BRIDGE'
  const needsDays = kind === 'DELAY_ARRIVAL' || kind === 'SPLIT_SUPPLIER_PAYMENT' || kind === 'EXTENSION'
  const needsAmount = kind === 'SPLIT_CUSTOMER_COLLECTION' || kind === 'SPLIT_SUPPLIER_PAYMENT' || kind === 'ADD_CREDIT_BRIDGE'

  const problem = (() => {
    if (kind !== 'ADD_CREDIT_BRIDGE' && !target) return 'Nothing of this kind is in the forecast to change.'
    if (kind === 'ADD_CREDIT_BRIDGE' && !facility) return 'Add an approved credit facility in Settings first.'
    if (needsDate && (!date || date < run.as_of || date > lastDate)) return `Pick a day between ${dayDate(run.as_of)} and ${dayDate(lastDate)}.`
    if (needsAmount && !money.ok) return money.error
    if (needsAmount && money.ok && kind !== 'ADD_CREDIT_BRIDGE' && target?.amount_paise && money.value >= target.amount_paise) return `Choose less than the full ${rupees(target.amount_paise)}.`
    if (needsDays && !dayCount.ok) return dayCount.error
    return null
  })()

  const start = async () => {
    setTouched(true)
    if (problem) return
    setBusy(true)
    setError(null)
    const paise = money.ok ? money.value : 0
    const body: Record<string, unknown> = { kind }
    if (kind !== 'ADD_CREDIT_BRIDGE') body.event_id = eventId
    if (kind === 'MOVE_RECEIPT_DATE') body.date = date
    if (kind === 'DELAY_ARRIVAL' || kind === 'EXTENSION') body.days = Number(days)
    if (kind === 'SPLIT_CUSTOMER_COLLECTION') Object.assign(body, { amount_paise: paise, date })
    if (kind === 'SPLIT_SUPPLIER_PAYMENT') Object.assign(body, { amount_paise: paise, days: Number(days) })
    if (kind === 'ADD_CREDIT_BRIDGE') Object.assign(body, { facility_id: facility, amount_paise: paise, date })
    try {
      const res = await api.post<ScenarioStarted>('/engine/scenario', body)
      const label = describe(kind, target?.label, { date, days, amount: paise })
      ui.setPlaying(false)
      ui.setScenario({ key: res.key, label, evaluation: res.evaluation, run: res.run, chance: res.chance_after, request: body })
      ui.setDiff(true)
      ui.setEngineView('flow')
      ui.setTableView(false)
      // Open on the first thing that changed, so the effect is the first thing seen.
      const moved = res.evaluation.changed_events.map((c) => res.run.events.find((e) => e.id === c.event_id)?.executed_day).filter((d): d is number => d !== null && d !== undefined)
      if (moved.length) ui.setDay(Math.min(...moved))
      ui.setScenarioBarOpen(false)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const showError = (message: string | null) => (touched && message ? <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{message}</span> : null)

  return (
    <form className="scenario-form" onSubmit={(e) => { e.preventDefault(); void start() }} noValidate>
      <div className="row-wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field" style={{ minWidth: 230 }}>
          <span className="field-label">What if</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
        </label>
        {kind !== 'ADD_CREDIT_BRIDGE' && (
          <label className="field" style={{ minWidth: 240, flex: 1 }}>
            <span className="field-label">Which</span>
            <select className="select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {options.length === 0 && <option value="">Nothing to change</option>}
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.amount_paise ? ` · ${rupees(o.amount_paise)}` : ''}</option>)}
            </select>
          </label>
        )}
        {kind === 'ADD_CREDIT_BRIDGE' && (
          <label className="field" style={{ minWidth: 220 }}>
            <span className="field-label">Approved facility</span>
            <select className="select" value={facility} onChange={(e) => setFacility(e.target.value)}>
              {facilities.length === 0 && <option value="">No approved facility yet</option>}
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        )}
        {needsDate && (
          <label className="field"><span className="field-label">{kind === 'MOVE_RECEIPT_DATE' ? 'Pays on' : kind === 'ADD_CREDIT_BRIDGE' ? 'Draw on' : 'Deposit by'}</span>
            <input className="input mono" type="date" value={date} min={run.as_of} max={lastDate} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {needsDays && (
          <label className="field" style={{ width: 130 }}><span className="field-label">{kind === 'DELAY_ARRIVAL' ? 'Days late' : kind === 'EXTENSION' ? 'Extra days' : 'Second part after (days)'}</span>
            <input className="input mono" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={touched && !dayCount.ok} />
          </label>
        )}
        {needsAmount && (
          <label className="field" style={{ width: 160 }}><span className="field-label">{kind === 'SPLIT_SUPPLIER_PAYMENT' ? 'First part, ₹' : kind === 'ADD_CREDIT_BRIDGE' ? 'Borrow, ₹' : 'Deposit, ₹'}</span>
            <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={touched && !money.ok} />
          </label>
        )}
        <button className="btn btn-primary" disabled={busy || (kind === 'ADD_CREDIT_BRIDGE' && !facility)}>{busy ? 'Running the engine' : 'Run scenario'}</button>
        <button type="button" className="btn btn-quiet" onClick={() => ui.setScenarioBarOpen(false)}>Close</button>
      </div>
      <div className="micro faint" style={{ marginTop: 6 }}>
        {meta.help}
        {target && kind !== 'ADD_CREDIT_BRIDGE' && <> Now the engine has it on <span className="mono">D{target.executed_day ?? '·'}</span>{target.due_day !== null && target.executed_day !== null && target.due_day !== target.executed_day ? <>, due <span className="mono">D{target.due_day}</span></> : null}{target.executed_date ? <> ({dayDate(target.executed_date)})</> : null}.</>}
        {kind === 'ADD_CREDIT_BRIDGE' && facilities.length === 0 && <> <Link to="/app/settings">Add one in Settings</Link>.</>}
      </div>
      {showError(problem)}
      {error !== null && <div style={{ marginTop: 8 }}><ErrorNote text={errorText(error)} /></div>}
    </form>
  )
}

function describe(kind: Kind, label: string | undefined, v: { date: string; days: string; amount: number }) {
  const who = label ?? 'This payment'
  switch (kind) {
    case 'MOVE_RECEIPT_DATE': return `${who}, paid on ${dayDate(v.date)}`
    case 'DELAY_ARRIVAL': return `${who}, ${v.days} days late`
    case 'SPLIT_CUSTOMER_COLLECTION': return `${rupees(v.amount)} deposit on ${who}`
    case 'SPLIT_SUPPLIER_PAYMENT': return `${who} in two parts`
    case 'EXTENSION': return `${who}, ${v.days} more days to pay`
    case 'ADD_CREDIT_BRIDGE': return `Borrow ${rupees(v.amount)} on ${dayDate(v.date)}`
  }
}
