import { create } from 'zustand'
import type { VoiceLang } from './voice'

/** Per-device voice choices. Kept in this browser only: voices differ from device to device. */
interface VoicePrefs {
  rate: number
  /** Chosen voice per language, by voiceURI. */
  voices: Partial<Record<VoiceLang, string>>
  /** Send what I said without pressing Send. */
  autoSend: boolean
  /** After Munim speaks, listen again (hands-free). */
  conversation: boolean
  setRate: (rate: number) => void
  setVoice: (lang: VoiceLang, uri: string | null) => void
  setAutoSend: (value: boolean) => void
  setConversation: (value: boolean) => void
}

const KEY = 'ripple.voice.v1'

function load(): Pick<VoicePrefs, 'rate' | 'voices' | 'autoSend' | 'conversation'> {
  const fallback = { rate: 1, voices: {}, autoSend: false, conversation: false }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return fallback
    return {
      rate: typeof raw.rate === 'number' && raw.rate >= 0.5 && raw.rate <= 1.6 ? raw.rate : 1,
      voices: raw.voices && typeof raw.voices === 'object' ? raw.voices : {},
      autoSend: raw.autoSend === true,
      conversation: raw.conversation === true,
    }
  } catch {
    return fallback
  }
}

function save(state: VoicePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ rate: state.rate, voices: state.voices, autoSend: state.autoSend, conversation: state.conversation }))
  } catch { /* private window or blocked storage: the choice just lasts this visit */ }
}

export const useVoicePrefs = create<VoicePrefs>((set, get) => ({
  ...load(),
  setRate: (rate) => { set({ rate }); save(get()) },
  setVoice: (lang, uri) => {
    const voices = { ...get().voices }
    if (uri) voices[lang] = uri
    else delete voices[lang]
    set({ voices }); save(get())
  },
  setAutoSend: (autoSend) => { set({ autoSend }); save(get()) },
  setConversation: (conversation) => { set({ conversation }); save(get()) },
}))
