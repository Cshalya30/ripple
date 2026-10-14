import { memo, useMemo, useState } from 'react'
import {
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  Background,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useReducedMotion } from 'framer-motion'
import { Factory, Store } from 'lucide-react'
import type { Party } from '../types'
import { daysFromToday } from '../lib/dates'
import { formatINR } from '../lib/format'
import { timingText, urgencyMeta, urgencyOf } from '../lib/urgency'
import { usePalette } from '../hooks/usePalette'
import { AnimatedNumber } from './AnimatedNumber'

const NODE_W = 196
const NODE_H = 88
const PITCH = 114
const ME_W = 230
const ME_H = 196
const SUPPLIER_X = 0
const ME_X = NODE_W + 190
const CUSTOMER_X = ME_X + ME_W + 190

interface PartyNodeData extends Record<string, unknown> {
  party: Party
  dim: boolean
  onSelect: (p: Party) => void
  onHover: (id: string | null) => void
}

interface MeNodeData extends Record<string, unknown> {
  cash: number
  businessName: string
}

interface FlowEdgeData extends Record<string, unknown> {
  kind: 'inventory' | 'goods' | 'cash'
  label: string
  dim: boolean
  highlight: boolean
  color: string
  delay: number
  reduceMotion: boolean
}

const PartyNode = memo(function PartyNode({ id, data }: NodeProps) {
  const { party, dim, onSelect, onHover } = data as unknown as PartyNodeData
  const urgency = urgencyOf(party)
  const meta = urgencyMeta[urgency]
  const isSupplier = party.kind === 'supplier'
  const Kind = isSupplier ? Factory : Store
  const StatusIcon = meta.icon
  const tipId = `tip-${id}`
  const overdueOrSoon = urgency !== 'ok'

  return (
    <div className={`group relative transition-opacity duration-200 ${dim ? 'opacity-40' : 'opacity-100'}`} style={{ width: NODE_W }}>
      {isSupplier ? (
        <Handle type="source" position={Position.Right} id="inv" style={{ opacity: 0 }} />
      ) : (
        <>
          <Handle type="target" position={Position.Left} id="goods" style={{ opacity: 0, top: '32%' }} />
          <Handle type="source" position={Position.Left} id="cash" style={{ opacity: 0, top: '68%' }} />
        </>
      )}
      <button
        type="button"
        onClick={() => onSelect(party)}
        onMouseEnter={() => onHover(id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(id)}
        onBlur={() => onHover(null)}
        aria-describedby={tipId}
        aria-label={`${party.name}. ${isSupplier ? 'You owe' : 'Owes you'} ${formatINR(party.owedAmount)}. ${meta.label}. Open details.`}
        className={`flex w-full items-center gap-2.5 rounded-2xl border-2 ${meta.border} ${meta.soft} px-3 py-2.5 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift`}
        style={{ height: NODE_H }}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface ${meta.text}`}>
          <Kind size={18} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{party.name}</span>
          <span className={`num mt-0.5 block text-sm font-bold ${isSupplier ? 'text-loss' : 'text-gain'}`}>
            {isSupplier ? formatINR(-party.owedAmount) : formatINR(party.owedAmount, { sign: true })}
          </span>
          <span className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium ${meta.text}`}>
            <StatusIcon size={12} aria-hidden="true" />
            {meta.label}
          </span>
        </span>
      </button>
      <div
        id={tipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-[260px] -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-xs font-medium text-bg shadow-lift group-focus-within:block group-hover:block"
      >
        {timingText(party)} <span aria-hidden="true">·</span> {formatINR(party.owedAmount)}
        {overdueOrSoon && daysFromToday(party.dueDate) >= 0 && party.causesShortfall && <span className="block opacity-80">Contributes to the Day 34 shortfall</span>}
      </div>
    </div>
  )
})

const MeNode = memo(function MeNode({ data }: NodeProps) {
  const { cash, businessName } = data as unknown as MeNodeData
  return (
    <div
      className="relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-brand bg-brand px-5 text-center text-on-brand shadow-lift"
      style={{ width: ME_W, height: ME_H }}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="goods" style={{ opacity: 0, top: '32%' }} />
      <Handle type="target" position={Position.Right} id="cash" style={{ opacity: 0, top: '68%' }} />
      <svg className="pointer-events-none absolute -right-10 -top-10 opacity-20" width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
        {[24, 46, 68, 90].map((r) => (
          <circle key={r} cx="80" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
        ))}
      </svg>
      <p className="relative text-xs font-medium opacity-80">Me / My business</p>
      <p className="relative mt-0.5 font-display text-lg font-bold leading-tight">{businessName}</p>
      <p className="relative mt-3 text-xs opacity-80">Cash today</p>
      <AnimatedNumber value={cash} className="relative font-display text-3xl font-extrabold" />
    </div>
  )
})

const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props
  const data = props.data as unknown as FlowEdgeData
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const isCash = data.kind === 'cash'
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        className={isCash && !data.reduceMotion ? 'flow-dash' : undefined}
        style={{
          stroke: data.color,
          strokeWidth: data.highlight ? 2.75 : 1.6,
          strokeDasharray: isCash ? '7 5' : undefined,
          opacity: data.dim ? 0.15 : data.highlight ? 1 : 0.7,
          transition: 'opacity 200ms, stroke-width 200ms',
        }}
      />
      {!data.reduceMotion && !data.dim && (
        <circle r={data.highlight ? 4.5 : 3.2} fill={data.color}>
          <animateMotion dur="3.6s" begin={`${data.delay}s`} repeatCount="indefinite" path={path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute rounded-full border bg-surface px-1.5 py-px text-[10px] font-semibold transition-opacity"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            color: data.color,
            borderColor: data.color,
            opacity: data.dim ? 0.15 : 1,
          }}
        >
          {data.label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

const nodeTypes = { party: PartyNode, me: MeNode }
const edgeTypes = { flow: FlowEdge }

interface Props {
  parties: Party[]
  cash: number
  businessName: string
  onSelect: (p: Party) => void
}

export function EngineDiagram({ parties, cash, businessName, onSelect }: Props) {
  const palette = usePalette()
  const reduceMotion = !!useReducedMotion()
  const [hovered, setHovered] = useState<string | null>(null)

  const { nodes, edges, meCenter } = useMemo(() => {
    const byDue = (a: Party, b: Party) => a.dueDate.localeCompare(b.dueDate)
    const suppliers = parties.filter((p) => p.kind === 'supplier').sort(byDue)
    const customers = parties.filter((p) => p.kind === 'customer').sort(byDue)
    const rows = Math.max(suppliers.length, customers.length, 1)
    const colHeight = rows * PITCH - (PITCH - NODE_H)
    const offsetFor = (count: number) => ((rows - count) * PITCH) / 2

    const connected = (id: string) => hovered === null || hovered === 'me' || hovered === id

    const partyNode = (p: Party, x: number, i: number, offset: number): Node => ({
      id: p.id,
      type: 'party',
      position: { x, y: offset + i * PITCH },
      draggable: false,
      selectable: false,
      data: { party: p, dim: !connected(p.id), onSelect, onHover: setHovered } satisfies PartyNodeData,
    })

    const meY = (colHeight - ME_H) / 2
    const ns: Node[] = [
      {
        id: 'me',
        type: 'me',
        position: { x: ME_X, y: meY },
        draggable: false,
        selectable: false,
        data: { cash, businessName } satisfies MeNodeData,
      },
      ...suppliers.map((p, i) => partyNode(p, SUPPLIER_X, i, offsetFor(suppliers.length))),
      ...customers.map((p, i) => partyNode(p, CUSTOMER_X, i, offsetFor(customers.length))),
    ]

    const edgeData = (kind: FlowEdgeData['kind'], label: string, id: string, color: string, i: number): FlowEdgeData => ({
      kind,
      label,
      color,
      dim: !connected(id),
      highlight: hovered !== null && hovered !== 'me' && hovered === id,
      delay: (i % 6) * 0.55,
      reduceMotion,
    })

    const es: Edge[] = [
      ...suppliers.map(
        (p, i): Edge => ({
          id: `inv-${p.id}`,
          source: p.id,
          sourceHandle: 'inv',
          target: 'me',
          targetHandle: 'in',
          type: 'flow',
          selectable: false,
          data: edgeData('inventory', 'Inventory', p.id, palette.brand, i),
        }),
      ),
      ...customers.flatMap((p, i): Edge[] => [
        {
          id: `goods-${p.id}`,
          source: 'me',
          sourceHandle: 'goods',
          target: p.id,
          targetHandle: 'goods',
          type: 'flow',
          selectable: false,
          data: edgeData('goods', 'Goods', p.id, palette.muted, i),
        },
        {
          id: `cash-${p.id}`,
          source: p.id,
          sourceHandle: 'cash',
          target: 'me',
          targetHandle: 'cash',
          type: 'flow',
          selectable: false,
          data: edgeData('cash', 'Cash', p.id, palette.gain, i + 2),
        },
      ]),
    ]
    return { nodes: ns, edges: es, meCenter: { x: ME_X + ME_W / 2, y: meY + ME_H / 2 } }
  }, [parties, cash, businessName, hovered, onSelect, palette, reduceMotion])

  const onInit = (instance: ReactFlowInstance) => {
    if (window.innerWidth < 640) instance.setCenter(meCenter.x, meCenter.y, { zoom: 0.55, duration: 0 })
  }

  return (
    <div className="h-[560px] w-full sm:h-[680px]" role="group" aria-label="Money flow diagram. Suppliers on the left, your business in the centre, customers on the right.">
      <ReactFlow
        key={parties.length}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        onInit={onInit}
        minZoom={0.25}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.2} color={palette.line} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}
