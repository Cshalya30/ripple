import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Amount, Dialog, ErrorNote, SkeletonRows, Status, StripCell } from '../components/ui'
import { api, errorText } from '../lib/api'
import { rupees, shortDate } from '../lib/format'
import { useInventory, useMovements, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me } from '../lib/types'

type Tab = 'raw' | 'finished' | 'recipes' | 'movements'

export default function Inventory({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('raw')
  const inv = useInventory()
  const finance = me.user.role !== 'SUPERVISOR'
  const [adjust, setAdjust] = useState<any>(null)

  return (
    <div className="page">
      <div className="page-head"><h1 className="h1">Inventory</h1></div>
      {inv.isLoading && <SkeletonRows rows={8} />}
      {inv.isError && <ErrorNote text={errorText(inv.error)} retry={() => inv.refetch()} />}
      {inv.data && (
        <>
          <div className="strip compact" style={{ marginBottom: 20 }}>
            <StripCell label="Stock value">{finance ? rupees(inv.data.summary.stock_value_paise) : <span className="faint">hidden</span>}</StripCell>
            <StripCell label="Short for open orders">{inv.data.summary.short_count}</StripCell>
            <StripCell label="Reorder now">{inv.data.summary.reorder_count}</StripCell>
            <StripCell label="Slow stock value" sub="no use in 60+ days">{finance ? rupees(inv.data.summary.slow_value_paise) : <span className="faint">hidden</span>}</StripCell>
          </div>
          <div className="tabs" role="tablist">
            {(['raw', 'finished', 'recipes', 'movements'] as Tab[]).map((t) => (
              <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {{ raw: 'Raw materials', finished: 'Finished goods', recipes: 'Recipes', movements: 'Movements' }[t]}
              </button>
            ))}
          </div>
          {tab === 'raw' && <Raw rows={inv.data.materials} finance={finance} onAdjust={setAdjust} />}
          {tab === 'finished' && <Finished rows={inv.data.finished} finance={finance} onAdjust={setAdjust} />}
          {tab === 'recipes' && <Recipes recipes={inv.data.recipes} finance={finance} />}
          {tab === 'movements' && <Movements />}
        </>
      )}
      <Adjust item={adjust} onClose={() => setAdjust(null)} />
    </div>
  )
}

function statusTone(s: string) {
  return s === 'SHORT' ? 'out' : s === 'REORDER' ? 'attn' : s === 'SLOW' ? 'wait' : 'in'
}

function Raw({ rows, finance, onAdjust }: { rows: any[]; finance: boolean; onAdjust: (item: any) => void }) {
  const ui = useUI()
  const navigate = useNavigate()
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th><th>Material</th><th className="money">On hand</th><th className="money">Needed for orders</th><th className="money">Free</th><th>On the way</th>
              <th className="money">Days of cover</th><th className="money">Reorder point</th><th>Status</th><th>Class</th><th>Main supplier</th>{finance && <th className="money">Stock value</th>}<th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="mono small nowrap">{m.sku}</td>
                <td className="wrap" style={{ minWidth: 190 }}>{m.name}<span className="sub">{m.avg_daily_use_label}/day · {m.avg_use_basis === 'LAST_30_DAYS' ? 'last 30 days' : 'planned use'}</span></td>
                <td className="money">{m.on_hand_label}</td>
                <td className="money" title={m.needed_by_order.map((n: any) => `${n.order} ${n.qty_label}`).join('\n')}>{m.needed_label}</td>
                <td className={`money ${m.free < 0 ? 'amt-out' : ''}`}>{m.free < 0 ? `Short ${m.free_label.replace('−', '')}` : m.free_label}</td>
                <td className="small wrap">{m.on_the_way ? <>{m.on_the_way_label}{m.incoming.map((i: any) => <span key={i.po_number} className="sub">{i.po_number} {i.expected_arrival ? shortDate(i.expected_arrival) : i.held ? 'held until bill paid' : 'after payment'}</span>)}</> : <span className="faint">·</span>}</td>
                <td className="money">{m.days_of_cover ?? '·'}</td>
                <td className="money">{m.reorder_point_label}</td>
                <td className="wrap">
                  <Status tone={statusTone(m.status)}>{{ SHORT: 'Short', REORDER: 'Reorder', OK: 'OK', SLOW: 'Slow' }[m.status as string]}</Status>
                  {m.blocked.map((b: any) => (
                    <button key={b.event_id} className="sub btn-quiet" style={{ border: 0, background: 'none', padding: 0, cursor: finance ? 'pointer' : 'default', color: 'var(--out)' }} disabled={!finance}
                      onClick={() => { ui.selectEvent(b.event_id); ui.setEngineView('flow'); ui.setDay(b.from_day); navigate('/app/engine') }}>
                      {b.order_id} waits D{b.from_day} to D{b.to_day}
                    </button>
                  ))}
                </td>
                <td className="mono">{m.abc}</td>
                <td className="small">{m.main_supplier?.name ?? '·'}</td>
                {finance && <td className="money"><Amount paise={m.stock_value_paise} /></td>}
                <td><button className="btn btn-sm btn-quiet" onClick={() => onAdjust({ item_type: 'MATERIAL', id: m.id, name: m.name, unit: m.unit, factor: m.unit_factor })}>Adjust</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro faint" style={{ marginTop: 8 }}>
        Needed for orders = quantity × recipe including wastage, the same figures the engine uses; stock is taken when production starts, not reserved earlier.
        Reorder point = average daily use × supplier lead time + safety days × average daily use. Class A covers the top 80% of stock value, B the next 15%, C the rest.
      </p>
    </>
  )
}

