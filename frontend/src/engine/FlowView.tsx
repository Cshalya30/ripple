import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react'
import { memo, useEffect, useMemo } from 'react'
import { Glyph, type GlyphName } from '../components/Glyph'
import { compact, rupees, shortDate } from '../lib/format'
import { useUI } from '../lib/store'
import type { EngineEvent, RunPayload } from '../lib/types'
import { amountText, LANE_ROW, PX_PER_DAY, stateText, upstreamChain } from './model'

const LABEL_W = 180
const ROW = LANE_ROW + 12
const CASH_H = 40

type EventData = { e: EngineEvent; foot: string; amount: string; selected: boolean; chain: boolean; dim: boolean; ripple: number | null }

const EventNode = memo(({ data }: NodeProps<Node<EventData>>) => {
  const e = data.e
  const cls = ['enode', e.state === 'EXECUTED' ? '' : e.state === 'BLOCKED' ? 'blocked' : 'pending', e.lateness_days ? 'late' : '',
    data.selected ? 'selected' : '', data.chain && !data.selected ? 'chain' : '', data.dim ? 'dim' : '', data.ripple !== null ? 'rippled' : ''].join(' ')
  const day = e.executed_day ?? e.due_day ?? e.earliest_day
  return (
    <div className={cls} style={data.ripple !== null ? { animationDelay: `${data.ripple}ms` } : undefined}
      aria-label={`${e.label}. ${data.foot}. ${data.amount}`}>
      <Handle type="target" position={Position.Left} />
      <div className="en-head">
        <Glyph name={e.type as GlyphName} size={12} style={{ color: e.direction === 'IN' ? 'var(--in)' : e.direction === 'OUT' ? 'var(--out)' : 'var(--text-2)', flex: 'none' }} />
        <span className="en-label">{e.label}</span>
        <span className="en-day">D{day}</span>
      </div>
      <div className={`en-body ${e.direction === 'IN' ? 'amt-in' : e.direction === 'OUT' ? 'amt-out' : ''}`}>{data.amount}</div>
      <div className="en-foot">{data.foot}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
})

const WaitBar = memo(({ data }: NodeProps<Node<{ width: number; label: string }>>) => (
  <div className="waitbar" style={{ width: data.width }}><span>{data.label}</span></div>
))

const LaneLabel = memo(({ data }: NodeProps<Node<{ label: string; height: number }>>) => (
  <div className="lanelabel" style={{ height: data.height, lineHeight: '16px', paddingTop: 8 }}>{data.label}</div>
))

const LaneBand = memo(({ data }: NodeProps<Node<{ width: number }>>) => <div className="laneband" style={{ width: data.width }} />)

const Ghost = memo(() => <div className="ghost" />)

const Playhead = memo(({ data }: NodeProps<Node<{ height: number; day: number }>>) => (
  <div className="playhead" style={{ height: data.height }} aria-label={`Day ${data.day}`} />
))

type RailsData = { run: RunPayload; width: number; height: number }

/** Shared pools across the top: daily cash (with buffer and zero) and stock per material. */
const Rails = memo(({ data }: NodeProps<Node<RailsData>>) => {
  const { run, width } = data
  const n = run.series.length
  const cash = run.series.map((p) => p.cash_paise)
  const net = run.series.map((p) => p.net_paise)
  const hi = Math.max(...cash, run.summary.buffer_paise, 1)
  const lo = Math.min(0, ...net)
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (CASH_H - 8)
  const x = (d: number) => LABEL_W + d * PX_PER_DAY
  const area = `M${x(0)},${y(0)} ` + cash.map((v, d) => `L${x(d)},${y(v)}`).join(' ') + ` L${x(n - 1)},${y(0)} Z`
  const netLine = net.map((v, d) => `${d ? 'L' : 'M'}${x(d)},${y(v)}`).join(' ')
  const stocks = run.stock.filter((s) => s.series.some((q) => q > 0))
  return (
    <svg className="rails" width={width} height={data.height} style={{ overflow: 'visible' }}>
      <text x={LABEL_W - 10} y={16} textAnchor="end" fontSize="11" fill="var(--text-2)">Cash pool</text>
      <text x={LABEL_W - 10} y={30} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-3)">{compact(hi)}</text>
      <path d={area} fill="var(--text)" opacity={0.08} />
      <path d={cash.map((v, d) => `${d ? 'L' : 'M'}${x(d)},${y(v)}`).join(' ')} fill="none" stroke="var(--text-2)" strokeWidth={1} />
      <path d={netLine} fill="none" stroke="var(--out)" strokeWidth={1} strokeDasharray="2 2" opacity={net.some((v) => v < 0) ? 1 : 0} />
      <line x1={x(0)} x2={x(n - 1)} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" />
      <line x1={x(0)} x2={x(n - 1)} y1={y(run.summary.buffer_paise)} y2={y(run.summary.buffer_paise)} stroke="var(--haldi)" strokeDasharray="4 4" />
      {Array.from({ length: Math.ceil(n / 7) }, (_, i) => i * 7).map((d) => (
        <text key={d} x={x(d)} y={-4} fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-3)">D{d} {shortDate(run.series[d].date)}</text>
      ))}
      {stocks.map((s, i) => {
        const top = CASH_H + 8 + i * 16
        const max = Math.max(...s.series, 1)
        return (
          <g key={s.material_id}>
            <text x={LABEL_W - 10} y={top + 10} textAnchor="end" fontSize="10" fill="var(--text-3)">{s.name.length > 24 ? s.name.slice(0, 23) + '…' : s.name}</text>
            {s.series.map((q, d) => (
              <rect key={d} x={x(d)} y={top + 12 - (q / max) * 11} width={PX_PER_DAY - 1} height={(q / max) * 11} fill={q === 0 ? 'var(--out)' : 'var(--text-3)'} opacity={q === 0 ? 0.6 : 0.35} />
            ))}
          </g>
        )
      })}
    </svg>
  )
})

