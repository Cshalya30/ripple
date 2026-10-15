import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DatasheetButton } from '../components/DatasheetButton'
import { ConfirmButton, ErrorNote, Section, Seg } from '../components/ui'
import { VoiceSettings } from '../components/VoiceSettings'
import { api, errorText, fieldIssues } from '../lib/api'
import { rupees, shortDate } from '../lib/format'
import { useSettings, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me, Prefs } from '../lib/types'
import {
  checkEmail, checkGstin, checkName, checkUdyam, normaliseGstin, normaliseUdyam, parseMoney, parsePercentToBps, parseWhole,
} from '../lib/validate'

/** Settings writes answer with the whole settings payload; put it straight in the cache so the screen never shows the old value. */
function useSettingsWrite<T>(fn: (body: T) => Promise<any>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (settings) => {
      if (settings?.business) qc.setQueryData(['settings'], settings)
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' })
    },
  })
}

export default function Settings({ me }: { me: Me }) {
  const finance = me.user.role !== 'SUPERVISOR'
  const owner = me.user.role === 'OWNER'
  const settings = useSettings(finance)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const ui = useUI()
  const setPref = async (patch: Partial<Prefs>) => {
    try {
      qc.setQueryData(['me'], await api.put<Me>('/me/prefs', patch))
    } catch (error) {
      ui.toast(`Could not save that setting. ${errorText(error)}`)
    }
  }
  const logout = async (everywhere = false) => {
    try {
      await api.post(everywhere ? '/auth/logout-all' : '/auth/logout')
    } catch { /* the session may already be gone: leave either way */ }
    qc.clear()
    ui.setScenario(null)
    navigate('/login')
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-head"><h1 className="h1">Settings</h1></div>

      {finance && settings.isLoading && <p className="small muted">Loading your settings</p>}
      {finance && settings.isError && <ErrorNote text={errorText(settings.error)} retry={() => settings.refetch()} />}
      {finance && settings.data && <BusinessProfile data={settings.data.business} editable={owner} />}
      {finance && settings.data && <MoneyRules data={settings.data} />}
      {owner && settings.data?.team && <Team team={settings.data.team} me={me} />}

      <Section title="Display">
        <Row label="Theme" hint="Lamp is warm and lower contrast, for long evenings.">
          <Seg label="Theme" value={me.prefs.theme} onChange={(theme) => setPref({ theme })} options={[{ value: 'night', label: 'Night' }, { value: 'day', label: 'Day' }, { value: 'lamp', label: 'Lamp' }]} />
        </Row>
        <Row label="Text size">
          <Seg label="Text size" value={me.prefs.text_size} onChange={(text_size) => setPref({ text_size })} options={(['S', 'M', 'L', 'XL'] as const).map((v) => ({ value: v, label: v }))} />
        </Row>
        <Row label="Number format" hint="Indian ₹1,45,000 or international ₹145,000">
          <Seg label="Number format" value={me.prefs.number_format} onChange={(number_format) => setPref({ number_format })} options={[{ value: 'indian', label: '1,45,000' }, { value: 'international', label: '145,000' }]} />
        </Row>
      </Section>

      <Section title="Language">
        {([['language_ui', 'App language'], ['language_messages', 'Message drafts']] as const).map(([key, label]) => (
          <Row key={key} label={label}>
            <Seg label={label} value={me.prefs[key]} onChange={(v) => setPref({ [key]: v } as Partial<Prefs>)} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }, { value: 'hi', label: 'हिन्दी' }]} />
          </Row>
        ))}
        <p className="micro faint">Tamil and Hindi screens and templates are awaiting review by a fluent speaker. Untranslated text shows in English. Munim's own language, including Telugu, Kannada, Malayalam, Punjabi, German, Spanish and Chinese, is set under Voice below.</p>
      </Section>

      <VoiceSettings prefs={me.prefs} setPref={setPref} />

      <Section title="Accessibility">
        {([['reduce_motion', 'Reduce motion', 'Scenario changes apply instantly with an outline instead of the ripple.'],
          ['high_contrast', 'High contrast', 'Secondary text at full strength.'],
          ['large_targets', 'Larger touch targets', 'At least 44px rows and controls, including compact actions.']] as const).map(([key, label, hint]) => (
          <Row key={key} label={label} hint={hint}>
            <label className="check"><input type="checkbox" checked={me.prefs[key]} onChange={(e) => setPref({ [key]: e.target.checked } as Partial<Prefs>)} /> {me.prefs[key] ? 'On' : 'Off'}</label>
          </Row>
        ))}
      </Section>

      {finance && (
        <Section title="Notifications">
          <p className="small muted">In-app alerts: buffer breach, overdue invoices, bills due in 3 days, stock short for an order, risk of a shortfall within 30 days above 25%. WhatsApp and SMS alerts are coming soon.</p>
        </Section>
      )}

      {finance && <DataSection me={me} />}

      <Section title="Privacy and security">
        <p className="small muted">Your records stay in Ripple's database. Only the text you send to Munim or to the set-up assistant goes to the AI provider (Groq). Every amount and date is computed by Ripple's own engine, never by the AI.</p>
        <Sessions />
        <div className="row" style={{ marginTop: 8 }}><button className="btn btn-secondary" onClick={() => logout(true)}>Log out everywhere</button></div>
      </Section>

      <Section title="Account">
        <Row label="Signed in as"><span>{me.user.name} · <span className="mono small">{me.user.email}</span> · {me.user.role.toLowerCase()}</span></Row>
        <div className="row" style={{ marginTop: 8 }}><button className="btn btn-primary" onClick={() => logout()}>Log out</button></div>
      </Section>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="list-row" style={{ flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 200 }}>{label}{hint && <span className="sub">{hint}</span>}</div>
      <div>{children}</div>
    </div>
  )
}

