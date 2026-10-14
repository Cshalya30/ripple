import type { BreakdownItem, DipCause, FixOption, ForecastPoint, ForecastSummary } from '../types'
import { baselineEvents, baselineSeries, HORIZON_DAYS } from '../data/forecast'
import { fixOptions } from '../data/fixes'
import { BUSINESS, mockParties } from '../data/parties'
import { formatCompact } from '../lib/format'
import { shortDate } from '../lib/dates'
import { api, warnFallback } from './api'

const tick = <T,>(value: T, ms = 120): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

export interface ForecastBundle {
  series: ForecastPoint[]
  summary: ForecastSummary
  causes: DipCause[]
  receivables: BreakdownItem[]
  payables: BreakdownItem[]
}

// ── backend shapes ───────────────────────────────────────────────────────

interface ApiPoint {
  day: number
  date: string // ISO yyyy-mm-dd
  balance: number
  inflow: number
  outflow: number
  events: { kind: 'inflow' | 'outflow'; label: string }[]
}

interface ApiForecast {
  series: ApiPoint[]
  summary: Omit<ForecastSummary, 'lowest'> & { lowest: { day: number; balance: number; date: string } }
  causes: DipCause[]
  receivables: BreakdownItem[]
  payables: BreakdownItem[]
}

function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function toPoint(p: ApiPoint): ForecastPoint {
  const date = localDate(p.date)
  return {
    day: p.day,
    date: date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
    label: shortDate(date),
    balance: p.balance,
    inflow: p.inflow,
    outflow: p.outflow,
    events: p.events.map((e) => `${e.kind === 'inflow' ? '+' : '−'} ${e.label}`),
  }
}

// ── public API (same signatures as before) ───────────────────────────────

export async function getForecast(): Promise<ForecastBundle> {
  try {
    const data = await api<ApiForecast>('/api/forecast')
    const series = data.series.map(toPoint)
    const lowest = series[data.summary.lowest.day] ?? series[0]
    return {
      series,
      summary: { ...data.summary, lowest: { ...data.summary.lowest, date: lowest.date } },
      causes: data.causes,
      receivables: data.receivables,
      payables: data.payables,
    }
  } catch (err) {
    warnFallback('getForecast', err)
    return mockForecast()
  }
}

export async function getFixOptions(): Promise<FixOption[]> {
  try {
    return await api<FixOption[]>('/api/fixes')
  } catch (err) {
    warnFallback('getFixOptions', err)
    return tick(fixOptions)
  }
}

// ── offline fallback (the original sample data) ──────────────────────────

function summarise(series: ForecastPoint[]): ForecastSummary {
  const inflows = baselineEvents.filter((e) => e.kind === 'inflow').reduce((s, e) => s + e.amount, 0)
  const outflows = baselineEvents.filter((e) => e.kind === 'outflow').reduce((s, e) => s + e.amount, 0)
  const lowestPoint = series.reduce((min, p) => (p.balance < min.balance ? p : min), series[0])
  const buffer = BUSINESS.safetyBuffer
  let from = lowestPoint.day
  let to = lowestPoint.day
  while (from > 0 && series[from - 1].balance < buffer) from--
  while (to < series.length - 1 && series[to + 1].balance < buffer) to++
  const firstDip = series.find((p) => p.balance < buffer)
  return {
    cashToday: BUSINESS.cashToday,
    inflows,
    outflows,
    net: inflows - outflows,
    lowest: { day: lowestPoint.day, balance: lowestPoint.balance, date: lowestPoint.date },
    bufferLevel: buffer,
    dipRange: { from, to },
    firstDipDay: firstDip?.day ?? HORIZON_DAYS,
  }
}

function group(kind: 'inflow' | 'outflow'): BreakdownItem[] {
  const map = new Map<string, number>()
  baselineEvents
    .filter((e) => e.kind === kind)
    .forEach((e) => map.set(e.label, (map.get(e.label) ?? 0) + e.amount))
  return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
}

function mockForecast(): Promise<ForecastBundle> {
  const sharma = mockParties.find((p) => p.id === 'sup-sharma')!
  const kaveri = mockParties.find((p) => p.id === 'cus-kaveri')!
  const staff = baselineEvents.find((e) => e.id === 'e-staff-2')!
  const causes: DipCause[] = [
    {
      id: 'c-sharma',
      kind: 'outflow',
      title: `${sharma.name} is due on Day 34`,
      detail: `${formatCompact(sharma.owedAmount)} goes out in one payment, the largest bill of the quarter.`,
      amount: sharma.owedAmount,
      day: 34,
    },
    {
      id: 'c-kaveri',
      kind: 'inflow',
      title: `${kaveri.name} has not paid`,
      detail: `${formatCompact(kaveri.owedAmount)} is 12 days overdue. The forecast expects it on Day 41, a week after Sharma needs paying.`,
      amount: kaveri.owedAmount,
      day: 41,
    },
    {
      id: 'c-staff',
      kind: 'outflow',
      title: 'Shop rent and staff land on Day 32',
      detail: `${formatCompact(staff.amount)} leaves two days before the Sharma payment, which removes your cushion.`,
      amount: staff.amount,
      day: 32,
    },
  ]
  return tick({
    series: baselineSeries,
    summary: summarise(baselineSeries),
    causes,
    receivables: group('inflow'),
    payables: group('outflow'),
  })
}
