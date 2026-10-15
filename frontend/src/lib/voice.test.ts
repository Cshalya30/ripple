import { describe, expect, it } from 'vitest'
import { chunkText, pickVoice, spokenForm, voiceLanguage, VOICE_LANGUAGES, voicesFor } from './voice'

const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
  ({ name, lang, voiceURI: name, default: false, localService: true, ...extra }) as SpeechSynthesisVoice

describe('languages', () => {
  it('covers English, Hindi, the four south Indian languages, Punjabi, German, Spanish and Chinese', () => {
    expect(VOICE_LANGUAGES.map((l) => l.code).sort()).toEqual(['de', 'en', 'es', 'hi', 'kn', 'ml', 'pa', 'ta', 'te', 'zh'])
  })
  it('gives every language something to say and at least one tag to listen with', () => {
    for (const l of VOICE_LANGUAGES) {
      expect(l.sample.length).toBeGreaterThan(10)
      expect(l.recognition.length).toBeGreaterThan(0)
      expect(l.synthesis.length).toBeGreaterThan(0)
    }
  })
  it('tries the Gurmukhi tag first for Punjabi listening', () => {
    expect(voiceLanguage('pa').recognition[0]).toBe('pa-Guru-IN')
  })
  it('falls back to English for an unknown code', () => {
    expect(voiceLanguage('xx').code).toBe('en')
  })
})

describe('spokenForm', () => {
  it('reads rupees as words and drops Indian grouping commas', () => {
    expect(spokenForm('Short by ₹1,39,550 on 17 Nov', 'en')).toBe('Short by 139550 rupees on 17 Nov')
    expect(spokenForm('₹50,000', 'hi')).toBe('50000 रुपये')
  })
  it('leaves the full stop after an amount as a full stop', () => {
    expect(spokenForm('You owe ₹1,25,000. Pay soon.', 'en')).toBe('You owe 125000 rupees. Pay soon.')
    expect(spokenForm('Fee is ₹1,250.50 today', 'en')).toBe('Fee is 1250.50 rupees today')
  })
  it('says minus for the true minus sign', () => {
    expect(spokenForm('Lowest −₹1,39,550', 'en')).toBe('Lowest minus 139550 rupees')
  })
  it('strips markdown, links and emoji', () => {
    expect(spokenForm('**Cash** is `ok` 👍 see https://x.test/a', 'en')).toBe('Cash is ok see')
    expect(spokenForm('- one\n- two', 'en')).toBe('one. two')
  })
})

describe('chunkText', () => {
  it('splits on sentences in several scripts and keeps every word', () => {
    const text = 'Cash is low on day 34. Chase Kaveri Boutique first! Then pay Sharma Yarn Mills.'
    expect(chunkText(text, 40).join(' ')).toBe(text)
    const hindi = 'पहला वाक्य बहुत लंबा है और बहुत सारी बातें कहता है। दूसरा वाक्य भी उतना ही लंबा है और कुछ और बताता है।'
    expect(chunkText(hindi, 170).length).toBe(2)
    const chinese = '未来三十天内您的现金是安全的而且没有任何一天会出现缺口请放心。' + '但是下个月初需要提前准备供应商的付款以免影响正常生产计划。'
    expect(chunkText(chinese, 170).length).toBe(2)
  })
  it('never returns a piece over the limit when the text has spaces', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    for (const piece of chunkText(long, 100)) expect(piece.length).toBeLessThanOrEqual(110)
  })
  it('merges tiny neighbours', () => {
    expect(chunkText('Yes. No. Ok.', 170)).toEqual(['Yes. No. Ok.'])
  })
})

describe('pickVoice', () => {
  const voices = [voice('Basic', 'en-US'), voice('Google UK English Female', 'en-GB'), voice('Microsoft Neerja Online (Natural) - English (India)', 'en-IN'), voice('Lekha', 'hi-IN'), voice('Ravi', 'te-IN')]
  it('prefers a natural voice for the exact regional tag', () => {
    expect(pickVoice(voices, 'en')?.name).toContain('Neerja')
  })
  it('returns null when the language has no voice installed', () => {
    expect(pickVoice(voices, 'ml')).toBeNull()
    expect(voicesFor(voices, 'kn')).toEqual([])
  })
  it('honours the saved choice while it is still installed, and ignores it once it is gone', () => {
    expect(pickVoice(voices, 'en', 'Basic')?.name).toBe('Basic')
    expect(pickVoice(voices, 'en', 'Removed voice')?.name).toContain('Neerja')
  })
  it('matches on the language part so es-MX serves Spanish', () => {
    expect(pickVoice([voice('Paulina', 'es_MX')], 'es')?.name).toBe('Paulina')
  })
})