/** Message under an input: a problem in red, or a caution in amber that does not block saving. */
function Hint({ error, warning, id }: { error?: string | null; warning?: string | null; id: string }) {
  if (error) return <span id={id} role="alert" className="micro" style={{ color: 'var(--out)' }}>{error}</span>
  if (warning) return <span id={id} className="micro" style={{ color: 'var(--haldi)' }}>{warning}</span>
  return null
}

// ---------------------------------------------------------------- business profile

function BusinessProfile({ data, editable }: { data: any; editable: boolean }) {
  const ui = useUI()
  const [form, setForm] = useState(() => toForm(data))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  useEffect(() => { setForm(toForm(data)); setTouched({}) }, [data])
  const write = useSettingsWrite((body: unknown) => api.put('/settings/business', body))

  const gstin = checkGstin(form.gstin)
  const udyam = checkUdyam(form.udyam_number)
  const errors: Record<string, string | null> = {
    name: checkName(form.name, 'Business name'),
    owner_name: form.owner_name.length > 120 ? 'Owner name can be at most 120 characters.' : null,
    gstin: gstin.error,
    udyam_number: udyam.error,
    address: form.address.length > 300 ? 'Address can be at most 300 characters.' : null,
  }
  const server = Object.fromEntries(fieldIssues(write.error).map((i) => [i.field, i.message]))
  const shown = (key: string) => (touched[key] || write.isError ? errors[key] ?? server[key] ?? null : null)
  const invalid = Object.values(errors).some(Boolean)
  const dirty = JSON.stringify(payload(form)) !== JSON.stringify(payload(toForm(data)))

  const set = (key: keyof typeof form, value: string) => { setForm({ ...form, [key]: value }); if (write.isError) write.reset() }
  const blur = (key: keyof typeof form, tidy?: (v: string) => string) => {
    setTouched({ ...touched, [key]: true })
    if (tidy) setForm((f) => ({ ...f, [key]: tidy(f[key]) }))
  }

  const field = (key: 'name' | 'owner_name' | 'gstin' | 'udyam_number', label: string, props: Record<string, unknown> = {}, tidy?: (v: string) => string, warning?: string | null) => (
    <label className="field"><span className="field-label">{label}</span>
      <input className={`input${key === 'gstin' || key === 'udyam_number' ? ' mono' : ''}`} disabled={!editable} value={form[key]} aria-invalid={!!shown(key)} aria-describedby={`${key}-hint`}
        onChange={(e) => set(key, e.target.value)} onBlur={() => blur(key, tidy)} {...props} />
      <Hint id={`${key}-hint`} error={shown(key)} warning={touched[key] ? warning : null} />
    </label>
  )

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched({ name: true, owner_name: true, gstin: true, udyam_number: true, address: true })
    if (invalid || !dirty) return
    write.mutate(payload(form), { onSuccess: () => ui.toast('Business profile saved.') })
  }

  return (
    <Section title="Business profile">
      <form onSubmit={save} noValidate>
        <div className="form-grid">
          {field('name', 'Business name', { maxLength: 120, required: true })}
          {field('owner_name', 'Owner name', { maxLength: 120 })}
          {field('gstin', 'GSTIN', { maxLength: 20, placeholder: '33AAJFM4721K1Z9', autoCapitalize: 'characters', spellCheck: false }, normaliseGstin, gstin.warning)}
          {field('udyam_number', 'Udyam number', { maxLength: 40, placeholder: 'UDYAM-TN-08-0012345', autoCapitalize: 'characters', spellCheck: false }, normaliseUdyam)}
          <label className="field"><span className="field-label">MSME category</span>
            <select className="select" disabled={!editable} value={form.msme_category} onChange={(e) => set('msme_category', e.target.value)}>
              <option value="">Not registered</option><option value="MICRO">Micro</option><option value="SMALL">Small</option><option value="MEDIUM">Medium</option>
            </select>
          </label>
          <label className="field"><span className="field-label">Business type</span><input className="input" disabled value="Manufacturer (v1 supports this shape only)" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span className="field-label">Address</span>
            <input className="input" disabled={!editable} maxLength={320} value={form.address} aria-invalid={!!shown('address')} onChange={(e) => set('address', e.target.value)} onBlur={() => blur('address')} />
            <Hint id="address-hint" error={shown('address')} />
          </label>
        </div>
        {!editable && <p className="micro faint" style={{ marginTop: 8 }}>Only the owner can change the business profile.</p>}
        {editable && (
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-secondary" disabled={write.isPending || !dirty}>{write.isPending ? 'Saving' : 'Save profile'}</button>
            {dirty && !write.isPending && <button type="button" className="btn btn-quiet" onClick={() => { setForm(toForm(data)); setTouched({}); write.reset() }}>Discard changes</button>}
            {write.isSuccess && !dirty && <span className="small muted">Saved.</span>}
            {dirty && invalid && Object.keys(touched).length > 0 && <span className="small" style={{ color: 'var(--out)' }}>Fix the highlighted fields to save.</span>}
          </div>
        )}
      </form>
      {write.isError && fieldIssues(write.error).length === 0 && <div style={{ marginTop: 8 }}><ErrorNote text={errorText(write.error)} /></div>}
    </Section>
  )
}

