import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Amount } from '../components/ui'
import { dayDate, rupees } from '../lib/format'
import { useUI } from '../lib/store'
import type { DecisionRow, RunPayload } from '../lib/types'

function materialQty(run: RunPayload, id: string, value: number) {
  const m = run.stock.find((s) => s.material_id === id)
  if (!m) return String(value)
  return `${(value / (m.unit_factor || 1)).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${m.unit}`
}

/** The chosen day in words: what ran and in what order, what was held up and why, what the cash did. Numbers match the badges on the boxes. */
export function DayBrief({ run, baseline, rows, loading, playing }: { run: RunPayload; baseline: RunPayload | null; rows: DecisionRow[]; loading: boolean; playing: boolean }) {
  const day = useUI((s) => s.day)
  const selected = useUI((s) => s.selectedEventId)
  const { selectEvent, setDay, setPlaying } = useUI.getState()
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1100)
  const point = run.series[Math.min(day, run.series.length - 1)]
  const basePoint = baseline?.series[Math.min(day, baseline.series.length - 1)]
  const byId = new Map(run.events.map((e) => [e.id, e]))
  const ran = rows.filter((r) => r.outcome === 'EXECUTED').sort((a, b) => a.seq - b.seq)
  const held = rows.filter((r) => r.outcome === 'BLOCKED')
  const next = run.events.filter((e) => e.executed_day !== null && e.executed_day > day).sort((a, b) => a.executed_day! - b.executed_day! || a.id.localeCompare(b.id))[0]
  const worse = basePoint && point && point.net_paise < basePoint.net_paise
  const better = basePoint && point && point.net_paise > basePoint.net_paise

  return (
    <aside className={`daybrief${open ? '' : ' closed'}`} aria-label={`Day ${day}`}>
      <button type="button" className="daybrief-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mono">D{day}</span>
        <span className="grow">{point ? dayDate(point.date) : ''}</span>
        {playing && <span className="live-dot" aria-label="Playing" />}
        {open ? <CaretUpIcon size={14} /> : <CaretDownIcon size={14} />}
      </button>
      {open && (
        <div className="daybrief-body">
          {point && (
            <div className="daybrief-cash">
              <span className="faint">Cash</span> <span className="mono">{rupees(point.cash_paise)}</span>
              <span className="faint"> · net </span><span className={`mono ${point.net_paise < 0 ? 'amt-out' : ''}`}>{rupees(point.net_paise)}</span>
              {basePoint && basePoint.net_paise !== point.net_paise && (
                <span className="micro" style={{ display: 'block', color: worse ? 'var(--out)' : better ? 'var(--in)' : undefined }}>
                  baseline net {rupees(basePoint.net_paise)} · {worse ? 'worse' : 'better'} in this what-if
                </span>
              )}
            </div>
          )}
          <div className="label" style={{ marginTop: 8 }}>{ran.length ? `Happening today (${ran.length})` : 'Happening today'}</div>
          {loading && !ran.length && <p className="micro faint">Loading the day</p>}
          {!loading && ran.length === 0 && <p className="micro faint" style={{ margin: '2px 0' }}>Nothing runs today.</p>}
          <ol className="daybrief-list">
            {ran.map((r, i) => (
              <li key={r.event_id}>
                <button type="button" className={selected === r.event_id ? 'on' : ''} onClick={() => selectEvent(r.event_id)}>
                  <span className="n">{i + 1}</span>
                  <span className="grow">{r.label}</span>
                  {r.amount_paise ? <Amount paise={r.amount_paise} direction={r.direction as 'IN' | 'OUT' | null} sign={false} /> : null}
                </button>
              </li>
            ))}
          </ol>
          {held.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 8, color: 'var(--out)' }}>Held up ({held.length})</div>
              <ul className="daybrief-list held">
                {held.map((r) => {
                  const reason = r.reasons[0]
                  return (
                    <li key={r.event_id}>
                      <button type="button" className={selected === r.event_id ? 'on' : ''} onClick={() => selectEvent(r.event_id)}>
                        <span className="grow">{r.label}
                          {reason?.code === 'INSUFFICIENT_CASH' && <span className="sub">need {rupees(reason.details.required_paise)} · have {rupees(reason.details.available_paise)} · short {rupees(reason.details.shortfall_paise)}</span>}
                          {reason?.code === 'INSUFFICIENT_INVENTORY' && <span className="sub">needs {materialQty(run, reason.details.material_id, reason.details.required_quantity)} · free {materialQty(run, reason.details.material_id, reason.details.available_quantity)}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {ran.length === 0 && next && (
            <p className="micro" style={{ marginTop: 8 }}>
              Next: D{next.executed_day} · <button type="button" className="linkish" onClick={() => { setPlaying(false); setDay(next.executed_day!); selectEvent(next.id) }}>{byId.get(next.id)?.label}</button>
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
