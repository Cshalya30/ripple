import type { ForecastPoint, Transaction } from '../types'
import { BUSINESS, mockParties } from './parties'
import { dateFromDay, shortDate } from '../lib/dates'

export const HORIZON_DAYS = 90

const owed = (id: string) => mockParties.find((p) => p.id === id)?.owedAmount ?? 0
const nameOf = (id: string) => mockParties.find((p) => p.id === id)?.name ?? id

/** Day the forecast expects each payment to actually land (differs from the due date for late payers). */
export const baselineEvents: Transaction[] = [
  { id: 'e-staff-1', kind: 'outflow', label: 'Shop rent and staff', amount: 40000, day: 2 },
  { id: 'e-rajdhani', partyId: 'sup-rajdhani', kind: 'outflow', label: nameOf('sup-rajdhani'), amount: owed('sup-rajdhani'), day: 3 },
  { id: 'e-anand', partyId: 'cus-anand', kind: 'inflow', label: nameOf('cus-anand'), amount: owed('cus-anand'), day: 5 },
  { id: 'e-bhavani', partyId: 'sup-bhavani', kind: 'outflow', label: nameOf('sup-bhavani'), amount: owed('sup-bhavani'), day: 6 },
  { id: 'e-sales-1', kind: 'inflow', label: 'Counter sales', amount: 30000, day: 10 },
  { id: 'e-mehta', partyId: 'cus-mehta', kind: 'inflow', label: nameOf('cus-mehta'), amount: owed('cus-mehta'), day: 14 },
  { id: 'e-gopal', partyId: 'sup-gopal', kind: 'outflow', label: nameOf('sup-gopal'), amount: owed('sup-gopal'), day: 18 },
  { id: 'e-venkat', partyId: 'cus-venkateswara', kind: 'inflow', label: nameOf('cus-venkateswara'), amount: owed('cus-venkateswara'), day: 22 },
  { id: 'e-meenakshi', partyId: 'cus-meenakshi', kind: 'inflow', label: nameOf('cus-meenakshi'), amount: owed('cus-meenakshi'), day: 27 },
  { id: 'e-staff-2', kind: 'outflow', label: 'Shop rent and staff', amount: 40000, day: 32 },
  { id: 'e-sharma', partyId: 'sup-sharma', kind: 'outflow', label: nameOf('sup-sharma'), amount: owed('sup-sharma'), day: 34 },
  { id: 'e-sales-2', kind: 'inflow', label: 'Counter sales', amount: 30000, day: 40 },
  { id: 'e-kaveri', partyId: 'cus-kaveri', kind: 'inflow', label: nameOf('cus-kaveri'), amount: owed('cus-kaveri'), day: 41 },
  { id: 'e-fashion', partyId: 'cus-fashion', kind: 'inflow', label: nameOf('cus-fashion'), amount: owed('cus-fashion'), day: 45 },
  { id: 'e-lakshmi', partyId: 'sup-lakshmi', kind: 'outflow', label: nameOf('sup-lakshmi'), amount: owed('sup-lakshmi'), day: 52 },
  { id: 'e-rohini', partyId: 'cus-rohini', kind: 'inflow', label: nameOf('cus-rohini'), amount: owed('cus-rohini'), day: 58 },
  { id: 'e-staff-3', kind: 'outflow', label: 'Shop rent and staff', amount: 40000, day: 62 },
  { id: 'e-sales-3', kind: 'inflow', label: 'Counter sales', amount: 30000, day: 70 },
  { id: 'e-patel', partyId: 'sup-patel', kind: 'outflow', label: nameOf('sup-patel'), amount: owed('sup-patel'), day: 71 },
  { id: 'e-gupta', partyId: 'cus-gupta', kind: 'inflow', label: nameOf('cus-gupta'), amount: owed('cus-gupta'), day: 74 },
]

/** Run a list of events day by day and return the projected balance. */
export function simulate(events: Transaction[], startCash = BUSINESS.cashToday, days = HORIZON_DAYS): ForecastPoint[] {
  const points: ForecastPoint[] = []
  let balance = startCash
  for (let day = 0; day <= days; day++) {
    const today = events.filter((e) => e.day === day)
    const inflow = today.filter((e) => e.kind === 'inflow').reduce((s, e) => s + e.amount, 0)
    const outflow = today.filter((e) => e.kind === 'outflow').reduce((s, e) => s + e.amount, 0)
    balance += inflow - outflow
    const date = dateFromDay(day)
    points.push({
      day,
      date: date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      label: shortDate(date),
      balance,
      inflow,
      outflow,
      events: today.map((e) => `${e.kind === 'inflow' ? '+' : '\u2212'} ${e.label}`),
    })
  }
  return points
}

export const baselineSeries: ForecastPoint[] = simulate(baselineEvents)
