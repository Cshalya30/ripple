import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow, useStore, useViewport, type Node, type NodeProps } from '@xyflow/react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Glyph, type GlyphName } from '../components/Glyph'
import { compact, rupees, shortDate } from '../lib/format'
import { useDayLog } from '../lib/queries'
import { useUI } from '../lib/store'
import type { DecisionRow, EngineEvent, RunPayload } from '../lib/types'
import { DayBrief } from './DayBrief'
import { amountText, changeOf, deltaText, LANE_ROW, NODE_H, NODE_W, phaseAt, PX_PER_DAY, stateText, upstreamChain, waitOn, type Change, type Phase } from './model'
import { nodeRect, roundedPath, routeLink, type Point, type Rect } from './router'

const LABEL_W = 180
const ROW = LANE_ROW + 12
const CASH_H = 40
const WAIT_DY = NODE_H + 4

type LinkKind = 'idle' | 'future' | 'traveled' | 'live' | 'chain' | 'hover'
interface LinkPath { id: string; from: string; to: string; d: string; end: Point; start: Point; lag: number; kind: LinkKind }
interface Shift { id: string; d: string; x: number; y: number; text: string; end: Point; dir: 1 | -1 }
type EventData = {
  e: EngineEvent; foot: string; amount: string; phase: Phase; spot: boolean; order: number | null; selected: boolean; chain: boolean
  dim: boolean; change: Change | null; calm: boolean; day: number
}

// ---------------------------------------------------------------- nodes

const EventNode = memo(({ data }: NodeProps<Node<EventData>>) => {
  const e = data.e
  const cls = ['enode', e.state === 'EXECUTED' ? '' : e.state === 'BLOCKED' ? 'blocked' : 'pending', e.lateness_days ? 'late' : '',
    data.spot ? `ph-${data.phase}` : '', data.selected ? 'selected' : '', data.chain && !data.selected ? 'chain' : '', data.dim ? 'dim' : '',
    data.change ? (data.change.kind === 'new' ? 'isnew' : 'changed') : '', data.calm ? 'calm' : ''].filter(Boolean).join(' ')
  const day = e.executed_day ?? e.due_day ?? e.earliest_day
  return (
    <div className={cls} aria-label={`${e.label}. ${data.foot}. ${data.amount}`}>
      {data.order !== null && <span className="en-order" aria-label={`Number ${data.order} today`}>{data.order}</span>}
      {data.change && <span className="en-delta">{deltaText(data.change.deltaDays)}</span>}
      <div className="en-head">
        <Glyph name={e.type as GlyphName} size={12} style={{ color: e.direction === 'IN' ? 'var(--in)' : e.direction === 'OUT' ? 'var(--out)' : 'var(--text-2)', flex: 'none' }} />
        <span className="en-label">{e.label}</span>
        <span className="en-day">D{day}</span>
      </div>
      <div className={`en-body ${e.direction === 'IN' ? 'amt-in' : e.direction === 'OUT' ? 'amt-out' : ''}`}>{data.amount}</div>
      <div className="en-foot">{data.foot}</div>
    </div>
  )
})

const WaitBar = memo(({ data }: NodeProps<Node<{ width: number; label: string; filled: number; state: 'past' | 'now' | 'future' }>>) => (
  <div className={`waitbar ${data.state}`} style={{ width: data.width }}>
    <i style={{ width: data.filled }} />
    <span>{data.label}</span>
  </div>
))

const LaneBand = memo(({ data }: NodeProps<Node<{ width: number; height: number; odd: boolean }>>) => (
  <div className={`laneband${data.odd ? ' odd' : ''}`} style={{ width: data.width, height: data.height }} />
))

const Ghost = memo(({ data }: NodeProps<Node<{ label: string; was: number | null; removed: boolean }>>) => (
  <div className={`ghost${data.removed ? ' removed' : ''}`}>
    <span className="ghost-label">{data.label}</span>
    <span className="ghost-was">{data.removed ? 'baseline, replaced' : `baseline${data.was !== null ? ` D${data.was}` : ''}`}</span>
  </div>
))

const DayBand = memo(({ data }: NodeProps<Node<{ height: number; day: number }>>) => (
  <div className="dayband" style={{ height: data.height, width: PX_PER_DAY }} aria-label={`Day ${data.day}`}><span>D{data.day}</span></div>
))

