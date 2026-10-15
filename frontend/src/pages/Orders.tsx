import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Amount, Dialog, ErrorNote, Section, SkeletonRows, Status } from '../components/ui'
import { api, errorText } from '../lib/api'
import { addDays, dayDate, percent, rupees, shortDate } from '../lib/format'
import { useCatalogue, usePurchaseOrders, useSalesOrders, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me } from '../lib/types'
import { parseQuantity } from '../lib/validate'

const STAGES = ['PLANNED', 'MATERIALS_READY', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'PAID'] as const
const STAGE_LABEL: Record<string, string> = { PLANNED: 'Planned', MATERIALS_READY: 'Materials ready', IN_PRODUCTION: 'In production', READY: 'Ready', DELIVERED: 'Delivered', PAID: 'Paid' }

export default function Orders({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'sales'
  const finance = me.user.role !== 'SUPERVISOR'
  return (
    <div className="page">
      <div className="page-head"><h1 className="h1">Orders</h1></div>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'sales'} onClick={() => setParams({})}>Sales orders</button>
        <button className="tab" role="tab" aria-selected={tab === 'purchase'} onClick={() => setParams({ tab: 'purchase' })}>Purchase orders</button>
        {finance && <button className="tab" role="tab" aria-selected={tab === 'new'} onClick={() => setParams({ tab: 'new' })}>Can I take this order?</button>}
      </div>
      {tab === 'sales' && <Sales finance={finance} />}
      {tab === 'purchase' && <Purchases finance={finance} preset={params.get('new') === '1' ? (params.get('material') ?? '') : null} />}
      {tab === 'new' && finance && <WhatIf />}
    </div>
  )
}

