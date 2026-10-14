import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useMemo, useState } from 'react'
import { Glyph, type GlyphName } from '../components/Glyph'
import { ErrorNote, Seg, SkeletonRows, Status } from '../components/ui'
import { Decisions } from '../engine/Decisions'
import { FlowView } from '../engine/FlowView'
import { EventTable, Inspector } from '../engine/Inspector'
import { NetworkView, sortParties, type SortKey } from '../engine/NetworkView'
import { ScenarioBar } from '../engine/ScenarioBar'
import { Timeline } from '../engine/Timeline'
import { errorText } from '../lib/api'
import { rupees } from '../lib/format'
import { useMe, useNetwork, useRisk, useRun } from '../lib/queries'
import { useUI, type EngineView } from '../lib/store'

const TYPE_LABEL: Record<string, string> = {
  CASH_RECEIPT: 'Receipts', SUPPLIER_PAYMENT: 'Supplier payments', INVENTORY_ARRIVAL: 'Arrivals', PRODUCTION_START: 'Production starts',
  PRODUCTION_COMPLETE: 'Completions', DELIVERY: 'Deliveries', OTHER_EXPENSE: 'Expenses', CREDIT_DRAWDOWN: 'Credit drawdown', CREDIT_REPAYMENT: 'Credit repayment',
}