const Links = memo(({ data }: NodeProps<Node<{ paths: LinkPath[]; width: number; height: number; shifts: Shift[] }>>) => (
  <svg className="links" width={data.width} height={data.height} aria-hidden="true">
    {data.paths.map((p) => (
      <g key={p.id} className={`fl ${p.kind}`}>
        <path d={p.d} fill="none" />
        {(p.kind === 'live' || p.kind === 'chain' || p.kind === 'hover') && <path className="fl-arrow" d={`M${p.end[0] - 7},${p.end[1] - 4} L${p.end[0]},${p.end[1]} L${p.end[0] - 7},${p.end[1] + 4} Z`} />}
        {(p.kind === 'chain' || p.kind === 'hover') && p.lag > 0 && <text x={p.start[0] + 10} y={p.start[1] - 5} className="fl-lag">+{p.lag}d</text>}
      </g>
    ))}
    {data.shifts.map((s) => (
      <g key={s.id} className="fl shift">
        <path d={s.d} fill="none" />
        <path className="fl-arrow" d={`M${s.end[0] - 7 * s.dir},${s.end[1] - 4} L${s.end[0]},${s.end[1]} L${s.end[0] - 7 * s.dir},${s.end[1] + 4} Z`} />
        <text x={s.x} y={s.y - 4} textAnchor="middle" className="fl-lag shift-text">{s.text}</text>
      </g>
    ))}
  </svg>
))

type RailsData = { run: RunPayload; baseline: RunPayload | null; width: number; height: number; day: number }

/** Shared pools across the top: daily cash (with buffer and zero) and stock per material. */
const Rails = memo(({ data }: NodeProps<Node<RailsData>>) => {
  const { run, width, baseline, day } = data
  const n = run.series.length
  const cash = run.series.map((p) => p.cash_paise)
  const net = run.series.map((p) => p.net_paise)
  const baseCash = baseline && baseline.series.length === n ? baseline.series.map((p) => p.cash_paise) : null
  const hi = Math.max(...cash, ...(baseCash ?? []), run.summary.buffer_paise, 1)
  const lo = Math.min(0, ...net)
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (CASH_H - 8)
  const x = (d: number) => LABEL_W + d * PX_PER_DAY
  const path = (series: number[]) => series.map((v, d) => `${d ? 'L' : 'M'}${x(d)},${y(v)}`).join(' ')
  const area = `M${x(0)},${y(0)} ` + cash.map((v, d) => `L${x(d)},${y(v)}`).join(' ') + ` L${x(n - 1)},${y(0)} Z`
  const stocks = run.stock.filter((s) => s.series.some((q) => q > 0))
  const d = Math.min(day, n - 1)
  return (
    <svg className="rails" width={width} height={data.height} style={{ overflow: 'visible' }}>
      <path d={area} fill="var(--text)" opacity={0.08} />
      {baseCash && <path d={path(baseCash)} fill="none" stroke="var(--text-3)" strokeWidth={1.2} strokeDasharray="4 3" />}
      <path d={path(cash)} fill="none" stroke="var(--text-2)" strokeWidth={1} />
      <path d={path(net)} fill="none" stroke="var(--out)" strokeWidth={1} strokeDasharray="2 2" opacity={net.some((v) => v < 0) ? 1 : 0} />
      <line x1={x(0)} x2={x(n - 1)} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" />
      <line x1={x(0)} x2={x(n - 1)} y1={y(run.summary.buffer_paise)} y2={y(run.summary.buffer_paise)} stroke="var(--haldi)" strokeDasharray="4 4" />
      {Array.from({ length: Math.ceil(n / 7) }, (_, i) => i * 7).map((dd) => (
        <text key={dd} x={x(dd)} y={-4} fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-3)">D{dd} {shortDate(run.series[dd].date)}</text>
      ))}
      <circle cx={x(d) + PX_PER_DAY / 2} cy={y(cash[d])} r={4} fill="var(--haldi)" stroke="var(--ground)" strokeWidth={1.5} />
      <text x={x(d) + PX_PER_DAY / 2 + 8} y={y(cash[d]) + 3} fontSize="10" fontFamily="var(--font-mono)" fill="var(--haldi)">{compact(cash[d])}</text>
      {stocks.map((s, i) => {
        const top = CASH_H + 8 + i * 16
        const max = Math.max(...s.series, 1)
        return (
          <g key={s.material_id}>
            {s.series.map((q, dd) => (
              <rect key={dd} x={x(dd)} y={top + 12 - (q / max) * 11} width={PX_PER_DAY - 1} height={(q / max) * 11} fill={q === 0 ? 'var(--out)' : dd === d ? 'var(--haldi)' : 'var(--text-3)'} opacity={q === 0 ? 0.6 : dd === d ? 0.9 : 0.35} />
            ))}
          </g>
        )
      })}
    </svg>
  )
})

