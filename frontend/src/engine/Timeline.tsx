import { ArrowCounterClockwiseIcon, CaretLeftIcon, CaretRightIcon, PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dayDate, rupees } from '../lib/format'
import { useUI, type PlaySpeed } from '../lib/store'
import type { Risk, RunPayload } from '../lib/types'
import { issueDays, nextStop, prevStop, stopDays } from './model'

const BASE_DWELL_MS = 1100 // time spent on a day that has events, at 1x
const QUIET_DWELL_MS = 340 // time on a day stepped through only because "skip quiet days" is off

export function Timeline({ run, fan, baseline }: { run: RunPayload; fan?: Risk['fan']; baseline?: RunPayload | null }) {
  const day = useUI((s) => s.day)
  const playing = useUI((s) => s.playing)
  const speed = useUI((s) => s.speed)
  const skipQuiet = useUI((s) => s.skipQuiet)
  const { setDay, setPlaying, setSpeed, setSkipQuiet, setEngineView, setTableView } = useUI.getState()
  const engineView = useUI((s) => s.engineView)
  const tableView = useUI((s) => s.tableView)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const horizon = run.horizon_days
  const last = Math.max(0, horizon - 1)
  const issues = useMemo(() => issueDays(run.events, run.summary.buffer_breach?.day ?? null), [run.events, run.summary.buffer_breach])
  const stops = useMemo(() => stopDays(run.events, horizon, run.summary.first_shortfall?.day ?? null), [run.events, horizon, run.summary.first_shortfall])
  const eventsToday = useMemo(() => run.events.filter((e) => e.executed_day === day).length, [run.events, day])

  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  // Keep the day inside the window if the window shrinks (a shorter forecast horizon).
  useEffect(() => { if (day > last) setDay(last) }, [day, last, setDay])

  // Playback: one timer per day, scheduled from the day just shown. Pausing, seeking or leaving clears it, so it cannot drift or double up.
  const dayRef = useRef(day)
  dayRef.current = day
  useEffect(() => {
    if (!playing) return
    const here = day
    const next = skipQuiet ? nextStop(stops, here) : here < last ? here + 1 : null
    if (next === null) { setPlaying(false); return }
    const busy = run.events.some((e) => e.executed_day === here)
    const dwell = (skipQuiet || busy ? BASE_DWELL_MS : QUIET_DWELL_MS) / speed
    const timer = window.setTimeout(() => { if (dayRef.current === here) setDay(next) }, dwell)
    return () => window.clearTimeout(timer)
  }, [playing, day, speed, skipQuiet, stops, last, run.events, setDay, setPlaying])
  useEffect(() => () => setPlaying(false), [setPlaying])

  const togglePlay = () => {
    if (playing) { setPlaying(false); return }
    if (engineView === 'network') setEngineView('flow') // the network has nothing to light up; the flow does
    if (tableView && engineView !== 'decisions') setTableView(false)
    if (useUI.getState().day >= last) setDay(0)
    setPlaying(true)
  }
  const seek = (target: number | null) => { if (target === null) return; setPlaying(false); setDay(Math.max(0, Math.min(last, target))) }
  const nextIssue = () => {
    const current = useUI.getState().day
    seek(issues.find((d) => d > current) ?? issues[0] ?? null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || target.closest('[role="dialog"]')) return
      const current = useUI.getState().day
      if (e.key === 'ArrowRight') { seek(current + (e.shiftKey ? 7 : 1)); e.preventDefault() }
      else if (e.key === 'ArrowLeft') { seek(current - (e.shiftKey ? 7 : 1)); e.preventDefault() }
      else if (e.key === 'Home') { seek(0); e.preventDefault() }
      else if (e.key === 'End') { seek(last); e.preventDefault() }
      else if (e.key === 'n' || e.key === 'N') nextIssue()
      else if (e.key === ' ' && !['BUTTON', 'A'].includes(target.tagName)) { togglePlay(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, issues, playing, engineView, tableView, stops])

  const h = 72
  const x = (d: number) => 8 + (d / Math.max(1, horizon - 1)) * (width - 16)
  const step = Math.max(2, (width - 16) / Math.max(1, horizon - 1))
  const base = baseline && baseline.series.length === run.series.length ? baseline.series : null
  const values = [...run.series.map((p) => p.net_paise), ...run.series.map((p) => p.cash_paise), ...(base?.map((p) => p.net_paise) ?? []), run.summary.buffer_paise, 0,
    ...(fan?.flatMap((f) => [f.p10_paise, f.p90_paise]) ?? [])]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (h - 22)
  const line = (series: { day: number; net_paise: number }[]) => series.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.net_paise)}`).join('')
  const band = fan?.length ? fan.map((f, i) => `${i ? 'L' : 'M'}${x(f.day)},${y(f.p90_paise)}`).join('') + [...fan].reverse().map((f) => `L${x(f.day)},${y(f.p10_paise)}`).join('') + 'Z' : null
  const point = run.series[Math.min(day, last)]
  const basePoint = base?.[Math.min(day, last)]

  const setFromPointer = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    seek(Math.round(((clientX - rect.left - 8) / (rect.width - 16)) * (horizon - 1)))
  }

  return (
    <>
      <div className="tl-controls tl-controls-wide">
        <div className="tl-buttons">
          <button className="icon-btn" onClick={() => seek(0)} aria-label="Back to day 0" title="Back to the start (Home)"><SkipBackIcon size={16} /></button>
          <button className="icon-btn" onClick={() => seek(skipQuiet ? prevStop(stops, day) : day - 1)} aria-label="Previous step" title="Previous step (←)"><CaretLeftIcon size={16} /></button>
          <button className={`icon-btn tl-play${playing ? ' on' : ''}`} onClick={togglePlay} aria-label={playing ? 'Pause' : day >= last ? 'Play again from the start' : 'Play'} aria-pressed={playing} title={playing ? 'Pause (space)' : 'Play (space)'}>
            {playing ? <PauseIcon size={18} weight="fill" /> : day >= last ? <ArrowCounterClockwiseIcon size={18} /> : <PlayIcon size={18} weight="fill" />}
          </button>
          <button className="icon-btn" onClick={() => seek(skipQuiet ? nextStop(stops, day) : day + 1)} aria-label="Next step" title="Next step (→)"><CaretRightIcon size={16} /></button>
          <button className="btn btn-sm btn-quiet" onClick={nextIssue} title="Next issue (N)"><SkipForwardIcon size={14} /> Next issue</button>
        </div>
        <div className="tl-options">
          <div className="seg" role="group" aria-label="Playback speed">
            {([1, 2, 4] as PlaySpeed[]).map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
          <label className="check micro" title="Jump straight to days where something happens"><input type="checkbox" checked={skipQuiet} onChange={(e) => setSkipQuiet(e.target.checked)} /> Skip quiet days</label>
        </div>
        <div className="grow small" style={{ textAlign: 'right' }}>
          <div className="mono">D{day}{point ? ` · ${dayDate(point.date)}` : ''}</div>
          <div className="mono micro faint">{eventsToday ? `${eventsToday} event${eventsToday === 1 ? '' : 's'}` : 'quiet day'}{playing ? ' · playing' : ''}</div>
        </div>
      </div>
      <div ref={ref} className="tl-track" role="slider" tabIndex={0} aria-label="Simulated day" aria-valuemin={0} aria-valuemax={last} aria-valuenow={day}
        aria-valuetext={point ? `Day ${day}, ${dayDate(point.date)}, net position ${rupees(point.net_paise)}${basePoint && basePoint.net_paise !== point.net_paise ? `, baseline ${rupees(basePoint.net_paise)}` : ''}` : undefined}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setFromPointer(e.clientX) }}
        onPointerMove={(e) => e.buttons === 1 && setFromPointer(e.clientX)}>
        <svg width={width} height={h + 24} style={{ display: 'block' }}>
          <rect x={x(0)} y={0} width={Math.max(0, x(day) - x(0))} height={h + 12} fill="var(--haldi)" opacity={0.07} />
          {band && <path d={band} fill="var(--text)" opacity={0.1} />}
          {run.series.map((p) => p.net_paise < 0 && <rect key={p.day} x={x(p.day) - step / 2} y={y(0)} width={step} height={Math.max(1, y(p.net_paise) - y(0))} fill="var(--out)" opacity={0.28} />)}
          <line x1={x(0)} x2={x(horizon - 1)} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" />
          <line x1={x(0)} x2={x(horizon - 1)} y1={y(run.summary.buffer_paise)} y2={y(run.summary.buffer_paise)} stroke="var(--haldi)" strokeDasharray="3 3" />
          {base && <path d={line(base)} fill="none" stroke="var(--text-3)" strokeWidth={1.4} strokeDasharray="4 3" />}
          <path d={line(run.series)} fill="none" stroke="var(--text)" strokeWidth={1.4} />
          {run.events.filter((e) => e.executed_day !== null || e.state === 'BLOCKED').map((e) => {
            const d = e.executed_day ?? e.due_day ?? 0
            const blocked = e.state === 'BLOCKED' || e.waits.some((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY')
            const now = e.executed_day === day
            return <line key={e.id} x1={x(d)} x2={x(d)} y1={h - (now ? 12 : 8)} y2={h + 2} stroke={now ? 'var(--haldi)' : blocked ? 'var(--out)' : e.lateness_days ? 'var(--haldi)' : 'var(--text-3)'} strokeWidth={now ? 2.5 : blocked ? 2 : 1} />
          })}
          {issues.map((d) => <circle key={d} cx={x(d)} cy={h + 8} r={2.5} fill="var(--out)" />)}
          {[0, 30, 60, 90, 120, 150, last].filter((d, i, all) => d <= last && all.indexOf(d) === i).map((d) => (
            <text key={d} x={x(d)} y={h + 22} fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-3)" textAnchor={d === 0 ? 'start' : d === last ? 'end' : 'middle'}>D{d}</text>
          ))}
          <line x1={x(day)} x2={x(day)} y1={0} y2={h + 12} stroke="var(--haldi)" strokeWidth={1.5} />
          <rect x={x(day) - 5} y={0} width={10} height={6} fill="var(--haldi)" />
          {point && <circle cx={x(day)} cy={y(point.net_paise)} r={3.5} fill="var(--haldi)" stroke="var(--ground)" strokeWidth={1.5} />}
        </svg>
        {base && <div className="tl-legend micro"><span><i className="solid" /> this what-if</span><span><i className="dashed" /> baseline</span></div>}
      </div>
    </>
  )
}
