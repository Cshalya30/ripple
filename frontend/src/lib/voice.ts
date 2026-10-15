/**
 * Browser speech, done carefully. Two halves:
 *  - listening: SpeechRecognition with live (interim) text, language fallbacks and clear errors
 *  - speaking: SpeechSynthesis with the best installed voice, sentence-sized chunks (long utterances
 *    are cut off by Chrome), spoken-form clean-up (rupees, markdown) and a hard stop.
 * Nothing here talks to the server. Audio goes to the browser's own speech service.
 */

export type VoiceLang = 'en' | 'hi' | 'ta' | 'te' | 'kn' | 'ml' | 'pa' | 'de' | 'es' | 'zh'

export interface VoiceLanguage {
  code: VoiceLang
  /** English name */
  name: string
  /** Name in its own script */
  native: string
  /** Tags to try for listening, best first. */
  recognition: string[]
  /** Tags to try for speaking, best first. */
  synthesis: string[]
  rupees: string
  minus: string
  sample: string
}

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: 'en', name: 'English', native: 'English', recognition: ['en-IN', 'en-GB', 'en-US'], synthesis: ['en-IN', 'en-GB', 'en-US'], rupees: 'rupees', minus: 'minus', sample: 'Your cash is safe for the next thirty days.' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', recognition: ['hi-IN'], synthesis: ['hi-IN'], rupees: 'रुपये', minus: 'माइनस', sample: 'अगले तीस दिनों तक आपका नकद सुरक्षित है।' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', recognition: ['ta-IN', 'ta-LK', 'ta-SG'], synthesis: ['ta-IN', 'ta-LK'], rupees: 'ரூபாய்', minus: 'மைனஸ்', sample: 'அடுத்த முப்பது நாட்களுக்கு உங்கள் பணம் பாதுகாப்பாக உள்ளது.' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', recognition: ['te-IN'], synthesis: ['te-IN'], rupees: 'రూపాయలు', minus: 'మైనస్', sample: 'రాబోయే ముప్పై రోజులు మీ నగదు సురక్షితంగా ఉంది.' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', recognition: ['kn-IN'], synthesis: ['kn-IN'], rupees: 'ರೂಪಾಯಿ', minus: 'ಮೈನಸ್', sample: 'ಮುಂದಿನ ಮೂವತ್ತು ದಿನಗಳವರೆಗೆ ನಿಮ್ಮ ನಗದು ಸುರಕ್ಷಿತವಾಗಿದೆ.' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', recognition: ['ml-IN'], synthesis: ['ml-IN'], rupees: 'രൂപ', minus: 'മൈനസ്', sample: 'അടുത്ത മുപ്പത് ദിവസത്തേക്ക് നിങ്ങളുടെ പണം സുരക്ഷിതമാണ്.' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', recognition: ['pa-Guru-IN', 'pa-IN'], synthesis: ['pa-IN', 'pa-Guru-IN'], rupees: 'ਰੁਪਏ', minus: 'ਮਾਈਨਸ', sample: 'ਅਗਲੇ ਤੀਹ ਦਿਨਾਂ ਲਈ ਤੁਹਾਡਾ ਨਕਦ ਸੁਰੱਖਿਅਤ ਹੈ।' },
  { code: 'de', name: 'German', native: 'Deutsch', recognition: ['de-DE', 'de-AT', 'de-CH'], synthesis: ['de-DE', 'de-AT', 'de-CH'], rupees: 'Rupien', minus: 'minus', sample: 'Ihr Bargeld ist für die nächsten dreißig Tage sicher.' },
  { code: 'es', name: 'Spanish', native: 'Español', recognition: ['es-ES', 'es-MX', 'es-US'], synthesis: ['es-ES', 'es-MX', 'es-US'], rupees: 'rupias', minus: 'menos', sample: 'Su efectivo está seguro durante los próximos treinta días.' },
  { code: 'zh', name: 'Chinese', native: '中文', recognition: ['zh-CN', 'cmn-Hans-CN', 'zh-TW'], synthesis: ['zh-CN', 'zh-TW', 'zh-HK'], rupees: '卢比', minus: '负', sample: '未来三十天内，您的现金是安全的。' },
]

export const voiceLanguage = (code: string): VoiceLanguage => VOICE_LANGUAGES.find((l) => l.code === code) ?? VOICE_LANGUAGES[0]

// ---------------------------------------------------------------- support

type RecognitionCtor = new () => any

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export const recognitionSupported = () => recognitionCtor() !== null
export const synthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

// ---------------------------------------------------------------- voices

