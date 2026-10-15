import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Amount, Status } from '../components/ui'
import { api, errorText } from '../lib/api'
import { clock, dayDate, percent, rupees, shortDate } from '../lib/format'
import { useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Flag, Guard, LadderRow, PaymentRow, Signal } from './types'

// ------------------------------------------------------------------ risk

/** How much can leave today and still keep every day up to D above the buffer. */
export function SafeLadder({ rows, hasRisk }: { rows: LadderRow[]; hasRisk: boolean }) {
  const top = Math.max(1, ...rows.map((r) => r.plan_paise))
  return (
    <div className="ladder">
      {rows.map((r) => {
        const cautious = r.cautious_paise
        return (
          <div className="ladder-row" key={r.days}>
            <span className="ladder-days mono">{r.days}d</span>
            <div className="ladder-bars" aria-hidden="true">
              <div className="ladder-plan" style={{ width: `${(r.plan_paise / top) * 100}%` }} />
              {cautious !== null && <div className="ladder-cautious" style={{ width: `${(cautious / top) * 100}%` }} />}
            </div>
            <span className="ladder-fig">
              <strong className="mono">{rupees(cautious ?? r.plan_paise)}</strong>
              {cautious !== null && cautious !== r.plan_paise && <span className="faint small"> plan {rupees(r.plan_paise)}</span>}
              {r.plan_paise === 0 && <span className="faint small"> tightest day {shortDate(r.binding_date)}</span>}
            </span>
          </div>
        )
      })}
      <p className="micro faint">
        Safe to spend today, with your buffer kept on every day up to each date. {hasRisk ? 'The solid bar is the amount that survives the 1-in-10 worse future; the faint bar is the plan alone.' : 'Risk is still running; this is the plan alone for now.'}
      </p>
    </div>
  )
}

const PAY_TONE = { OK: 'in', TIGHT: 'attn', LATE: 'out', BLOCKED: 'out' } as const

export function UpcomingPayments({ rows }: { rows: PaymentRow[] }) {
  const ui = useUI()
  if (!rows.length) return <p className="muted">No supplier payment falls due in the next 45 days.</p>
  return (
    <ol className="plain-list">
      {rows.map((p) => (
        <li key={p.event_id} className="list-row">
          <div className="grow">
            <div>{p.party_name} <span className="faint small">{p.detail}</span></div>
            <span className="sub">{dayDate(p.due_date)} · {p.message}</span>
          </div>
          <Amount paise={p.amount_paise} direction="OUT" />
          <Status tone={PAY_TONE[p.verdict]}>{p.verdict === 'OK' ? 'Fine' : p.verdict === 'TIGHT' ? 'Tight' : p.verdict === 'LATE' ? 'Late' : 'Blocked'}</Status>
          {p.invoice_id && p.party_id && (
            <button className="btn btn-sm btn-secondary" onClick={() => ui.openPayment({ partyId: p.party_id!, invoiceId: p.invoice_id!, amountPaise: p.amount_paise, direction: 'OUT' })}>Mark paid</button>
          )}
        </li>
      ))}
    </ol>
  )
}

export function Signals({ rows }: { rows: Signal[] }) {
  if (!rows.length) return <p className="muted">Nothing else stands out: no concentration, overdue pile-up, stock gap or 45-day clock.</p>
  return (
    <ul className="plain-list">
      {rows.map((s) => (
        <li key={s.id} className="list-row">
          <span className={`dot ${s.severity}`} aria-hidden="true" />
          <div className="grow"><div>{s.title}</div><span className="sub">{s.detail}</span></div>
          <Status tone={s.severity === 'out' ? 'out' : s.severity === 'attention' ? 'attn' : 'in'}>{s.severity === 'out' ? 'Act' : s.severity === 'attention' ? 'Watch' : 'OK'}</Status>
          <Link className="btn btn-sm btn-quiet" to={s.link}>Open</Link>
        </li>
      ))}
    </ul>
  )
}

