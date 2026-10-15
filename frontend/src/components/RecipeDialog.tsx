import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import { parseMoney, parsePercentToBps, parseWhole } from '../lib/validate'
import { MaterialDialog, type MaterialRow } from './MaterialDialog'
import { Dialog, ErrorNote } from './ui'

interface Line { key: number; material_id: string; qty: string; waste: string }

/** What one finished piece needs. Quantities are in each material's base unit (g, ml, cm, pc) so they stay whole numbers. */
export function RecipeDialog({ recipe, materials, onClose }: { recipe: any | null; materials: MaterialRow[]; onClose: () => void }) {
  const ui = useUI()
  const [lines, setLines] = useState<Line[]>([])
  const [cost, setCost] = useState('')
  const [days, setDays] = useState('')
  const [touched, setTouched] = useState(false)
  const [adding, setAdding] = useState(false)
  const save = useWrite((body: unknown) => api.put(`/recipes/${encodeURIComponent(recipe.product_id)}`, body))

  useEffect(() => {
    if (!recipe) return
    setTouched(false)
    save.reset()
    setLines(recipe.lines.map((l: any, i: number) => ({ key: i, material_id: l.material_id, qty: String(l.qty_per_piece), waste: String(l.wastage_bp / 100) })))
    setCost(String(recipe.production_cost_paise / 100))
    setDays(String(recipe.production_days))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.product_id])

  if (!recipe) return null
  const byId = new Map(materials.map((m) => [m.id, m]))
  const used = new Set(lines.map((l) => l.material_id))

  const checked = lines.map((l) => ({
    qty: parseWhole(l.qty, 1, 10_000_000, 'Quantity'),
    waste: l.waste.trim() ? parsePercentToBps(l.waste, 'Wastage') : ({ ok: true, value: 0 } as const),
  }))
  const costCheck = parseMoney(cost, { label: 'Production cost', allowZero: true, max: 10 ** 10 })
  const daysCheck = parseWhole(days, 0, 365, 'Production days')
  const lineProblem = lines.map((l, i) => (!l.material_id ? 'Choose a material.' : !checked[i].qty.ok ? checked[i].qty.error : !checked[i].waste.ok ? checked[i].waste.error : (checked[i].waste.ok && checked[i].waste.value > 5000) ? 'Wastage cannot be above 50%.' : null))
  const problem = lineProblem.find(Boolean) ?? (!costCheck.ok ? costCheck.error : null) ?? (!daysCheck.ok ? daysCheck.error : null)

  const update = (key: number, patch: Partial<Line>) => { setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l))); if (save.isError) save.reset() }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (problem || !costCheck.ok || !daysCheck.ok) return
    save.mutate({
      lines: lines.map((l, i) => ({ material_id: l.material_id, qty_per_piece: (checked[i].qty as any).value, wastage_bp: (checked[i].waste as any).value })),
      production_cost_paise: costCheck.value, production_days: daysCheck.value,
    }, { onSuccess: () => { ui.toast(`${recipe.name} recipe saved. Stock needs and the forecast are recalculated.`); onClose() } })
  }

  const nextFree = materials.find((m) => !used.has(m.id))

  return (
    <>
      <Dialog open onClose={onClose} wide title={`Recipe: ${recipe.name}`} description="What one finished piece uses, including the wastage you expect. Open orders and the forecast use these figures.">
        <form onSubmit={submit} noValidate>
          <table className="table dense">
            <thead><tr><th>Material</th><th className="money">Per piece</th><th className="money">Wastage %</th><th /></tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={4} className="small muted">No materials yet. Add what one piece needs.</td></tr>}
              {lines.map((l, i) => {
                const m = byId.get(l.material_id)
                return (
                  <tr key={l.key}>
                    <td>
                      <select className="select" value={l.material_id} aria-label="Material" onChange={(e) => update(l.key, { material_id: e.target.value })}>
                        {!l.material_id && <option value="">Choose</option>}
                        {materials.map((x) => <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== l.material_id}>{x.name}</option>)}
                      </select>
                      {touched && lineProblem[i] && <span className="micro" role="alert" style={{ color: 'var(--out)', display: 'block' }}>{lineProblem[i]}</span>}
                    </td>
                    <td className="money"><span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <input className="input mono" style={{ width: 96, textAlign: 'right' }} inputMode="numeric" value={l.qty} aria-label={`Quantity per piece${m ? ` in ${m.base_unit ?? m.unit}` : ''}`} onChange={(e) => update(l.key, { qty: e.target.value })} />
                      <span className="small faint" style={{ width: 24 }}>{m?.base_unit ?? m?.unit}</span>
                    </span></td>
                    <td className="money"><input className="input mono" style={{ width: 72, textAlign: 'right' }} inputMode="decimal" value={l.waste} aria-label="Wastage percent" onChange={(e) => update(l.key, { waste: e.target.value })} /></td>
                    <td className="right"><button type="button" className="icon-btn" aria-label={`Remove ${m?.name ?? 'material'}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><TrashIcon size={16} /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="row-wrap" style={{ margin: '8px 0 14px' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!nextFree} onClick={() => nextFree && setLines([...lines, { key: Date.now(), material_id: nextFree.id, qty: '1', waste: '0' }])}><PlusIcon size={14} /> Add material</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAdding(true)}>New raw material</button>
            {!nextFree && materials.length > 0 && <span className="micro faint">Every material is already in this recipe.</span>}
          </div>
          <div className="form-grid">
            <label className="field"><span className="field-label">Production cost per piece, ₹</span>
              <input className="input mono" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-invalid={touched && !costCheck.ok} />
              {touched && !costCheck.ok && <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{costCheck.error}</span>}
            </label>
            <label className="field"><span className="field-label">Production time, days per batch</span>
              <input className="input mono" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={touched && !daysCheck.ok} />
              {touched && !daysCheck.ok && <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{daysCheck.error}</span>}
            </label>
          </div>
          {save.isError && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(save.error)} /></div>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save recipe'}</button>
          </div>
        </form>
      </Dialog>
      <MaterialDialog open={adding} onClose={() => setAdding(false)}
        onSaved={(created) => setLines((current) => [...current, { key: Date.now(), material_id: created.id, qty: '1', waste: '0' }])} />
    </>
  )
}