function toForm(data: any) {
  return {
    name: data?.name ?? '', owner_name: data?.owner_name ?? '', gstin: data?.gstin ?? '', udyam_number: data?.udyam_number ?? '',
    msme_category: data?.msme_category ?? '', address: data?.address ?? '',
  }
}

/** What the server gets: tidy text, and null for anything left empty so clearing a field really clears it. */
function payload(form: ReturnType<typeof toForm>) {
  const text = (v: string) => v.replace(/\s+/g, ' ').trim() || null
  return {
    name: text(form.name), owner_name: text(form.owner_name), address: text(form.address),
    gstin: normaliseGstin(form.gstin) || null, udyam_number: normaliseUdyam(form.udyam_number) || null, msme_category: form.msme_category || null,
  }
}

// ---------------------------------------------------------------- money rules

const HORIZONS = ['30', '60', '90', '120', '180'] as const

function MoneyRules({ data }: { data: any }) {
  const ui = useUI()
  const money = useSettingsWrite((body: unknown) => api.put('/settings/money', body))
  const horizonWrite = useSettingsWrite((body: unknown) => api.put('/settings/money', body))
  const addRx = useSettingsWrite((body: unknown) => api.post('/settings/recurring', body))
  const delRx = useSettingsWrite((id: string) => api.del(`/settings/recurring/${encodeURIComponent(id)}`))
  const addCf = useSettingsWrite((body: unknown) => api.post('/settings/facilities', body))
  const delCf = useSettingsWrite((id: string) => api.del(`/settings/facilities/${encodeURIComponent(id)}`))

  // Safety buffer
  const serverBuffer = String(data.money.safety_buffer_paise / 100)
  const [buffer, setBuffer] = useState(serverBuffer)
  useEffect(() => setBuffer(serverBuffer), [serverBuffer])
  const parsedBuffer = parseMoney(buffer, { label: 'Safety buffer', allowZero: true, max: 10 ** 12 })
  const bufferDirty = parsedBuffer.ok ? parsedBuffer.value !== data.money.safety_buffer_paise : true

  // Forecast horizon: show the server's value; while a change is in flight show the one asked for.
  const [wanted, setWanted] = useState<string | null>(null)
  const horizon = wanted ?? String(data.money.horizon_days)

  // Default credit terms
  const [terms, setTerms] = useState({ customer: String(data.money.default_customer_terms_days), supplier: String(data.money.default_supplier_terms_days) })
  useEffect(() => setTerms({ customer: String(data.money.default_customer_terms_days), supplier: String(data.money.default_supplier_terms_days) }), [data.money.default_customer_terms_days, data.money.default_supplier_terms_days])
  const customerDays = parseWhole(terms.customer, 0, 365, 'Customer credit days')
  const supplierDays = parseWhole(terms.supplier, 0, 365, 'Supplier credit days')
  const termsDirty = customerDays.ok && supplierDays.ok && (customerDays.value !== data.money.default_customer_terms_days || supplierDays.value !== data.money.default_supplier_terms_days)

  // Recurring expenses
  const [rx, setRx] = useState({ label: '', amount: '', day: '15' })
  const rxAmount = parseMoney(rx.amount, { label: 'Amount', max: 10 ** 12 })
  const rxDay = parseWhole(rx.day, 1, 31, 'Day of month')
  const rxLabel = checkName(rx.label, 'Name', 80)
  const rxStarted = rx.label !== '' || rx.amount !== ''

  // Credit facilities
  const [cf, setCf] = useState({ label: '', limit: '', rate: '', fee: '0', from: '', repay: '' })
  const cfLimit = parseMoney(cf.limit, { label: 'Limit', max: 10 ** 12 })
  const cfRate = parsePercentToBps(cf.rate, 'Rate')
  const cfFee = parseMoney(cf.fee, { label: 'Fee', allowZero: true, max: 10 ** 11 })
  const cfLabel = checkName(cf.label, 'Name', 80)
  const cfDates = !cf.from || !cf.repay ? 'Choose both dates.' : cf.repay <= cf.from ? 'Repay-by must be after available-from.' : null
  const cfStarted = cf.label !== '' || cf.limit !== ''

  const errors = [money, horizonWrite, addRx, delRx, addCf, delCf].find((m) => m.isError)

  return (
    <Section title="Money rules">
      <Row label="Safety buffer" hint="Cash you want to keep aside. The forecast flags the first day net position goes below it.">
        <form className="stack" style={{ gap: 4 }} onSubmit={(e) => {
          e.preventDefault()
          if (!parsedBuffer.ok || !bufferDirty) return
          money.mutate({ safety_buffer_paise: parsedBuffer.value }, { onSuccess: () => ui.toast('Buffer saved. Forecast recalculated.') })
        }}>
          <div className="row">
            <input className="input mono" style={{ width: 160 }} inputMode="decimal" value={buffer} aria-label="Safety buffer in rupees" aria-invalid={!parsedBuffer.ok}
              onChange={(e) => { setBuffer(e.target.value); if (money.isError) money.reset() }} />
            <button className="btn btn-secondary" disabled={money.isPending || !parsedBuffer.ok || !bufferDirty}>Save</button>
          </div>
          {!parsedBuffer.ok && <Hint id="buffer-hint" error={parsedBuffer.error} />}
        </form>
      </Row>

      <Row label="Forecast horizon" hint={`The engine plays your business forward ${horizon} days. Longer shows more, but later days are less certain.`}>
        <Seg label="Forecast horizon" value={horizon as (typeof HORIZONS)[number]}
          onChange={(v) => {
            if (horizonWrite.isPending || v === String(data.money.horizon_days)) return
            setWanted(v)
            horizonWrite.mutate({ horizon_days: Number(v) }, {
              onSuccess: () => { ui.setScenario(null); ui.toast(`Forecast now looks ${v} days ahead.`) },
              onSettled: () => setWanted(null),
            })
          }}
          options={HORIZONS.map((v) => ({ value: v, label: `${v}d` }))} />
        {horizonWrite.isPending && <span className="micro faint" style={{ marginLeft: 8 }}>Recalculating</span>}
      </Row>

      <Row label="Default credit days" hint="Used for new customers and suppliers until you set their own terms.">
        <form className="row-wrap" onSubmit={(e) => {
          e.preventDefault()
          if (customerDays.ok && supplierDays.ok && termsDirty) money.mutate({ default_customer_terms_days: customerDays.value, default_supplier_terms_days: supplierDays.value }, { onSuccess: () => ui.toast('Default terms saved.') })
        }}>
          <label className="field"><span className="field-label">Customers</span>
            <input className="input mono" style={{ width: 90 }} inputMode="numeric" value={terms.customer} aria-invalid={!customerDays.ok} onChange={(e) => setTerms({ ...terms, customer: e.target.value })} /></label>
          <label className="field"><span className="field-label">Suppliers</span>
            <input className="input mono" style={{ width: 90 }} inputMode="numeric" value={terms.supplier} aria-invalid={!supplierDays.ok} onChange={(e) => setTerms({ ...terms, supplier: e.target.value })} /></label>
          <button className="btn btn-secondary" disabled={money.isPending || !termsDirty}>Save</button>
          {!customerDays.ok && <Hint id="cust-days" error={customerDays.error} />}
          {customerDays.ok && !supplierDays.ok && <Hint id="sup-days" error={supplierDays.error} />}
        </form>
      </Row>

      <Row label="MSME payment alerts" hint="Warn when a customer invoice nears the 45-day payment limit.">
        <label className="check"><input type="checkbox" checked={!!data.money.msme_alerts} disabled={money.isPending} onChange={(e) => money.mutate({ msme_alerts: e.target.checked })} /> {data.money.msme_alerts ? 'On' : 'Off'}</label>
      </Row>

      <div className="label" style={{ marginTop: 16 }}>Recurring expenses</div>
      {data.recurring.length === 0 && <p className="small muted">None yet. Rent, wages and electricity belong here so the forecast counts them.</p>}
      <table className="table dense">
        <tbody>
          {data.recurring.map((r: any) => (
            <tr key={r.id}><td>{r.label}</td><td className="small muted">{r.day_of_month > 28 ? `day ${r.day_of_month}, or the last day of shorter months` : `day ${r.day_of_month} of each month`}</td><td className="money">{rupees(r.amount_paise)}</td>
              <td className="right"><ConfirmButton label="Remove" confirmLabel="Remove?" disabled={delRx.isPending} onConfirm={() => delRx.mutate(r.id)} /></td></tr>
          ))}
        </tbody>
      </table>
      <form className="row-wrap" style={{ marginTop: 8 }} onSubmit={(e) => {
        e.preventDefault()
        if (!rxAmount.ok || !rxDay.ok || rxLabel) return
        addRx.mutate({ label: rx.label.trim(), amount_paise: rxAmount.value, day_of_month: rxDay.value }, { onSuccess: () => { setRx({ label: '', amount: '', day: '15' }); ui.toast('Expense added.') } })
      }}>
        <input className="input" style={{ width: 180 }} placeholder="Name" value={rx.label} maxLength={80} aria-label="Expense name" onChange={(e) => setRx({ ...rx, label: e.target.value })} />
        <input className="input mono" style={{ width: 130 }} placeholder="₹ amount" inputMode="decimal" value={rx.amount} aria-label="Expense amount in rupees" onChange={(e) => setRx({ ...rx, amount: e.target.value })} />
        <input className="input mono" style={{ width: 80 }} inputMode="numeric" value={rx.day} aria-label="Day of month" onChange={(e) => setRx({ ...rx, day: e.target.value })} />
        <button className="btn btn-secondary" disabled={addRx.isPending || !!rxLabel || !rxAmount.ok || !rxDay.ok}>Add</button>
        {rxStarted && <Hint id="rx-hint" error={rxLabel ?? (!rxAmount.ok ? rxAmount.error : !rxDay.ok ? rxDay.error : null)} />}
      </form>

      <div className="label" style={{ marginTop: 16 }}>Approved credit facilities</div>
      {data.facilities.length === 0 && <p className="small muted">None. Add an approved overdraft or loan to try "Borrow to bridge" in the engine.</p>}
      <table className="table dense">
        <tbody>
          {data.facilities.map((f: any) => (
            <tr key={f.id}><td>{f.label}</td><td className="small muted">{(f.annual_rate_bps / 100).toFixed(2)}% a year · fee {rupees(f.drawdown_fee_paise)} · {shortDate(f.available_from)} to {shortDate(f.repayment_date)}</td>
              <td className="money">{rupees(f.approved_limit_paise)}</td><td className="right"><ConfirmButton label="Remove" confirmLabel="Remove?" disabled={delCf.isPending} onConfirm={() => delCf.mutate(f.id)} /></td></tr>
          ))}
        </tbody>
      </table>
      <form className="row-wrap" style={{ marginTop: 8 }} onSubmit={(e) => {
        e.preventDefault()
        if (cfLabel || !cfLimit.ok || !cfRate.ok || !cfFee.ok || cfDates) return
        addCf.mutate({ label: cf.label.trim(), approved_limit_paise: cfLimit.value, annual_rate_bps: cfRate.value, drawdown_fee_paise: cfFee.value, available_from: cf.from, repayment_date: cf.repay },
          { onSuccess: () => { setCf({ label: '', limit: '', rate: '', fee: '0', from: '', repay: '' }); ui.toast('Facility added.') } })
      }}>
        <input className="input" style={{ width: 160 }} placeholder="Name" value={cf.label} maxLength={80} aria-label="Facility name" onChange={(e) => setCf({ ...cf, label: e.target.value })} />
        <input className="input mono" style={{ width: 120 }} placeholder="₹ limit" inputMode="decimal" value={cf.limit} aria-label="Limit in rupees" onChange={(e) => setCf({ ...cf, limit: e.target.value })} />
        <input className="input mono" style={{ width: 90 }} placeholder="% a year" inputMode="decimal" value={cf.rate} aria-label="Interest rate, percent a year" onChange={(e) => setCf({ ...cf, rate: e.target.value })} />
        <input className="input mono" style={{ width: 100 }} placeholder="₹ fee" inputMode="decimal" value={cf.fee} aria-label="Drawdown fee in rupees" onChange={(e) => setCf({ ...cf, fee: e.target.value })} />
        <input className="input mono" style={{ width: 140 }} type="date" value={cf.from} aria-label="Available from" onChange={(e) => setCf({ ...cf, from: e.target.value })} />
        <input className="input mono" style={{ width: 140 }} type="date" value={cf.repay} min={cf.from || undefined} aria-label="Repay by" onChange={(e) => setCf({ ...cf, repay: e.target.value })} />
        <button className="btn btn-secondary" disabled={addCf.isPending || !!cfLabel || !cfLimit.ok || !cfRate.ok || !cfFee.ok || !!cfDates}>Add</button>
        {cfStarted && <Hint id="cf-hint" error={cfLabel ?? (!cfLimit.ok ? cfLimit.error : !cfRate.ok ? cfRate.error : !cfFee.ok ? cfFee.error : cfDates)} />}
      </form>
      {errors && <div style={{ marginTop: 8 }}><ErrorNote text={errorText(errors.error)} /></div>}
    </Section>
  )
}

