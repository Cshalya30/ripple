import { MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MaterialDialog, type MaterialRow } from '../components/MaterialDialog'
import { RecipeDialog } from '../components/RecipeDialog'
import { Amount, Dialog, ErrorNote, SkeletonRows, Status, StripCell } from '../components/ui'
import { api, errorText } from '../lib/api'
import { rupees, shortDate } from '../lib/format'
import { useInventory, useMovements, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me } from '../lib/types'
import { parseQuantity } from '../lib/validate'

type Tab = 'raw' | 'finished' | 'recipes' | 'movements'
const STATUS_LABEL: Record<string, string> = { SHORT: 'Short', REORDER: 'Reorder', OK: 'OK', SLOW: 'Slow', UNUSED: 'Not used yet' }

export default function Inventory({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('raw')
  const inv = useInventory()
  const finance = me.user.role !== 'SUPERVISOR'
  const [adjust, setAdjust] = useState<any>(null)
  const [material, setMaterial] = useState<{ open: boolean; row: MaterialRow | null }>({ open: false, row: null })
  const [recipe, setRecipe] = useState<any>(null)

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="h1">Inventory</h1>
        <span className="spacer" />
        {finance && inv.data && <button className="btn btn-primary" onClick={() => setMaterial({ open: true, row: null })}><PlusIcon size={16} /> New raw material</button>}
      </div>
      {inv.isLoading && <SkeletonRows rows={8} />}
      {inv.isError && <ErrorNote text={errorText(inv.error)} retry={() => inv.refetch()} />}
      {inv.data && (
        <>
          <div className="strip compact" style={{ marginBottom: 20 }}>
            <StripCell label="Raw materials" sub={`${inv.data.finished.length} finished products`}>{inv.data.materials.length}</StripCell>
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
          {tab === 'raw' && <Raw rows={inv.data.materials} finance={finance} onAdjust={setAdjust} onEdit={(row) => setMaterial({ open: true, row })} onNew={() => setMaterial({ open: true, row: null })} />}
          {tab === 'finished' && <Finished rows={inv.data.finished} finance={finance} onAdjust={setAdjust} />}
          {tab === 'recipes' && <Recipes recipes={inv.data.recipes} materials={inv.data.materials} finance={finance} onEdit={setRecipe} onNew={() => setMaterial({ open: true, row: null })} />}
          {tab === 'movements' && <Movements />}
        </>
      )}
      <Adjust item={adjust} onClose={() => setAdjust(null)} />
      <MaterialDialog open={material.open} material={material.row} onClose={() => setMaterial({ open: false, row: null })} />
      <RecipeDialog recipe={recipe} materials={inv.data?.materials ?? []} onClose={() => setRecipe(null)} />
    </div>
  )
}

function statusTone(s: string) {
  return s === 'SHORT' ? 'out' : s === 'REORDER' ? 'attn' : s === 'SLOW' || s === 'UNUSED' ? 'wait' : 'in'
}

