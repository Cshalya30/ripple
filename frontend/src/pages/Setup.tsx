import { MicrophoneIcon, StopIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '../components/Glyph'
import { LanguageSelect } from '../components/VoiceSettings'
import { ErrorNote, Section } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useMe } from '../lib/queries'
import { useSpeechInput } from '../lib/useVoice'
import { voiceLanguage, type VoiceLang } from '../lib/voice'

interface Draft {
  draft_id: string
  draft_version: number
  status: 'READY_FOR_REVIEW' | 'NEEDS_INPUT'
  extracted_facts: any
  evidence: { fact_reference: string; field_path: string; source_excerpt: string; status: string }[]
  unresolved_questions: string[]
  validation_issues: string[]
  source_text: string
}

const PLACEHOLDER: Partial<Record<VoiceLang, string>> = {
  en: 'Tell Ripple about your business. Opening cash, who you buy from, who buys from you, what is owed, when.',
  ta: 'உங்கள் தொழிலைப் பற்றிச் சொல்லுங்கள். கையிருப்பு, யாரிடம் வாங்குகிறீர்கள், யார் வாங்குகிறார்கள், யார் யாருக்கு எவ்வளவு, எப்போது.',
  hi: 'अपने कारोबार के बारे में बताइए। हाथ में नकद, किससे खरीदते हैं, कौन खरीदता है, किसका कितना बाकी है, कब तक।',
}

