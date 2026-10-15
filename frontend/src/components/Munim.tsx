import { MicrophoneIcon, PaperPlaneRightIcon, SpeakerHighIcon, SpeakerSlashIcon, StopIcon, WaveformIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { clock } from '../lib/format'
import { useUI, type MunimContext } from '../lib/store'
import type { EngineView } from '../lib/store'
import type { AssistantLang, Me, RunPayload } from '../lib/types'
import { useSpeaker, useSpeechInput } from '../lib/useVoice'
import { voiceLanguage, type VoiceLang } from '../lib/voice'
import { useVoicePrefs } from '../lib/voicePrefs'
import { Glyph } from './Glyph'
import { LanguageSelect } from './VoiceSettings'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  mode?: string
  reason?: string
  runAt?: string
  tools?: string[]
  /** The language the answer is actually written in, when it differs from the one asked for. */
  answeredIn?: string
}

const CHIPS: Record<AssistantLang, { finance: string[]; supervisor: string[] }> = {
  en: { finance: ['Why the dip?', 'Ways to fix', 'Who to chase?', 'How did the engine decide day 34?'], supervisor: ['Which material is short?', 'What does waiting mean?'] },
  ta: { finance: ['ஏன் குறைவு?', 'தீர்வுகள்', 'யாரிடம் வசூலிக்க?'], supervisor: ['எந்த சரக்கு குறைவு?'] },
  hi: { finance: ['कमी क्यों?', 'समाधान', 'किससे वसूलें?'], supervisor: ['कौन सा माल कम है?'] },
  te: { finance: ['ఎందుకు తగ్గింది?', 'పరిష్కారాలు', 'ఎవరి దగ్గర వసూలు చేయాలి?'], supervisor: ['ఏ సరుకు తక్కువగా ఉంది?'] },
  kn: { finance: ['ಏಕೆ ಕಡಿಮೆ?', 'ಪರಿಹಾರಗಳು', 'ಯಾರಿಂದ ವಸೂಲಿ ಮಾಡಬೇಕು?'], supervisor: ['ಯಾವ ಸರಕು ಕಡಿಮೆ ಇದೆ?'] },
  ml: { finance: ['എന്തുകൊണ്ട് കുറവ്?', 'പരിഹാരങ്ങൾ', 'ആരോട് പിരിച്ചെടുക്കണം?'], supervisor: ['ഏത് സാധനം കുറവാണ്?'] },
  pa: { finance: ['ਘਾਟ ਕਿਉਂ?', 'ਹੱਲ', 'ਕਿਸ ਤੋਂ ਵਸੂਲੀ ਕਰੀਏ?'], supervisor: ['ਕਿਹੜਾ ਮਾਲ ਘੱਟ ਹੈ?'] },
  de: { finance: ['Warum der Einbruch?', 'Lösungen', 'Wen mahnen?'], supervisor: ['Welches Material fehlt?'] },
  es: { finance: ['¿Por qué la caída?', 'Soluciones', '¿A quién reclamar?'], supervisor: ['¿Qué material falta?'] },
  zh: { finance: ['为什么现金会下降？', '解决办法', '该向谁催款？'], supervisor: ['哪种材料短缺？'] },
}

const PLACEHOLDER: Record<AssistantLang, string> = {
  en: 'Ask about your books', hi: 'अपने खाते के बारे में पूछें', ta: 'உங்கள் கணக்கைப் பற்றிக் கேளுங்கள்', te: 'మీ ఖాతాల గురించి అడగండి', kn: 'ನಿಮ್ಮ ಲೆಕ್ಕದ ಬಗ್ಗೆ ಕೇಳಿ',
  ml: 'നിങ്ങളുടെ കണക്കുകളെക്കുറിച്ച് ചോദിക്കുക', pa: 'ਆਪਣੇ ਖਾਤੇ ਬਾਰੇ ਪੁੱਛੋ', de: 'Fragen Sie zu Ihren Büchern', es: 'Pregunte sobre sus cuentas', zh: '询问您的账目',
}