/** On hand (solid), on the way (hatched) and the reorder point (tick), on one shared scale. */
function StockBar({ m }: { m: any }) {
  const scale = Math.max(m.reorder_point * 2, m.on_hand + m.on_the_way, m.needed, 1)
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`
  const tone = m.status === 'SHORT' ? 'var(--out)' : m.status === 'REORDER' ? 'var(--haldi)' : 'var(--in)'
  return (
    <span className="stockbar" role="img" aria-label={`On hand ${m.on_hand_label}, on the way ${m.on_the_way_label}, reorder at ${m.reorder_point_label}`}>
      <span className="stockbar-have" style={{ width: pct(Math.max(0, m.on_hand)), background: tone }} />
      <span className="stockbar-way" style={{ left: pct(Math.max(0, m.on_hand)), width: pct(m.on_the_way) }} />
      {m.reorder_point > 0 && <span className="stockbar-tick" style={{ left: pct(m.reorder_point) }} />}
    </span>
  )
}

const FILTERS = [['ALL', 'All'], ['SHORT', 'Short'], ['REORDER', 'Reorder'], ['SLOW', 'Slow'], ['OK', 'OK'], ['UNUSED', 'Not used yet']] as const

function Raw({ rows, finance, onAdjust, onEdit, onNew }: { rows: any[]; finance: boolean; onAdjust: (item: any) => void; onEdit: (row: MaterialRow) => void; onNew: () => void }) {
  const ui = useUI()
  const navigate = useNavigate()
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>('ALL')
  const [search, setSearch] = useState('')
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, key === 'ALL' ? rows.length : rows.filter((r) => r.status === key).length])), [rows])
  const q = search.trim().toLowerCase()
  const shown = rows.filter((r) => (status === 'ALL' || r.status === status) && (!q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || (r.main_supplier?.name ?? '').toLowerCase().includes(q)))

  if (rows.length === 0) {
    return (
      <div className="notice" style={{ textAlign: 'center', padding: '32px 16px' }}>
        <p style={{ margin: 0 }}><strong>No raw materials yet.</strong></p>
        <p className="small muted">Add the yarn, dye, thread or packing you buy. Ripple then tracks stock, tells you when to reorder, and counts it in the forecast.</p>
        {finance && <button className="btn btn-primary" onClick={onNew}><PlusIcon size={16} /> Add your first raw material</button>}
      </div>
    )
  }

  return (
    <>
      <div className="inv-toolbar">
        <div className="row-wrap" role="group" aria-label="Filter by status" style={{ gap: 6 }}>
          {FILTERS.filter(([key]) => key === 'ALL' || counts[key] > 0).map(([key, label]) => (
            <button key={key} type="button" className="fchip" aria-pressed={status === key} onClick={() => setStatus(key)}>{label} <span className="mono">{counts[key]}</span></button>
          ))}
        </div>
        <label className="search">
          <MagnifyingGlassIcon size={14} />
          <input className="input" placeholder="Search material, SKU or supplier" value={search} aria-label="Search materials" onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Material</th><th className="money">On hand</th><th className="money">Needed for orders</th><th className="money">Free</th><th>On the way</th>
              <th className="money">Cover</th><th>Status</th><th>Main supplier</th>{finance && <th className="money">Stock value</th>}<th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={finance ? 10 : 9} className="small muted" style={{ padding: 20 }}>Nothing matches. <button className="btn-quiet small" style={{ border: 0, background: 'none', cursor: 'pointer', textDecoration: 'underline', color: 'inherit' }} onClick={() => { setStatus('ALL'); setSearch('') }}>Clear the filter</button></td></tr>}
            {shown.map((m) => (
              <tr key={m.id}>
                <td className="wrap" style={{ minWidth: 200 }}>
                  {m.name}
                  <span className="sub"><span className="mono">{m.sku}</span> · class {m.abc} · {m.avg_daily_use_label}/day {m.avg_use_basis === 'LAST_30_DAYS' ? '(last 30 days)' : '(planned use)'}</span>
                </td>
                <td className="money">{m.on_hand_label}<StockBar m={m} /></td>
                <td className="money" title={m.needed_by_order.map((n: any) => `${n.order} ${n.qty_label}`).join('\n')}>{m.needed_label}</td>
                <td className={`money ${m.free < 0 ? 'amt-out' : ''}`}>{m.free < 0 ? `Short ${m.free_label.replace('−', '')}` : m.free_label}</td>
                <td className="small wrap">{m.on_the_way ? <>{m.on_the_way_label}{m.incoming.map((i: any) => <span key={i.po_number} className="sub">{i.po_number} {i.expected_arrival ? shortDate(i.expected_arrival) : i.held ? 'held until bill paid' : 'after payment'}</span>)}</> : <span className="faint">·</span>}</td>
                <td className="money">{m.days_of_cover !== null ? `${m.days_of_cover} d` : '·'}<span className="sub">reorder at {m.reorder_point_label}</span></td>
                <td className="wrap">
                  <Status tone={statusTone(m.status)}>{STATUS_LABEL[m.status] ?? m.status}</Status>
                  {m.blocked.map((b: any) => (
                    <button key={b.event_id} className="sub btn-quiet" style={{ border: 0, background: 'none', padding: 0, cursor: finance ? 'pointer' : 'default', color: 'var(--out)' }} disabled={!finance}
                      onClick={() => { ui.selectEvent(b.event_id); ui.setEngineView('flow'); ui.setDay(b.from_day); navigate('/app/engine') }}>
                      {b.order_id} waits D{b.from_day} to D{b.to_day}
                    </button>
                  ))}
                </td>
                <td className="small">{m.main_supplier?.name ?? <span className="faint">·</span>}</td>
                {finance && <td className="money"><Amount paise={m.stock_value_paise} /></td>}
                <td className="right nowrap">
                  {finance && (m.status === 'SHORT' || m.status === 'REORDER') && <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/app/orders?tab=purchase&new=1&material=${encodeURIComponent(m.id)}`)}>Order</button>}{' '}
                  <button className="btn btn-sm btn-quiet" onClick={() => onAdjust({ item_type: 'MATERIAL', id: m.id, name: m.name, unit: m.unit, factor: m.unit_factor })}>Adjust</button>
                  {finance && <button className="icon-btn" aria-label={`Edit ${m.name}`} title="Edit material" onClick={() => onEdit(m)}><PencilSimpleIcon size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro faint" style={{ marginTop: 8 }}>
        Needed for orders = quantity × recipe including wastage, the same figures the engine uses; stock is taken when production starts, not reserved earlier.
        Reorder point = average daily use × supplier lead time + safety days × average daily use. The bar shows stock on hand, material on the way (hatched) and the reorder point (tick).
        Class A covers the top 80% of stock value, B the next 15%, C the rest.
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

function Recipes({ recipes, materials, finance, onEdit, onNew }: { recipes: any[]; materials: any[]; finance: boolean; onEdit: (recipe: any) => void; onNew: () => void }) {
  const inRecipe = new Set(recipes.flatMap((r) => r.lines.map((l: any) => l.material_id)))
  const loose = materials.filter((m) => !inRecipe.has(m.id))
  return (
    <div className="stack" style={{ gap: 24 }}>
      {finance && loose.length > 0 && (
        <div className="notice attn">
          <strong>Not in any recipe yet:</strong> {loose.map((m) => m.name).join(', ')}. Add {loose.length === 1 ? 'it' : 'them'} to a recipe with Edit recipe so orders reserve and the forecast counts the stock.
        </div>
      )}
      {recipes.map((r) => (
        <div key={r.product_id}>
          <div className="row" style={{ borderBottom: '1px solid var(--rule-strong)', paddingBottom: 6 }}>
            <span className="mono small">{r.sku}</span><strong className="grow">{r.name}</strong><span className="small faint">used in {r.used_in_open_orders} open orders</span>
            {finance && <button className="btn btn-sm btn-secondary" onClick={() => onEdit(r)}><PencilSimpleIcon size={14} /> Edit recipe</button>}
          </div>
          <table className="table dense">
            <thead><tr><th>Material</th><th className="money">Per piece</th><th className="money">Wastage</th><th className="money">Per piece incl. wastage</th></tr></thead>
            <tbody>
              {r.lines.length === 0 && <tr><td colSpan={4} className="small muted">No materials in this recipe yet.</td></tr>}
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
      {finance && <div><button className="btn btn-quiet" onClick={onNew}><PlusIcon size={14} /> New raw material</button></div>}
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
          {moves.data!.movements.length === 0 && <tr><td colSpan={7} className="small muted">No stock movements yet.</td></tr>}
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
  const ui = useUI()
  const write = useWrite((body: unknown) => api.post('/stock-movements', body))
  if (!item) return null
  const negative = qty.trim().startsWith('-')
  const parsed = parseQuantity(qty.trim().replace(/^[-+]/, ''), 'Change', { decimals: item.factor === 1000 ? 3 : item.factor === 100 ? 2 : 0, max: 10 ** 6 })
  const delta = parsed.ok ? Math.round((negative ? -parsed.value : parsed.value) * item.factor) : 0
  return (
    <Dialog open onClose={onClose} title={`Adjust ${item.name}`} description="Use for counts, damage or returns. A note is required.">
      <form onSubmit={(e) => {
        e.preventDefault()
        if (!parsed.ok || !note.trim()) return
        write.mutate({ item_type: item.item_type, item_id: item.id, qty_delta: delta, note: note.trim() }, { onSuccess: () => { setQty(''); setNote(''); ui.toast(`${item.name} adjusted.`); onClose() } })
      }}>
        <div className="form-grid">
          <label className="field"><span className="field-label">Change in {item.unit} (negative to remove)</span>
            <input className="input mono" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={qty !== '' && !parsed.ok} />
            {qty !== '' && !parsed.ok && <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{parsed.error}</span>}
          </label>
          <label className="field"><span className="field-label">Note</span><input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {write.isError && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(write.error)} /></div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!parsed.ok || !note.trim() || write.isPending}>Save adjustment</button>
        </div>
      </form>
    </Dialog>
  )
}
