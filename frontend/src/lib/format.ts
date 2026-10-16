/**
 * The only place money is turned into text. The API always sends integer paise
 * (fields ending in _paise); this file divides by 100 exactly once (PRD E-3).
 */
export const MINUS = '−'

let grouping: 'indian' | 'international' = 'indian'
export function setNumberFormat(value: 'indian' | 'international') {
  grouping = value
}

function groupDigits(digits: string): string {
  if (grouping === 'international') return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (digits.length <= 3) return digits
  const head = digits.slice(0, -3)
  const tail = digits.slice(-3)
  return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail
}

/** ₹1,45,000 · −₹1,20,000 · +₹50,000 (sign: true). Paise shown only when present. */
export function rupees(paise: number | null | undefined, opts: { sign?: boolean; hidePaise?: boolean } = {}): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return '·'
  const negative = paise < 0
  const abs = Math.abs(Math.round(paise))
  const whole = Math.floor(abs / 100)
  const fraction = abs % 100
  const body = `₹${groupDigits(String(whole))}${fraction && !opts.hidePaise ? '.' + String(fraction).padStart(2, '0') : ''}`
  if (negative) return MINUS + body
  if (opts.sign && abs > 0) return '+' + body
  return body
}

/** Axis labels only: ₹1.3L, ₹50k, ₹2.4Cr. Full figures go in tables and tooltips. */
export function compact(paise: number): string {
  const value = Math.abs(paise) / 100
  let body: string
  if (value >= 1e7) body = `₹${trim(value / 1e7)}Cr`
  else if (value >= 1e5) body = `₹${trim(value / 1e5)}L`
  else if (value >= 1e3) body = `₹${trim(value / 1e3)}k`
  else body = `₹${Math.round(value)}`
  return paise < 0 ? MINUS + body : body
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

export function percent(share: number | null | undefined): string {
  if (share === null || share === undefined) return '·'
  return `${Math.round(share * 100)}%`
}

const MONTHS: Record<string, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ta: ['ஜன', 'பிப்', 'மார்', 'ஏப்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆக', 'செப்', 'அக்', 'நவ', 'டிச'],
  hi: ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुला', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'],
}
const WEEKDAYS: Record<string, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ta: ['ஞாயி', 'திங்', 'செவ்', 'புத', 'வியா', 'வெள்', 'சனி'],
  hi: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
}
let lang = 'en'
export function setDateLanguage(value: string) {
  lang = MONTHS[value] ? value : 'en'
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toISO(d)
}

export function daysBetween(fromISO: string, toISOValue: string): number {
  return Math.round((parseISO(toISOValue).getTime() - parseISO(fromISO).getTime()) / 86_400_000)
}

/** 17 Nov */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '·'
  const d = parseISO(iso)
  return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]}`
}

/** Tue 17 Nov */
export function dayDate(iso: string | null | undefined): string {
  if (!iso) return '·'
  const d = parseISO(iso)
  return `${WEEKDAYS[lang][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]}`
}

export function weekday(iso: string): string {
  return WEEKDAYS[lang][parseISO(iso).getUTCDay()]
}

/** 20:14:07 from an ISO timestamp, in local time */
export function clock(timestamp: string | null | undefined): string {
  if (!timestamp) return '·'
  const d = new Date(timestamp)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function digits(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '')
}

/** The number wa.me needs (country code first, no plus), or null when it cannot be told. Mirrors services/messages.py whatsapp_number. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const raw = (phone || '').trim()
  let d = digits(raw)
  let international = raw.startsWith('+')
  if (d.startsWith('00')) { d = d.slice(2); international = true }
  if (international) return d.length >= 8 && d.length <= 15 ? d : null
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}` // Indian mobiles start 6 to 9; the rest are landlines
  if (d.length === 11 && /^0[6-9]/.test(d)) return `91${d.slice(1)}`
  if (d.length === 12 && d.startsWith('91')) return d
  return null
}