function Sales({ finance }: { finance: boolean }) {
  const orders = useSalesOrders()
  const ui = useUI()
  const navigate = useNavigate()
  const advance = useWrite(({ id, stage }: { id: string; stage: string }) => api.patch(`/sales-orders/${encodeURIComponent(id)}`, { stage }))
  const [undo, setUndo] = useState<{ order: any; to: string } | null>(null)
  if (orders.isLoading) return <SkeletonRows rows={6} h={48} />
  if (orders.isError) return <ErrorNote text={errorText(orders.error)} retry={() => orders.refetch()} />
  return (
    <>
      {advance.isError && <ErrorNote text={errorText(advance.error)} />}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Order</th><th>Customer</th><th>Product × qty</th>{finance && <th className="money">Value</th>}<th>Promised</th><th>Forecast delivery</th><th>Stage</th><th>Materials</th><th /></tr>
          </thead>
          <tbody>
            {orders.data!.orders.map((o) => {
              const index = STAGES.indexOf(o.stage)
              const next = STAGES[index + 1]
              const previous = index > 0 && o.stage !== 'PAID' && (finance || o.stage !== 'DELIVERED') ? STAGES[index - 1] : null
              const change = o.last_change as { direction: string; from: string; to: string } | null
              return (
                <tr key={o.id}>
                  <td className="mono nowrap">{o.number}</td>
                  <td>{o.customer}</td>
                  <td className="wrap small" style={{ minWidth: 150 }}>{o.product}<span className="sub mono">× {o.qty}</span></td>
                  {finance && <td className="money"><Amount paise={o.value_paise} /></td>}
                  <td className="mono small">{shortDate(o.promised_date)}</td>
                  <td className="small">
                    {o.forecast_delivery ? <span className="mono">{shortDate(o.forecast_delivery)}</span> : o.stage === 'DELIVERED' || o.stage === 'PAID' ? <span className="faint">done</span> : <span className="amt-out">beyond forecast</span>}
                    {o.forecast_lateness_days ? <> <Status tone="attn">+{o.forecast_lateness_days} days</Status></> : o.forecast_delivery ? <> <Status tone="in">On time</Status></> : null}
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <div className="stepper" aria-label={`Stage: ${STAGE_LABEL[o.stage]}`}>{STAGES.map((s, i) => <span key={s} className={i < index ? 'done' : i === index ? 'now' : ''} />)}</div>
                    <span className="sub">{STAGE_LABEL[o.stage]}</span>
                    {change?.direction === 'BACK' && change.to === o.stage && <span className="sub">moved back from {STAGE_LABEL[change.from].toLowerCase()}</span>}
                  </td>
                  <td className="small">
                    {o.materials?.status === 'SHORT'
                      ? <button className="btn-quiet small" style={{ border: 0, background: 'none', cursor: finance ? 'pointer' : 'default', padding: 0 }} disabled={!finance}
                        onClick={() => { ui.selectEvent(o.materials.event_id); ui.setEngineView('flow'); ui.setDay(o.materials.waits_from_day); navigate('/app/engine') }}>
                        <Status tone="out">Short {o.materials.short_label}</Status>
                        <span className="sub">{o.materials.material}</span>
                      </button>
                      : o.materials?.status === 'READY' ? <Status tone="in">Ready</Status> : <span className="faint">·</span>}
                  </td>
                  <td className="right nowrap">
                    {previous && (
                      <button className="btn btn-sm btn-quiet" disabled={advance.isPending} onClick={() => setUndo({ order: o, to: previous })} title={`Move back to ${STAGE_LABEL[previous]}`}>
                        <ArrowCounterClockwiseIcon size={14} /> Undo
                      </button>
                    )}{' '}
                    {next && next !== 'PAID' && (
                      <button className="btn btn-sm btn-secondary" disabled={advance.isPending} onClick={() => advance.mutate({ id: o.id, stage: next },
                        { onSuccess: () => ui.toast(`${o.number} moved to ${STAGE_LABEL[next]}. Stock and forecast updated.`) })}>
                        {next === 'IN_PRODUCTION' ? 'Start production' : next === 'DELIVERED' ? 'Mark delivered' : `Mark ${STAGE_LABEL[next].toLowerCase()}`}
                      </button>
                    )}
                    {o.stage === 'PAID' && <span className="small faint">Paid</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="micro faint" style={{ marginTop: 8 }}>Forecast delivery comes from the engine. Starting production uses the recipe quantities from stock; delivering creates the invoice on the customer's terms. Undo takes back exactly what the step recorded.</p>
      <UndoDialog open={!!undo} title={undo ? `Move ${undo.order.number} back to ${STAGE_LABEL[undo.to]}?` : ''} effects={undo ? stageUndoEffects(undo.order, undo.to) : []}
        busy={advance.isPending} error={advance.isError ? errorText(advance.error) : null} confirmLabel={undo ? `Move back to ${STAGE_LABEL[undo.to]}` : ''}
        onClose={() => { setUndo(null); advance.reset() }}
        onConfirm={() => undo && advance.mutate({ id: undo.order.id, stage: undo.to }, {
          onSuccess: () => { ui.toast(`${undo.order.number} moved back to ${STAGE_LABEL[undo.to]}. Stock, money and forecast restored.`); setUndo(null) },
        })} />
    </>
  )
}

function Purchases({ finance, preset }: { finance: boolean; preset: string | null }) {
  const orders = usePurchaseOrders()
  const ui = useUI()
  const [creating, setCreating] = useState(preset !== null && finance)
  const mark = useWrite(({ id, status }: { id: string; status: string }) => api.patch(`/purchase-orders/${encodeURIComponent(id)}`, { status }))
  const [undo, setUndo] = useState<any>(null)
  if (orders.isLoading) return <SkeletonRows rows={5} h={48} />
  if (orders.isError) return <ErrorNote text={errorText(orders.error)} retry={() => orders.refetch()} />
  return (
    <>
      {finance && <div className="row" style={{ marginBottom: 12 }}><span className="spacer" /><button className="btn btn-secondary" onClick={() => setCreating(!creating)}>New purchase order</button></div>}
      {creating && <NewPO initialMaterial={preset} onDone={() => setCreating(false)} />}
      {mark.isError && <ErrorNote text={errorText(mark.error)} />}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Order</th><th>Supplier</th><th>Material × qty</th>{finance && <th className="money">Value</th>}<th>Terms</th><th>Expected arrival</th><th>Payment</th><th>Status</th><th /></tr></thead>
          <tbody>
            {orders.data!.orders.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.number}</td>
                <td>{o.supplier}</td>
                <td className="small">{o.material} × {o.qty_label}</td>
                {finance && <td className="money"><Amount paise={o.value_paise} direction="OUT" /></td>}
                <td className="small">{o.terms_type === 'CREDIT' ? 'Credit' : o.terms_type === 'ADVANCE' ? 'Advance' : 'On delivery'}</td>
                <td className="small wrap">
                  {o.forecast_arrival ? <span className="mono">{shortDate(o.forecast_arrival)}</span> : o.status === 'ARRIVED' || o.status === 'CLOSED' ? <span className="faint">arrived</span> : <span className="amt-out">beyond forecast</span>}
                  {o.held_until_paid && <span className="sub">held until {o.held_until_paid} is paid</span>}
                </td>
                <td className="small">{o.forecast_payment ? <span className="mono">{shortDate(o.forecast_payment)}</span> : <span className="faint">·</span>}</td>
                <td>{o.status === 'ARRIVED' || o.status === 'CLOSED' ? <Status tone="in">Arrived</Status> : o.status === 'PAID' ? <Status tone="wait">Paid, awaited</Status> : o.status === 'CANCELLED' ? <Status tone="wait">Cancelled</Status> : <Status tone="wait">Ordered</Status>}</td>
                <td className="right nowrap">
                  {(o.status === 'ARRIVED' || (finance && (o.status === 'PAID' || o.status === 'CANCELLED'))) && (
                    <button className="btn btn-sm btn-quiet" disabled={mark.isPending} onClick={() => setUndo(o)}>
                      <ArrowCounterClockwiseIcon size={14} /> {o.status === 'ARRIVED' ? 'Undo received' : o.status === 'PAID' ? 'Undo payment' : 'Reopen'}
                    </button>
                  )}{' '}
                  {finance && o.status === 'ORDERED' && <button className="btn btn-sm btn-quiet" disabled={mark.isPending} onClick={() => mark.mutate({ id: o.id, status: 'CANCELLED' }, { onSuccess: () => ui.toast(`${o.number} cancelled.`) })}>Cancel</button>}
                  {finance && o.status === 'ORDERED' && o.terms_type !== 'CREDIT' && <button className="btn btn-sm btn-quiet" onClick={() => mark.mutate({ id: o.id, status: 'PAID' })}>Mark paid</button>}{' '}
                  {(o.status === 'ORDERED' || o.status === 'PAID') && <button className="btn btn-sm btn-secondary" onClick={() => mark.mutate({ id: o.id, status: 'ARRIVED' }, { onSuccess: () => ui.toast(`${o.number} received. Stock updated.`) })}>Received</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <UndoDialog open={!!undo} title={undo ? `${undo.status === 'ARRIVED' ? 'Undo the receipt of' : undo.status === 'PAID' ? 'Undo the payment on' : 'Reopen'} ${undo.number}?` : ''}
        effects={undo ? poUndoEffects(undo) : []} busy={mark.isPending} error={mark.isError ? errorText(mark.error) : null}
        confirmLabel={undo ? (undo.status === 'CANCELLED' ? 'Reopen order' : 'Undo') : ''}
        onClose={() => { setUndo(null); mark.reset() }}
        onConfirm={() => undo && mark.mutate({ id: undo.id, status: 'UNDO' }, { onSuccess: () => { ui.toast(`${undo.number} stepped back. Stock, bills and forecast updated.`); setUndo(null) } })} />
    </>
  )
}

/** What a step back will reverse, in plain words. Mirrors repo.advance_stage on the server. */
function stageUndoEffects(o: any, to: string): string[] {
  const from = STAGES.indexOf(o.stage)
  const target = STAGES.indexOf(to as (typeof STAGES)[number])
  const out: string[] = []
  if (from >= 4 && target < 4) out.push(`Cancels invoice ${o.number}-INV and puts ${o.qty} finished pieces back in stock.`)
  if (from >= 3 && target < 3) out.push(`Takes the ${o.qty} finished pieces back out of stock.`)
  if (from >= 2 && target < 2) out.push('Returns the materials used to raw stock and removes the production cost entry.')
  if (!out.length) out.push('Only the stage changes. No stock or money moves.')
  out.push('The forecast and every screen that uses these figures are recalculated.')
  return out
}

function poUndoEffects(po: any): string[] {
  if (po.status === 'ARRIVED') return [`Takes ${po.qty_label} of ${po.material} back out of stock.`, 'Removes the supplier bill created on arrival, if there is one.', 'The order goes back to waiting for the delivery.', 'The forecast is recalculated.']
  if (po.status === 'PAID') return ['Removes the advance payment recorded for this order.', 'The order goes back to ordered, not paid.', 'The forecast is recalculated.']
  return ['The order is open again and counted in the forecast.']
}

function UndoDialog({ open, title, effects, busy, error, confirmLabel, onClose, onConfirm }: {
  open: boolean; title: string; effects: string[]; busy: boolean; error: string | null; confirmLabel: string; onClose: () => void; onConfirm: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description="Only the records this step created are taken out. Nothing else is touched.">
      <ul className="small" style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>{effects.map((e) => <li key={e}>{e}</li>)}</ul>
      {error && <ErrorNote text={error} />}
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onClose}>Keep as is</button>
        <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>{busy ? 'Working' : confirmLabel}</button>
      </div>
    </Dialog>
  )
}

function NewPO({ onDone, initialMaterial }: { onDone: () => void; initialMaterial?: string | null }) {
  const cat = useCatalogue()
  const ui = useUI()
  const [supplier, setSupplier] = useState('')
  const [material, setMaterial] = useState('')
  const [qty, setQty] = useState('')
  const write = useWrite((body: unknown) => api.post('/purchase-orders', body))
  // Arriving from Inventory's Order button: start with that material and its usual supplier.
  useEffect(() => {
    if (!initialMaterial || material || !cat.data) return
    const found = cat.data.materials.find((x: any) => x.id === initialMaterial)
    if (found) { setMaterial(found.id); if (found.primary_supplier_id) setSupplier(found.primary_supplier_id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMaterial, cat.data])
  const qtyCheck = parseQuantity(qty, 'Quantity', { decimals: 3, max: 10 ** 7 })
  const m = cat.data?.materials.find((x: any) => x.id === material)
  return (
    <div className="notice" style={{ marginBottom: 16 }}>
      <div className="form-grid">
        <label className="field"><span className="field-label">Material</span>
          <select className="select" value={material} onChange={(e) => { setMaterial(e.target.value); const mm = cat.data.materials.find((x: any) => x.id === e.target.value); if (mm?.primary_supplier_id) setSupplier(mm.primary_supplier_id) }}>
            <option value="">Choose</option>{cat.data?.materials.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Supplier</span>
          <select className="select" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Choose</option>{cat.data?.suppliers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Quantity{m ? ` (${m.unit})` : ''}</span><input className="input mono" inputMode="decimal" value={qty} aria-invalid={qty !== '' && !qtyCheck.ok} onChange={(e) => setQty(e.target.value)} />
          {qty !== '' && !qtyCheck.ok && <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{qtyCheck.error}</span>}</label>
      </div>
      {write.isError && <ErrorNote text={errorText(write.error)} />}
      <div className="dialog-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-quiet" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={!supplier || !material || !qtyCheck.ok || write.isPending}
          onClick={() => qtyCheck.ok && write.mutate({ supplier_id: supplier, material_id: material, qty: Math.round(qtyCheck.value * (m?.unit_factor || 1)) },
            { onSuccess: () => { ui.toast('Purchase order created. It is now in the forecast.'); onDone() } })}>
          Create purchase order
        </button>
      </div>
    </div>
  )
}

function WhatIf() {
  const cat = useCatalogue()
  const me = cat.data
  const ui = useUI()
  const [customer, setCustomer] = useState('')
  const [product, setProduct] = useState('')
  const [qty, setQty] = useState('40')
  const [price, setPrice] = useState('')
  const [promised, setPromised] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const accept = useWrite((body: unknown) => api.post('/sales-orders', body))
  const p = me?.products.find((x: any) => x.id === product)
  const body = () => ({
    customer_id: customer, product_id: product, qty: Number(qty), unit_price_paise: price ? Math.round(Number(price) * 100) : undefined,
    promised_date: promised, with_supporting_po: true,
  })
  const check = async () => {
    setBusy(true); setError(null)
    try { setResult(await api.post('/orders/what-if', body())) } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const ready = customer && product && Number(qty) > 0 && promised

  return (
    <div style={{ maxWidth: 820 }}>
      <p className="muted" style={{ marginTop: 0 }}>Test an order against everything else before you accept it. Ripple runs the engine twice, with and without the order and the material it needs.</p>
      <div className="form-grid">
        <label className="field"><span className="field-label">New order from</span>
          <select className="select" value={customer} onChange={(e) => setCustomer(e.target.value)}><option value="">Choose customer</option>{me?.customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">Product</span>
          <select className="select" value={product} onChange={(e) => { setProduct(e.target.value); const pp = me.products.find((x: any) => x.id === e.target.value); if (pp) setPrice(String(pp.unit_price_paise / 100)) }}>
            <option value="">Choose product</option>{me?.products.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Qty</span><input className="input mono" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="field"><span className="field-label">Price each, ₹</span><input className="input mono" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="field"><span className="field-label">Promised by</span><input className="input mono" type="date" value={promised} min={addDays(new Date().toISOString().slice(0, 10), 1)} onChange={(e) => setPromised(e.target.value)} /></label>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" disabled={!ready || busy} onClick={check}>{busy ? 'Running the engine twice' : 'Check this order'}</button>
        {p && <span className="small faint">{p.production_days} days to make</span>}
      </div>
      {error !== null && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(error)} /></div>}
      {result && (
        <Section title="If you accept">
          <table className="table">
            <tbody>
              <tr>
                <td className="muted" style={{ width: 160 }}>Materials</td>
                <td className="wrap small">
                  {result.materials.map((m: any) => (
                    <div key={m.material_id}>
                      needs {m.needed_label} {m.material} · {m.free_label} free{m.short_label ? <span className="amt-out"> · short {m.short_label}</span> : ''}
                      {m.supporting_po && <span className="sub">{m.supporting_po.supplier} can deliver {m.supporting_po.qty_label} in {m.supporting_po.lead_time_days} days · cost {rupees(m.supporting_po.amount_paise)} · {m.supporting_po.terms_type === 'CREDIT' ? 'on credit' : 'paid in advance'}</span>}
                    </div>
                  ))}
                </td>
              </tr>
              <tr><td className="muted">Value</td><td><Amount paise={result.value_paise} direction="IN" sign={false} /></td></tr>
              <tr>
                <td className="muted">Delivery</td>
                <td>{result.delivery.forecast ? <>forecast {dayDate(result.delivery.forecast)} {result.delivery.lateness_days ? <Status tone="attn">{result.delivery.lateness_days} days late</Status> : <Status tone="in">On time</Status>}</> : <Status tone="out">Not within the forecast</Status>}</td>
              </tr>
              <tr>
                <td className="muted">Cash low point</td>
                <td className="mono">
                  {result.low_point_before ? `${rupees(result.low_point_before.net_paise)} on ${shortDate(result.low_point_before.date)}` : '·'} → <span className={result.low_point_after?.net_paise < 0 ? 'amt-out' : ''}>{result.low_point_after ? `${rupees(result.low_point_after.net_paise)} on ${shortDate(result.low_point_after.date)}` : '·'}</span>
                </td>
              </tr>
              <tr>
                <td className="muted">Risk (30 days)</td>
                <td className="mono">{result.risk_samples ? `${percent(result.risk_30_before)} → ${percent(result.risk_30_after)}` : 'not enough history'}<span className="sub">{result.risk_samples ? `${result.risk_samples} samples each` : ''}</span></td>
              </tr>
              <tr>
                <td className="muted">Other orders</td>
                <td>{result.other_orders_delayed.length ? result.other_orders_delayed.map((o: any) => <div key={o.order_id}><Status tone="attn">{o.order_id} {o.delta_days !== null ? `+${o.delta_days} days` : 'not delivered in window'}</Status></div>) : 'none delayed'}</td>
              </tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled={accept.isPending} onClick={() => accept.mutate(body(), { onSuccess: () => { ui.toast('Order created with its supporting purchase. Forecast recalculated.'); setResult(null) } })}>Accept and create order</button>
            <button className="btn btn-quiet" onClick={() => setResult(null)}>Not now</button>
          </div>
          {accept.isError && <ErrorNote text={errorText(accept.error)} />}
        </Section>
      )}
    </div>
  )
}
