import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { memo, useMemo, useState } from 'react'
import { Glyph } from '../components/Glyph'
import { Status } from '../components/ui'
import { rupees, shortDate } from '../lib/format'
import { useUI } from '../lib/store'
import type { Network, NetworkParty, RunPayload } from '../lib/types'

export type SortKey = 'exposure' | 'due' | 'risk'

type PartyData = { party: NetworkParty; dim: boolean; selected: boolean; balance: number | null }
type BizData = { name: string; cash: number; runway: number | null; lowest: { net_paise: number; date: string } | null; horizon: number }

const PartyNode = memo(({ data }: NodeProps<Node<PartyData>>) => {
  const p = data.party
  const customer = p.kind === 'CUSTOMER'
  const pct = Math.round(p.exposure_bp / 100)
  const status = p.blocked ? <Status tone="out">Blocked</Status>
    : p.late_orders.length ? <Status tone="attn">{p.late_orders[0].order_id} +{p.late_orders[0].lateness_days}d</Status>
    : p.days_overdue > 0 ? <Status tone="attn">{p.days_overdue}d late</Status>
      : p.next_event?.executed_date ? <Status tone="wait" glyph="CLOCK">{shortDate(p.next_event.executed_date)}</Status> : null
  return (
    <div className={`pnode${data.dim ? ' dim' : ''}${data.selected ? ' selected' : ''}`} title={`${p.name}: ${pct}% of ${customer ? 'receivables' : 'payables'}`}>
      <Handle type={customer ? 'target' : 'source'} position={customer ? Position.Left : Position.Right} />
      <div className="pn-status">{status}</div>
      <div className="pn-name">{p.name}</div>
      <div className="pn-sub">{p.city}{p.tags.length ? ` · ${p.tags[0]}` : ''}</div>
      <div className={`pn-amt ${customer ? 'amt-in' : 'amt-out'}`}>{p.outstanding_paise ? rupees(customer ? p.outstanding_paise : -p.outstanding_paise, { sign: customer }) : '·'}</div>
      <div className="pn-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: data.selected ? 'var(--haldi)' : undefined }} /></div>
      <div className="pn-pct">{pct}%</div>
    </div>
  )
})

const BusinessNode = memo(({ data }: NodeProps<Node<BizData>>) => (
  <div className="bnode">
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
    <div className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
      <Glyph name="SEAL" style={{ color: 'var(--haldi)' }} />
      <strong className="truncate" style={{ fontSize: 13 }}>{data.name}</strong>
    </div>
    <div className="row small" style={{ marginTop: 8 }}><span className="faint">Cash now</span><span className="mono">{rupees(data.cash)}</span></div>
    <div className="row small"><span className="faint">Runway</span><span className="mono">{data.runway !== null ? `${data.runway} days` : `${data.horizon}+ days`}</span></div>
    <div className="row small"><span className="faint">Lowest point</span>
      <span className={`mono ${data.lowest && data.lowest.net_paise < 0 ? 'amt-out' : ''}`}>{data.lowest ? `${rupees(data.lowest.net_paise)} · ${shortDate(data.lowest.date)}` : '·'}</span>
    </div>
  </div>
))

const nodeTypes = { party: PartyNode, business: BusinessNode }

export function sortParties(parties: NetworkParty[], sort: SortKey, drivers: Record<string, number>) {
  return [...parties].sort((a, b) => {
    if (sort === 'due') return (a.next_event?.executed_date ?? a.oldest_due ?? '9999').localeCompare(b.next_event?.executed_date ?? b.oldest_due ?? '9999')
    if (sort === 'risk') return (drivers[b.id] ?? 0) - (drivers[a.id] ?? 0) || b.exposure_bp - a.exposure_bp
    return b.exposure_bp - a.exposure_bp || b.outstanding_paise - a.outstanding_paise
  })
}

export function NetworkView({ network, run, sort, drivers, businessName }: {
  network: Network; run: RunPayload; sort: SortKey; drivers: Record<string, number>; businessName: string
}) {
  const ui = useUI()
  const [hover, setHover] = useState<string | null>(null)
  const focus = hover ?? ui.selectedPartyId

  const { nodes, edges } = useMemo(() => {
    const suppliers = sortParties(network.parties.filter((p) => p.kind === 'SUPPLIER'), sort, drivers)
    const customers = sortParties(network.parties.filter((p) => p.kind === 'CUSTOMER'), sort, drivers)
    const rows = Math.max(suppliers.length, customers.length)
    const gap = 80
    const centerY = ((rows - 1) * gap) / 2
    const byId = new Map(run.events.map((e) => [e.id, e]))
    const nodes: Node[] = [
      { id: 'me', type: 'business', position: { x: 330, y: centerY - 28 }, draggable: false,
        data: { name: businessName, cash: run.summary.opening_cash_paise, runway: run.summary.runway_days, lowest: run.summary.lowest, horizon: run.horizon_days } },
    ]
    const edges: Edge[] = []
    const place = (list: NetworkParty[], x: number) => {
      const offset = ((rows - list.length) * gap) / 2
      list.forEach((p, i) => {
        nodes.push({ id: p.id, type: 'party', position: { x, y: offset + i * gap }, draggable: false,
          data: { party: p, dim: !!focus && focus !== p.id, selected: ui.selectedPartyId === p.id, balance: null } })
        const width = 1 + Math.min(3, Math.log10(1 + p.outstanding_paise / 1e6) * 1.6)
        const next = p.next_event ? byId.get(p.next_event.id) : undefined
        const color = !next ? 'var(--rule-strong)' : next.state === 'BLOCKED' || p.blocked ? 'var(--out)' : next.lateness_days ? 'var(--haldi)' : p.days_overdue > 0 ? 'var(--haldi)' : 'var(--text-3)'
        const supplier = p.kind === 'SUPPLIER'
        const opacity = focus && focus !== p.id ? 0.25 : 1
        edges.push({
          id: `goods-${p.id}`, source: supplier ? p.id : 'me', target: supplier ? 'me' : p.id,
          style: { stroke: color, strokeWidth: width, opacity }, type: 'default',
        })
        edges.push({
          id: `cash-${p.id}`, source: supplier ? p.id : 'me', target: supplier ? 'me' : p.id,
          style: { stroke: color, strokeWidth: width, strokeDasharray: '5 4', opacity: opacity * 0.8 }, type: 'smoothstep',
        })
      })
    }
    place(suppliers, 0)
    place(customers, 700)
    return { nodes, edges }
  }, [network, run, sort, drivers, focus, ui.selectedPartyId, businessName])

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }}
      minZoom={0.3} maxZoom={2} nodesConnectable={false} nodesDraggable={false} elementsSelectable edgesFocusable={false}
      onNodeMouseEnter={(_, n) => n.type === 'party' && setHover(n.id)}
      onNodeMouseLeave={() => setHover(null)}
      onNodeClick={(_, n) => (n.type === 'party' ? ui.selectParty(n.id) : ui.selectParty(null))}
      onPaneClick={() => ui.selectParty(null)}
      proOptions={{ hideAttribution: true }}
      aria-label="Network: suppliers on the left, customers on the right, your business in the centre"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--rule)" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  )
}
