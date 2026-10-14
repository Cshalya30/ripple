import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ErrorNote, Section, Seg } from '../components/ui'
import { api, errorText } from '../lib/api'
import { rupees, shortDate } from '../lib/format'
import { useSettings, useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Me, Prefs } from '../lib/types'

export default function Settings({ me }: { me: Me }) {
  const finance = me.user.role !== 'SUPERVISOR'
  const owner = me.user.role === 'OWNER'
  const settings = useSettings(finance)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const setPref = async (patch: Partial<Prefs>) => qc.setQueryData(['me'], await api.put<Me>('/me/prefs', patch))
  const logout = async (everywhere = false) => {
    await api.post(everywhere ? '/auth/logout-all' : '/auth/logout')
    qc.clear()
    navigate('/login')
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-head"><h1 className="h1">Settings</h1></div>

      {finance && settings.data && <BusinessProfile data={settings.data.business} editable={owner} />}
      {finance && settings.data && <MoneyRules data={settings.data} />}
      {owner && settings.data && <Team team={settings.data.team} me={me} />}

      <Section title="Display">
        <Row label="Theme" hint="Lamp is warm and lower contrast, for long evenings.">
          <Seg label="Theme" value={me.prefs.theme} onChange={(theme) => setPref({ theme })} options={[{ value: 'night', label: 'Night' }, { value: 'day', label: 'Day' }, { value: 'lamp', label: 'Lamp' }]} />
        </Row>
        <Row label="Text size">
          <Seg label="Text size" value={me.prefs.text_size} onChange={(text_size) => setPref({ text_size })} options={(['S', 'M', 'L', 'XL'] as const).map((v) => ({ value: v, label: v }))} />
        </Row>
        <Row label="Number format" hint={`Indian ${'₹1,45,000'} or international ₹145,000`}>
          <Seg label="Number format" value={me.prefs.number_format} onChange={(number_format) => setPref({ number_format })} options={[{ value: 'indian', label: '1,45,000' }, { value: 'international', label: '145,000' }]} />
        </Row>
      </Section>

      <Section title="Language">
        {([['language_ui', 'App language'], ['language_assistant', "Munim's language"], ['language_messages', 'Message drafts']] as const).map(([key, label]) => (
          <Row key={key} label={label}>
            <Seg label={label} value={me.prefs[key]} onChange={(v) => setPref({ [key]: v } as Partial<Prefs>)} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }, { value: 'hi', label: 'हिन्दी' }]} />
          </Row>
        ))}
        <p className="micro faint">Tamil and Hindi screens and templates are awaiting review by a fluent speaker. Untranslated text shows in English.</p>
      </Section>

      <Section title="Accessibility">
        {([['reduce_motion', 'Reduce motion', 'Scenario changes apply instantly with an outline instead of the ripple.'],
          ['high_contrast', 'High contrast', 'Secondary text at full strength.'],
          ['read_aloud', "Read Munim's replies aloud", 'Uses your browser voice.'],
          ['large_targets', 'Larger touch targets', '44px rows and buttons everywhere.']] as const).map(([key, label, hint]) => (
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

function BusinessProfile({ data, editable }: { data: any; editable: boolean }) {
  const [form, setForm] = useState(data)
  useEffect(() => setForm(data), [data])
  const write = useWrite((body: unknown) => api.put('/settings/business', body))
  const field = (key: string, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span className="field-label">{label}</span>
      <input className="input" disabled={!editable} value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  )
  return (
    <Section title="Business profile">
      <div className="form-grid">
        {field('name', 'Business name', { maxLength: 120 })}
        {field('owner_name', 'Owner name', { maxLength: 120 })}
        {field('gstin', 'GSTIN', { maxLength: 15, className: 'input mono' })}
        {field('udyam_number', 'Udyam number', { maxLength: 30, className: 'input mono' })}
        <label className="field"><span className="field-label">MSME category</span>
          <select className="select" disabled={!editable} value={form.msme_category ?? ''} onChange={(e) => setForm({ ...form, msme_category: e.target.value || null })}>
            <option value="">Not registered</option><option value="MICRO">Micro</option><option value="SMALL">Small</option><option value="MEDIUM">Medium</option>
          </select>
        </label>
        <label className="field"><span className="field-label">Business type</span><input className="input" disabled value="Manufacturer (v1 supports this shape only)" /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span className="field-label">Address</span>
          <input className="input" disabled={!editable} maxLength={300} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
      </div>
      {editable && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" disabled={write.isPending} onClick={() => write.mutate({
            name: form.name, owner_name: form.owner_name, address: form.address, gstin: form.gstin || null, udyam_number: form.udyam_number || null, msme_category: form.msme_category || null,
          })}>Save profile</button>
          {write.isSuccess && <span className="small muted">Saved.</span>}
        </div>
      )}
      {write.isError && <ErrorNote text={errorText(write.error)} />}
    </Section>
  )
}