const NO_ROWS: DecisionRow[] = []

const nodeTypes = { event: EventNode, waitbar: WaitBar, laneBand: LaneBand, ghost: Ghost, dayband: DayBand, rails: Rails, links: Links }

// ---------------------------------------------------------------- camera

/** Keeps what is happening on the chosen day in view as the day changes. */
function FollowDay({ positions, activeIds, day, enabled, reduceMotion }: { positions: Map<string, { x: number; y: number }>; activeIds: string[]; day: number; enabled: boolean; reduceMotion: boolean }) {
  const rf = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!enabled || !width || !height) return
    // Only pans, never zooms: at the zoom you chose, boxes stay readable. It moves only when the day's
    // activity would otherwise drift out of the comfortable middle of the screen.
    const vp = rf.getViewport()
    const duration = reduceMotion ? 0 : 450
    const spots = activeIds.map((id) => positions.get(id)).filter((p): p is { x: number; y: number } => !!p)
    let cx = LABEL_W + day * PX_PER_DAY + PX_PER_DAY / 2
    let cy = (height / 2 - vp.y) / vp.zoom
    let comfortable = (sx: number, _sy: number) => sx > width * 0.3 && sx < width * 0.75
    if (spots.length) {
      const minX = Math.min(...spots.map((p) => p.x))
      const maxX = Math.max(...spots.map((p) => p.x + NODE_W))
      const minY = Math.min(...spots.map((p) => p.y))
      const maxY = Math.max(...spots.map((p) => p.y + NODE_H))
      cx = (minX + maxX) / 2
      // Everything fits on screen: centre on all of it. Otherwise start with the first thing that runs (activeIds is in execution order).
      cy = (maxY - minY) * vp.zoom < height * 0.7 ? (minY + maxY) / 2 : spots[0].y + NODE_H / 2
      comfortable = (sx, sy) => sx > width * 0.3 && sx < width * 0.75 && sy > height * 0.2 && sy < height * 0.8
    }
    if (comfortable(cx * vp.zoom + vp.x, cy * vp.zoom + vp.y)) return
    void rf.setCenter(cx, cy, { zoom: vp.zoom, duration })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])
  return null
}

interface RailLabel { id: string; y: number; h: number; text: string; sub?: string; minZoom?: number }

/** Lane and pool names pinned to the left edge, so you always know which row you are looking at however far you pan. */
function LaneRail({ labels }: { labels: RailLabel[] }) {
  const { y, zoom } = useViewport()
  return (
    <div className="lanerail" aria-hidden="true">
      {labels.map((l) => {
        const top = l.y * zoom + y
        return top > -120 && top < 6000 && zoom >= (l.minZoom ?? 0) ? (
          <div key={l.id} className="lr" style={{ top, height: Math.max(14, l.h * zoom) }}>
            <span>{l.text}</span>{l.sub && <em>{l.sub}</em>}
          </div>
        ) : null
      })}
    </div>
  )
}

function FocusSelected({ positions }: { positions: Map<string, { x: number; y: number }> }) {
  const selected = useUI((s) => s.selectedEventId)
  const { setCenter, getZoom } = useReactFlow()
  useEffect(() => {
    const p = selected ? positions.get(selected) : undefined
    if (p) void setCenter(p.x + NODE_W / 2, p.y + NODE_H / 2, { zoom: Math.max(getZoom(), 0.9), duration: 300 })
  }, [selected, positions, setCenter, getZoom])
  return null
}

// ---------------------------------------------------------------- the view

function footText(e: EngineEvent, phase: Phase, day: number, byId: Map<string, EngineEvent>): string {
  if (phase === 'active') return e.lateness_days ? `Happens today, ${e.lateness_days}d late` : 'Happens today'
  if (phase === 'done') return e.lateness_days ? `Done D${e.executed_day}, ${e.lateness_days}d late` : `Done D${e.executed_day}`
  if (phase === 'waiting') {
    const w = waitOn(e, day)
    const reason = w?.code === 'INSUFFICIENT_INVENTORY' ? 'not enough material' : 'not enough cash'
    return `Held ${w ? day - w.from_day + 1 : 1}d: ${reason}`
  }
  if (e.executed_day !== null) return `Will happen D${e.executed_day}${e.lateness_days ? `, ${e.lateness_days}d late` : ''}`
  return stateText(e, byId)
}

