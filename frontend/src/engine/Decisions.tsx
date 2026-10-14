import { Status } from '../components/ui'
import { dayDate, rupees } from '../lib/format'
import { useDayLog } from '../lib/queries'
import { useUI } from '../lib/store'
import type { DecisionRow, StockSeries } from '../lib/types'
import { REASON_TEXT } from './model'

const GROUPS = [
  { key: 'BRING_IN', title: '1 Bring in', sub: 'receipts, arrivals, credit' },
  { key: 'MOVE_GOODS', title: '2 Move goods', sub: 'completions, deliveries' },
  { key: 'PAY_OUT', title: '3 Pay out', sub: 'payments, expenses, production, repayments' },
] as const

export function Decisions({ stock }: { stock: StockSeries[] }) {
  const ui = useUI()
  const log = useDayLog(ui.day, ui.scenario?.key)
  const data = log.data
  const shown = (data?.rows ?? []).filter((r) => r.outcome !== 'NOT_ELIGIBLE')
  const waiting = (data?.rows ?? []).filter((r) => r.outcome === 'NOT_ELIGIBLE').length
  const executed = shown.filter((r) => r.outcome === 'EXECUTED').sort((a, b) => a.seq - b.seq)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="row-wrap" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)', gap: 16 }}>
        <strong className="mono">DAY {ui.day} · {data ? dayDate(data.date) : ''}</strong>
        {data && <span className="small">Opening cash <span className="amt">{rupees(data.opening_cash_paise)}</span> → closing <span className="amt">{rupees(data.closing_cash_paise)}</span></span>}
        {data && data.net_paise < 0 && <Status tone="out">Net position {rupees(data.net_paise)}</Status>}
        <span className="spacer" />
        <button className="btn btn-sm btn-secondary" onClick={() => ui.askMunim(`How did the engine decide day ${ui.day}? Explain it simply.`, { day: ui.day, scenario: ui.scenario?.key })}>Explain this day</button>
      </div>
      {executed.length > 0 && (
        <div className="row-wrap mono micro" style={{ padding: '6px 14px', borderBottom: '1px solid var(--rule)', gap: 6, color: 'var(--text-3)' }} aria-label="Cash after each executed event">
          <span>cash</span><span>{rupees(data!.opening_cash_paise)}</span>
          {executed.map((r) => <span key={r.seq}>→ <span style={{ color: r.cash_after_paise < r.cash_before_paise ? 'var(--out)' : r.cash_after_paise > r.cash_before_paise ? 'var(--in)' : 'var(--text-2)' }}>{rupees(r.cash_after_paise)}</span></span>)}
        </div>
      )}
      <div className="decisions" style={{ flex: 1, minHeight: 0 }}>
        {GROUPS.map((g) => {
          const rows = shown.filter((r) => r.group === g.key)
          return (
            <div key={g.key}>
              <div className="label">{g.title}</div>
              <div className="micro faint" style={{ marginBottom: 8 }}>{g.sub}</div>
              {log.isLoading && <p className="small faint">Loading</p>}
              {!log.isLoading && rows.length === 0 && <p className="small faint">nothing eligible</p>}
              {rows.map((r) => <Row key={`${r.seq}-${r.event_id}`} row={r} stock={stock} onSelect={() => { ui.selectEvent(r.event_id) }} selected={ui.selectedEventId === r.event_id} />)}
            </div>
          )
        })}
      </div>
      <div className="micro faint" style={{ padding: '6px 14px', borderTop: '1px solid var(--rule)' }}>
        Inside each step the engine goes by order priority, event priority, due date, event ID (the sort key under each row); after every execution it checks again until nothing else can run.
        {waiting > 0 && ` ${waiting} events were waiting for an earlier step.`} Source: the engine's execution log.
      </div>
    </div>
  )
}

function Row({ row, stock, onSelect, selected }: { row: DecisionRow; stock: StockSeries[]; onSelect: () => void; selected: boolean }) {
  const blocked = row.outcome === 'BLOCKED'
  return (
    <button className="dec-row" onClick={onSelect}
      style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--rule)', background: selected ? 'var(--haldi-wash)' : 'transparent', cursor: 'pointer', padding: '8px 4px' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="mono faint" style={{ width: 18, flex: 'none' }}>{blocked ? '' : row.seq + 1}</span>
        <span className="grow">{row.label}</span>
      </div>
      <div className="row-wrap" style={{ paddingLeft: 26, gap: 10 }}>
        {row.amount_paise ? <span className={`amt ${row.direction === 'IN' ? 'amt-in' : row.direction === 'OUT' ? 'amt-out' : ''}`}>{rupees(row.direction === 'OUT' ? -row.amount_paise : row.amount_paise, { sign: row.direction === 'IN' })}</span> : null}
        {blocked ? <Status tone="out">Blocked</Status> : <Status tone="in">Done</Status>}
        {!blocked && <span className="mono micro faint">cash {rupees(row.cash_after_paise)}</span>}
      </div>
      {blocked && row.reasons.map((reason, i) => (
        <div key={i} className="small" style={{ color: 'var(--out)', paddingLeft: 26 }}>
          {REASON_TEXT[reason.code] ?? reason.code}
          {reason.code === 'INSUFFICIENT_CASH' && <span className="mono"> · need {rupees(reason.details.required_paise)} · have {rupees(reason.details.available_paise)} · short {rupees(reason.details.shortfall_paise)}</span>}
          {reason.code === 'INSUFFICIENT_INVENTORY' && <span className="mono"> · {qty(reason.details.material_id, reason.details.required_quantity, stock)} needed · {qty(reason.details.material_id, reason.details.available_quantity, stock)} free</span>}
        </div>
      ))}
      <div className="dec-key" style={{ paddingLeft: 26 }}>key {row.sort_key.slice(1, 4).map((k) => k ?? '·').join(' · ')} · {row.event_id}</div>
    </button>
  )
}

function qty(materialId: string, value: number, stock: StockSeries[]) {
  const m = stock.find((s) => s.material_id === materialId)
  if (!m) return String(value)
  const v = value / (m.unit_factor || 1)
  return `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${m.unit}`
}
