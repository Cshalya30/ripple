import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { useApp } from '../context/AppContext'
import { isoFromOffset } from '../lib/dates'
import { formatINR } from '../lib/format'
import type { PartyKind } from '../types'

interface Props {
  kind: PartyKind
  open: boolean
  onClose: () => void
}

interface FormState {
  name: string
  phone: string
  details: string
  products: string
  quantity: string
  total: string
  paid: string
  txDate: string
  dueDate: string
}

const empty = (): FormState => ({
  name: '',
  phone: '',
  details: '',
  products: '',
  quantity: '',
  total: '',
  paid: '0',
  txDate: isoFromOffset(0),
  dueDate: isoFromOffset(30),
})

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-loss" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function PartyFormModal({ kind, open, onClose }: Props) {
  const { addParty, pushToast } = useApp()
  const isCustomer = kind === 'customer'
  const [form, setForm] = useState<FormState>(empty)
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(empty())
      setTouched({})
      setSubmitted(false)
      setSaving(false)
    }
  }, [open, kind])

  const total = Number(form.total)
  const paid = Number(form.paid)
  const owed = Number.isFinite(total) && Number.isFinite(paid) ? Math.max(0, total - paid) : 0

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {}
    const who = isCustomer ? 'customer' : 'supplier'
    if (!form.name.trim()) e.name = `Enter the ${who}'s name.`
    const digits = form.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
    if (!form.phone.trim()) e.phone = 'Enter a phone number.'
    else if (digits.length !== 10) e.phone = 'Enter a 10-digit mobile number.'
    if (!form.details.trim()) e.details = 'Add the business name and city.'
    if (!form.products.trim()) e.products = isCustomer ? 'Add at least one product sold.' : 'Add at least one product supplied.'
    const q = Number(form.quantity)
    if (form.quantity.trim() === '') e.quantity = 'Enter the quantity.'
    else if (q < 0) e.quantity = "Quantity can't be negative."
    else if (!(q > 0)) e.quantity = 'Quantity must be more than 0.'
    if (form.total.trim() === '') e.total = 'Enter the total amount.'
    else if (total < 0) e.total = "Total amount can't be negative."
    else if (!(total > 0)) e.total = 'Total amount must be more than ₹0.'
    if (form.paid.trim() === '') e.paid = 'Enter the amount paid, or 0 if nothing yet.'
    else if (paid < 0) e.paid = "Amount paid can't be negative."
    else if (!e.total && paid > total) e.paid = "Amount paid can't be more than the total."
    if (!form.txDate) e.txDate = isCustomer ? 'Pick the sale date.' : 'Pick the supply date.'
    if (!form.dueDate) e.dueDate = 'Pick the payment due date.'
    else if (form.txDate && form.dueDate < form.txDate) e.dueDate = "Due date can't be before the " + (isCustomer ? 'sale' : 'supply') + ' date.'
    return e
  }, [form, isCustomer, total, paid])

  const show = (k: keyof FormState) => (submitted || touched[k]) && errors[k]
  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const inputProps = (k: keyof FormState) => ({
    id: `pf-${k}`,
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k)(e.target.value),
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    'aria-invalid': show(k) ? (true as const) : undefined,
    'aria-describedby': show(k) ? `pf-${k}-err` : `pf-${k}-hint`,
    className: 'field',
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setSaving(true)
    await addParty({
      kind,
      name: form.name.trim(),
      phone: form.phone.trim(),
      details: form.details.trim(),
      products: form.products.split(',').map((p) => p.trim()).filter(Boolean),
      quantity: Number(form.quantity),
      totalAmount: total,
      paidAmount: paid,
      transactionDate: form.txDate,
      dueDate: form.dueDate,
    })
    pushToast(`${form.name.trim()} added to your ${isCustomer ? 'customers' : 'suppliers'}`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isCustomer ? 'Add customer' : 'Add supplier'}
      description={isCustomer ? 'Record a sale and what the customer still owes you.' : 'Record a supply and what you still owe the supplier.'}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="pf-name" label={isCustomer ? 'Customer name' : 'Supplier name'} error={show('name') || undefined}>
          <input {...inputProps('name')} data-autofocus autoComplete="off" />
        </Field>
        <Field id="pf-phone" label="Phone" error={show('phone') || undefined} hint="10-digit mobile number">
          <input {...inputProps('phone')} type="tel" inputMode="tel" placeholder="+91 98765 43210" />
        </Field>
        <div className="sm:col-span-2">
          <Field id="pf-details" label="Business and address details" error={show('details') || undefined} hint={isCustomer ? 'For example: Saree boutique, Mysuru' : 'For example: Spinning mill, Ludhiana'}>
            <input {...inputProps('details')} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id="pf-products" label={isCustomer ? 'Product(s) sold' : 'Product(s) supplied'} error={show('products') || undefined} hint="Separate several products with commas">
            <input {...inputProps('products')} />
          </Field>
        </div>
        <Field id="pf-quantity" label="Quantity" error={show('quantity') || undefined} hint="Metres, pieces or kilos, whichever you track">
          <input {...inputProps('quantity')} type="number" inputMode="decimal" />
        </Field>
        <Field id="pf-total" label="Total amount (₹)" error={show('total') || undefined}>
          <input {...inputProps('total')} type="number" inputMode="decimal" />
        </Field>
        <Field id="pf-paid" label="Amount paid (₹)" error={show('paid') || undefined}>
          <input {...inputProps('paid')} type="number" inputMode="decimal" />
        </Field>
        <div>
          <label htmlFor="pf-owed" className="mb-1.5 block text-sm font-medium">
            {isCustomer ? 'Amount owed to you' : 'Amount you owe'}
          </label>
          <input id="pf-owed" className="field bg-sunken font-semibold" value={formatINR(owed)} readOnly aria-describedby="pf-owed-hint" />
          <p id="pf-owed-hint" className="mt-1 text-xs text-muted">
            Worked out from total minus paid
          </p>
        </div>
        <Field id="pf-txDate" label={isCustomer ? 'Sale date' : 'Supply date'} error={show('txDate') || undefined}>
          <input {...inputProps('txDate')} type="date" />
        </Field>
        <Field id="pf-dueDate" label="Payment due date" error={show('dueDate') || undefined}>
          <input {...inputProps('dueDate')} type="date" />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4 sm:col-span-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {isCustomer ? 'Save customer' : 'Save supplier'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
