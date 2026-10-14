import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Maximize2, Mic, Minus, Send, Sparkles, X } from 'lucide-react'
import { assistantLanguages, suggestedQuestions, voiceTranscripts, type AssistantAction } from '../data/assistant'
import { getReply } from '../services/assistantService'
import type { LanguageCode } from '../types'

interface ChatMessage {
  id: number
  from: 'user' | 'bot'
  text: string
  actions?: AssistantAction[]
  note?: string
}

const seed: ChatMessage[] = [
  { id: 1, from: 'bot', text: "Hi, I'm Ripple's assistant. Ask me about your forecast, or tell me where you want to go." },
  { id: 2, from: 'user', text: 'Will I be able to pay Sharma Yarn Mills on time?' },
  {
    id: 3,
    from: 'bot',
    text: 'Not on the current plan. The ₹3.52L payment lands on Day 34, a week before Kaveri Boutique is expected to pay you. A fix can close that gap.',
    actions: [{ label: 'See ways to fix it', route: '/forecast' }],
  },
]

const STORAGE_KEY = 'ripple-assistant-open'

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function Waveform() {
  return (
    <div className="flex h-7 items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: 22 }).map((_, i) => (
        <span
          key={i}
          className="h-full w-[3px] origin-center animate-wave rounded-full bg-loss"
          style={{ animationDelay: `${(i % 7) * 0.12}s`, animationDuration: `${0.7 + (i % 5) * 0.12}s` }}
        />
      ))}
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-sunken px-3.5 py-3" aria-label="Ripple is typing" role="status">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-typing rounded-full bg-muted" style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </div>
  )
}

