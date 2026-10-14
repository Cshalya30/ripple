import { MicrophoneIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { clock } from '../lib/format'
import { useUI, type MunimContext } from '../lib/store'
import type { EngineView } from '../lib/store'
import type { Lang, Me, RunPayload } from '../lib/types'
import { Glyph } from './Glyph'
import { Seg } from './ui'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  mode?: string
  reason?: string
  runAt?: string
  tools?: string[]
}

const CHIPS: Record<Lang, { finance: string[]; supervisor: string[] }> = {
  en: { finance: ['Why the dip?', 'Ways to fix', 'Who to chase?', 'How did the engine decide day 34?'], supervisor: ['Which material is short?', 'What does waiting mean?'] },
  ta: { finance: ['ஏன் குறைவு?', 'தீர்வுகள்', 'யாரிடம் வசூலிக்க?'], supervisor: ['எந்த சரக்கு குறைவு?'] },
  hi: { finance: ['कमी क्यों?', 'समाधान', 'किससे वसूलें?'], supervisor: ['कौन सा माल कम है?'] },
}
const SPEECH_LANG: Record<Lang, string> = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN' }

export function MunimPanel({ me }: { me: Me }) {
  const ui = useUI()
  const navigate = useNavigate()
  const location = useLocation()
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState<Lang>(me.prefs.language_assistant)
  const [listening, setListening] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const finance = me.user.role !== 'SUPERVISOR'
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [turns, busy])
  useEffect(() => { setLang(me.prefs.language_assistant) }, [me.prefs.language_assistant])

  const send = async (message: string, context: MunimContext = {}) => {
    const trimmed = message.trim()
    if (!trimmed || busy) return
    const history = turns.slice(-6).map(({ role, content }) => ({ role, content }))
    setTurns((t) => [...t, { role: 'user', content: trimmed }])
    setText('')
    setBusy(true)
    try {
      const res = await api.post<{ reply: string; mode: string; reason?: string; run_created_at: string; tools: string[]; actions: any[] }>('/assistant/chat', {
        message: trimmed.slice(0, 1000), language: lang, history,
        context: { route: location.pathname, event_id: ui.selectedEventId ?? undefined, party_id: ui.selectedPartyId ?? undefined, ...context },
      })
      setTurns((t) => [...t, { role: 'assistant', content: res.reply, mode: res.mode, reason: res.reason, runAt: res.run_created_at, tools: res.tools }])
      if (me.prefs.read_aloud && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(res.reply)
        utterance.lang = SPEECH_LANG[lang]
        window.speechSynthesis.speak(utterance)
      }
      await runActions(res.actions)
    } catch (error) {
      setTurns((t) => [...t, { role: 'assistant', content: errorText(error), mode: 'ERROR' }])
    } finally {
      setBusy(false)
    }
  }

  const runActions = async (actions: any[]) => {
    for (const action of actions ?? []) {
      if (action.type === 'draft_message') {
        ui.openComposer({ partyId: action.party_id, intent: action.intent, tone: action.tone })
      } else if (action.type === 'open_party') {
        // Keep the reply visible; the owner can open the party from Khata.
      } else if (action.type === 'run_scenario' && finance) {
        try {
          const res = await api.post<any>('/engine/scenario', { kind: action.fix.kind, event_id: action.fix.params.event_id, date: action.fix.params.date })
          ui.setScenario({ key: res.key, label: 'Munim what-if', evaluation: res.evaluation, run: res.run as RunPayload })
          ui.setEngineView('flow')
          navigate('/app/engine')
        } catch { /* reply already explains */ }
      } else if (action.type === 'open_view' && action.screen === 'engine' && action.view) {
        // Prepare the engine view; the owner stays on the current screen.
        ui.setEngineView(action.view as EngineView)
        if (typeof action.day === 'number') ui.setDay(action.day)
        if (action.event_id) ui.selectEvent(action.event_id)
      }
    }
  }

  useEffect(() => {
    if (ui.munimSeed) void send(ui.munimSeed.text, ui.munimSeed.context)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.munimSeed?.nonce])

  const listen = () => {
    if (!SpeechRecognition) return
    const recognition = new SpeechRecognition()
    recognition.lang = SPEECH_LANG[lang]
    recognition.interimResults = false
    recognition.onresult = (e: any) => setText((prev) => `${prev} ${e.results[0][0].transcript}`.trim())
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    setListening(true)
    recognition.start()
  }

  return (
    <>
      <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
        <Glyph name="NIB" style={{ color: 'var(--haldi)' }} />
        <strong>Munim</strong>
        <span className="spacer" />
        <Seg label="Reply language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'EN' }, { value: 'ta', label: 'த' }, { value: 'hi', label: 'हि' }]} />
        <button className="icon-btn" onClick={() => ui.setMunimOpen(false)} aria-label="Close Munim"><Glyph name="CROSS" /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }} aria-live="polite">
        {turns.length === 0 && (
          <div className="small muted">
            <p style={{ marginTop: 0 }}>I keep your books. I answer only from your records and the engine's results, and I never do the arithmetic myself.</p>
            <p>I can't record payments or change anything. I can prepare a message or open a screen.</p>
          </div>
        )}
        {turns.map((turn, i) => turn.role === 'user' ? (
          <p key={i} className="right" style={{ margin: '14px 0 6px', color: 'var(--text-2)' }}>{turn.content}</p>
        ) : (
          <div key={i} className="row" style={{ alignItems: 'flex-start', margin: '6px 0 14px' }}>
            <Glyph name="NIB" style={{ color: 'var(--haldi)', marginTop: 3, flex: 'none' }} />
            <div className="grow">
              <div style={{ whiteSpace: 'pre-wrap' }} lang={lang}>{turn.content}</div>
              {turn.runAt && (
                <div className="micro faint" style={{ marginTop: 4 }}>
                  From engine run {clock(turn.runAt)}
                  {turn.mode === 'TEMPLATE' && ` · answered by template${turn.reason ? ` (${turn.reason})` : ''}`}
                  {turn.tools?.length ? ` · ${turn.tools.join(', ')}` : ''}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="small faint">Reading your books…</p>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--rule)' }}>
        <div className="row-wrap" style={{ marginBottom: 8, gap: 6 }}>
          {CHIPS[lang][finance ? 'finance' : 'supervisor'].map((chip) => (
            <button key={chip} className="chip" style={{ cursor: 'pointer', background: 'transparent' }} onClick={() => send(chip)}>{chip}</button>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void send(text) }}>
          <input className="input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ask about your books" aria-label="Message to Munim" />
          {SpeechRecognition && (
            <button type="button" className="icon-btn" onClick={listen} aria-label="Speak" aria-pressed={listening} style={listening ? { color: 'var(--haldi)' } : undefined}>
              <MicrophoneIcon size={18} />
            </button>
          )}
          <button className="icon-btn" disabled={!text.trim() || busy} aria-label="Send"><PaperPlaneRightIcon size={18} /></button>
        </form>
      </div>
    </>
  )
}