function MoneyRules({ data }: { data: any }) {
  const ui = useUI()
  const [buffer, setBuffer] = useState(String(data.money.safety_buffer_paise / 100))
  const [horizon, setHorizon] = useState(String(data.money.horizon_days))
  const [rx, setRx] = useState({ label: '', amount: '', day: '15' })
  const [cf, setCf] = useState({ label: '', limit: '', rate: '', fee: '0', from: '', repay: '' })
  const money = useWrite((body: unknown) => api.put('/settings/money', body))
  const addRx = useWrite((body: unknown) => api.post('/settings/recurring', body))
  const delRx = useWrite((id: string) => api.del(`/settings/recurring/${encodeURIComponent(id)}`))
  const addCf = useWrite((body: unknown) => api.post('/settings/facilities', body))
  const delCf = useWrite((id: string) => api.del(`/settings/facilities/${encodeURIComponent(id)}`))
  const errors = [money, addRx, delRx, addCf, delCf].find((m) => m.isError)

  return (
    <Section title="Money rules">
      <Row label="Safety buffer" hint="Cash you want to keep aside. The forecast flags the first day net position goes below it.">
        <div className="row">
          <input className="input mono" style={{ width: 140 }} inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} aria-label="Safety buffer in rupees" />
          <button className="btn btn-secondary" onClick={() => money.mutate({ safety_buffer_paise: Math.round(Number(buffer) * 100) }, { onSuccess: () => ui.toast('Buffer saved. Forecast recalculated.') })}>Save</button>
        </div>
      </Row>
      <Row label="Forecast horizon">
        <Seg label="Horizon" value={horizon as '30' | '60' | '90' | '120' | '180'} onChange={(v) => { setHorizon(v); money.mutate({ horizon_days: Number(v) }) }}
          options={(['30', '60', '90', '120', '180'] as const).map((v) => ({ value: v, label: `${v}d` }))} />
      </Row>
      <div className="label" style={{ marginTop: 16 }}>Recurring expenses</div>
      <table className="table dense">
        <tbody>
          {data.recurring.map((r: any) => (
            <tr key={r.id}><td>{r.label}</td><td className="small muted">day {r.day_of_month} of each month</td><td className="money">{rupees(r.amount_paise)}</td>
              <td className="right"><button className="btn btn-sm btn-quiet" onClick={() => delRx.mutate(r.id)}>Remove</button></td></tr>
          ))}
        </tbody>
      </table>
      <div className="row-wrap" style={{ marginTop: 8 }}>
        <input className="input" style={{ width: 180 }} placeholder="Label" value={rx.label} maxLength={80} onChange={(e) => setRx({ ...rx, label: e.target.value })} />
        <input className="input mono" style={{ width: 120 }} placeholder="₹ amount" inputMode="decimal" value={rx.amount} onChange={(e) => setRx({ ...rx, amount: e.target.value })} />
        <input className="input mono" style={{ width: 80 }} type="number" min={1} max={31} value={rx.day} onChange={(e) => setRx({ ...rx, day: e.target.value })} aria-label="Day of month" />
        <button className="btn btn-secondary" disabled={!rx.label || !(Number(rx.amount) > 0)}
          onClick={() => addRx.mutate({ label: rx.label, amount_paise: Math.round(Number(rx.amount) * 100), day_of_month: Number(rx.day) }, { onSuccess: () => setRx({ label: '', amount: '', day: '15' }) })}>Add</button>
      </div>
      <div className="label" style={{ marginTop: 16 }}>Approved credit facilities</div>
      <table className="table dense">
        <tbody>
          {data.facilities.map((f: any) => (
            <tr key={f.id}><td>{f.label}</td><td className="small muted">{(f.annual_rate_bps / 100).toFixed(2)}% a year · fee {rupees(f.drawdown_fee_paise)} · {shortDate(f.available_from)} to {shortDate(f.repayment_date)}</td>
              <td className="money">{rupees(f.approved_limit_paise)}</td><td className="right"><button className="btn btn-sm btn-quiet" onClick={() => delCf.mutate(f.id)}>Remove</button></td></tr>
          ))}
        </tbody>
      </table>
      <div className="row-wrap" style={{ marginTop: 8 }}>
        <input className="input" style={{ width: 160 }} placeholder="Label" value={cf.label} maxLength={80} onChange={(e) => setCf({ ...cf, label: e.target.value })} />
        <input className="input mono" style={{ width: 110 }} placeholder="₹ limit" value={cf.limit} onChange={(e) => setCf({ ...cf, limit: e.target.value })} />
        <input className="input mono" style={{ width: 90 }} placeholder="% rate" value={cf.rate} onChange={(e) => setCf({ ...cf, rate: e.target.value })} />
        <input className="input mono" style={{ width: 90 }} placeholder="₹ fee" value={cf.fee} onChange={(e) => setCf({ ...cf, fee: e.target.value })} />
        <input className="input mono" style={{ width: 140 }} type="date" value={cf.from} onChange={(e) => setCf({ ...cf, from: e.target.value })} aria-label="Available from" />
        <input className="input mono" style={{ width: 140 }} type="date" value={cf.repay} onChange={(e) => setCf({ ...cf, repay: e.target.value })} aria-label="Repay by" />
        <button className="btn btn-secondary" disabled={!cf.label || !(Number(cf.limit) > 0) || !cf.from || !cf.repay}
          onClick={() => addCf.mutate({ label: cf.label, approved_limit_paise: Math.round(Number(cf.limit) * 100), annual_rate_bps: Math.round(Number(cf.rate || 0) * 100),
            drawdown_fee_paise: Math.round(Number(cf.fee || 0) * 100), available_from: cf.from, repayment_date: cf.repay })}>Add</button>
      </div>
      {errors && <div style={{ marginTop: 8 }}><ErrorNote text={errorText(errors.error)} /></div>}
    </Section>
  )
}