const norm = (tag: string) => tag.replace('_', '-').toLowerCase()
const primary = (tag: string) => norm(tag).split('-')[0]

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null

/** Voices load asynchronously in Chrome; resolve once they appear (or after a short wait with whatever exists). */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!synthesisSupported()) return Promise.resolve([])
  const now = window.speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      const done = () => { window.speechSynthesis.removeEventListener('voiceschanged', done); resolve(window.speechSynthesis.getVoices()); voicesPromise = null }
      window.speechSynthesis.addEventListener('voiceschanged', done)
      window.setTimeout(done, 1500)
    })
  }
  return voicesPromise
}

export function voicesFor(voices: SpeechSynthesisVoice[], lang: VoiceLang): SpeechSynthesisVoice[] {
  const wanted = voiceLanguage(lang)
  const tags = wanted.synthesis.map(norm)
  return voices
    .filter((v) => primary(v.lang) === lang || tags.includes(norm(v.lang)))
    .sort((a, b) => score(b, tags) - score(a, tags) || a.name.localeCompare(b.name))
}

function score(voice: SpeechSynthesisVoice, tags: string[]): number {
  let s = 0
  const index = tags.indexOf(norm(voice.lang))
  if (index >= 0) s += 40 - index * 5
  if (/natural|neural|online|enhanced|premium/i.test(voice.name)) s += 20
  if (/google|microsoft|apple/i.test(voice.name)) s += 6
  if (voice.default) s += 1
  return s
}

