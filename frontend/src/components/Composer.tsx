import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { useMe } from '../lib/queries'
import { useUI } from '../lib/store'
import type { Lang } from '../lib/types'
import { Dialog, ErrorNote, Seg, Skeleton } from './ui'

const INTENT_TITLE: Record<string, string> = {
  reminder: 'Payment reminder',
  early_discount: 'Early-payment offer',
  extension: 'Ask for more time',
  instalment: 'Propose two instalments',
  deposit: 'Ask for a deposit',
}

export function Composer() {
  const composer = useUI((s) => s.composer)
  const close = useUI((s) => s.openComposer)
  const toast = useUI((s) => s.toast)
  const me = useMe().data
  const [tone, setTone] = useState<'polite' | 'firm'>('polite')
  const [lang, setLang] = useState<Lang>(me?.prefs.language_messages ?? 'en')
  const [msme, setMsme] = useState(false)

  useEffect(() => {
    if (composer) {
      setTone(composer.tone ?? 'polite')
      setLang(me?.prefs.language_messages ?? 'en')
      setMsme(false)
    }
  }, [composer, me?.prefs.language_messages])

  const draft = useQuery({
    queryKey: ['draft', composer, tone, lang, msme],
    enabled: !!composer,
    queryFn: () => api.post<{ text: string; wa_link: string | null; party_name: string; phone: string | null; msme_line_available: boolean; template: string }>('/messages/draft', {
      intent: composer!.intent, party_id: composer!.partyId, invoice_id: composer!.invoiceId, fix_id: composer!.fixId,
      tone, language: lang, include_msme: msme,
    }),
  })

  if (!composer) return null
  const data = draft.data
  return (
    <Dialog open onClose={() => close(null)} title={`${INTENT_TITLE[composer.intent]}${data ? ` · ${data.party_name}` : ''}`}
      description="Drafted from a fixed template with amounts from your books. Ripple never sends anything; you send it from WhatsApp.">
      <div className="row-wrap" style={{ marginBottom: 12, gap: 12 }}>
        <Seg label="Tone" value={tone} onChange={setTone} options={[{ value: 'polite', label: 'Polite' }, { value: 'firm', label: 'Firm' }]} />
        <Seg label="Language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }, { value: 'hi', label: 'हिन्दी' }]} />
      </div>
      {data?.msme_line_available && (
        <label className="check small" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={msme} onChange={(e) => setMsme(e.target.checked)} />
          Add the MSMED Act Section 15 line (45-day payment limit)
        </label>
      )}
      {draft.isError && <ErrorNote text={errorText(draft.error)} />}
      {draft.isLoading && <Skeleton h={120} />}
      {data && (
        <div className="notice" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 'var(--t-body)', lineHeight: 'var(--lh-body)' }} lang={lang}>
          {data.text}
        </div>
      )}
      {data && <div className="micro faint" style={{ marginTop: 6 }}>Template {data.template}{lang !== 'en' ? ' · translation awaiting fluent review' : ''}</div>}
      <div className="dialog-actions">
        <button className="btn btn-secondary" disabled={!data} onClick={async () => {
          if (!data) return
          try { await navigator.clipboard.writeText(data.text); toast('Message copied.') } catch { toast('Copy failed. Select the text instead.') }
        }}>Copy</button>
        {data?.wa_link ? (
          <a className="btn btn-primary" href={data.wa_link} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
        ) : (
          <button className="btn btn-primary" disabled>No phone number</button>
        )}
      </div>
    </Dialog>
  )
}