function Team({ team, me }: { team: any[]; me: Me }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'ACCOUNTANT' })
  const [created, setCreated] = useState<any>(null)
  const invite = useWrite((body: unknown) => api.post('/team', body))
  const remove = useWrite((id: string) => api.del(`/team/${encodeURIComponent(id)}`))
  return (
    <Section title="Team and access">
      <p className="small muted">Owner sees everything. Accountant sees everything except this team list. Supervisor sees orders and stock only; the server removes every amount before it reaches their screen.</p>
      <table className="table dense">
        <tbody>
          {team.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td className="mono small">{u.email}</td><td className="small">{u.role.toLowerCase()}</td>
              <td className="right">{u.id !== me.user.id && <button className="btn btn-sm btn-quiet" onClick={() => remove.mutate(u.id)}>Remove</button>}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="row-wrap" style={{ marginTop: 8 }}>
        <input className="input" style={{ width: 160 }} placeholder="Name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" style={{ width: 220 }} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className="select" style={{ width: 150 }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="ACCOUNTANT">Accountant</option><option value="SUPERVISOR">Supervisor</option><option value="OWNER">Owner</option>
        </select>
        <button className="btn btn-secondary" disabled={!form.name || !form.email} onClick={() => invite.mutate(form, { onSuccess: (r) => { setCreated(r); setForm({ email: '', name: '', role: 'ACCOUNTANT' }) } })}>Invite</button>
      </div>
      {created && <div className="notice attn" style={{ marginTop: 8 }}>Temporary password for <span className="mono">{created.email}</span>: <span className="mono">{created.temporary_password}</span>. Shown once; share it privately.</div>}
      {invite.isError && <ErrorNote text={errorText(invite.error)} />}
    </Section>
  )
}

function DataSection({ me }: { me: Me }) {
  const [confirm, setConfirm] = useState('')
  const ui = useUI()
  const owner = me.user.role === 'OWNER'
  const reset = useWrite((body: unknown) => api.post('/data/reset', body))
  const demo = useWrite(() => api.post('/data/load-demo'))
  return (
    <Section title="Data">
      <div className="row-wrap">
        <a className="btn btn-secondary" href="/api/export" download="ripple-export.json">Export all data (JSON)</a>
        <a className="btn btn-secondary" href="/api/export/transactions.csv">Export transactions (CSV)</a>
        {owner && <Link className="btn btn-secondary" to="/setup">Set up from a description</Link>}
        {owner && <button className="btn btn-secondary" disabled={demo.isPending} onClick={() => demo.mutate(undefined, { onSuccess: () => ui.toast('Demo data restored.') })}>Load demo data</button>}
      </div>
      {owner && (
        <div style={{ marginTop: 16 }}>
          <div className="field-label">Reset business: deletes every party, order, payment and stock record. Type <strong>{me.business.name}</strong> to confirm.</div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input" style={{ maxWidth: 280 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the business name to confirm" />
            <button className="btn btn-danger" disabled={confirm !== me.business.name || reset.isPending}
              onClick={() => reset.mutate({ confirm }, { onSuccess: () => { setConfirm(''); ui.toast('Business reset.') } })}>Reset business</button>
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
      <tbody>{rows.map((s, i) => <tr key={i}><td className="small truncate" style={{ maxWidth: 420 }}>{s.user_agent || 'Unknown device'}</td><td className="mono small">{s.created_at.slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody>
    </table>
  )
}
