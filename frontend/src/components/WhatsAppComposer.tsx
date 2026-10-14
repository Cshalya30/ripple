import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCheck, ChevronDown, Copy, ExternalLink } from 'lucide-react'
import type { FixOption, LanguageCode, Tone } from '../types'
import { buildMessage, messageLanguages, type MessageContext } from '../data/messages'
import { dateFromDay, shortDate } from '../lib/dates'
import { digitsOnly, formatINR } from '../lib/format'
import { useApp } from '../context/AppContext'

const days = (n: number) => shortDate(dateFromDay(n))

function contextFor(fix: FixOption, business: string): MessageContext {
  const amount = fix.recipient.amount
  const party = fix.id === 'invoice-financing' ? 'Kaveri Boutique' : fix.recipient.name
  return {
    business,
    party,
    amount: formatINR(amount),
    discounted: formatINR(Math.round(amount * 0.98)),
    half: formatINR(Math.round(amount / 2)),
    earlyDate: days(fix.id === 'invoice-financing' ? 26 : 30),
    dueDate: days(34),
    laterDate: days(fix.id === 'extension' ? 44 : 48),
  }
}

export function WhatsAppComposer({ fix }: { fix: FixOption }) {
  const { businessName, pushToast } = useApp()
  const [tone, setTone] = useState<Tone>('polite')
  const [lang, setLang] = useState<LanguageCode>('en')
  const generated = useMemo(() => buildMessage(fix.id, tone, lang, contextFor(fix, businessName)), [fix, tone, lang, businessName])
  const [text, setText] = useState(generated.text)
  const [copied, setCopied] = useState(false)

  useEffect(() => setText(generated.text), [generated.text])

  const langLabel = messageLanguages.find((l) => l.code === lang)?.label ?? ''
  const waHref = `https://wa.me/${digitsOnly(fix.recipient.phone)}?text=${encodeURIComponent(text)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    pushToast('Message copied')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Controls */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Tone</legend>
            <div role="radiogroup" aria-label="Tone" className="flex rounded-xl border border-line bg-sunken p-1">
              {(['polite', 'firm'] as Tone[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={tone === t}
                  onClick={() => setTone(t)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition ${tone === t ? 'bg-surface text-brand shadow-soft' : 'text-muted hover:text-ink'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="wa-lang" className="mb-1.5 block text-sm font-medium">
              Language
            </label>
            <div className="relative">
              <select id="wa-lang" value={lang} onChange={(e) => setLang(e.target.value as LanguageCode)} className="field appearance-none py-2 pr-9">
                {messageLanguages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            </div>
          </div>
        </div>
        {generated.usedLanguage !== lang && (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn" role="status">
            The {langLabel} version is not ready in this demo, so the English message is shown.
          </p>
        )}
        <div>
          <label htmlFor="wa-text" className="mb-1.5 block text-sm font-medium">
            Message to {fix.recipient.name}
          </label>
          <textarea id="wa-text" value={text} onChange={(e) => setText(e.target.value)} rows={9} className="field resize-y leading-relaxed" />
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={copy} className="btn btn-ghost">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            <ExternalLink size={16} aria-hidden="true" />
            Open in WhatsApp
          </a>
        </div>
      </div>

      {/* Preview */}
      <div>
        <p className="mb-1.5 text-sm font-medium">Preview</p>
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="flex items-center gap-3 bg-[#0B6B5A] px-4 py-2.5 text-white dark:bg-[#12423a]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold" aria-hidden="true">
              {fix.recipient.name[0]}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{fix.recipient.name}</p>
              <p className="num text-xs opacity-80">{fix.recipient.phone}</p>
            </div>
          </div>
          <div className="min-h-[260px] bg-[#EFE8DC] p-4 dark:bg-[#0E1A1C]">
            <div className="relative ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-[#D9FDD3] px-3.5 py-2.5 text-sm leading-relaxed text-[#111B21] shadow-sm dark:bg-[#144D37] dark:text-[#E9EDEF]">
              <p className="whitespace-pre-line break-words">{text || ' '}</p>
              <p className="mt-1 flex items-center justify-end gap-1 text-[11px] opacity-70">
                9:41 am <CheckCheck size={14} className="text-[#53BDEB]" aria-hidden="true" />
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
