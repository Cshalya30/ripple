import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Seg, Status } from '../components/ui'
import { api, errorText } from '../lib/api'
import { addDays, dayDate, percent, rupees, shortDate } from '../lib/format'
import { useUI } from '../lib/store'
import type { ChanceAfter, Evaluation, RunPayload } from '../lib/types'
import { parseMoney } from '../lib/validate'
import type { Guard, OptionRow, PaymentCheckResult } from './types'

const TONE = { SAFE: 'in', TIGHT: 'attn', SHORTFALL: 'out', ERROR: 'out' } as const
const WORD = { SAFE: 'Above buffer', TIGHT: 'Under buffer', SHORTFALL: 'Runs short', ERROR: 'Not possible' } as const

/** Shortfall chance for one option, from the risk engine re-run with that option applied. */
function Chance({ option, baseline }: { option: OptionRow; baseline: number | undefined }) {
  const request = option.request
  const query = useQuery({
    queryKey: ['guard-chance', request],
    queryFn: () => api.post<{ chance_after: ChanceAfter }>('/engine/scenario/chance', request),
    enabled: !!request,
    refetchInterval: (q) => (q.state.data && ['COMPUTING', 'MISSING'].includes(q.state.data.chance_after.status) ? 2000 : false),
  })
  if (!request) return <span className="mono">{baseline === undefined ? '…' : percent(baseline)}</span>
  const status = query.data?.chance_after
  if (status?.status === 'READY' && status.shortfall_chance) return <span className="mono">{percent(status.shortfall_chance['30'])}</span>
  if (status && ['INSUFFICIENT_HISTORY', 'UNAVAILABLE'].includes(status.status)) return <span className="faint small">n/a</span>
  return <span className="faint small">calculating</span>
}

export function PaymentCheck({ guard }: { guard: Guard }) {
  const ui = useUI()
  const navigate = useNavigate()
  const bills = guard.risk.payments
  const [mode, setMode] = useState<'bill' | 'new'>(bills.length ? 'bill' : 'new')
  const [eventId, setEventId] = useState(bills[0]?.event_id ?? '')
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const first = guard.as_of
  const last = addDays(first, Math.max(0, guard.risk.series.length - 1))
  const [date, setDate] = useState(addDays(first, 7))
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [result, setResult] = useState<PaymentCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const baseChance = guard.risk.shortfall_chance?.['30']

  const check = async () => {
    setError(null)
    let body: Record<string, unknown>
    if (mode === 'bill') {
      if (!eventId) return setError('Pick a bill to check.')
      body = { event_id: eventId }
    } else {
      const parsed = parseMoney(amount, { label: 'Amount', max: 100_000_000_000 })
      if (!parsed.ok) return setError(parsed.error)
      if (!date || date < first || date > last) return setError(`Pick a date between ${shortDate(first)} and ${shortDate(last)}.`)
      body = { amount_paise: parsed.value, date, label: label.trim() || undefined }
    }
    setBusy(true)
    try {
      setResult(await api.post<PaymentCheckResult>('/guard/payment-check', body))
    } catch (e) {
      setResult(null)
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const open = async (option: OptionRow) => {
    if (!option.request) return
    setOpening(option.id)
    try {
      const res = await api.post<{ key: string; evaluation: Evaluation; run: RunPayload; chance_after?: ChanceAfter }>('/engine/scenario', option.request)
      ui.setPlaying(false)
      ui.setScenario({ key: res.key, label: `${result?.subject}: ${option.title}`, evaluation: res.evaluation, run: res.run, chance: res.chance_after, request: option.request })
      ui.setDiff(true)
      ui.setEngineView('flow')
      ui.setDay(res.evaluation.first_shortfall_after?.day ?? option.near_low_day ?? 0)
      navigate('/app/engine')
    } catch (e) {
      ui.toast(errorText(e))
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="pcheck">
      <div className="row-wrap" style={{ marginBottom: 10 }}>
        <Seg label="What are you checking" value={mode} onChange={(v) => { setMode(v); setResult(null); setError(null) }}
          options={[{ value: 'bill', label: 'A bill I owe' }, { value: 'new', label: 'A new payment' }]} />
      </div>
      <form className="pcheck-form" onSubmit={(e) => { e.preventDefault(); void check() }}>
        {mode === 'bill' ? (
          <label className="field grow">
            <span className="label">Bill</span>
            {bills.length ? (
              <select className="select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                {bills.map((b) => <option key={b.event_id} value={b.event_id}>{b.party_name} · {rupees(b.amount_paise)} · {shortDate(b.due_date)}</option>)}
              </select>
            ) : <span className="muted small">No bill falls due in the next 45 days.</span>}
          </label>
        ) : (
          <>
            <label className="field"><span className="label">Amount (₹)</span>
              <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150000" aria-label="Amount in rupees" /></label>
            <label className="field"><span className="label">Pay on</span>
              <input className="input" type="date" min={first} max={last} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="field grow"><span className="label">For (optional)</span>
              <input className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="New loom, repairs, advance…" /></label>
          </>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || (mode === 'bill' && !bills.length)}>{busy ? 'Running the engine…' : 'Check it'}</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {result && (
        <div className="pcheck-result">
          <p className="pcheck-reco"><strong>{result.subject}.</strong> {result.recommendation}</p>
          <div className="table-wrap">
            <table className="table tight">
              <thead>
                <tr><th>Option</th><th className="money">Lowest, next {result.window_days} days</th><th>Against your buffer</th><th className="money">Shortfall chance, 30d</th><th /></tr>
              </thead>
              <tbody>
                {result.options.map((o) => (
                  <tr key={o.id} className={o.id === result.best ? 'best' : undefined}>
                    <td className="wrap">{o.title}{o.id === result.best && <span className="chip-best">Best</span>}<span className="sub">{o.summary}</span></td>
                    <td className="money">
                      {o.near_low_paise !== undefined ? <>{rupees(o.near_low_paise, { sign: true })}<span className="sub">{shortDate(o.near_low_date)}{o.near_change_paise ? ` · ${rupees(o.near_change_paise, { sign: true })}` : ''}</span></> : '·'}
                    </td>
                    <td><Status tone={TONE[o.verdict]}>{WORD[o.verdict]}</Status>
                      {o.first_shortfall && <span className="sub">{o.shortfall_unchanged ? 'later dip unchanged' : 'later dip changes'}: {dayDate(o.first_shortfall.date)}</span>}</td>
                    <td className="money"><Chance option={o} baseline={baseChance} /></td>
                    <td className="right">{o.request && <button className="btn btn-sm btn-secondary" disabled={opening !== null} onClick={() => void open(o)}>{opening === o.id ? 'Opening' : 'Show in Engine'}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro faint">The engine is re-run for each option, so every figure is calculated, not estimated. Shortfall chance re-runs the simulated futures with the option applied. Nothing is recorded until you record the payment yourself.</p>
        </div>
      )}
    </div>
  )
}