const nodeTypes = { event: EventNode, waitbar: WaitBar, laneLabel: LaneLabel, laneBand: LaneBand, ghost: Ghost, playhead: Playhead, rails: Rails }

function FocusSelected({ positions }: { positions: Map<string, { x: number; y: number }> }) {
  const selected = useUI((s) => s.selectedEventId)
  const { setCenter, getZoom } = useReactFlow()
  useEffect(() => {
    const p = selected ? positions.get(selected) : undefined
    if (p) void setCenter(p.x + 76, p.y + 26, { zoom: Math.max(getZoom(), 0.9), duration: 300 })
  }, [selected, positions, setCenter, getZoom])
  return null
}

export function FlowView({ run, baseline }: { run: RunPayload; baseline?: RunPayload | null }) {
  const ui = useUI()
  const day = ui.day
  const selected = ui.selectedEventId
  const reduceMotion = typeof window !== 'undefined' && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce')

  const graph = useMemo(() => {
    const byId = new Map(run.events.map((e) => [e.id, e]))
    const chain = selected ? upstreamChain(selected, byId) : new Set<string>()
    const party = ui.selectedPartyId
    const stocks = run.stock.filter((s) => s.series.some((q) => q > 0)).length
    const railsH = CASH_H + 16 + stocks * 16
    const width = LABEL_W + run.horizon_days * PX_PER_DAY + 160
    const nodes: Node[] = []
    const edges: Edge[] = []
    const positions = new Map<string, { x: number; y: number }>()
    const baseById = baseline ? new Map(baseline.events.map((e) => [e.id, e])) : null
    const changed = new Map<string, number>()
    if (baseById) {
      for (const e of run.events) {
        const b = baseById.get(e.id)
        if (!b || b.executed_day !== e.executed_day) changed.set(e.id, e.executed_day ?? run.horizon_days)
      }
    }
    const minChanged = changed.size ? Math.min(...changed.values()) : 0

    nodes.push({ id: 'rails', type: 'rails', position: { x: 0, y: 0 }, draggable: false, selectable: false, focusable: false, data: { run, width, height: railsH } })
    let y = railsH + 24
    for (const lane of run.lanes) {
      const laneEvents = run.events.filter((e) => e.lane === lane.id)
      if (!laneEvents.length) continue
      const rows = Math.max(1, ...laneEvents.map((e) => e.row + 1))
      const h = rows * ROW + 8
      nodes.push({ id: `band-${lane.id}`, type: 'laneBand', position: { x: 0, y }, draggable: false, selectable: false, focusable: false, data: { width }, zIndex: -1 })
      nodes.push({ id: `lane-${lane.id}`, type: 'laneLabel', position: { x: 0, y }, draggable: false, selectable: false, focusable: false, data: { label: lane.label, height: h } })
      for (const e of laneEvents) {
        const pos = { x: LABEL_W + e.x_day * PX_PER_DAY, y: y + 8 + e.row * ROW }
        positions.set(e.id, pos)
        const ripple = changed.has(e.id) && ui.diff ? (reduceMotion ? 0 : Math.min(1500, (changed.get(e.id)! - minChanged) * 60)) : null
        nodes.push({
          id: e.id, type: 'event', position: pos, draggable: false,
          data: {
            e, foot: stateText(e, byId), amount: amountText(e, run.stock), selected: selected === e.id, chain: chain.has(e.id),
            dim: !!party && e.party_id !== party, ripple,
          },
        })
        const resource = e.waits.filter((w) => w.code === 'INSUFFICIENT_CASH' || w.code === 'INSUFFICIENT_INVENTORY')
        if (resource.length) {
          const from = resource[0].from_day
          const to = e.executed_day ?? run.horizon_days
          const cash = resource.find((w) => w.code === 'INSUFFICIENT_CASH')
          const inv = resource.find((w) => w.code === 'INSUFFICIENT_INVENTORY')
          const label = cash ? `short ${rupees(cash.max_shortfall_paise ?? cash.first_details.shortfall_paise)} · ${to - from}d` : inv ? `waiting for material · ${to - from}d` : ''
          nodes.push({
            id: `wait-${e.id}`, type: 'waitbar', draggable: false, selectable: false, focusable: false, zIndex: -1,
            position: { x: LABEL_W + from * PX_PER_DAY, y: pos.y + 55 }, data: { width: Math.max(8, (to - from) * PX_PER_DAY), label },
          })
        }
        if (baseById && ui.diff && changed.has(e.id)) {
          const b = baseById.get(e.id)
          if (b && b.executed_day !== null && b.x_day !== e.x_day) {
            const gp = { x: LABEL_W + b.x_day * PX_PER_DAY, y: pos.y }
            nodes.push({ id: `ghost-${e.id}`, type: 'ghost', position: gp, draggable: false, selectable: false, focusable: false, data: {}, zIndex: -1 })
            const delta = (e.executed_day ?? run.horizon_days) - b.executed_day
            edges.push({
              id: `diff-${e.id}`, source: `ghost-${e.id}`, target: e.id, type: 'straight', animated: false,
              label: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}d`, style: { stroke: 'var(--haldi)', strokeWidth: 1 },
              markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--haldi)', width: 12, height: 12 },
            })
          }
        }
      }
      y += h
    }
    for (const e of run.events) {
      for (const dep of e.depends_on) {
        if (!byId.has(dep.event_id)) continue
        const onChain = chain.has(e.id) && chain.has(dep.event_id) && !!selected
        edges.push({
          id: `${dep.event_id}->${e.id}`, source: dep.event_id, target: e.id, type: 'smoothstep',
          label: dep.lag_days ? `+${dep.lag_days}d` : undefined,
          style: { stroke: onChain ? 'var(--haldi)' : 'var(--rule-strong)', strokeWidth: onChain ? 1.5 : 1 },
          zIndex: onChain ? 1 : 0,
        })
      }
    }
    nodes.push({ id: 'playhead', type: 'playhead', position: { x: LABEL_W + day * PX_PER_DAY + 13, y: 0 }, draggable: false, selectable: false, focusable: false, data: { height: y, day }, zIndex: 5 })
    return { nodes, edges, positions }
  }, [run, baseline, selected, ui.selectedPartyId, ui.diff, day, reduceMotion])

  return (
    <ReactFlow
      nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes}
      defaultViewport={{ x: 20 - Math.max(0, day - 10) * PX_PER_DAY * 0.85, y: 30, zoom: 0.85 }} minZoom={0.2} maxZoom={1.6}
      nodesConnectable={false} nodesDraggable={false} onlyRenderVisibleElements
      onNodeClick={(_, n) => n.type === 'event' && ui.selectEvent(n.id)}
      onPaneClick={() => ui.selectEvent(null)}
      proOptions={{ hideAttribution: true }}
      aria-label="Flow: the events the engine runs, by day"
    >
      <FocusSelected positions={graph.positions} />
      <Background variant={BackgroundVariant.Lines} gap={[PX_PER_DAY * 7, 4000]} color="var(--rule)" style={{ opacity: 0.5 }} />
      <MiniMap pannable zoomable position="bottom-left" style={{ width: 150, height: 90 }} nodeColor={(n) => (n.type === 'event' ? ((n.data as EventData).e.state === 'BLOCKED' ? 'var(--out)' : 'var(--text-3)') : 'transparent')} maskColor="rgba(0,0,0,0.35)" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  )
}