export default function Engine() {
  const ui = useUI()
  const me = useMe().data
  const baseline = useRun()
  const network = useNetwork()
  const risk = useRisk()
  const [sort, setSort] = useState<SortKey>('exposure')
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  // The canvas needs the width; Munim stays one keystroke (M) away.
  useEffect(() => { if (window.innerWidth < 1800) ui.setMunimOpen(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (baseline.data && ui.day === 0 && baseline.data.summary.first_shortfall && !ui.scenario) ui.setDay(baseline.data.summary.first_shortfall.day)
    // Jump to the first issue once, on first open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline.data?.run_id])

  const run = ui.scenario?.run ?? baseline.data
  const drivers = useMemo(() => Object.fromEntries((risk.data?.drivers ?? []).map((d) => [d.party_id, d.share])), [risk.data])
  const fan = risk.data?.status === 'READY' && !ui.scenario && risk.data.snapshot_hash === baseline.data?.snapshot_hash ? risk.data.fan : undefined

  if (baseline.isLoading || !me) return <div className="page"><SkeletonRows rows={12} /></div>
  if (baseline.isError || !run) return <div className="page"><ErrorNote text={`Couldn't reach the engine. ${errorText(baseline.error)}`} retry={() => baseline.refetch()} /></div>

  const parties = network.data ? network.data.parties : []
  const q = filter.toLowerCase()
  const visibleParties = (kind: 'SUPPLIER' | 'CUSTOMER') => sortParties(parties.filter((p) => p.kind === kind && p.name.toLowerCase().includes(q)), sort, drivers)
  const types = Object.keys(TYPE_LABEL).filter((t) => run.events.some((e) => e.type === t))
  const showInspector = !!(ui.selectedEventId || ui.selectedPartyId) || window.innerWidth >= 1280

  return (
    <div className="page-wide">
      <div className={`engine${showInspector ? '' : ' no-inspector'}`}>
        <aside className="engine-palette" aria-label="Parties and events">
          <div style={{ padding: 10 }}>
            <input className="input" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter parties" />
          </div>
          {(['SUPPLIER', 'CUSTOMER'] as const).map((kind) => (
            <div key={kind}>
              <div className="palette-group label">{kind === 'SUPPLIER' ? 'Suppliers' : 'Customers'} <span className="mono">{visibleParties(kind).length}</span></div>
              <div style={{ padding: '0 6px' }}>
                {visibleParties(kind).map((p) => (
                  <button key={p.id} className={`palette-item${ui.selectedPartyId === p.id ? ' active' : ''}`} onClick={() => ui.selectParty(ui.selectedPartyId === p.id ? null : p.id)}>
                    <Glyph name={kind} size={14} />
                    <span className="grow truncate">{p.name}</span>
                    {p.blocked ? <Status tone="out">Blocked</Status> : p.late_orders.length ? <span className="mono micro" style={{ color: 'var(--haldi)' }}>{p.late_orders[0].order_id}</span> : p.days_overdue > 0 ? <span className="mono micro" style={{ color: 'var(--haldi)' }}>{p.days_overdue}d</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="palette-group label">Events <span className="mono">{run.event_count}</span></div>
          <div style={{ padding: '0 6px 16px' }}>
            {types.map((t) => {
              const list = run.events.filter((e) => e.type === t)
              const blocked = list.filter((e) => e.state === 'BLOCKED' || e.waits.some((w) => w.code.startsWith('INSUFFICIENT'))).length
              return (
                <div key={t}>
                  <button className={`palette-item${typeFilter === t ? ' active' : ''}`} onClick={() => setTypeFilter(typeFilter === t ? null : t)}>
                    <Glyph name={t as GlyphName} size={14} />
                    <span className="grow">{TYPE_LABEL[t]}</span>
                    <span className="mono micro">{list.length}{blocked ? <span style={{ color: 'var(--out)' }}> · {blocked}</span> : ''}</span>
                  </button>
                  {typeFilter === t && list.map((e) => (
                    <button key={e.id} className={`palette-item${ui.selectedEventId === e.id ? ' active' : ''}`} style={{ paddingLeft: 30 }}
                      onClick={() => { ui.selectEvent(e.id); if (ui.engineView === 'network') ui.setEngineView('flow') }}>
                      <span className="grow truncate">{e.label}</span>
                      <span className="mono micro">{e.executed_day !== null ? `D${e.executed_day}` : '·'}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </aside>

        <div className="engine-bar">
          <div className="tabs" role="tablist" style={{ margin: 0, border: 0 }}>
            {(['network', 'flow', 'decisions'] as EngineView[]).map((v) => (
              <button key={v} role="tab" className="tab" aria-selected={ui.engineView === v} onClick={() => ui.setEngineView(v)} style={{ textTransform: 'capitalize' }}>{v}</button>
            ))}
          </div>
          <span className="spacer" />
          {ui.scenario ? (
            <>
              <span className="small"><span className="faint">Scenario:</span> {ui.scenario.label}</span>
              <ScenarioSummary />
              <label className="check small"><input type="checkbox" checked={ui.diff} onChange={(e) => ui.setDiff(e.target.checked)} /> Diff</label>
              <button className="btn btn-sm btn-secondary" onClick={() => ui.setScenario(null)}>Back to baseline</button>
            </>
          ) : (
            <span className="small faint">Baseline</span>
          )}
          {ui.engineView === 'network' && (
            <select className="select" style={{ width: 'auto', height: 28 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort parties">
              <option value="exposure">Sort: exposure</option><option value="due">Sort: next due</option><option value="risk">Sort: risk share</option>
            </select>
          )}
          <button className="btn btn-sm btn-secondary" onClick={() => ui.setScenarioBarOpen(!ui.scenarioBarOpen)} aria-expanded={ui.scenarioBarOpen}>Try a what-if</button>
          <Seg label="Display" value={ui.tableView ? 'table' : 'graph'} onChange={(v) => ui.setTableView(v === 'table')}
            options={[{ value: 'graph', label: 'Graph' }, { value: 'table', label: 'Table' }]} />
        </div>

        <div className="engine-canvas" style={{ display: 'flex', flexDirection: 'column' }}>
          {ui.scenarioBarOpen && <ScenarioBar run={baseline.data!} facilities={baseline.data!.facilities ?? []} />}
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {ui.tableView && ui.engineView !== 'decisions' ? <EventTable run={run} />
              : ui.engineView === 'network' ? (
                network.data ? <ReactFlowProvider><NetworkView network={network.data} run={baseline.data!} sort={sort} drivers={drivers} businessName={me.business.name} /></ReactFlowProvider>
                  : network.isError ? <div className="page"><ErrorNote text={errorText(network.error)} /></div> : <div className="page"><SkeletonRows /></div>
              ) : ui.engineView === 'flow' ? (
                <ReactFlowProvider><FlowView run={run} baseline={ui.scenario ? baseline.data : null} /></ReactFlowProvider>
              ) : <Decisions stock={run.stock} />}
          </div>
        </div>

        {showInspector && (
          <aside className="engine-inspector" aria-label="Inspector">
            {(ui.selectedEventId || ui.selectedPartyId) && window.innerWidth < 1280 && (
              <button className="icon-btn" style={{ float: 'right' }} aria-label="Close inspector" onClick={() => { ui.selectEvent(null) }}><Glyph name="CROSS" /></button>
            )}
            <Inspector run={run} network={network.data} drivers={drivers} />
          </aside>
        )}

        <div className="engine-timeline">
          <Timeline run={run} fan={fan} />
        </div>
      </div>
    </div>
  )
}

function ScenarioSummary() {
  const scenario = useUI((s) => s.scenario)
  if (!scenario) return null
  const e = scenario.evaluation
  return (
    <span className="small mono" title="Lowest net position before → after, from the engine">
      {rupees(e.dip_before_paise)} → <span className={e.dip_after_paise !== null && e.dip_after_paise < 0 ? 'amt-out' : 'amt-in'}>{rupees(e.dip_after_paise)}</span>
      {' · '}{e.changed_events.length} events move
    </span>
  )
}