export default function Setup() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [lang, setLang] = useState<VoiceLang>('en')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [hot, setHot] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const dictation = useSpeechInput({ lang, continuous: true, maxMs: 180_000, onFinal: (heard) => setText((t) => `${t} ${heard}`.trim().slice(0, 8000)) })

  if (me.isError) return <div className="page"><ErrorNote text="Sign in first." /> <Link to="/login">Sign in</Link></div>
  const owner = me.data?.user.role === 'OWNER'

  const submit = async (sourceText: string) => {
    setBusy('draft'); setError(null)
    try {
      const d = await api.post<Draft>('/setup/draft', { source_text: sourceText.slice(0, 8000) })
      setDraft(d); setAnswers({})
    } catch (err) { setError(err) } finally { setBusy(null) }
  }

  const answerAll = () => {
    const lines = draft!.unresolved_questions.filter((q) => answers[q]?.trim()).map((q) => `${q} ${answers[q].trim()}`)
    const next = `${draft!.source_text}\n\n${lines.join('\n')}`
    setText(next)
    void submit(next)
  }

  const approve = async () => {
    setBusy('approve'); setError(null)
    try {
      await api.post('/setup/approve', { draft_id: draft!.draft_id, draft_version: draft!.draft_version, approval: 'APPROVE' })
      qc.clear()
      navigate('/app/today')
    } catch (err) { setError(err) } finally { setBusy(null) }
  }

  const loadDemo = async () => {
    setBusy('demo')
    try {
      await api.post('/data/load-demo')
      qc.clear()
      navigate('/app/today')
    } catch (err) { setError(err) } finally { setBusy(null) }
  }

  return (
    <div className="density-simple" style={{ minHeight: '100%' }}>
      <div className="page" style={{ maxWidth: 1200 }}>
        <div className="row" style={{ marginBottom: 20 }}><Logo /><span className="spacer" /><Link className="btn btn-quiet" to="/app/today">Back to the app</Link></div>
        <h1 className="h1">Set up your khata</h1>
        <p className="muted">Describe → review → approve. Nothing is saved until you approve. Approving replaces this business's records.</p>
        {!owner && me.data && <ErrorNote text="Only the owner can set up the business." />}

        {!draft && (
          <Section title="1 Describe">
            <div className="row" style={{ marginBottom: 8 }}>
              <LanguageSelect label="Language you will speak or type in" value={lang} onChange={setLang} />
              <button className="btn btn-secondary" disabled={!dictation.supported} aria-pressed={dictation.listening} onClick={dictation.toggle}
                title={dictation.supported ? undefined : 'Voice input works in Chrome, Edge and Safari'}>
                {dictation.listening ? <><StopIcon size={16} /> Stop</> : <><MicrophoneIcon size={16} /> Speak in {voiceLanguage(lang).name}</>}
              </button>
            </div>
            {dictation.error && <div style={{ marginBottom: 8 }}><ErrorNote text={dictation.error} /></div>}
            {(dictation.listening || dictation.interim) && <p className="small" style={{ color: 'var(--haldi)', margin: '0 0 6px' }} aria-live="polite" lang={lang}><span className="mic-dot" aria-hidden="true" /> {dictation.interim || `Listening in ${voiceLanguage(lang).name}. Keep talking; press Stop when done.`}</p>}
            <textarea className="textarea" rows={10} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER[lang] ?? PLACEHOLDER.en} lang={lang} />
            <div className="row" style={{ marginTop: 6 }}><span className="micro faint">{text.length} / 8,000</span></div>
            {error !== null && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(error)} /></div>}
            <div className="row-wrap" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" disabled={!owner || !text.trim() || busy !== null} onClick={() => submit(text)}>{busy === 'draft' ? 'Reading your description' : 'Read my description'}</button>
              <span className="faint">or</span>
              <button className="btn btn-secondary" disabled={!owner || busy !== null} onClick={loadDemo}>Load the demo business</button>
            </div>
          </Section>
        )}

        {draft && (
          <>
            <Section title="2 Review" aside={<button className="btn btn-quiet" onClick={() => setDraft(null)}>Edit description</button>}>
              <div className="setup-panes">
                <div>
                  <div className="label">What you said</div>
                  <SourceText text={draft.source_text} evidence={draft.evidence} hot={hot} setHot={setHot} />
                </div>
                <div>
                  <div className="label">What Ripple understood</div>
                  <Facts facts={draft.extracted_facts} evidence={draft.evidence} hot={hot} setHot={setHot} />
                </div>
              </div>
            </Section>
            {(draft.unresolved_questions.length > 0 || draft.validation_issues.length > 0) && (
              <Section title={`Questions (${draft.unresolved_questions.length + draft.validation_issues.length})`}>
                {draft.unresolved_questions.map((q) => (
                  <div className="list-row" key={q} style={{ flexWrap: 'wrap' }}>
                    <span className="grow" style={{ minWidth: 260 }}>? {q}</span>
                    <input className="input" style={{ maxWidth: 360 }} value={answers[q] ?? ''} maxLength={300} onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })} aria-label={q} />
                  </div>
                ))}
                {draft.validation_issues.map((issue) => <p key={issue} className="small" style={{ color: 'var(--out)' }}>{issue}</p>)}
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn btn-secondary" disabled={busy !== null || !Object.values(answers).some((a) => a.trim())} onClick={answerAll}>{busy === 'draft' ? 'Updating' : 'Add my answers and re-read'}</button>
                </div>
              </Section>
            )}
            <Section title="3 Approve">
              <Counts facts={draft.extracted_facts} />
              {error !== null && <div style={{ marginTop: 12 }}><ErrorNote text={errorText(error)} /></div>}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" disabled={draft.status !== 'READY_FOR_REVIEW' || busy !== null} onClick={approve}>
                  {busy === 'approve' ? 'Building your forecast' : 'Approve and build my forecast'}
                </button>
                {draft.status !== 'READY_FOR_REVIEW' && <span className="small muted">Answer every question first.</span>}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function SourceText({ text, evidence, hot, setHot }: { text: string; evidence: Draft['evidence']; hot: string | null; setHot: (v: string | null) => void }) {
  const spans: { start: number; end: number; ref: string }[] = []
  for (const e of evidence) {
    const start = text.indexOf(e.source_excerpt)
    if (start >= 0 && e.source_excerpt) spans.push({ start, end: start + e.source_excerpt.length, ref: e.field_path })
  }
  spans.sort((a, b) => a.start - b.start)
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const s of spans) {
    if (s.start < cursor) continue
    parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, s.start)}</Fragment>)
    parts.push(<mark key={`m${s.start}`} className={`quote${hot && s.ref.startsWith(hot) ? ' hot' : ''}`} style={{ color: 'inherit' }}
      onMouseEnter={() => setHot(s.ref.split('.')[0])} onMouseLeave={() => setHot(null)}>{text.slice(s.start, s.end)}</mark>)
    cursor = s.end
  }
  parts.push(<Fragment key="end">{text.slice(cursor)}</Fragment>)
  return <div className="notice" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', marginTop: 6 }}>{parts}</div>
}

