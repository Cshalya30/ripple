import { CaretLeftIcon, CaretRightIcon, PauseIcon, PlayIcon, SkipForwardIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { dayDate, rupees } from '../lib/format'
import { useUI } from '../lib/store'
import type { Risk, RunPayload } from '../lib/types'
import { issueDays } from './model'

export function Timeline({ run, fan }: { run: RunPayload; fan?: Risk['fan'] }) {
  const ui = useUI()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [playing, setPlaying] = useState(false)
  const horizon = run.horizon_days
  const issues = issueDays(run.events, run.summary.buffer_breach?.day ?? null)

  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const next = useUI.getState().day + 1
      if (next >= horizon) { setPlaying(false); return }
      ui.setDay(next)
    }, 250)
    return () => clearInterval(timer)
  }, [playing, horizon, ui])

  const nextIssue = () => {
    const day = useUI.getState().day
    const next = issues.find((d) => d > day) ?? issues[0]
    if (next !== undefined) ui.setDay(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="dialog"]')) return
      const day = useUI.getState().day
      if (e.key === 'ArrowRight') { ui.setDay(Math.min(horizon - 1, day + (e.shiftKey ? 7 : 1))); e.preventDefault() }
      else if (e.key === 'ArrowLeft') { ui.setDay(Math.max(0, day - (e.shiftKey ? 7 : 1))); e.preventDefault() }
      else if (e.key === 'n' || e.key === 'N') nextIssue()
      else if (e.key === ' ' && target === document.body) { setPlaying((p) => !p); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, issues.join(',')])

  const h = 72
  const x = (d: number) => 8 + (d / Math.max(1, horizon - 1)) * (width - 16)
  const values = [...run.series.map((p) => p.net_paise), ...run.series.map((p) => p.cash_paise), run.summary.buffer_paise, 0,
    ...(fan?.flatMap((f) => [f.p10_paise, f.p90_paise]) ?? [])]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (h - 22)
  const net = run.series.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.net_paise)}`).join('')
  const band = fan?.length ? fan.map((f, i) => `${i ? 'L' : 'M'}${x(f.day)},${y(f.p90_paise)}`).join('') + [...fan].reverse().map((f) => `L${x(f.day)},${y(f.p10_paise)}`).join('') + 'Z' : null
  const point = run.series[ui.day]

  const setFromPointer = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const d = Math.round(((clientX - rect.left - 8) / (rect.width - 16)) * (horizon - 1))
    ui.setDay(Math.max(0, Math.min(horizon - 1, d)))
  }

  return (
    <>
      <div className="tl-controls tl-controls-wide">
        <button className="icon-btn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</button>
        <button className="icon-btn" onClick={() => ui.setDay(Math.max(0, ui.day - 1))} aria-label="Previous day"><CaretLeftIcon size={16} /></button>
        <button className="icon-btn" onClick={() => ui.setDay(Math.min(horizon - 1, ui.day + 1))} aria-label="Next day"><CaretRightIcon size={16} /></button>
        <button className="btn btn-sm btn-quiet" onClick={nextIssue} title="Next issue (N)"><SkipForwardIcon size={14} /> Next issue</button>
        <div className="grow small" style={{ textAlign: 'right' }}>
          <div className="mono">D{ui.day}</div>
          {point && <div className="mono micro faint">{dayDate(point.date)}</div>}
        </div>
      </div>
      <div ref={ref} className="tl-track" role="slider" tabIndex={0} aria-label="Simulated day" aria-valuemin={0} aria-valuemax={horizon - 1} aria-valuenow={ui.day}
        aria-valuetext={point ? `Day ${ui.day}, ${dayDate(point.date)}, net position ${rupees(point.net_paise)}` : undefined}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setFromPointer(e.clientX) }}
        onPointerMove={(e) => e.buttons === 1 && setFromPointer(e.clientX)}>
        <svg width={width} height={h + 24} style={{ display: 'block' }}>
          {band && <path d={band} fill="var(--text)" opacity={0.1} />}
          <line x1={x(0)} x2={x(horizon - 1)} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" />
          <line x1={x(0)} x2={x(horizon - 1)} y1={y(run.summary.buffer_paise)} y2={y(run.summary.buffer_paise)} stroke="var(--haldi)" strokeDasharray="3 3" />
          <path d={net} fill="none" stroke="var(--text)" strokeWidth={1.2} />
          {run.events.filter((e) => e.executed_day !== null || e.state === 'BLOCKED').map((e) => {
            const d = e.executed_day ?? e.due_day ?? 0
            const blocked = e.state === 'BLOCKED' || e.waits.some((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY')
            return <line key={e.id} x1={x(d)} x2={x(d)} y1={h - 8} y2={h + 2} stroke={blocked ? 'var(--out)' : e.lateness_days ? 'var(--haldi)' : 'var(--text-3)'} strokeWidth={blocked ? 2 : 1} />
          })}
          {issues.map((d) => <circle key={d} cx={x(d)} cy={h + 8} r={2.5} fill="var(--out)" />)}
          {[0, 30, 60, horizon - 1].filter((d) => d < horizon).map((d) => (
            <text key={d} x={x(d)} y={h + 22} fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-3)" textAnchor={d === 0 ? 'start' : d === horizon - 1 ? 'end' : 'middle'}>D{d}</text>
          ))}
          <line x1={x(ui.day)} x2={x(ui.day)} y1={0} y2={h + 12} stroke="var(--haldi)" strokeWidth={1.5} />
          <rect x={x(ui.day) - 5} y={0} width={10} height={6} fill="var(--haldi)" />
        </svg>
      </div>
    </>
  )
}
