import type { BreakdownItem, DipCause, FixOption, ForecastPoint, ForecastSummary } from '../types'
import { baselineEvents, baselineSeries, HORIZON_DAYS } from '../data/forecast'
import { fixOptions } from '../data/fixes'
import { BUSINESS, mockParties } from '../data/parties'
import { formatCompact } from '../lib/format'

const tick = <T,>(value: T, ms = 120): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

export interface ForecastBundle {
  series: ForecastPoint[]
  summary: ForecastSummary
  causes: DipCause[]
  receivables: BreakdownItem[]
  payables: BreakdownItem[]
}

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

export async function getForecast(): Promise<ForecastBundle> {
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

export async function getFixOptions(): Promise<FixOption[]> {
  return tick(fixOptions)
}