// ---------------------------------------------------------------- team

function Team({ team, me }: { team: any[]; me: Me }) {
  const ui = useUI()
  const [form, setForm] = useState({ email: '', name: '', role: 'ACCOUNTANT' })
  const [created, setCreated] = useState<any>(null)
  const invite = useWrite((body: unknown) => api.post('/team', body))
  const remove = useWrite((id: string) => api.del(`/team/${encodeURIComponent(id)}`))
  const emailError = form.email ? checkEmail(form.email) : null
  const nameError = form.name ? checkName(form.name, 'Name') : null
  const ready = !!form.name.trim() && !!form.email.trim() && !checkEmail(form.email) && !checkName(form.name, 'Name')
  return (
    <Section title="Team and access">
      <p className="small muted">Owner sees everything. Accountant sees everything except this team list. Supervisor sees orders and stock only; the server removes every amount before it reaches their screen.</p>
      <table className="table dense">
        <tbody>
          {team.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td className="mono small">{u.email}</td><td className="small">{u.role.toLowerCase()}</td>
              <td className="right">{u.id !== me.user.id && <ConfirmButton label="Remove" confirmLabel={`Remove ${u.name.split(' ')[0]}?`} disabled={remove.isPending} onConfirm={() => remove.mutate(u.id, { onSuccess: () => ui.toast(`${u.name} removed.`) })} />}</td></tr>
          ))}
        </tbody>
      </table>
      <form className="row-wrap" style={{ marginTop: 8 }} onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        invite.mutate({ ...form, email: form.email.trim().toLowerCase(), name: form.name.trim() }, { onSuccess: (r) => { setCreated(r); setForm({ email: '', name: '', role: 'ACCOUNTANT' }) } })
      }}>
        <input className="input" style={{ width: 160 }} placeholder="Name" value={form.name} maxLength={120} aria-label="Name" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" style={{ width: 220 }} placeholder="Email" type="email" value={form.email} aria-label="Email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className="select" style={{ width: 150 }} value={form.role} aria-label="Role" onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="ACCOUNTANT">Accountant</option><option value="SUPERVISOR">Supervisor</option><option value="OWNER">Owner</option>
        </select>
        <button className="btn btn-secondary" disabled={!ready || invite.isPending}>Invite</button>
        <Hint id="invite-hint" error={emailError ?? nameError} warning={form.role === 'OWNER' ? 'An owner can change everything, including this team list.' : null} />
      </form>
      {created && (
        <div className="notice attn row-wrap" style={{ marginTop: 8 }}>
          <span>Temporary password for <span className="mono">{created.email}</span>: <span className="mono">{created.temporary_password}</span>. Shown once; share it privately.</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(created.temporary_password); ui.toast('Password copied.') } catch { ui.toast('Copy failed. Select the password instead.') }
          }}>Copy</button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setCreated(null)}>Done</button>
        </div>
      )}
      {invite.isError && <ErrorNote text={errorText(invite.error)} />}
      {remove.isError && <ErrorNote text={errorText(remove.error)} />}
    </Section>
  )
}

