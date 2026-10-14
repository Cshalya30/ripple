import { useMemo } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ForecastPoint, ForecastSummary } from '../types'
import { formatCompact, formatINR } from '../lib/format'
import { usePalette } from '../hooks/usePalette'

interface Props {
  series: ForecastPoint[]
  summary: ForecastSummary
  range: 30 | 60 | 90
  afterSeries: number[] | null
}

interface Row {
  day: number
  label: string
  date: string
  balance: number
  inflow: number
  outflow: number
  events: string[]
  after?: number
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="max-w-[240px] rounded-xl border border-line bg-surface px-3.5 py-3 text-sm shadow-lift">
      <p className="text-xs font-medium text-muted">
        {r.date} <span aria-hidden="true">·</span> Day {r.day}
      </p>
      <p className={`num mt-1 font-display text-lg font-bold ${r.balance < 0 ? 'text-loss' : 'text-ink'}`}>{formatINR(r.balance)}</p>
      {r.after !== undefined && <p className="num text-xs font-semibold text-gain">After fix: {formatINR(r.after)}</p>}
      <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs">
        <p className="num flex justify-between gap-4">
          <span className="text-muted">Inflows</span>
          <span className="font-semibold text-gain">{r.inflow ? formatINR(r.inflow, { sign: true }) : '₹0'}</span>
        </p>
        <p className="num flex justify-between gap-4">
          <span className="text-muted">Outflows</span>
          <span className="font-semibold text-loss">{r.outflow ? formatINR(-r.outflow) : '₹0'}</span>
        </p>
      </div>
      {r.events.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {r.events.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface MarkerProps {
  cx?: number
  cy?: number
  day: number
  range: number
  text: string
  color: string
  halo: string
  surface: string
}

function DipMarker({ cx = 0, cy = 0, day, range, text, color, halo, surface }: MarkerProps) {
  const flip = day / range > 0.6
  const x = flip ? cx - 14 : cx + 14
  return (
    <g>
      <circle cx={cx} cy={cy} r={13} fill={halo} opacity={0.25} />
      <circle cx={cx} cy={cy} r={6} fill={color} stroke={surface} strokeWidth={2} />
      <text
        x={x}
        y={cy - 12}
        textAnchor={flip ? 'end' : 'start'}
        fontSize={12}
        fontWeight={700}
        fill={color}
        stroke={surface}
        strokeWidth={4}
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  )
}

export function ForecastChart({ series, summary, range, afterSeries }: Props) {
  const palette = usePalette()
  const reduce = !!useReducedMotion()

  const data: Row[] = useMemo(
    () => series.slice(0, range + 1).map((p) => ({ ...p, after: afterSeries ? afterSeries[p.day] : undefined })),
    [series, range, afterSeries],
  )

  const { strokeOffset, fillOffset, domain } = useMemo(() => {
    const balances = data.map((d) => d.balance)
    const all = afterSeries ? [...balances, ...data.map((d) => d.after ?? 0)] : balances
    const max = Math.max(...balances)
    const min = Math.min(...balances)
    const lo = Math.min(0, min)
    const hi = Math.max(0, max)
    const pad = (Math.max(...all) - Math.min(...all, 0)) * 0.12
    return {
      strokeOffset: min >= 0 ? 1 : max <= 0 ? 0 : max / (max - min),
      fillOffset: hi === lo ? 1 : hi / (hi - lo),
      domain: [Math.min(0, ...all) - pad, Math.max(...all, summary.bufferLevel) + pad] as [number, number],
    }
  }, [data, afterSeries, summary.bufferLevel])

  const labels = useMemo(() => Object.fromEntries(series.map((p) => [p.day, p.label])), [series])
  const ticks = useMemo(() => {
    const step = range === 30 ? 5 : range === 60 ? 10 : 15
    return Array.from({ length: Math.floor(range / step) + 1 }, (_, i) => i * step)
  }, [range])

  const lowestInView = summary.lowest.day <= range
  const dipFrom = summary.dipRange.from
  const dipTo = Math.min(summary.dipRange.to, range)
  const dipVisible = dipFrom <= range
  const shortText = `Day ${summary.lowest.day} · ${formatCompact(Math.abs(summary.lowest.balance))} short`

  return (
    <div
      className="h-[320px] w-full sm:h-[400px]"
      role="img"
      aria-label={`Projected cash balance for the next ${range} days. Lowest point is ${formatINR(summary.lowest.balance)} on day ${summary.lowest.day}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 28, right: 18, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="strokeSplit" x1="0" y1="0" x2="0" y2="1">
              <stop offset={strokeOffset} stopColor={palette.brand} />
              <stop offset={strokeOffset} stopColor={palette.loss} />
            </linearGradient>
            <linearGradient id="fillSplit" x1="0" y1="0" x2="0" y2="1">
              <stop offset={fillOffset} stopColor={palette.brand} stopOpacity={0.2} />
              <stop offset={fillOffset} stopColor={palette.loss} stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={palette.line} strokeDasharray="3 4" />
          <XAxis
            dataKey="day"
            type="number"
            domain={[0, range]}
            ticks={ticks}
            tickFormatter={(d: number) => labels[d] ?? ''}
            tick={{ fill: palette.muted, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: palette.line }}
            padding={{ left: 4, right: 4 }}
          />
          <YAxis
            domain={domain}
            tickFormatter={(v: number) => formatCompact(v)}
            tick={{ fill: palette.muted, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          {dipVisible && <ReferenceArea x1={dipFrom} x2={dipTo} fill={palette.loss} fillOpacity={0.12} stroke={palette.loss} strokeOpacity={0.35} strokeDasharray="4 4" ifOverflow="hidden" />}
          <ReferenceLine y={0} stroke={palette.muted} strokeOpacity={0.5} />
          <ReferenceLine y={summary.bufferLevel} stroke={palette.warn} strokeDasharray="6 5" label={{ value: 'Safety buffer', position: 'insideTopRight', fill: palette.warn, fontSize: 12, fontWeight: 600 }} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: palette.muted, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="balance" stroke="url(#strokeSplit)" strokeWidth={2.75} fill="url(#fillSplit)" baseValue={0} isAnimationActive={!reduce} dot={false} activeDot={{ r: 5 }} />
          {afterSeries && <Line type="monotone" dataKey="after" stroke={palette.gain} strokeWidth={2.75} strokeDasharray="7 5" dot={false} isAnimationActive={!reduce} />}
          {lowestInView && (
            <ReferenceDot
              x={summary.lowest.day}
              y={summary.lowest.balance}
              ifOverflow="extendDomain"
              shape={(p: { cx?: number; cy?: number }) => (
                <DipMarker cx={p.cx} cy={p.cy} day={summary.lowest.day} range={range} text={shortText} color={palette.loss} halo={palette.loss} surface={palette.surface} />
              )}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
