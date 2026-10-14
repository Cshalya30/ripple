const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const MINUS = '\u2212'

/** ₹1,25,000 (negative: −₹1,25,000) */
export function formatINR(value: number, opts: { sign?: boolean } = {}): string {
  const rounded = Math.round(value)
  const abs = inr.format(Math.abs(rounded))
  if (rounded < 0) return `${MINUS}${abs}`
  if (opts.sign && rounded > 0) return `+${abs}`
  return abs
}

/** ₹1.2L, ₹38K, ₹2.4Cr */
export function formatCompact(value: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(value)
  let body: string
  if (abs >= 1e7) body = `₹${trim(abs / 1e7)}Cr`
  else if (abs >= 1e5) body = `₹${trim(abs / 1e5)}L`
  else if (abs >= 1e3) body = `₹${trim(abs / 1e3)}K`
  else body = `₹${Math.round(abs)}`
  if (value < 0) return `${MINUS}${body}`
  if (opts.sign && value > 0) return `+${body}`
  return body
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

export function pluralDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

/** "in 4 days", "today", "12 days overdue" */
export function relativeDue(daysFromToday: number): string {
  if (daysFromToday < 0) return `${pluralDays(Math.abs(daysFromToday))} overdue`
  if (daysFromToday === 0) return 'today'
  return `in ${pluralDays(daysFromToday)}`
}

export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '')
}
