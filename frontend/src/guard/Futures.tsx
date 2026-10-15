import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, compact, dayDate, percent, rupees, shortDate } from '../lib/format'
import { niceStep } from './logic'
import type { Guard } from './types'

const W = 900, H = 300, PL = 56, PR = 14, PT = 14, PB = 26
const REPLAY_MS = 6000

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce'
  } catch {
    return false
  }
}

/**
 * The risk model, drawn. Each thin line is one simulated future: the same deterministic engine, run again with every customer's
 * payment delay drawn from their own history. Lines that cross zero are the futures where cash runs short.
 */
export function Futures({ guard }: { guard: Guard }) {
  const { risk } = guard
  const [cursor, setCursor] = useState<number | null>(null)
  const [replay, setReplay] = useState<number | null>(null)
  const raf = useRef<number | null>(null)
  const horizon = Math.max(1, risk.series.length - 1)
  const paths = risk.paths ?? []
  const pathDays = risk.path_days ?? []
  const fan = risk.fan ?? []

  const geo = useMemo(() => {
    const values = [0, guard.buffer_paise, ...risk.series.map((p) => p.net_paise), ...paths.flatMap((p) => p.net), ...fan.map((f) => f.p10_paise ?? 0), ...fan.map((f) => f.p90_paise ?? 0)]
    const rawLo = Math.min(...values), rawHi = Math.max(...values)
    const step = niceStep((rawHi - rawLo || 1) / 4)
    const lo = Math.floor(rawLo / step) * step, hi = Math.ceil(rawHi / step) * step
    const span = hi - lo || 1
    const x = (d: number) => PL + (d / horizon) * (W - PL - PR)
    const y = (v: number) => PT + (1 - (v - lo) / span) * (H - PT - PB)
    const line = (days: number[], nets: (number | null)[]) => days.map((d, i) => (nets[i] === null ? '' : `${i === 0 ? 'M' : 'L'}${x(d).toFixed(1)},${y(nets[i] as number).toFixed(1)}`)).join(' ')
    const ticks = Array.from({ length: Math.round(span / step) + 1 }, (_, i) => lo + step * i)
    return { lo, hi, x, y, line, ticks }
  }, [guard.buffer_paise, risk.series, paths, fan, horizon])

  const drawn = useMemo(() => paths.map((p) => ({ d: geo.line(pathDays, p.net), short: p.net.some((v, i) => v < 0 && pathDays[i] <= 30) })), [paths, pathDays, geo])
  const band = useMemo(() => {
    if (!fan.length) return ''
    const top = fan.map((f) => `${geo.x(f.day).toFixed(1)},${geo.y(f.p90_paise).toFixed(1)}`)
    const bottom = [...fan].reverse().map((f) => `${geo.x(f.day).toFixed(1)},${geo.y(f.p10_paise).toFixed(1)}`)
    return `M${top.join(' L')} L${bottom.join(' L')} Z`
  }, [fan, geo])
  const median = useMemo(() => geo.line(fan.map((f) => f.day), fan.map((f) => f.p50_paise)), [fan, geo])
  const plan = useMemo(() => geo.line(risk.series.map((p) => p.day), risk.series.map((p) => p.net_paise)), [risk.series, geo])

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    setReplay(null)
  }, [])
  useEffect(() => stop, [stop])

  const start = () => {
    if (reducedMotion()) { setCursor(null); return }
    setCursor(null)
    const began = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / REPLAY_MS)
      setReplay(progress * horizon)
      if (progress < 1) raf.current = requestAnimationFrame(tick)
      else { raf.current = null; setReplay(null) }
    }
    raf.current = requestAnimationFrame(tick)
  }

  const day = replay !== null ? Math.round(replay) : cursor
  const at = day === null ? null : fan[Math.min(day, fan.length - 1)]
  const nearest = day === null ? -1 : pathDays.reduce((best, d, i) => (Math.abs(d - day) < Math.abs(pathDays[best] - day) ? i : best), 0)
  const below = nearest < 0 ? 0 : paths.filter((p) => p.net[nearest] < 0).length
  const reveal = replay !== null ? geo.x(replay) : W

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (replay !== null) return
    const box = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - box.left) / box.width) * W
    setCursor(Math.max(0, Math.min(horizon, Math.round(((px - PL) / (W - PL - PR)) * horizon))))
  }

  if (!paths.length) {
    return <div className="futures-empty muted">{risk.status === 'INSUFFICIENT_HISTORY' ? 'Not enough payment history to simulate futures yet.' : 'Running the simulated futures…'}</div>
  }

  const chance = risk.shortfall_chance
  return (
    <figure className="futures" aria-label="Simulated futures of net position">
      <div className="futures-head">
        <div className="futures-read" aria-live="polite">
          {at && day !== null ? (
            <>
              <strong>{dayDate(addDays(guard.as_of, day))}</strong>
              <span className="faint mono"> D{day}</span>
              <span className="futures-kv"><i className="fk plan" /> plan {rupees(risk.series[Math.min(day, risk.series.length - 1)].net_paise, { sign: true })}</span>
              <span className="futures-kv"><i className="fk median" /> middle future {rupees(at.p50_paise, { sign: true })}</span>
              <span className="futures-kv"><i className="fk band" /> 1 in 10 worse {rupees(at.p10_paise, { sign: true })}</span>
              <span className={`futures-kv ${below ? 'out' : ''}`}>{below} of {paths.length} drawn futures are below zero</span>
            </>
          ) : (
            <span className="muted">
              {chance ? <><strong className="futures-big">{percent(chance['30'])}</strong> of simulated futures run short within 30 days, <strong>{percent(chance['60'])}</strong> within 60, <strong>{percent(chance['90'])}</strong> within 90.</> : 'Hover the chart to read any day.'}
            </span>
          )}
        </div>
        <button className="btn btn-sm btn-secondary" onClick={replay !== null ? stop : start} aria-pressed={replay !== null}>{replay !== null ? 'Stop' : 'Replay the futures'}</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="futures-svg" role="img" onMouseMove={onMove} onMouseLeave={() => setCursor(null)}
        aria-label={`${paths.length} of ${risk.n_samples ?? 0} simulated futures; ${percent(chance?.['30'])} run short within 30 days`}>
        <defs>
          <clipPath id="futures-reveal"><rect x="0" y="0" width={reveal} height={H} /></clipPath>
        </defs>
        <rect x={PL} y={geo.y(0)} width={W - PL - PR} height={Math.max(0, H - PB - geo.y(0))} className="f-neg" />
        {geo.ticks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={geo.y(t)} y2={geo.y(t)} className="f-grid" />
            <text x={PL - 8} y={geo.y(t) + 4} textAnchor="end" className="f-tick">{compact(t)}</text>
          </g>
        ))}
        {[0, 30, 60, 90].filter((d) => d <= horizon).map((d) => (
          <text key={d} x={geo.x(d)} y={H - 8} textAnchor={d === 0 ? 'start' : 'middle'} className="f-tick">{shortDate(addDays(guard.as_of, d))}</text>
        ))}
        <line x1={PL} x2={W - PR} y1={geo.y(0)} y2={geo.y(0)} className="f-zero" />
        <line x1={PL} x2={W - PR} y1={geo.y(guard.buffer_paise)} y2={geo.y(guard.buffer_paise)} className="f-buffer" />
        <text x={W - PR} y={geo.y(guard.buffer_paise) - 4} textAnchor="end" className="f-label buffer">buffer {compact(guard.buffer_paise)}</text>
        <text x={W - PR} y={geo.y(0) - 4} textAnchor="end" className="f-label zero">zero: cash runs short below this line</text>
        <g clipPath="url(#futures-reveal)">
          <path d={band} className="f-band" />
          {drawn.map((p, i) => <path key={i} d={p.d} className={`f-path${p.short ? ' short' : ''}`} style={{ animationDelay: `${i * 18}ms` }} />)}
          <path d={median} className="f-median" />
          <path d={plan} className="f-plan" />
        </g>
        {day !== null && <line x1={geo.x(day)} x2={geo.x(day)} y1={PT} y2={H - PB} className="f-cursor" />}
      </svg>
      <figcaption className="micro faint">
        Each thin line is one simulated future ({paths.length} of {risk.n_samples} shown, worst to best): the same engine, run again with each customer's delay drawn from their own history. Red lines run short within 30 days.
        The shaded band holds the middle 80% of futures; the white line is the middle one; the dashed line is the plan.
      </figcaption>
    </figure>
  )
}
