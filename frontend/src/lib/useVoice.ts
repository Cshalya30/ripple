import { useCallback, useEffect, useRef, useState } from 'react'
import { listen, loadVoices, recognitionSupported, speak, stopSpeaking, synthesisSupported, voicesFor, type Listener, type VoiceLang } from './voice'
import { useVoicePrefs } from './voicePrefs'

/** Microphone input with live text. The caller decides what a finished phrase does. */
export function useSpeechInput(opts: { lang: VoiceLang; continuous?: boolean; onFinal: (text: string) => void; maxMs?: number }) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<Listener | null>(null)
  const onFinal = useRef(opts.onFinal)
  onFinal.current = opts.onFinal

  const stop = useCallback(() => { handle.current?.stop() }, [])
  const abort = useCallback(() => { handle.current?.abort(); handle.current = null; setListening(false); setInterim('') }, [])

  const start = useCallback(() => {
    if (handle.current) return
    setError(null)
    stopSpeaking() // never listen to our own voice
    handle.current = listen({ lang: opts.lang, continuous: opts.continuous, maxMs: opts.maxMs }, {
      onStart: () => setListening(true),
      onInterim: setInterim,
      onFinal: (text) => onFinal.current(text),
      onError: (message) => setError(message),
      onEnd: () => { handle.current = null; setListening(false); setInterim('') },
    })
  }, [opts.lang, opts.continuous, opts.maxMs])

  const toggle = useCallback(() => { if (handle.current) stop(); else start() }, [start, stop])

  // Changing language mid-sentence would keep the old one; stop cleanly instead. Leaving the screen releases the microphone.
  useEffect(() => () => { handle.current?.abort(); handle.current = null }, [opts.lang])

  return { supported: recognitionSupported(), listening, interim, error, clearError: () => setError(null), start, stop, abort, toggle }
}

/** Read text aloud with the person's chosen voice and speed. */
export function useSpeaker(lang: VoiceLang) {
  const prefs = useVoicePrefs()
  const [speakingKey, setSpeakingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installed, setInstalled] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void loadVoices().then((voices) => { if (alive) setInstalled(voicesFor(voices, lang).length) })
    return () => { alive = false }
  }, [lang])

  const stop = useCallback(() => { stopSpeaking(); setSpeakingKey(null) }, [])

  /** Read text aloud. `spokenLang` is for text that is not in the chosen language (an English fallback reply while Telugu is chosen). */
  const say = useCallback((text: string, key = 'default', done?: () => void, spokenLang: VoiceLang = lang) => {
    setError(null)
    setSpeakingKey(key)
    void speak(text, {
      lang: spokenLang, voiceURI: prefs.voices[spokenLang], rate: prefs.rate,
      onEnd: () => { setSpeakingKey((current) => (current === key ? null : current)); done?.() },
      onError: (message) => { setError(message); setSpeakingKey(null) },
    })
  }, [lang, prefs.voices, prefs.rate])

  useEffect(() => stop, [stop, lang])

  return { supported: synthesisSupported(), speakingKey, speaking: speakingKey !== null, say, stop, error, clearError: () => setError(null), installed }
}
