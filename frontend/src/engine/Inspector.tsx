import { useNavigate } from 'react-router-dom'
import { Glyph, type GlyphName } from '../components/Glyph'
import { Amount, Status } from '../components/ui'
import { dayDate, percent, rupees, shortDate } from '../lib/format'
import { useUI } from '../lib/store'
import type { EngineEvent, Network, RunPayload } from '../lib/types'
import { alsoDelays, downstreamChain, REASON_TEXT, stateText, stateTone } from './model'

export function Inspector({ run, network, drivers }: { run: RunPayload; network?: Network; drivers: Record<string, number> }) {
  const ui = useUI()
  const byId = new Map(run.events.map((e) => [e.id, e]))
  if (ui.selectedEventId && byId.get(ui.selectedEventId)) return <EventInspector e={byId.get(ui.selectedEventId)!} run={run} byId={byId} />
  const party = ui.selectedPartyId ? network?.parties.find((p) => p.id === ui.selectedPartyId) : null
  if (party) {
    const events = run.events.filter((e) => e.party_id === party.id && e.direction !== 'NONE')
    return (
      <div>
        <div className="label">{party.kind === 'CUSTOMER' ? 'Customer' : 'Supplier'}</div>
        <h2 className="h2" style={{ marginTop: 4 }}>{party.name}</h2>
        <p className="small muted" style={{ margin: '2px 0 12px' }}>{party.city} · {party.tags.join(', ')}</p>
        <KV k="Outstanding"><Amount paise={party.outstanding_paise} direction={party.kind === 'CUSTOMER' ? 'IN' : 'OUT'} sign={false} /></KV>
        <KV k={`Share of ${party.kind === 'CUSTOMER' ? 'receivables' : 'payables'}`}><span className="mono">{Math.round(party.exposure_bp / 100)}%</span></KV>
        {party.days_overdue > 0 && <KV k="Overdue"><Status tone="attn">{party.days_overdue} days</Status></KV>}
        {party.kind === 'CUSTOMER' && party.risk && (
          <>
            <KV k="Delay used by risk"><span className="mono">P50 {party.risk.p50_days} · P90 {party.risk.p90_days}d</span></KV>
            {drivers[party.id] !== undefined && <KV k="Share of risk"><span className="mono">{percent(drivers[party.id])}</span></KV>}
            {party.risk.no_history && <p className="small muted">No payment history: other customers' average is used.</p>}
          </>
        )}
        <div className="label" style={{ marginTop: 16 }}>Events</div>
        {events.map((e) => (
          <button key={e.id} className="palette-item" style={{ height: 'auto', padding: '6px 4px' }} onClick={() => { ui.selectEvent(e.id); ui.setEngineView('flow') }}>
            <Glyph name={e.type as GlyphName} size={14} />
            <span className="grow">{e.label}<span className="sub">{stateText(e, byId)}</span></span>
            <Amount paise={e.amount_paise} direction={e.direction} />
          </button>
        ))}
        <div className="stack" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => ui.openParty(party.id)}>Open in Khata</button>
          <button className="btn btn-quiet" onClick={() => ui.askMunim(`Tell me about ${party.name}`, { party_id: party.id })}>Ask Munim about {party.name.split(' ')[0]}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="small muted">
      <div className="label">Inspector</div>
      <p>Select a party or an event to see what the engine did with it, and why.</p>
      <p>Blocked events have a hatched waiting bar in Flow. Press <span className="kbd">N</span> to jump to the next issue, <span className="kbd">←</span> <span className="kbd">→</span> to move a day.</p>
      <EngineFacts run={run} />
    </div>
  )
}

function EngineFacts({ run }: { run: RunPayload }) {
  const s = run.summary
  return (
    <div style={{ marginTop: 16 }}>
      <KV k="Events">{run.event_count}</KV>
      <KV k="Missed commitments">{s.missed_commitment_count}</KV>
      <KV k="First shortfall">{s.first_shortfall ? `D${s.first_shortfall.day} · ${rupees(-s.first_shortfall.shortfall_paise)}` : 'none'}</KV>
      <KV k="Closing cash">{rupees(s.closing_cash_paise)}</KV>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>Engine assumptions ({run.assumptions.length})</summary>
        <ul style={{ paddingLeft: 16 }}>{run.assumptions.slice(0, 12).map((a) => <li key={a} className="micro">{a}</li>)}</ul>
      </details>
    </div>
  )
}

function EventInspector({ e, run, byId }: { e: EngineEvent; run: RunPayload; byId: Map<string, EngineEvent> }) {
  const ui = useUI()
  const navigate = useNavigate()
  const day = (d: number | null) => (d === null ? '·' : `D${d} · ${dayDate(run.series[Math.min(d, run.series.length - 1)]?.date)}`)
  const resourceWaits = e.waits.filter((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY')
  const downstream = downstreamChain(e.id, byId)
  const also = alsoDelays(e.id, run.events, byId)
  const tone = stateTone(e)
  const fixable = e.type === 'SUPPLIER_PAYMENT' || e.type === 'CASH_RECEIPT' || e.type === 'INVENTORY_ARRIVAL'

  return (
    <div>
      <div className="row"><span className="label grow">{e.type.replace(/_/g, ' ')}</span><Status tone={tone}>{tone === 'in' ? 'On time' : tone === 'attn' ? `${e.lateness_days} days late` : e.state === 'BLOCKED' ? 'Blocked' : 'Waiting'}</Status></div>
      <h2 className="h2" style={{ marginTop: 4 }}>{e.label}</h2>
      <p className="small muted" style={{ margin: '2px 0 12px' }}>{e.detail}</p>
      {e.due_day !== null && <KV k="Due">{day(e.due_day)}</KV>}
      <KV k="Earliest">{day(e.earliest_day)}</KV>
      <KV k="Executed">{e.executed_day !== null ? <>{day(e.executed_day)}{e.lateness_days ? <span className="amt-out"> (+{e.lateness_days}d late)</span> : ''}</> : <span className="amt-out">not within the forecast</span>}</KV>
      {e.amount_paise ? <KV k="Amount"><Amount paise={e.amount_paise} direction={e.direction} /></KV> : null}

      {resourceWaits.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 16 }}>Why it waited</div>
          {resourceWaits.map((w, i) => (
            <div key={i} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
              <span className="mono">D{w.from_day}{w.to_day !== w.from_day ? ` to D${w.to_day}` : ''}</span> {REASON_TEXT[w.code]}
              {w.code === 'INSUFFICIENT_CASH' && (
                <div className="mono micro amt-out">need {rupees(w.first_details.required_paise)} · have {rupees(w.first_details.available_paise)} · short {rupees(w.first_details.shortfall_paise)}</div>
              )}
              {w.code === 'INSUFFICIENT_INVENTORY' && (
                <div className="mono micro amt-out">short {qtyLabel(run, w.first_details.material_id, w.first_details.shortfall_quantity)} of {materialName(run, w.first_details.material_id)}</div>
              )}
            </div>
          ))}
          {e.executed_day !== null && <ExecutedAfter e={e} run={run} />}
        </>
      )}

      <div className="label" style={{ marginTop: 16 }}>Depends on</div>
      {e.depends_on.length === 0 ? <p className="small muted" style={{ margin: '4px 0' }}>none</p> : e.depends_on.map((d) => (
        <button key={d.event_id} className="palette-item" onClick={() => ui.selectEvent(d.event_id)}>
          {byId.get(d.event_id)?.label ?? d.event_id}{d.lag_days ? <span className="mono faint"> +{d.lag_days}d</span> : ''}
        </button>
      ))}
      {downstream.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 16 }}>Unblocks</div>
          <p className="small" style={{ margin: '4px 0' }}>
            {downstream.slice(0, 6).map((d, i) => (
              <span key={d.id}>{i > 0 && ' → '}<button className="btn-quiet small" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }} onClick={() => ui.selectEvent(d.id)}>{d.label}</button></span>
            ))}
          </p>
        </>
      )}
      {also.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 16 }}>Also delays</div>
          {also.map((a) => {
            const w = a.waits.find((x) => x.code === 'INSUFFICIENT_INVENTORY')!
            return (
              <p key={a.id} className="small" style={{ margin: '4px 0' }}>
                <button className="btn-quiet small" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }} onClick={() => ui.selectEvent(a.id)}>{a.order_id}</button>
                {a.party_name ? ` for ${a.party_name}` : ''}, waiting for the same {materialName(run, w.first_details.material_id).toLowerCase()}: starts D{a.executed_day ?? '·'}, {(a.executed_day ?? w.to_day) - w.from_day} days after it was ready to.
                <span className="sub">No link to this party except the shared stock pool.</span>
              </p>
            )
          })}
        </>
      )}

      <div className="stack" style={{ marginTop: 20 }}>
        {fixable && <button className="btn btn-primary" onClick={() => ui.setScenarioBarOpen(true)}>Try a fix ▸</button>}
        <button className="btn btn-secondary" onClick={() => ui.askMunim(`Why did "${e.label}" happen when it did?`, { event_id: e.id })}>Explain with Munim</button>
        <button className="btn btn-quiet" onClick={() => navigate('/app/book')}>Show in Book</button>
      </div>
      {e.assumptions.length > 0 && (
        <details className="micro faint" style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}>Assumptions</summary>
          <ul style={{ paddingLeft: 16 }}>{e.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

function ExecutedAfter({ e, run }: { e: EngineEvent; run: RunPayload }) {
  const before = run.events.filter((x) => x.executed_day === e.executed_day && x.direction === 'IN' && x.id !== e.id)
  if (!before.length) return <p className="small" style={{ margin: '6px 0' }}><span className="mono">D{e.executed_day}</span> executed</p>
  return (
    <p className="small" style={{ margin: '6px 0' }}>
      <span className="mono">D{e.executed_day}</span> executed after {before.map((b) => `${b.party_name ?? b.label} ${rupees(b.amount_paise ?? 0, { sign: true })}`).join(', ')}
    </p>
  )
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="row small" style={{ padding: '3px 0' }}><span className="faint" style={{ width: 120, flex: 'none' }}>{k}</span><span className="grow">{children}</span></div>
}

function materialName(run: RunPayload, id: string) {
  return run.stock.find((s) => s.material_id === id)?.name ?? 'material'
}

function qtyLabel(run: RunPayload, id: string, qty: number) {
  const m = run.stock.find((s) => s.material_id === id)
  if (!m) return String(qty)
  return `${(qty / (m.unit_factor || 1)).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${m.unit}`
}

export function EventTable({ run }: { run: RunPayload }) {
  const ui = useUI()
  const byId = new Map(run.events.map((e) => [e.id, e]))
  const rows = [...run.events].sort((a, b) => (a.executed_day ?? 999) - (b.executed_day ?? 999) || a.id.localeCompare(b.id))
  return (
    <div className="table-wrap" style={{ height: '100%', overflow: 'auto', padding: '0 12px' }}>
      <table className="table dense">
        <thead style={{ position: 'sticky', top: 0, background: 'var(--ground)' }}>
          <tr><th>Event</th><th>Type</th><th>Party</th><th>Order</th><th>Earliest</th><th>Due</th><th>Executed</th><th>Lateness</th><th>Status</th><th>Reason</th><th className="money">Amount</th></tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const reason = e.waits.find((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY')
            return (
              <tr key={e.id} className={`clickable${ui.selectedEventId === e.id ? ' selected' : ''}`} onClick={() => ui.selectEvent(e.id)} tabIndex={0}
                onKeyDown={(k) => k.key === 'Enter' && ui.selectEvent(e.id)}>
                <td className="small">{e.label}</td>
                <td className="micro faint">{e.type.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="small">{e.party_name ?? '·'}</td>
                <td className="mono small">{e.order_id ?? '·'}</td>
                <td className="mono small">{e.earliest_day !== null ? `D${e.earliest_day}` : '·'}</td>
                <td className="mono small">{e.due_date ? shortDate(e.due_date) : '·'}</td>
                <td className="mono small">{e.executed_day !== null ? `D${e.executed_day}` : '·'}</td>
                <td className="mono small">{e.lateness_days ? `+${e.lateness_days}d` : '·'}</td>
                <td><Status tone={stateTone(e)}>{stateText(e, byId).split(':')[0]}</Status></td>
                <td className="small">{reason ? REASON_TEXT[reason.code] : '·'}</td>
                <td className="money"><Amount paise={e.amount_paise} direction={e.direction} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

