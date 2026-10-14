import { fallbackReply, matchReply, type AssistantAction, type CannedReply } from '../data/assistant'
import { api, ApiError, warnFallback } from './api'

/**
 * Ask Ripple. Navigation requests ("take me to the forecast") are answered
 * instantly from the built-in phrases. Everything else goes to the backend,
 * where Gemini answers from the live forecast for this workspace. If the
 * backend or Gemini is unavailable, the built-in keyword replies are used.
 */

interface ApiReply {
  en: string
  hi: string
  route: string | null
}

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Open engine',
  '/forecast': 'Open forecast',
  '/khata': 'Open khata',
}

const history: { role: 'user' | 'assistant'; content: string }[] = []
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Send a voice recording to the backend's local Whisper model. Returns the transcript. */
export async function transcribeAudio(audio: Blob): Promise<string> {
  const ext = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : audio.type.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', audio, `voice.${ext}`)
  const res = await api<{ transcript: string; language: string | null }>('/api/assistant/transcribe', { method: 'POST', body: form }, 60_000)
  return res.transcript
}

export async function getReply(input: string): Promise<CannedReply> {
  const canned = matchReply(input)
  if (canned.autoRoute) {
    await delay(600)
    return canned
  }
  try {
    const reply = await api<ApiReply>(
      '/api/assistant/chat',
      { method: 'POST', body: JSON.stringify({ message: input.slice(0, 1000), history: history.slice(-10) }) },
      25_000,
    )
    history.push({ role: 'user', content: input.slice(0, 1000) }, { role: 'assistant', content: reply.en.slice(0, 2000) })
    let actions: AssistantAction[] | undefined = canned !== fallbackReply ? canned.actions : undefined
    if (!actions && reply.route && ROUTE_LABELS[reply.route]) actions = [{ label: ROUTE_LABELS[reply.route], route: reply.route }]
    return { keywords: [], en: reply.en, hi: reply.hi || reply.en, actions }
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'RATE_LIMITED')) warnFallback('getReply', err)
    await delay(400)
    return canned
  }
}