function Finished({ rows, finance, onAdjust }: { rows: any[]; finance: boolean; onAdjust: (item: any) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>SKU</th><th>Product</th><th>Variant</th><th className="money">On hand</th><th className="money">Committed</th><th className="money">In production</th><th className="money">Planned</th><th className="money">Free</th><th>Next delivery</th>{finance && <th className="money">Value</th>}<th /></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="mono small nowrap">{p.sku}</td><td style={{ minWidth: 190 }}>{p.name}</td>
              <td className="small muted">{Object.values(p.variant).join(', ')}</td>
              <td className="money">{p.on_hand}</td><td className="money">{p.committed}</td><td className="money">{p.in_production}</td><td className="money">{p.planned}</td><td className="money">{p.free}</td>
              <td className="mono small">{p.next_delivery ? shortDate(p.next_delivery) : '·'}</td>
              {finance && <td className="money"><Amount paise={p.value_paise} /></td>}
              <td><button className="btn btn-sm btn-quiet" onClick={() => onAdjust({ item_type: 'PRODUCT', id: p.id, name: p.name, unit: 'pc', factor: 1 })}>Adjust</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Recipes({ recipes, finance }: { recipes: any[]; finance: boolean }) {
  return (
    <div className="stack" style={{ gap: 24 }}>
      {recipes.map((r) => (
        <div key={r.product_id}>
          <div className="row" style={{ borderBottom: '1px solid var(--rule-strong)', paddingBottom: 6 }}>
            <span className="mono small">{r.sku}</span><strong className="grow">{r.name}</strong><span className="small faint">used in {r.used_in_open_orders} open orders</span>
          </div>
          <table className="table dense">
            <thead><tr><th>Material</th><th className="money">Per piece</th><th className="money">Wastage</th><th className="money">Per piece incl. wastage</th></tr></thead>
            <tbody>
              {r.lines.map((l: any) => (
                <tr key={l.id}><td>{l.material}</td><td className="money">{l.per_piece_label}</td><td className="money">{(l.wastage_bp / 100).toFixed(0)}%</td><td className="money">{l.with_wastage_label}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 6 }}>
            {finance && <>Production cost per piece <span className="mono">{rupees(r.production_cost_paise)}</span> · </>}Production time {r.production_days} days per batch
          </p>
        </div>
      ))}
      <p className="micro faint">Recipe quantities and wastage are owner-entered assumptions (illustrative persona data in the demo).</p>
    </div>
  )
}

function Movements() {
  const moves = useMovements(true)
  if (moves.isLoading) return <SkeletonRows />
  if (moves.isError) return <ErrorNote text={errorText(moves.error)} />
  const reason: Record<string, string> = { PURCHASE_ARRIVAL: 'Purchase arrival', PRODUCTION_USE: 'Production use', DISPATCH: 'Dispatch', ADJUSTMENT: 'Adjustment' }
  return (
    <div className="table-wrap">
      <table className="table dense">
        <thead><tr><th>Date</th><th>Item</th><th className="money">Quantity</th><th>Reason</th><th>Reference</th><th>Note</th><th>By</th></tr></thead>
        <tbody>
          {moves.data!.movements.map((m) => (
            <tr key={m.id}>
              <td className="mono small">{shortDate(m.date)}</td><td>{m.item}</td>
              <td className={`money ${m.qty_delta > 0 ? 'amt-in' : 'amt-out'}`}>{m.qty_label}</td>
              <td className="small">{reason[m.reason] ?? m.reason}</td><td className="mono small">{m.ref ?? '·'}</td><td className="small muted">{m.note ?? ''}</td><td className="small">{m.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Adjust({ item, onClose }: { item: any; onClose: () => void }) {
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const write = useWrite((body: unknown) => api.post('/stock-movements', body))
  if (!item) return null
  const value = Number(qty)
  return (
    <Dialog open onClose={onClose} title={`Adjust ${item.name}`} description="Use for counts, damage or returns. A note is required.">
      <div className="form-grid">
        <label className="field"><span className="field-label">Change in {item.unit} (negative to remove)</span><input className="input mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="field"><span className="field-label">Note</span><input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {write.isError && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(write.error)} /></div>}
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!value || !note.trim() || write.isPending}
          onClick={() => write.mutate({ item_type: item.item_type, item_id: item.id, qty_delta: Math.round(value * item.factor), note: note.trim() }, { onSuccess: () => { setQty(''); setNote(''); onClose() } })}>
          Save adjustment
        </button>
      </div>
    </Dialog>
  )
}