function Facts({ facts, evidence, hot, setHot }: { facts: any; evidence: Draft['evidence']; hot: string | null; setHot: (v: string | null) => void }) {
  const has = (path: string) => evidence.some((e) => e.field_path.startsWith(path))
  const edited = (path: string) => evidence.some((e) => e.field_path.startsWith(path) && e.status === 'USER_CONFIRMED')
  const row = (path: string, label: React.ReactNode, value: React.ReactNode) => (
    <div key={path} className={`list-row quote${hot && path.startsWith(hot) ? ' hot' : ''}`} onMouseEnter={() => setHot(path.split('.')[0])} onMouseLeave={() => setHot(null)}>
      <span className="grow">{label}</span><span className="mono small">{value}</span>
      <span className="micro faint" style={{ width: 70, textAlign: 'right' }}>{edited(path) ? 'edited by you' : has(path) ? 'quoted' : 'no quote'}</span>
    </div>
  )
  const money = (m: any) => (m ? `₹${m.amount}` : '?')
  return (
    <div style={{ marginTop: 6 }}>
      {row('opening_cash', 'Opening cash', money(facts.opening_cash))}
      {facts.existing_receivables?.length > 0 && <div className="label" style={{ marginTop: 10 }}>Customer receipts</div>}
      {facts.existing_receivables?.map((r: any, i: number) => row(`existing_receivables[${i}]`, r.customer ?? 'Customer', `${money(r.amount)} · ${r.expected_collection_date ?? '?'}`))}
      {facts.supplier_purchases?.length > 0 && <div className="label" style={{ marginTop: 10 }}>Supplier payments</div>}
      {facts.supplier_purchases?.map((p: any, i: number) => row(`supplier_purchases[${i}]`, p.supplier ?? 'Supplier', `${p.already_paid ? 'paid' : money(p.outstanding_payment)} · ${p.contractual_due_date ?? p.earliest_payment_date ?? '?'}`))}
      {facts.customer_orders?.length > 0 && <div className="label" style={{ marginTop: 10 }}>Customer orders</div>}
      {facts.customer_orders?.map((o: any, i: number) => row(`customer_orders[${i}]`, `${o.order_reference ?? 'Order'} · ${o.customer ?? '?'}`, `${money(o.outstanding_collection)} · deliver ${o.promised_delivery_date ?? '?'}`))}
      {facts.expenses?.length > 0 && <div className="label" style={{ marginTop: 10 }}>Expenses</div>}
      {facts.expenses?.map((x: any, i: number) => row(`expenses[${i}]`, x.description ?? 'Expense', `${money(x.amount)} · ${x.due_date ?? '?'}`))}
      {facts.opening_inventory?.length > 0 && <div className="label" style={{ marginTop: 10 }}>Stock</div>}
      {facts.opening_inventory?.map((m: any, i: number) => row(`opening_inventory[${i}]`, m.material_name ?? m.material_reference, `${m.quantity ?? '?'} ${m.unit ?? ''}`))}
    </div>
  )
}

function Counts({ facts }: { facts: any }) {
  const parties = new Set([...(facts.existing_receivables ?? []).map((r: any) => r.customer), ...(facts.customer_orders ?? []).map((o: any) => o.customer), ...(facts.supplier_purchases ?? []).map((p: any) => p.supplier)].filter(Boolean))
  return (
    <p className="muted">
      {parties.size} parties · {(facts.customer_orders ?? []).length} orders · {(facts.existing_receivables ?? []).length + (facts.supplier_purchases ?? []).length + (facts.expenses ?? []).length} money events ·
      opening cash {facts.opening_cash ? `₹${facts.opening_cash.amount}` : 'not given'}
    </p>
  )
}
