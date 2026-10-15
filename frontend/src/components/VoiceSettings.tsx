import { MicrophoneIcon, SpeakerHighIcon, StopIcon } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { loadVoices, microphonePermission, recognitionSupported, synthesisSupported, VOICE_LANGUAGES, voiceLanguage, voicesFor, type VoiceLang } from '../lib/voice'
import { useSpeechInput, useSpeaker } from '../lib/useVoice'
import { useVoicePrefs } from '../lib/voicePrefs'
import type { Prefs } from '../lib/types'
import { Section } from './ui'

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="list-row" style={{ flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 200 }}>{label}{hint && <span className="sub">{hint}</span>}</div>
      <div>{children}</div>
    </div>
  )
}

export function LanguageSelect({ value, onChange, label, id, compact }: { value: VoiceLang; onChange: (v: VoiceLang) => void; label: string; id?: string; compact?: boolean }) {
  return (
    <select id={id} className="select" style={compact ? { width: 'auto', minWidth: 0, height: 28 } : { minWidth: 190 }} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as VoiceLang)}>
      {VOICE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{compact || l.native === l.name ? l.native : `${l.native} (${l.name})`}</option>)}
    </select>
  )
}

/** Voice section of Settings: which language Munim speaks and hears, which voice reads, and a live test of both. */
export function VoiceSettings({ prefs, setPref }: { prefs: Prefs; setPref: (patch: Partial<Prefs>) => void | Promise<void> }) {
  const lang = prefs.language_assistant as VoiceLang
  const voicePrefs = useVoicePrefs()
  const speaker = useSpeaker(lang)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [heard, setHeard] = useState('')
  const [permission, setPermission] = useState<string | null>(null)
  const input = useSpeechInput({ lang, onFinal: (text) => setHeard(text), maxMs: 12_000 })
  const meta = voiceLanguage(lang)
  const mine = voicesFor(voices, lang)

  useEffect(() => { void loadVoices().then(setVoices) }, [])
  useEffect(() => { void microphonePermission().then(setPermission) }, [input.listening, input.error])

  return (
    <Section title="Voice">
      <Row label="Munim's language" hint="Used for replies, for listening, and for reading aloud.">
        <LanguageSelect value={lang} label="Munim's language" onChange={(v) => { void setPref({ language_assistant: v }) }} />
      </Row>
      {lang !== 'en' && lang !== 'hi' && lang !== 'ta' && (
        <p className="micro faint" style={{ margin: '0 0 8px' }}>{meta.name} replies are written by the AI service. When it is not available Munim answers from fixed templates, which exist in English, Hindi and Tamil.</p>
      )}
      <Row label="Read Munim's replies aloud" hint="Uses a voice installed on this device.">
        <label className="check"><input type="checkbox" checked={prefs.read_aloud} onChange={(e) => { void setPref({ read_aloud: e.target.checked }) }} /> {prefs.read_aloud ? 'On' : 'Off'}</label>
      </Row>
      <Row label={`Voice for ${meta.name}`} hint={speaker.supported ? (voices.length === 0 ? 'Looking for voices on this device' : mine.length ? `${mine.length} installed` : undefined) : 'This browser cannot read aloud.'}>
        {speaker.supported && mine.length > 0 && (
          <div className="row" style={{ gap: 8 }}>
            <select className="select" style={{ maxWidth: 260 }} aria-label={`Voice for ${meta.name}`} value={voicePrefs.voices[lang] ?? ''} onChange={(e) => voicePrefs.setVoice(lang, e.target.value || null)}>
              <option value="">Best available</option>
              {mine.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
            </select>
            {speaker.speakingKey === 'test'
              ? <button className="btn btn-secondary" onClick={speaker.stop}><StopIcon size={14} /> Stop</button>
              : <button className="btn btn-secondary" onClick={() => speaker.say(meta.sample, 'test')}><SpeakerHighIcon size={14} /> Test voice</button>}
          </div>
        )}
        {speaker.supported && voices.length > 0 && mine.length === 0 && (
          <span className="small" style={{ color: 'var(--haldi)' }}>
            No {meta.name} voice is installed on this device, so replies cannot be read in {meta.name}. Add one in your system's speech settings
            (Windows: Settings, Time and language, Speech. Android: Text-to-speech output. Mac and iPhone: Accessibility, Spoken content), then reload.
          </span>
        )}
      </Row>
      <Row label="Speaking speed" hint={`${voicePrefs.rate.toFixed(1)}x`}>
        <input type="range" min={0.6} max={1.4} step={0.1} value={voicePrefs.rate} aria-label="Speaking speed" onChange={(e) => voicePrefs.setRate(Number(e.target.value))} />
      </Row>
      <Row label="Send automatically after I speak" hint="Skip pressing Send when the microphone hears a full question.">
        <label className="check"><input type="checkbox" checked={voicePrefs.autoSend} onChange={(e) => voicePrefs.setAutoSend(e.target.checked)} /> {voicePrefs.autoSend ? 'On' : 'Off'}</label>
      </Row>
      <Row label="Keep listening after Munim answers" hint="Hands-free: Munim reads the reply, then listens again. Needs read-aloud on.">
        <label className="check"><input type="checkbox" checked={voicePrefs.conversation} onChange={(e) => voicePrefs.setConversation(e.target.checked)} /> {voicePrefs.conversation ? 'On' : 'Off'}</label>
      </Row>
      <Row label="Test the microphone" hint={recognitionSupported() ? `Say something in ${meta.name}.` : 'Voice input works in Chrome, Edge and Safari.'}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary" disabled={!recognitionSupported()} onClick={() => { setHeard(''); input.toggle() }} aria-pressed={input.listening}>
            <MicrophoneIcon size={14} /> {input.listening ? 'Listening, press to stop' : 'Test'}
          </button>
        </div>
      </Row>
      {(input.listening || input.interim || heard) && <p className="small" lang={lang} style={{ margin: '0 0 8px' }}>{input.interim || heard || 'Listening'}</p>}
      {input.error && <p className="small" role="alert" style={{ color: 'var(--out)', margin: '0 0 8px' }}>{input.error}</p>}
      {speaker.error && <p className="small" role="alert" style={{ color: 'var(--out)', margin: '0 0 8px' }}>{speaker.error}</p>}
      <p className="micro faint">
        Voice input: {recognitionSupported() ? 'available' : 'not available in this browser'} · Voice output: {synthesisSupported() ? 'available' : 'not available'}
        {permission ? ` · Microphone permission: ${permission}` : ''}. Your voice goes to the browser's speech service, not to Ripple.
        Voice choices are saved on this device only.
      </p>
    </Section>
  )
}