export function AssistantWidget() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(readOpen)
  const [minimized, setMinimized] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(seed)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [lang, setLang] = useState<LanguageCode>('en')
  const [autoTranslate, setAutoTranslate] = useState(false)
  const [listening, setListening] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [transcriptNote, setTranscriptNote] = useState(false)
  const idRef = useRef(10)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const voiceIndex = useRef(0)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, open, minimized])

  // Mock voice capture: record for ~3 seconds, then drop a transcript into the input.
  useEffect(() => {
    if (!listening) return
    setSeconds(0)
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000)
    const done = setTimeout(() => {
      setListening(false)
      setInput(voiceTranscripts[voiceIndex.current % voiceTranscripts.length])
      voiceIndex.current += 1
      setTranscriptNote(true)
      setTimeout(() => inputRef.current?.focus(), 50)
    }, 3200)
    return () => {
      clearInterval(tick)
      clearTimeout(done)
    }
  }, [listening])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || typing) return
      setMessages((m) => [...m, { id: idRef.current++, from: 'user', text }])
      setInput('')
      setTranscriptNote(false)
      setTyping(true)
      const reply = await getReply(text)
      const langInfo = assistantLanguages.find((l) => l.code === lang)
      let body = reply.en
      let note: string | undefined
      if (autoTranslate && lang !== 'en') {
        if (lang === 'hi') body = reply.hi
        else note = `Showing English for now. ${langInfo?.label ?? 'This language'} replies are coming soon.`
      }
      setTyping(false)
      setMessages((m) => [...m, { id: idRef.current++, from: 'bot', text: body, actions: reply.actions, note }])
      if (reply.autoRoute) setTimeout(() => navigate(reply.autoRoute!), 700)
    },
    [typing, lang, autoTranslate, navigate],
  )

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const runAction = (a: AssistantAction) => {
    navigate(a.route, a.state ? { state: a.state } : undefined)
    if (window.innerWidth < 640) setMinimized(true)
  }

  const mm = String(Math.floor(seconds / 60))
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <>
      {/* Floating launcher */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="launcher"
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1, width: expanded ? 152 : 56 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            onHoverStart={() => setExpanded(true)}
            onHoverEnd={() => setExpanded(false)}
            onFocus={() => setExpanded(true)}
            onBlur={() => setExpanded(false)}
            onClick={() => {
              setOpen(true)
              setMinimized(false)
            }}
            aria-label="Ask Ripple"
            className="fixed bottom-20 right-4 z-50 flex h-14 items-center justify-center overflow-visible rounded-full bg-brand text-on-brand shadow-lift lg:bottom-6 lg:right-6"
          >
            {!expanded && <span className="absolute inset-0 animate-soft-pulse rounded-full bg-brand" aria-hidden="true" />}
            <span className="relative flex h-full w-full items-center justify-center gap-2 overflow-hidden rounded-full px-4">
              <Sparkles size={22} className="shrink-0" aria-hidden="true" />
              <motion.span
                animate={{ opacity: expanded ? 1 : 0, width: expanded ? 'auto' : 0 }}
                className="overflow-hidden whitespace-nowrap text-sm font-semibold"
              >
                Ask Ripple
              </motion.span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.section
            key="panel"
            role="dialog"
            aria-label="Ripple assistant"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={`fixed z-[55] flex flex-col overflow-hidden border border-line bg-surface shadow-lift ${
              minimized
                ? 'bottom-20 right-4 h-14 w-[min(20rem,calc(100vw-2rem))] rounded-2xl lg:bottom-6 lg:right-6'
                : 'inset-0 sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[560px] sm:w-[380px] sm:rounded-2xl'
            }`}
          >
            {/* Header */}
            <div className="border-b border-line bg-brand-soft/60 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-on-brand" aria-hidden="true">
                  <Sparkles size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-bold leading-tight">Ripple assistant</p>
                  {!minimized && <p className="text-xs text-muted">Sample replies, no live AI</p>}
                </div>
                <button
                  type="button"
                  onClick={() => setMinimized((m) => !m)}
                  aria-label={minimized ? 'Restore chat' : 'Minimise chat'}
                  className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink"
                >
                  {minimized ? <Maximize2 size={16} /> : <Minus size={16} />}
                </button>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink">
                  <X size={16} />
                </button>
              </div>
              {!minimized && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="relative">
                    <label htmlFor="assistant-lang" className="sr-only">
                      Assistant language
                    </label>
                    <select
                      id="assistant-lang"
                      value={lang}
                      onChange={(e) => setLang(e.target.value as LanguageCode)}
                      className="appearance-none rounded-lg border border-line bg-surface py-1.5 pl-3 pr-8 text-sm font-medium"
                    >
                      {assistantLanguages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    Auto-translate
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoTranslate}
                      onClick={() => setAutoTranslate((a) => !a)}
                      className={`relative h-5 w-9 rounded-full transition ${autoTranslate ? 'bg-brand' : 'bg-line'}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoTranslate ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </label>
                </div>
              )}
            </div>

            {!minimized && (
              <>
                {/* Messages */}
                <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex flex-col gap-2 ${m.from === 'user' ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          m.from === 'user' ? 'rounded-br-md bg-brand text-on-brand' : 'rounded-bl-md bg-sunken text-ink'
                        }`}
                      >
                        {m.text}
                      </div>
                      {m.note && <p className="max-w-[88%] text-xs italic text-muted">{m.note}</p>}
                      {m.actions && (
                        <div className="flex flex-wrap gap-2">
                          {m.actions.map((a) => (
                            <button
                              key={a.label}
                              type="button"
                              onClick={() => runAction(a)}
                              className="rounded-full border border-brand/40 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-on-brand"
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {typing && <TypingDots />}
                </div>

                {/* Suggestions */}
                <div className="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
                  {suggestedQuestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      disabled={typing || listening}
                      className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-brand hover:text-brand disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>

                {/* Input / voice bar */}
                <div className="border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  {listening ? (
                    <div className="flex items-center gap-3 rounded-xl bg-loss-soft px-3 py-2" role="status">
                      <span className="relative flex h-3 w-3" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-soft-pulse rounded-full bg-loss" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-loss" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-loss">Listening…</p>
                        <Waveform />
                      </div>
                      <span className="num text-sm font-semibold">
                        {mm}:{ss}
                      </span>
                      <button type="button" onClick={() => setListening(false)} aria-label="Cancel recording" className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={onSubmit} className="flex items-center gap-2">
                      <label htmlFor="assistant-input" className="sr-only">
                        Message Ripple
                      </label>
                      <input
                        ref={inputRef}
                        id="assistant-input"
                        value={input}
                        onChange={(e) => {
                          setInput(e.target.value)
                          setTranscriptNote(false)
                        }}
                        placeholder="Ask about your cash flow"
                        autoComplete="off"
                        className="field flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => setListening(true)}
                        aria-label="Speak your question"
                        className="rounded-xl border border-line bg-surface p-2.5 text-muted transition hover:text-brand"
                      >
                        <Mic size={18} />
                      </button>
                      <button
                        type="submit"
                        aria-label="Send message"
                        disabled={!input.trim() || typing}
                        className="rounded-xl bg-brand p-2.5 text-on-brand transition hover:opacity-90 disabled:opacity-40"
                      >
                        <Send size={18} />
                      </button>
                    </form>
                  )}
                  {transcriptNote && !listening && <p className="mt-1.5 text-xs text-muted">Sample transcript from your voice note. Edit it or send as is.</p>}
                </div>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