export function Drivers({ guard }: { guard: Guard }) {
  const rows = guard.risk.drivers
  if (!rows.length) return null
  return (
    <div className="drivers">
      <div className="label">Who moves the risk most</div>
      {rows.map((d) => (
        <div key={d.party_id} style={{ margin: '6px 0' }}>
          <div className="row small"><span className="grow">{d.name}{d.no_history ? <span className="faint"> · no history</span> : ''}</span><span className="mono">{percent(d.share)}</span></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round(d.share * 100)}%`, background: d.share > 0.5 ? 'var(--haldi)' : 'var(--text-2)' }} /></div>
        </div>
      ))}
      <p className="micro faint">Share of the expected shortfall that disappears if only that customer paid on terms.</p>
    </div>
  )
}

// ------------------------------------------------------------------ finance

const SEV = { high: 'out', medium: 'attn', low: 'wait' } as const

function FlagCard({ flag, onReview, busy }: { flag: Flag; onReview: (verdict: 'CONFIRMED' | 'DISMISSED' | 'OPEN') => void; busy: boolean }) {
  return (
    <li className={`flag sev-${flag.severity}`}>
      <div className="flag-head">
        <Status tone={SEV[flag.severity]}>{flag.rule_label}</Status>
        <span className="faint small">{flag.confidence} confidence{flag.date ? ` · ${shortDate(flag.date)}` : ''}</span>
      </div>
      <div className="flag-title">{flag.title}</div>
      <div className="sub">{flag.detail}</div>
      <div className="row-actions flag-actions">
        {flag.status === 'OPEN' ? (
          <>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onReview('DISMISSED')} title="Not a problem: hide it and teach the check">Looks fine</button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onReview('CONFIRMED')} title="A real problem: keep it on the list">It's real</button>
          </>
        ) : (
          <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => onReview('OPEN')}>Reopen</button>
        )}
        <Link className="btn btn-sm btn-quiet" to={flag.link}>Open</Link>
      </div>
    </li>
  )
}

export function Flags({ guard }: { guard: Guard }) {
  const ui = useUI()
  const data = guard.finance.flags
  const review = useWrite((b: { key: string; verdict: 'CONFIRMED' | 'DISMISSED' | 'OPEN' }) => api.post('/guard/flags/review', { flag_key: b.key, verdict: b.verdict }))
  const missed = useWrite((b: { rule: string; note: string }) => api.post('/guard/missed', b))
  const [rule, setRule] = useState('DUPLICATE')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const act = (key: string) => (verdict: 'CONFIRMED' | 'DISMISSED' | 'OPEN') =>
    review.mutate({ key, verdict }, { onSuccess: () => ui.toast(verdict === 'DISMISSED' ? 'Hidden. The check will learn from this.' : verdict === 'CONFIRMED' ? 'Kept on the list.' : 'Reopened.'), onError: (e) => ui.toast(errorText(e)) })
  const send = () => {
    if (note.trim().length < 3) return setNoteError('Say what it missed, in a few words.')
    setNoteError(null)
    missed.mutate({ rule, note: note.trim() }, { onSuccess: () => { setNote(''); ui.toast('Logged. The tally below counts it as missed.') }, onError: (e) => ui.toast(errorText(e)) })
  }
  return (
    <div>
      {data.open.length ? (
        <ul className="plain-list flags">{data.open.map((f) => <FlagCard key={f.key} flag={f} busy={review.isPending} onReview={act(f.key)} />)}</ul>
      ) : (
        <p className="muted">Nothing suspicious. {data.scanned.rules} checks ran over {data.scanned.payments} payments and {data.scanned.bills} bills.</p>
      )}
      {data.open_count > data.open.length && <p className="micro faint">{data.open_count - data.open.length} more, lower down the list.</p>}
      {!!data.confirmed.length && (
        <details className="small" style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer' }}>{data.confirmed.length} confirmed {data.confirmed.length === 1 ? 'issue' : 'issues'}</summary>
          <ul className="plain-list flags">{data.confirmed.map((f) => <FlagCard key={f.key} flag={f} busy={review.isPending} onReview={act(f.key)} />)}</ul>
        </details>
      )}
      <details className="small" style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer' }}>How good are these checks?</summary>
        <table className="table dense tight" style={{ marginTop: 6 }}>
          <thead><tr><th>Check</th><th className="money">Real</th><th className="money">Fine</th><th className="money">Missed</th><th className="money">Right when it flags</th></tr></thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={r.rule}>
                <td>{r.label}{r.sensitivity && <span className="sub">{r.sensitivity}</span>}</td>
                <td className="money">{r.confirmed}</td><td className="money">{r.dismissed}</td><td className="money">{r.missed}</td>
                <td className="money">{r.precision === null ? <span className="faint">·</span> : percent(r.precision)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="micro faint">"Fine" are false alarms and "Missed" are things a check should have caught; both are counted from your own verdicts. After enough "Fine" verdicts, the amount check flags only bigger outliers.</p>
        <div className="row-wrap" style={{ marginTop: 6 }}>
          <select className="select" style={{ width: 'auto' }} value={rule} onChange={(e) => setRule(e.target.value)} aria-label="Which check should have caught it">
            {data.rules.map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}
          </select>
          <input className="input grow" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Something it missed, in a few words" aria-label="What it missed" />
          <button className="btn btn-sm btn-secondary" disabled={missed.isPending} onClick={send}>Log a miss</button>
        </div>
        {noteError && <p className="field-error" role="alert">{noteError}</p>}
      </details>
    </div>
  )
}

export function Checks({ guard }: { guard: Guard }) {
  const rows = guard.finance.checks
  return (
    <div>
      <ul className="plain-list checks">
        {rows.map((c) => (
          <li key={c.id} className="list-row">
            <span className={`check-mark ${c.ok ? 'ok' : 'bad'}`} aria-label={c.ok ? 'Passed' : 'Failed'}>{c.ok ? '✓' : '✕'}</span>
            <div className="grow"><div>{c.title}</div><span className="sub">{c.detail}</span></div>
          </li>
        ))}
      </ul>
      <p className="micro faint">Run every time this page loads, over the same records the engine reads. A failed check names the entries that disagree.</p>
    </div>
  )
}

export function Opportunities({ guard, yieldText, setYieldText, yieldError }: { guard: Guard; yieldText: string; setYieldText: (v: string) => void; yieldError: string | null }) {
  const o = guard.finance.opportunities
  return (
    <div>
      <label className="row small" style={{ gap: 8, marginBottom: 8 }}>
        <span className="muted">Assumed yearly return on spare cash</span>
        <input className="input mono" style={{ width: 70 }} inputMode="decimal" value={yieldText} onChange={(e) => setYieldText(e.target.value)} aria-label="Assumed yearly return, percent" aria-invalid={!!yieldError} />
        <span className="muted">%</span>
      </label>
      {yieldError && <p className="field-error" role="alert">{yieldError}</p>}
      {o.items.length ? (
        <ul className="plain-list">
          {o.items.map((i) => (
            <li key={i.id} className="list-row opp">
              <span className={`opp-kind ${i.kind.toLowerCase()}`}>{i.kind === 'CAPITAL' ? 'Capital' : 'Resource'}</span>
              <div className="grow"><div>{i.title}</div><span className="sub">{i.detail}</span></div>
              {i.gain_paise ? <span className="mono amt-in">≈ {rupees(i.gain_paise, { hidePaise: true })}</span> : null}
              {i.link && i.cta && <Link className="btn btn-sm btn-secondary" to={i.link}>{i.cta}</Link>}
            </li>
          ))}
        </ul>
      ) : <p className="muted">{o.reason_none}</p>}
      <p className="micro faint">{o.note}</p>
    </div>
  )
}

export function Activity({ guard }: { guard: Guard }) {
  const rows = guard.finance.activity
  if (!rows.length) return <p className="muted">No changes recorded yet.</p>
  return (
    <ul className="plain-list activity">
      {rows.map((a, i) => (
        <li key={i} className="list-row">
          <span className="mono faint small nowrap">{clock(a.at)}</span>
          <span className="grow">{a.text}</span>
          {a.amount_paise !== null && <Amount paise={a.amount_paise} direction={a.direction ?? 'NONE'} />}
        </li>
      ))}
    </ul>
  )
}