/** The voice to use: the one the person picked if it is still installed, else the best match. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: VoiceLang, preferredURI?: string | null): SpeechSynthesisVoice | null {
  const matches = voicesFor(voices, lang)
  if (preferredURI) {
    const chosen = matches.find((v) => v.voiceURI === preferredURI)
    if (chosen) return chosen
  }
  return matches[0] ?? null
}

// ---------------------------------------------------------------- speaking

/** Make the text sound right when read out: no markdown, no symbols, numbers without grouping commas. */
export function spokenForm(text: string, lang: VoiceLang): string {
  const l = voiceLanguage(lang)
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`#>~|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/−/g, `${l.minus} `)
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/₹\s?(\d+(?:\.\d+)?)/g, `$1 ${l.rupees}`)
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Sentence-sized pieces, each short enough that no engine drops the tail. */
export function chunkText(text: string, max = 170): string[] {
  const sentences = text.match(/[^.!?।。！？]+[.!?।。！？]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text]
  const chunks: string[] = []
  for (const sentence of sentences) {
    if (sentence.length <= max) { chunks.push(sentence); continue }
    let rest = sentence
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(',', max), rest.lastIndexOf(';', max), rest.lastIndexOf('، ', max), rest.lastIndexOf(' ', max), 0) || max
      chunks.push(rest.slice(0, cut + 1).trim())
      rest = rest.slice(cut + 1).trim()
    }
    if (rest) chunks.push(rest)
  }
  // Merge tiny neighbours so the voice does not stutter between two-word pieces.
  const merged: string[] = []
  for (const chunk of chunks) {
    const last = merged.at(-1)
    if (last && last.length + chunk.length < 60) merged[merged.length - 1] = `${last} ${chunk}`
    else merged.push(chunk)
  }
  return merged.filter(Boolean)
}

export interface SpeakOptions {
  lang: VoiceLang
  voiceURI?: string | null
  rate?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

// Held at module level: a utterance that is only referenced by the engine can be garbage collected before it ends.
const live = new Set<SpeechSynthesisUtterance>()
let generation = 0

export function stopSpeaking() {
  generation += 1
  live.clear()
  if (synthesisSupported()) window.speechSynthesis.cancel()
}

export async function speak(text: string, opts: SpeakOptions): Promise<void> {
  if (!synthesisSupported()) { opts.onError?.('This browser cannot read text aloud.'); return }
  stopSpeaking()
  const mine = generation
  const spoken = spokenForm(text, opts.lang)
  if (!spoken) { opts.onEnd?.(); return }
  const voices = await loadVoices()
  if (mine !== generation) return
  const voice = pickVoice(voices, opts.lang, opts.voiceURI)
  const chunks = chunkText(spoken)
  const synth = window.speechSynthesis
  let index = 0
  const next = () => {
    if (mine !== generation) return
    if (index >= chunks.length) { opts.onEnd?.(); return }
    const utterance = new SpeechSynthesisUtterance(chunks[index])
    index += 1
    utterance.lang = voice?.lang ?? voiceLanguage(opts.lang).synthesis[0]
    if (voice) utterance.voice = voice
    utterance.rate = Math.min(1.6, Math.max(0.5, opts.rate ?? 1))
    live.add(utterance)
    utterance.onstart = () => { if (index === 1) opts.onStart?.() }
    utterance.onend = () => { live.delete(utterance); next() }
    utterance.onerror = (event) => {
      live.delete(utterance)
      if (mine !== generation) return
      const reason = (event as SpeechSynthesisErrorEvent).error
      if (reason === 'interrupted' || reason === 'canceled') return
      opts.onError?.(reason === 'not-allowed' ? 'The browser blocked audio. Click anywhere on the page, then try again.' : `Could not read that aloud (${reason ?? 'unknown'}).`)
      opts.onEnd?.()
    }
    synth.speak(utterance)
  }
  // Some engines stay paused after a previous cancel.
  if (synth.paused) synth.resume()
  next()
}

// ---------------------------------------------------------------- listening

export interface ListenHandlers {
  /** Live text while the person is still speaking. */
  onInterim?: (text: string) => void
  /** A finished phrase. */
  onFinal?: (text: string) => void
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string, code: string) => void
}

export interface ListenOptions {
  lang: VoiceLang
  /** Keep listening through pauses (dictation) instead of stopping after one phrase. */
  continuous?: boolean
  /** Stop on its own after this many ms in total. */
  maxMs?: number
}

export interface Listener { stop: () => void; abort: () => void }

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': "Microphone access is blocked. Allow the microphone for this site in the browser's address bar, then try again.",
  'service-not-allowed': 'The browser has speech recognition turned off. Check its privacy settings.',
  'audio-capture': 'No microphone was found. Plug one in or check which input the browser is using.',
  network: 'Speech recognition needs an internet connection: the browser sends your voice to its speech service.',
  'no-speech': 'I did not hear anything. Move closer to the microphone and try again.',
  'language-not-supported': 'This browser cannot listen in that language.',
  'bad-grammar': 'The browser could not process that.',
}

export function listen(opts: ListenOptions, handlers: ListenHandlers): Listener | null {
  const Ctor = recognitionCtor()
  if (!Ctor) { handlers.onError?.('Voice input works in Chrome, Edge and Safari. Type instead in this browser.', 'unsupported'); return null }
  const tags = voiceLanguage(opts.lang).recognition
  let tagIndex = 0
  let stopped = false
  let current: any = null
  let timer: number | undefined

  const finish = () => { window.clearTimeout(timer); handlers.onEnd?.() }

  const begin = () => {
    const recognition = new Ctor()
    current = recognition
    recognition.lang = tags[tagIndex]
    recognition.interimResults = true
    recognition.continuous = !!opts.continuous
    recognition.maxAlternatives = 1
    let failed = false
    recognition.onstart = () => handlers.onStart?.()
    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text: string = result[0]?.transcript ?? ''
        if (result.isFinal) { const clean = text.trim(); if (clean) handlers.onFinal?.(clean) } else interim += text
      }
      handlers.onInterim?.(interim.trim())
    }
    recognition.onerror = (event: any) => {
      const code: string = event.error ?? 'unknown'
      if (code === 'aborted') return
      if (code === 'language-not-supported' && tagIndex < tags.length - 1) { tagIndex += 1; failed = true; return }
      // A pause while dictating is not a failure: keep listening until the person stops it.
      if (code === 'no-speech' && opts.continuous) { failed = true; return }
      failed = true
      stopped = true
      handlers.onError?.(ERROR_TEXT[code] ?? `Voice input stopped (${code}).`, code)
    }
    recognition.onend = () => {
      handlers.onInterim?.('')
      if (stopped) { finish(); return }
      if (failed) { failed = false; try { begin() } catch { finish() } return }
      // Chrome ends a dictation session after a long silence; carry on until the person stops it.
      if (opts.continuous) { try { begin() } catch { finish() } return }
      finish()
    }
    try { recognition.start() } catch { stopped = true; finish() }
  }

  begin()
  if (opts.maxMs) timer = window.setTimeout(() => { stopped = true; try { current?.stop() } catch { /* already stopped */ } }, opts.maxMs)
  return {
    stop: () => { stopped = true; try { current?.stop() } catch { /* already stopped */ } },
    abort: () => { stopped = true; try { current?.abort() } catch { /* already stopped */ } },
  }
}

/** Best-effort: "granted", "denied" or "prompt"; null where the browser will not say. */
export async function microphonePermission(): Promise<'granted' | 'denied' | 'prompt' | null> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state as 'granted' | 'denied' | 'prompt'
  } catch {
    return null
  }
}