export function MunimPanel({ me }: { me: Me }) {
  const ui = useUI()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const voicePrefs = useVoicePrefs()
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState<AssistantLang>(me.prefs.language_assistant)
  const endRef = useRef<HTMLDivElement>(null)
  const textRef = useRef('')
  const finance = me.user.role !== 'SUPERVISOR'
  const readAloud = me.prefs.read_aloud

  const speaker = useSpeaker(lang as VoiceLang)
  const input = useSpeechInput({
    lang: lang as VoiceLang,
    onFinal: (heard) => {
      const combined = `${textRef.current} ${heard}`.trim()
      textRef.current = combined
      setText(combined)
      if (useVoicePrefs.getState().autoSend) void send(combined)
    },
  })

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [turns, busy])
  useEffect(() => { setLang(me.prefs.language_assistant) }, [me.prefs.language_assistant])
  useEffect(() => { textRef.current = text }, [text])

  const setPref = async (patch: Partial<Me['prefs']>) => {
    try {
      qc.setQueryData(['me'], await api.put<Me>('/me/prefs', patch))
    } catch (error) {
      ui.toast(`Could not save that setting. ${errorText(error)}`)
    }
  }
  const changeLang = (next: AssistantLang) => { setLang(next); void setPref({ language_assistant: next }) }

  const send = async (message: string, context: MunimContext = {}) => {
    const trimmed = message.trim()
    if (!trimmed || busy) return
    speaker.stop()
    input.abort()
    const history = turns.slice(-6).map(({ role, content }) => ({ role, content }))
    setTurns((t) => [...t, { role: 'user', content: trimmed }])
    setText('')
    textRef.current = ''
    setBusy(true)
    try {
      const res = await api.post<{ reply: string; mode: string; reason?: string; run_created_at: string; tools: string[]; actions: any[]; language?: string; requested_language?: string }>('/assistant/chat', {
        message: trimmed.slice(0, 1000), language: lang, history,
        context: { route: location.pathname, event_id: ui.selectedEventId ?? undefined, party_id: ui.selectedPartyId ?? undefined, ...context },
      })
      const answeredIn = res.language && res.language !== lang ? res.language : undefined
      setTurns((t) => [...t, { role: 'assistant', content: res.reply, mode: res.mode, reason: res.reason, runAt: res.run_created_at, tools: res.tools, answeredIn }])
      // The reply is read in the language it is written in, so an English fallback is never spoken with a Telugu voice.
      const spoken = (answeredIn ?? lang) as VoiceLang
      if (readAloud && speaker.supported) {
        speakReply(res.reply, spoken)
      } else if (useVoicePrefs.getState().conversation && readAloud) {
        input.start()
      }
      await runActions(res.actions)
    } catch (error) {
      setTurns((t) => [...t, { role: 'assistant', content: errorText(error), mode: 'ERROR' }])
    } finally {
      setBusy(false)
    }
  }

  // One path for every spoken reply, so Stop, errors and hands-free listening behave the same whatever language it is in.
  const speakReply = (reply: string, spokenLang: VoiceLang, key = 'latest') => {
    speaker.say(reply, key, () => { if (useVoicePrefs.getState().conversation && input.supported) input.start() }, spokenLang)
  }

  const runActions = async (actions: any[]) => {
    for (const action of actions ?? []) {
      if (action.type === 'draft_message') {
        ui.openComposer({ partyId: action.party_id, intent: action.intent, tone: action.tone })
      } else if (action.type === 'open_party') {
        // Keep the reply visible; the owner can open the party from Khata.
      } else if (action.type === 'run_scenario' && finance) {
        try {
          const request = { kind: action.fix.kind, event_id: action.fix.params.event_id, date: action.fix.params.date }
          const res = await api.post<any>('/engine/scenario', request)
          ui.setPlaying(false)
          ui.setScenario({ key: res.key, label: 'Munim what-if', evaluation: res.evaluation, run: res.run as RunPayload, chance: res.chance_after, request })
          ui.setDiff(true)
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

  const speakTurn = (turn: Turn, index: number) => {
    speaker.say(turn.content, `turn-${index}`, undefined, (turn.answeredIn ?? lang) as VoiceLang)
  }

  const micLabel = !input.supported ? 'Voice input works in Chrome, Edge and Safari' : input.listening ? 'Stop listening' : `Speak in ${voiceLanguage(lang).name}`
  const noVoice = readAloud && speaker.supported && speaker.installed === 0
  const notice = input.error ?? speaker.error

  return (
    <>
      <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)', gap: 6 }}>
        <Glyph name="NIB" style={{ color: 'var(--haldi)' }} />
        <strong>Munim</strong>
        <span className="spacer" />
        <LanguageSelect compact label="Reply language" value={lang as VoiceLang} onChange={changeLang} />
        <button className="icon-btn" onClick={() => void setPref({ read_aloud: !readAloud })} aria-pressed={readAloud} disabled={!speaker.supported}
          aria-label={readAloud ? 'Turn off reading replies aloud' : 'Read replies aloud'} title={speaker.supported ? (readAloud ? 'Reading replies aloud' : 'Read replies aloud') : 'This browser cannot read aloud'}
          style={readAloud ? { color: 'var(--haldi)' } : undefined}>
          {readAloud ? <SpeakerHighIcon size={18} /> : <SpeakerSlashIcon size={18} />}
        </button>
        <button className="icon-btn" onClick={() => voicePrefs.setConversation(!voicePrefs.conversation)} aria-pressed={voicePrefs.conversation} disabled={!input.supported || !speaker.supported}
          aria-label="Hands-free conversation" title="Hands-free: Munim answers aloud, then listens again" style={voicePrefs.conversation ? { color: 'var(--haldi)' } : undefined}>
          <WaveformIcon size={18} />
        </button>
        <button className="icon-btn" onClick={() => ui.setMunimOpen(false)} aria-label="Close Munim"><Glyph name="CROSS" /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }} aria-live="polite">
        {turns.length === 0 && (
          <div className="small muted">
            <p style={{ marginTop: 0 }}>I keep your books. I answer only from your records and the engine's results, and I never do the arithmetic myself.</p>
            <p>I can't record payments or change anything. I can prepare a message or open a screen.</p>
            {input.supported && <p>Press the microphone and ask in {voiceLanguage(lang).name}. Turn on the speaker to hear my answers.</p>}
          </div>
        )}
        {turns.map((turn, i) => turn.role === 'user' ? (
          <p key={i} className="right" style={{ margin: '14px 0 6px', color: 'var(--text-2)' }}>{turn.content}</p>
        ) : (
          <div key={i} className="row" style={{ alignItems: 'flex-start', margin: '6px 0 14px' }}>
            <Glyph name="NIB" style={{ color: 'var(--haldi)', marginTop: 3, flex: 'none' }} />
            <div className="grow">
              <div style={{ whiteSpace: 'pre-wrap' }} lang={turn.answeredIn ?? lang}>{turn.content}</div>
              {turn.answeredIn && <div className="micro" style={{ color: 'var(--haldi)', marginTop: 2 }}>Answered in {voiceLanguage(turn.answeredIn).name}: {voiceLanguage(lang).name} replies need the AI service, which is not answering right now.</div>}
              {turn.runAt && (
                <div className="micro faint" style={{ marginTop: 4 }}>
                  From engine run {clock(turn.runAt)}
                  {turn.mode === 'TEMPLATE' && ` · answered by template${turn.reason ? ` (${turn.reason})` : ''}`}
                  {turn.tools?.length ? ` · ${turn.tools.join(', ')}` : ''}
                </div>
              )}
            </div>
            {speaker.supported && turn.mode !== 'ERROR' && (
              speaker.speakingKey === `turn-${i}` || (speaker.speakingKey === 'latest' && i === turns.length - 1)
                ? <button className="icon-btn" onClick={speaker.stop} aria-label="Stop reading" title="Stop reading"><StopIcon size={16} /></button>
                : <button className="icon-btn" onClick={() => speakTurn(turn, i)} aria-label="Read this reply aloud" title="Read this reply aloud"><SpeakerHighIcon size={16} /></button>
            )}
          </div>
        ))}
        {busy && <p className="small faint">Reading your books…</p>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--rule)' }}>
        {notice && (
          <div className="notice bad row small" role="alert" style={{ marginBottom: 8 }}>
            <span className="grow">{notice}</span>
            <button className="btn btn-sm btn-quiet" onClick={() => { input.clearError(); speaker.clearError() }}>Dismiss</button>
          </div>
        )}
        {noVoice && <p className="micro" style={{ color: 'var(--haldi)', margin: '0 0 8px' }}>No {voiceLanguage(lang).name} voice is installed on this device, so replies are not read aloud. Settings, Voice explains how to add one.</p>}
        <div className="row-wrap" style={{ marginBottom: 8, gap: 6 }}>
          {CHIPS[lang][finance ? 'finance' : 'supervisor'].map((chip) => (
            <button key={chip} className="chip" style={{ cursor: 'pointer', background: 'transparent' }} onClick={() => send(chip)}>{chip}</button>
          ))}
        </div>
        {(input.listening || input.interim) && (
          <p className="small" style={{ margin: '0 0 6px', color: 'var(--haldi)' }} aria-live="polite" lang={lang}>
            <span className="mic-dot" aria-hidden="true" /> {input.interim || `Listening in ${voiceLanguage(lang).name}…`}
          </p>
        )}
        <form className="row" onSubmit={(e) => { e.preventDefault(); void send(text) }}>
          <input className="input" value={text} maxLength={1000} lang={lang} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER[lang]} aria-label="Message to Munim"
            onKeyDown={(e) => { if (e.key === 'Escape' && input.listening) { input.stop(); e.stopPropagation() } }} />
          <button type="button" className={`icon-btn${input.listening ? ' mic-live' : ''}`} onClick={input.toggle} disabled={!input.supported || busy} aria-label={micLabel} title={micLabel}
            aria-pressed={input.listening} style={input.listening ? { color: 'var(--haldi)' } : undefined}>
            <MicrophoneIcon size={18} weight={input.listening ? 'fill' : 'regular'} />
          </button>
          <button className="icon-btn" disabled={!text.trim() || busy} aria-label="Send"><PaperPlaneRightIcon size={18} /></button>
        </form>
      </div>
    </>
  )

}