export function FlowView({ run, baseline }: { run: RunPayload; baseline?: RunPayload | null }) {
  const day = useUI((s) => s.day)
  const selected = useUI((s) => s.selectedEventId)
  const selectedParty = useUI((s) => s.selectedPartyId)
  const spotlight = useUI((s) => s.spotlight)
  const diff = useUI((s) => s.diff)
  const scenario = useUI((s) => s.scenario)
  const playing = useUI((s) => s.playing)
  const { selectEvent, setSpotlight } = useUI.getState()
  const [hover, setHover] = useState<string | null>(null)
  const reduceMotion = typeof window !== 'undefined' && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce')
  const log = useDayLog(day, scenario?.key)
  const rows: DecisionRow[] = log.data?.day === day ? log.data.rows : NO_ROWS

  // Layout that depends only on the run: where each box sits, and the routed lines between them.
  const layout = useMemo(() => {
    const byId = new Map(run.events.map((e) => [e.id, e]))
    const stocks = run.stock.filter((s) => s.series.some((q) => q > 0)).length
    const railsH = CASH_H + 16 + stocks * 16
    const width = LABEL_W + run.horizon_days * PX_PER_DAY + 200
    const positions = new Map<string, { x: number; y: number }>()
    const lanes: { id: string; label: string; y: number; h: number; ids: string[] }[] = []
    const obstacles: Rect[] = []
    let y = railsH + 28
    for (const lane of run.lanes) {
      const laneEvents = run.events.filter((e) => e.lane === lane.id)
      if (!laneEvents.length) continue
      const rows = Math.max(1, ...laneEvents.map((e) => e.row + 1))
      const h = rows * ROW + 12
      for (const e of laneEvents) {
        const pos = { x: LABEL_W + e.x_day * PX_PER_DAY, y: y + 10 + e.row * ROW }
        positions.set(e.id, pos)
        obstacles.push(nodeRect(e.id, pos.x, pos.y))
        const resource = e.waits.filter((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY')
        if (resource.length) {
          const from = resource[0].from_day
          const to = e.executed_day ?? run.horizon_days
          obstacles.push({ id: `wait-${e.id}`, x: LABEL_W + from * PX_PER_DAY, y: pos.y + WAIT_DY, w: Math.max(8, (to - from) * PX_PER_DAY) + 80, h: 22 })
        }
      }
      lanes.push({ id: lane.id, label: lane.label, y, h, ids: laneEvents.map((e) => e.id) })
      y += h
    }
    const links = run.events.flatMap((e) => e.depends_on.filter((d) => byId.has(d.event_id)).map((d) => {
      const a = positions.get(d.event_id)!
      const b = positions.get(e.id)!
      const points = routeLink(nodeRect(d.event_id, a.x, a.y), nodeRect(e.id, b.x, b.y), obstacles)
      return { id: `${d.event_id}->${e.id}`, from: d.event_id, to: e.id, d: roundedPath(points), start: points[0], end: points.at(-1)!, lag: d.lag_days }
    }))
    const hi = Math.max(...run.series.map((p) => p.cash_paise), run.summary.buffer_paise, 1)
    const labels: RailLabel[] = [{ id: 'cash', y: 4, h: CASH_H - 8, text: 'Cash pool', sub: `up to ${compact(hi)}`, minZoom: 0.4 }]
    run.stock.filter((st) => st.series.some((q) => q > 0)).forEach((st, i) => labels.push({ id: `stock-${st.material_id}`, y: CASH_H + 8 + i * 16, h: 14, text: st.name, minZoom: 0.75 }))
    for (const lane of lanes) labels.push({ id: `lane-${lane.id}`, y: lane.y + 6, h: Math.min(lane.h - 6, 44), text: lane.label })
    return { byId, railsH, width, height: y + 20, positions, lanes, links, labels }
  }, [run])

  const baseById = useMemo(() => (baseline ? new Map(baseline.events.map((e) => [e.id, e])) : null), [baseline])
  const showDiff = !!baseById && diff

  // Everything that changes with the chosen day, the selection and the spotlight.
  const graph = useMemo(() => {
    const { byId, positions } = layout
    const chain = selected ? upstreamChain(selected, byId) : new Set<string>()
    const order = new Map<string, number>()
    rows.filter((r) => r.outcome === 'EXECUTED').sort((a, b) => a.seq - b.seq).forEach((r, i) => order.set(r.event_id, i + 1))
    const phases = new Map(run.events.map((e) => [e.id, phaseAt(e, day)]))
    const activeIds = run.events.filter((e) => phases.get(e.id) === 'active').map((e) => e.id).sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
    const nodes: Node[] = []
    nodes.push({ id: 'rails', type: 'rails', position: { x: 0, y: 0 }, draggable: false, selectable: false, focusable: false, zIndex: 1, data: { run, baseline: showDiff ? baseline : null, width: layout.width, height: layout.railsH, day } })
    layout.lanes.forEach((lane, i) => {
      nodes.push({ id: `band-${lane.id}`, type: 'laneBand', position: { x: 0, y: lane.y }, draggable: false, selectable: false, focusable: false, data: { width: layout.width, height: lane.h, odd: i % 2 === 1 }, zIndex: -4 })
    })
    nodes.push({ id: 'dayband', type: 'dayband', position: { x: LABEL_W + day * PX_PER_DAY, y: 0 }, draggable: false, selectable: false, focusable: false, zIndex: -3, data: { height: layout.height, day } })

    const shifts: Shift[] = []
    for (const e of run.events) {
      const pos = positions.get(e.id)!
      const phase = phases.get(e.id)!
      const change = showDiff ? changeOf(e, baseById, run.horizon_days) : null
      nodes.push({
        id: e.id, type: 'event', position: pos, draggable: false,
        data: {
          e, foot: spotlight ? footText(e, phase, day, byId) : stateText(e, byId), amount: amountText(e, run.stock), phase, spot: spotlight, order: order.get(e.id) ?? null,
          selected: selected === e.id, chain: chain.has(e.id), dim: !!selectedParty && e.party_id !== selectedParty, change, calm: showDiff && !change, day,
        } satisfies EventData,
      })
      const resource = e.waits.filter((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY')
      if (resource.length) {
        const from = resource[0].from_day
        const to = e.executed_day ?? run.horizon_days
        const cash = resource.find((w) => w.code === 'INSUFFICIENT_CASH')
        const inv = resource.find((w) => w.code === 'INSUFFICIENT_INVENTORY')
        const label = cash ? `short ${rupees(cash.max_shortfall_paise ?? cash.first_details.shortfall_paise)} · ${to - from}d` : inv ? `waiting for material · ${to - from}d` : ''
        const w = Math.max(8, (to - from) * PX_PER_DAY)
        const filled = Math.max(0, Math.min(w, (day - from + 1) * PX_PER_DAY))
        nodes.push({
          id: `wait-${e.id}`, type: 'waitbar', draggable: false, selectable: false, focusable: false, zIndex: -1,
          position: { x: LABEL_W + from * PX_PER_DAY, y: pos.y + WAIT_DY },
          data: { width: w, label, filled: spotlight ? filled : 0, state: !spotlight ? 'past' : day < from ? 'future' : day <= to - 1 ? 'now' : 'past' },
        })
      }
      if (showDiff && change && change.kind === 'moved') {
        const b = baseById!.get(e.id)!
        if (b.executed_day !== null && b.x_day !== e.x_day) {
          const gx = LABEL_W + b.x_day * PX_PER_DAY
          nodes.push({ id: `ghost-${e.id}`, type: 'ghost', position: { x: gx, y: pos.y }, draggable: false, selectable: false, focusable: false, data: { label: e.label, was: b.executed_day, removed: false }, zIndex: -1 })
          const ay = pos.y - 7
          const fromX = gx + NODE_W / 2
          const toX = pos.x + NODE_W / 2
          if (Math.abs(toX - fromX) > 14) shifts.push({ id: `shift-${e.id}`, d: `M${fromX},${ay} L${toX},${ay}`, x: (fromX + toX) / 2, y: ay, text: deltaText(change.deltaDays), end: [toX, ay], dir: toX > fromX ? 1 : -1 })
        }
      }
    }
    if (showDiff && scenario) {
      const rowsOf = new Map<string, number>()
      for (const id of scenario.evaluation.removed_events) {
        const b = baseById?.get(id)
        if (!b) continue
        const lane = layout.lanes.find((l) => l.id === b.lane)
        if (!lane) continue
        const slot = rowsOf.get(b.lane) ?? 0
        rowsOf.set(b.lane, slot + 1)
        nodes.push({ id: `gone-${id}`, type: 'ghost', position: { x: LABEL_W + b.x_day * PX_PER_DAY, y: lane.y + 10 + Math.min(slot, Math.max(0, Math.round(lane.h / ROW) - 1)) * ROW }, draggable: false, selectable: false, focusable: false, data: { label: b.label, was: b.executed_day, removed: true }, zIndex: -1 })
      }
    }

    const live = new Set(['done', 'active'])
    const paths: LinkPath[] = layout.links.map((l) => {
      const sp = phases.get(l.from)!
      const tp = phases.get(l.to)!
      let kind: LinkKind = 'idle'
      if (selected && chain.has(l.from) && chain.has(l.to)) kind = 'chain'
      else if (spotlight) kind = live.has(sp) && tp === 'active' ? 'live' : live.has(sp) && live.has(tp) ? 'traveled' : 'future'
      return { ...l, kind }
    })
    return { nodes, activeIds, paths, shifts }
  }, [layout, run, baseline, baseById, showDiff, scenario, rows, day, selected, selectedParty, spotlight])

  // Hovering a box only restyles its lines. Kept out of the big memo above so moving the mouse never rebuilds the boxes.
  const nodes = useMemo(() => {
    const rank: Record<LinkKind, number> = { future: 0, idle: 1, traveled: 2, live: 3, chain: 4, hover: 5 }
    const paths = graph.paths.map((p): LinkPath => (hover && p.kind !== 'chain' && (p.from === hover || p.to === hover) ? { ...p, kind: 'hover' } : p))
    paths.sort((a, b) => rank[a.kind] - rank[b.kind])
    const links: Node = { id: 'links', type: 'links', position: { x: 0, y: 0 }, draggable: false, selectable: false, focusable: false, zIndex: -2, data: { paths, width: layout.width, height: layout.height, shifts: graph.shifts } }
    return [...graph.nodes, links]
  }, [graph, hover, layout.width, layout.height])

  return (
    <div className="flow-wrap">
      <ReactFlow
        nodes={nodes} edges={[]} nodeTypes={nodeTypes}
        defaultViewport={{ x: 20 - Math.max(0, day - 10) * PX_PER_DAY * 0.85, y: 30, zoom: 0.85 }} minZoom={0.2} maxZoom={1.6}
        nodesConnectable={false} nodesDraggable={false} onlyRenderVisibleElements
        onNodeClick={(_, n) => n.type === 'event' && selectEvent(n.id)}
        onNodeMouseEnter={(_, n) => n.type === 'event' && setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        onPaneClick={() => selectEvent(null)}
        proOptions={{ hideAttribution: true }}
        aria-label="Flow: the events the engine runs, by day"
      >
        <LaneRail labels={layout.labels} />
        <FocusSelected positions={layout.positions} />
        <FollowDay positions={layout.positions} activeIds={graph.activeIds} day={day} enabled={spotlight} reduceMotion={reduceMotion} />
        <Background variant={BackgroundVariant.Lines} gap={[PX_PER_DAY * 7, 4000]} color="var(--rule)" style={{ opacity: 0.5 }} />
        <MiniMap pannable zoomable position="bottom-left" style={{ width: 150, height: 90 }}
          nodeColor={(n) => {
            if (n.type !== 'event') return 'transparent'
            const d = n.data as EventData
            return d.phase === 'active' ? 'var(--haldi)' : d.phase === 'waiting' || d.e.state === 'BLOCKED' ? 'var(--out)' : d.phase === 'done' ? 'var(--text-2)' : 'var(--text-3)'
          }} maskColor="rgba(0,0,0,0.35)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <DayBrief run={run} baseline={showDiff ? baseline ?? null : null} rows={rows} loading={log.isLoading} playing={playing} />
      <div className="flow-legend" role="group" aria-label="Flow display">
        <label className="check micro"><input type="checkbox" checked={spotlight} onChange={(e) => setSpotlight(e.target.checked)} /> Spotlight the chosen day</label>
        {spotlight && (
          <span className="legend-keys">
            <span><i className="k active" /> happening now</span><span><i className="k done" /> already happened</span><span><i className="k waiting" /> held up</span><span><i className="k upcoming" /> still to come</span>
          </span>
        )}
        {showDiff && <span className="legend-keys"><span><i className="k changed" /> moved by this what-if</span><span><i className="k ghost" /> where it was</span></span>}
      </div>
    </div>
  )
}