// ---------------------------------------------------------------- data

function DataSection({ me }: { me: Me }) {
  const [confirm, setConfirm] = useState('')
  const ui = useUI()
  const owner = me.user.role === 'OWNER'
  const reset = useWrite((body: unknown) => api.post('/data/reset', body))
  const demo = useWrite(() => api.post('/data/load-demo'))
  return (
    <Section title="Data">
      <div className="row-wrap">
        <DatasheetButton target={{ kind: 'company', name: me.business.name }} label="Company datasheet (CSV)" className="btn btn-primary" />
        <a className="btn btn-secondary" href="/api/export" download="ripple-export.json">Export all data (JSON)</a>
        <a className="btn btn-secondary" href="/api/export/transactions.csv">Export transactions (CSV)</a>
        {owner && <Link className="btn btn-secondary" to="/setup">Set up from a description</Link>}
        {owner && <ConfirmButton className="btn btn-secondary" label="Load demo data" confirmLabel="Replace everything with demo data?" disabled={demo.isPending}
          onConfirm={() => demo.mutate(undefined, { onSuccess: () => { ui.setScenario(null); ui.toast('Demo data restored.') } })} />}
      </div>
      <p className="micro faint" style={{ marginTop: 8 }}>The company datasheet is one neat CSV for the whole business. A single customer's or supplier's datasheet is on their page in Khata.</p>
      {demo.isError && <ErrorNote text={errorText(demo.error)} />}
      {owner && (
        <div style={{ marginTop: 16 }}>
          <div className="field-label">Reset business: deletes every party, order, payment and stock record. Type <strong>{me.business.name}</strong> to confirm.</div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input" style={{ maxWidth: 280 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the business name to confirm" />
            <button className="btn btn-danger" disabled={confirm.trim() !== me.business.name || reset.isPending}
              onClick={() => reset.mutate({ confirm: confirm.trim() }, { onSuccess: () => { setConfirm(''); ui.setScenario(null); ui.toast('Business reset.') } })}>Reset business</button>
          </div>
          {reset.isError && <ErrorNote text={errorText(reset.error)} />}
        </div>
      )}
    </Section>
  )
}

function Sessions() {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { api.get<{ sessions: any[] }>('/sessions').then((r) => setRows(r.sessions)).catch(() => setRows([])) }, [])
  if (!rows.length) return null
  return (
    <table className="table dense">
      <tbody>{rows.map((s, i) => <tr key={i}><td className="small truncate" style={{ maxWidth: 420 }}>{s.user_agent || 'Unknown device'}</td><td className="mono small">{String(s.created_at).slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody>
    </table>
  )
}
