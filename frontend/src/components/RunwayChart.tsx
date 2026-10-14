import { useEffect, useMemo, useRef, useState } from 'react'
import { compact, dayDate, rupees, shortDate } from '../lib/format'
import type { Risk, SeriesPoint } from '../lib/types'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** Net position (engine-derived) with the risk fan behind it. */
export function RunwayChart({ series, fan, buffer, window, height = 240, compare }: {
  series: SeriesPoint[]
  fan?: Risk['fan']
  buffer: number
  window: number
  height?: number
  compare?: SeriesPoint[]
}) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const points = series.slice(0, window)
  const band = fan?.slice(0, window)
  const pad = { l: 64, r: 16, t: 14, b: 26 }
  const w = width - pad.l - pad.r
  const h = height - pad.t - pad.b

  const { min, max } = useMemo(() => {
    const values = [...points.map((p) => p.net_paise), buffer, 0, ...(band?.flatMap((b) => [b.p10_paise, b.p90_paise]) ?? []), ...(compare?.slice(0, window).map((p) => p.net_paise) ?? [])]
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const span = hi - lo || 1
    return { min: lo - span * 0.08, max: hi + span * 0.08 }
  }, [points, band, buffer, compare, window])

  if (!points.length) return null
  const x = (day: number) => pad.l + (day / Math.max(1, points.length - 1)) * w
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * h
  const line = (data: { day: number; v: number }[]) => data.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const netPath = line(points.map((p) => ({ day: p.day, v: p.net_paise })))
  const comparePath = compare ? line(compare.slice(0, window).map((p) => ({ day: p.day, v: p.net_paise }))) : null
  const bandPath = band?.length
    ? band.map((b, i) => `${i ? 'L' : 'M'}${x(b.day).toFixed(1)},${y(b.p90_paise).toFixed(1)}`).join('') +
      [...band].reverse().map((b) => `L${x(b.day).toFixed(1)},${y(b.p10_paise).toFixed(1)}`).join('') + 'Z'
    : null
  const p50Path = band?.length ? line(band.map((b) => ({ day: b.day, v: b.p50_paise }))) : null
  const lowest = points.reduce((a, b) => (b.net_paise < a.net_paise ? b : a), points[0])
  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks)
  const xTicks = [0, Math.round((points.length - 1) / 3), Math.round(((points.length - 1) * 2) / 3), points.length - 1]
  const hovered = hover !== null ? points[hover] : null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={`Net position over ${window} days. Lowest ${rupees(lowest.net_paise)} on ${dayDate(lowest.date)}.`}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const day = Math.round(((e.clientX - rect.left - pad.l) / w) * (points.length - 1))
          setHover(day >= 0 && day < points.length ? day : null)
        }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <clipPath id="below-zero"><rect x={pad.l} y={y(0)} width={w} height={Math.max(0, pad.t + h - y(0))} /></clipPath>
        </defs>
        {y(0) < pad.t + h && <rect x={pad.l} y={y(0)} width={w} height={pad.t + h - y(0)} fill="var(--out-wash)" />}
        {yTicks.map((v, i) => (
          <text key={i} x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-3)">{compact(v)}</text>
        ))}
        {xTicks.map((d) => (
          <text key={d} x={x(d)} y={height - 8} textAnchor={d === 0 ? 'start' : d === points.length - 1 ? 'end' : 'middle'} fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-3)">
            {shortDate(points[d].date)}
          </text>
        ))}
        {bandPath && <path d={bandPath} fill="var(--text)" opacity={0.1} />}
        {p50Path && <path d={p50Path} fill="none" stroke="var(--text-2)" strokeWidth={1} strokeDasharray="3 3" />}
        <line x1={pad.l} x2={pad.l + w} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" strokeWidth={1} />
        <line x1={pad.l} x2={pad.l + w} y1={y(buffer)} y2={y(buffer)} stroke="var(--haldi)" strokeWidth={1} strokeDasharray="4 4" />
        <text x={pad.l + w} y={y(buffer) - 4} textAnchor="end" fontSize="11" fill="var(--haldi)">buffer {compact(buffer)}</text>
        {comparePath && <path d={comparePath} fill="none" stroke="var(--text-3)" strokeWidth={1.5} strokeDasharray="2 3" />}
        <path d={netPath} fill="none" stroke="var(--text)" strokeWidth={1.5} />
        <path d={netPath} fill="none" stroke="var(--out)" strokeWidth={1.5} clipPath="url(#below-zero)" />
        {lowest.net_paise < buffer && (
          <g>
            <circle cx={x(lowest.day)} cy={y(lowest.net_paise)} r={3} fill="var(--out)" />
            <text x={Math.min(x(lowest.day) + 6, pad.l + w - 120)} y={Math.min(y(lowest.net_paise) + 16, pad.t + h - 4)} fontSize="11" fontFamily="var(--font-mono)" fill="var(--out)">
              D{lowest.day} · {rupees(lowest.net_paise)}
            </text>
          </g>
        )}
        {hovered && <line x1={x(hovered.day)} x2={x(hovered.day)} y1={pad.t} y2={pad.t + h} stroke="var(--rule-strong)" />}
        {bandPath && <text x={pad.l + 4} y={pad.t + 10} fontSize="11" fill="var(--text-3)">P10 to P90 band</text>}
      </svg>
      {hovered && (
        <div className="popover small" style={{ position: 'absolute', left: Math.min(x(hovered.day) + 10, width - 230), top: 8, padding: '8px 10px', minWidth: 210, pointerEvents: 'none' }}>
          <div className="mono">D{hovered.day} · {dayDate(hovered.date)}</div>
          <div className="row"><span className="grow faint">Cash balance</span><span className="amt">{rupees(hovered.cash_paise)}</span></div>
          <div className="row"><span className="grow faint">Unpaid dues</span><span className="amt amt-out">{rupees(-hovered.unpaid_dues_paise)}</span></div>
          <div className="row"><span className="grow faint">Net position</span><span className={`amt ${hovered.net_paise < 0 ? 'amt-out' : ''}`}>{rupees(hovered.net_paise)}</span></div>
          {band?.[hovered.day] && <div className="row"><span className="grow faint">P10 to P90</span><span className="amt">{compact(band[hovered.day].p10_paise)} to {compact(band[hovered.day].p90_paise)}</span></div>}
        </div>
      )}
    </div>
  )
}

export function RunwayTable({ series, fan, window }: { series: SeriesPoint[]; fan?: Risk['fan']; window: number }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
      <table className="table dense">
        <thead><tr><th>Day</th><th>Date</th><th className="money">Cash</th><th className="money">Unpaid dues</th><th className="money">Net position</th>{fan && <th className="money">P10</th>}{fan && <th className="money">P90</th>}</tr></thead>
        <tbody>
          {series.slice(0, window).map((p) => (
            <tr key={p.day}>
              <td className="mono">D{p.day}</td><td className="mono">{shortDate(p.date)}</td>
              <td className="money">{rupees(p.cash_paise)}</td>
              <td className="money">{p.unpaid_dues_paise ? rupees(-p.unpaid_dues_paise) : '·'}</td>
              <td className={`money ${p.net_paise < 0 ? 'amt-out' : ''}`}>{rupees(p.net_paise)}</td>
              {fan && <td className="money">{fan[p.day] ? rupees(fan[p.day].p10_paise) : '·'}</td>}
              {fan && <td className="money">{fan[p.day] ? rupees(fan[p.day].p90_paise) : '·'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
