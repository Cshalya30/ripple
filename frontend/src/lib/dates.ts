export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isoFromOffset(days: number): string {
  return toISO(addDays(startOfToday(), days))
}

/** Whole days from today to an ISO date (negative = past). */
export function daysFromToday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(y, (m ?? 1) - 1, d ?? 1)
  return Math.round((target.getTime() - startOfToday().getTime()) / 86_400_000)
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function shortISODate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dateFromDay(day: number): Date {
  return addDays(startOfToday(), day)
}
