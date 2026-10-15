import { useEffect, useState } from 'react'
import { api, errorText, fieldIssues } from '../lib/api'
import { useCatalogue, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import { checkName, parseMoney, parseQuantity, parseWhole } from '../lib/validate'
import { ConfirmButton, Dialog, ErrorNote } from './ui'

export const UNITS = [
  { key: 'kg', label: 'Kilograms (kg)', base: 'g', factor: 1000, decimals: 3 },
  { key: 'g', label: 'Grams (g)', base: 'g', factor: 1, decimals: 0 },
  { key: 'L', label: 'Litres (L)', base: 'ml', factor: 1000, decimals: 3 },
  { key: 'ml', label: 'Millilitres (ml)', base: 'ml', factor: 1, decimals: 0 },
  { key: 'm', label: 'Metres (m)', base: 'cm', factor: 100, decimals: 2 },
  { key: 'pc', label: 'Pieces (pc)', base: 'pc', factor: 1, decimals: 0 },
  { key: 'box', label: 'Boxes (box)', base: 'box', factor: 1, decimals: 0 },
] as const

export interface MaterialRow {
  id: string
  sku: string
  name: string
  unit: string
  base_unit?: string
  unit_factor: number
  avg_cost_paise?: number
  safety_days?: number
  main_supplier?: { id: string; name: string } | null
}

/** Add a raw material, or edit one. Everything that reads stock (inventory, reorder alerts, purchase orders, recipes, the forecast) picks it up from the same record. */
export function MaterialDialog({ open, material, onClose, onSaved }: {
  open: boolean
  material?: MaterialRow | null
  onClose: () => void
  onSaved?: (material: { id: string; name: string }) => void
}) {
  const ui = useUI()
  const catalogue = useCatalogue()
  const editing = !!material
  const blank = { name: '', sku: '', unit: 'kg', cost: '', opening: '', supplier: '', safety: '7' }
  const [form, setForm] = useState(blank)
  const [touched, setTouched] = useState(false)
  const create = useWrite((body: unknown) => api.post<{ material: { id: string; name: string } }>('/materials', body))
  const patch = useWrite((body: { id: string; data: unknown }) => api.patch<{ material: { id: string; name: string } }>(`/materials/${encodeURIComponent(body.id)}`, body.data))
  const remove = useWrite((id: string) => api.del(`/materials/${encodeURIComponent(id)}`))
  const write = editing ? patch : create

  useEffect(() => {
    if (!open) return
    setTouched(false)
    create.reset(); patch.reset(); remove.reset()
    setForm(material
      ? { name: material.name, sku: material.sku, unit: material.unit, cost: material.avg_cost_paise !== undefined ? String(material.avg_cost_paise / 100) : '', opening: '', supplier: material.main_supplier?.id ?? '', safety: String(material.safety_days ?? 7) }
      : blank)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, material?.id])

  const unit = UNITS.find((u) => u.key === form.unit) ?? UNITS[0]
  const nameError = checkName(form.name, 'Name')
  const skuError = form.sku && !/^[A-Za-z0-9][A-Za-z0-9_-]{1,23}$/.test(form.sku.trim()) ? 'SKU uses letters, numbers, - and _ (2 to 24 characters).' : null
  const cost = form.cost.trim() ? parseMoney(form.cost, { label: 'Cost', allowZero: true, max: 10 ** 9 }) : ({ ok: true, value: 0 } as const)
  const opening = form.opening.trim() ? parseQuantity(form.opening, 'Opening stock', { decimals: unit.decimals, allowZero: true, max: 10 ** 7 }) : ({ ok: true, value: 0 } as const)
  const safety = parseWhole(form.safety, 0, 90, 'Safety days')
  const problem = nameError ?? skuError ?? (!cost.ok ? cost.error : null) ?? (!opening.ok ? opening.error : null) ?? (!safety.ok ? safety.error : null)
  const server = Object.fromEntries(fieldIssues(write.error).map((i) => [i.field, i.message]))
  const set = (key: keyof typeof form, value: string) => { setForm({ ...form, [key]: value }); if (write.isError) write.reset() }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (problem || !cost.ok || !opening.ok || !safety.ok) return
    const common = { name: form.name.trim(), sku: form.sku.trim() || undefined, cost_paise: cost.value, supplier_id: form.supplier || null, reorder_safety_days: safety.value }
    if (editing) {
      patch.mutate({ id: material!.id, data: { ...common, sku: form.sku.trim() || material!.sku } }, {
        onSuccess: (r) => { ui.toast(`${r.material.name} updated.`); onSaved?.(r.material); onClose() },
      })
    } else {
      create.mutate({ ...common, unit: form.unit, opening_qty: opening.value }, {
        onSuccess: (r) => { ui.toast(`${r.material.name} added. It now shows in stock, purchase orders and recipes.`); onSaved?.(r.material); onClose() },
      })
    }
  }

  const err = (message: string | null | undefined) => (touched && message ? <span className="micro" role="alert" style={{ color: 'var(--out)' }}>{message}</span> : null)

  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Edit ${material!.name}` : 'New raw material'}
      description={editing ? 'The unit cannot change, because every quantity on record is counted in it.' : 'Add a material you buy and use. Opening stock is what you hold right now.'}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label className="field" style={{ gridColumn: '1 / -1' }}><span className="field-label">Name</span>
            <input className="input" autoFocus maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Indigo dye" aria-invalid={touched && !!nameError} />
            {err(nameError ?? server.name)}
          </label>
          <label className="field"><span className="field-label">Counted in</span>
            <select className="select" value={form.unit} disabled={editing} onChange={(e) => set('unit', e.target.value)}>
              {UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
            </select>
            <span className="micro faint">{unit.factor === 1 ? `Stored in ${unit.base}.` : `Stored in ${unit.base} (1 ${unit.key} = ${unit.factor.toLocaleString('en-IN')} ${unit.base}).`}</span>
          </label>
          <label className="field"><span className="field-label">SKU</span>
            <input className="input mono" maxLength={24} value={form.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder={editing ? undefined : 'Made for you'} aria-invalid={touched && !!skuError} />
            {err(skuError ?? server.sku)}
          </label>
          <label className="field"><span className="field-label">Cost per {unit.key}, ₹</span>
            <input className="input mono" inputMode="decimal" value={form.cost} onChange={(e) => set('cost', e.target.value)} placeholder="0" aria-invalid={touched && !cost.ok} />
            {err(!cost.ok ? cost.error : server.cost_paise)}
          </label>
          {!editing && (
            <label className="field"><span className="field-label">Opening stock, {unit.key}</span>
              <input className="input mono" inputMode="decimal" value={form.opening} onChange={(e) => set('opening', e.target.value)} placeholder="0" aria-invalid={touched && !opening.ok} />
              {err(!opening.ok ? opening.error : server.opening_qty)}
            </label>
          )}
          <label className="field"><span className="field-label">Main supplier</span>
            <select className="select" value={form.supplier} onChange={(e) => set('supplier', e.target.value)}>
              <option value="">None yet</option>
              {catalogue.data?.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="micro faint">Used to pre-fill purchase orders and to work out the reorder point.</span>
          </label>
          <label className="field"><span className="field-label">Safety stock, days of use</span>
            <input className="input mono" inputMode="numeric" value={form.safety} onChange={(e) => set('safety', e.target.value)} aria-invalid={touched && !safety.ok} />
            {err(!safety.ok ? safety.error : null)}
          </label>
        </div>
        {write.isError && fieldIssues(write.error).length === 0 && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(write.error)} /></div>}
        {remove.isError && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(remove.error)} /></div>}
        <div className="dialog-actions" style={{ justifyContent: editing ? 'space-between' : undefined }}>
          {editing && <ConfirmButton className="btn btn-quiet" label="Delete" confirmLabel="Delete for good?" disabled={remove.isPending} onConfirm={() => remove.mutate(material!.id, { onSuccess: () => { ui.toast(`${material!.name} deleted.`); onClose() } })} />}
          <span className="row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={write.isPending}>{write.isPending ? 'Saving' : editing ? 'Save changes' : 'Add material'}</button>
          </span>
        </div>
      </form>
    </Dialog>
  )
}
