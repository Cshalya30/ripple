import { ArrowRightIcon, CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { percent, rupees, shortDate } from '../lib/format'
import { useRisk } from '../lib/queries'
import { useUI } from '../lib/store'
import type { ChanceAfter, Evaluation, RunPayload } from '../lib/types'
import { deltaText } from './model'

type Verdict = 'better' | 'worse' | 'same'

function verdictOf(before: number | null, after: number | null, higherIsBetter: boolean): Verdict {
  if (before === null || after === null || before === after) return 'same'
  return (after > before) === higherIsBetter ? 'better' : 'worse'
}

function Card({ title, before, after, verdict, sub }: { title: string; before: ReactNode; after: ReactNode; verdict: Verdict; sub?: ReactNode }) {
  return (
    <div className={`impact-card ${verdict}`}>
      <div className="impact-title">{title}</div>
      <div className="impact-figures">
        <span className="impact-before">{before}</span>
        <ArrowRightIcon size={12} aria-label="becomes" />
        <span className="impact-after">{after}</span>
      </div>
      <div className="impact-verdict">{verdict === 'better' ? 'Better' : verdict === 'worse' ? 'Worse' : 'No change'}{sub ? <span className="faint"> · {sub}</span> : null}</div>
    </div>
  )
}

/** The answer to "what happens if", before it is believed: headline, five before-and-after figures, and every event that moves. */
export function ScenarioImpact({ baseline }: { baseline: RunPayload }) {
  const scenario = useUI((s) => s.scenario)!
  const { selectEvent, setDay, setEngineView, setScenario, setPlaying } = useUI.getState()
  const risk = useRisk()
  const [open, setOpen] = useState(false)
  const [showMoves, setShowMoves] = useState(false)
  const e: Evaluation = scenario.evaluation
  const run = scenario.run
  const base = baseline.summary

  // The chance of a shortfall is computed in the background; ask again until it is ready.
  const chance = scenario.chance
  useEffect(() => {
    if (!scenario.request || !chance || (chance.status !== 'COMPUTING' && chance.status !== 'MISSING')) return
    let tries = 0
    const timer = window.setInterval(async () => {
      tries += 1
      try {
        const r = await api.post<{ chance_after?: ChanceAfter }>('/engine/scenario/chance', scenario.request)
        const latest = useUI.getState().scenario
        if (r.chance_after && latest?.key === scenario.key) setScenario({ ...latest, chance: r.chance_after })
        if (r.chance_after && r.chance_after.status !== 'COMPUTING' && r.chance_after.status !== 'MISSING') window.clearInterval(timer)
      } catch { window.clearInterval(timer) }
      if (tries >= 30) window.clearInterval(timer)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [scenario.key, scenario.request, chance?.status, setScenario])

  const baseById = useMemo(() => new Map(baseline.events.map((x) => [x.id, x])), [baseline])
  const runById = useMemo(() => new Map(run.events.map((x) => [x.id, x])), [run])
  const lateBefore = base.late_orders.filter((o) => (o.lateness_days ?? 0) > 0).length
  const lateAfter = e.late_orders_after.filter((o) => (o.lateness_days ?? 0) > 0).length
  const lowBefore = base.lowest?.net_paise ?? null
  const lowAfter = e.dip_after_paise
  const shortBefore = base.first_shortfall
  const shortAfter = e.first_shortfall_after
  const missedBefore = base.missed_commitment_count
  const missedAfter = missedBefore + e.missed_commitments_delta
  const riskBefore = risk.data?.status === 'READY' ? risk.data.shortfall_chance?.['30'] ?? null : null
  const riskAfter = chance?.status === 'READY' ? chance.shortfall_chance?.['30'] ?? null : null

  const fixed = shortBefore && !shortAfter
  const headline = fixed ? 'Cash no longer runs out in this window.'
    : lowAfter !== null && lowBefore !== null && lowAfter > lowBefore ? 'The lowest point improves.'
      : lowAfter !== null && lowBefore !== null && lowAfter < lowBefore ? 'The lowest point gets worse.'
        : e.changed_events.length ? 'The lowest point stays the same, but events move.' : 'Nothing in the forecast changes.'
  const tone = fixed || (lowAfter !== null && lowBefore !== null && lowAfter > lowBefore) ? 'better' : lowAfter !== null && lowBefore !== null && lowAfter < lowBefore ? 'worse' : 'same'

  const moves = [...e.changed_events].sort((a, b) => (a.new === b.new ? Math.abs(b.delta_days ?? 0) - Math.abs(a.delta_days ?? 0) : a.new ? 1 : -1))
  const focus = (id: string) => {
    const ev = runById.get(id)
    setPlaying(false)
    setEngineView('flow')
    selectEvent(id)
    if (ev?.executed_day !== null && ev?.executed_day !== undefined) setDay(ev.executed_day)
  }

  return (
    <section className={`impact ${tone}`} aria-label="What this what-if changes">
      <div className="impact-head">
        <div className="grow">
          <strong>{headline}</strong>
          <span className="small muted"> {scenario.label}</span>
        </div>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <>Hide details <CaretUpIcon size={12} /></> : <>Show details <CaretDownIcon size={12} /></>}</button>
      </div>
      {open && (
        <>
          <div className="impact-cards">
            <Card title="Lowest point" before={rupees(lowBefore)} after={rupees(lowAfter)} verdict={verdictOf(lowBefore, lowAfter, true)}
              sub={e.dip_after_day !== null && e.dip_after_day !== undefined ? `D${e.dip_after_day}` : undefined} />
            <Card title="First shortfall" before={shortBefore ? `D${shortBefore.day}` : 'none'} after={shortAfter ? `D${shortAfter.day}` : 'none'}
              verdict={verdictOf(shortBefore ? shortBefore.day : Infinity, shortAfter ? shortAfter.day : Infinity, true)} />
            <Card title="Late orders" before={lateBefore} after={lateAfter} verdict={verdictOf(lateBefore, lateAfter, false)} />
            <Card title="Payments missed" before={missedBefore} after={missedAfter} verdict={verdictOf(missedBefore, missedAfter, false)} />
            <Card title="Shortfall chance, 30 days" before={riskBefore !== null ? percent(riskBefore) : '·'}
              after={riskAfter !== null ? percent(riskAfter) : chance && (chance.status === 'COMPUTING' || chance.status === 'MISSING') ? 'working…' : '·'}
              verdict={riskBefore !== null && riskAfter !== null && Math.abs(riskAfter - riskBefore) >= 0.025 ? verdictOf(riskBefore, riskAfter, false) : 'same'} sub={riskAfter === null ? undefined : `${chance?.n_samples ?? ''} samples`} />
          </div>
          <div className="impact-moves">
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setShowMoves(!showMoves)} aria-expanded={showMoves} disabled={!moves.length && !e.removed_events.length}>
              {moves.length ? `${moves.length} event${moves.length === 1 ? '' : 's'} move` : 'No event moves'}{e.removed_events.length ? ` · ${e.removed_events.length} replaced` : ''}
              {moves.length || e.removed_events.length ? (showMoves ? ' · hide' : ' · show') : ''}
            </button>
            {showMoves && <ul>
              {moves.slice(0, 12).map((c) => {
                const ev = runById.get(c.event_id)
                return (
                  <li key={c.event_id}>
                    <button type="button" onClick={() => focus(c.event_id)}>
                      <span className="grow truncate">{ev?.label ?? c.event_id}</span>
                      <span className="mono small faint">{c.new ? 'new' : `${c.baseline_date ? shortDate(c.baseline_date) : 'not in window'} → ${c.scenario_date ? shortDate(c.scenario_date) : 'not in window'}`}</span>
                      <span className={`impact-chip ${c.new ? 'new' : (c.delta_days ?? 0) < 0 ? 'earlier' : 'later'}`}>{c.new ? 'new' : deltaText(c.delta_days)}</span>
                    </button>
                  </li>
                )
              })}
              {e.removed_events.map((id) => (
                <li key={id}><span className="removed-row"><span className="grow truncate">{baseById.get(id)?.label ?? id}</span><span className="impact-chip gone">replaced</span></span></li>
              ))}
            </ul>}
            {showMoves && moves.length > 12 && <p className="micro faint">and {moves.length - 12} more, listed in the Table view.</p>}
            {showMoves && (e.snapshot_edits.length > 0 || e.assumptions.length > 0) && (
              <details className="micro faint" style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer' }}>How this was worked out</summary>
                <ul style={{ paddingLeft: 16 }}>{[...e.snapshot_edits, ...e.assumptions].slice(0, 8).map((a) => <li key={a}>{a}</li>)}</ul>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  )
}
