import type { FixOption, Transaction } from '../types'
import { baselineEvents, simulate } from './forecast'
import { mockParties } from './parties'
import { formatINR } from '../lib/format'

const find = (id: string) => mockParties.find((p) => p.id === id)!
const kaveri = find('cus-kaveri')
const sharma = find('sup-sharma')

const without = (ids: string[]): Transaction[] => baselineEvents.filter((e) => !ids.includes(e.id))
const lowest = (series: number[]) => Math.min(...series)

// 1. Kaveri pays early with a 2% discount
const earlyAmount = Math.round(kaveri.owedAmount * 0.98)
const earlySeries = simulate([
  ...without(['e-kaveri']),
  { id: 'fix-early', kind: 'inflow', label: 'Kaveri Boutique (early, 2% off)', amount: earlyAmount, day: 30 },
]).map((p) => p.balance)

// 2. Pay Sharma in two parts: half on the due date, half after Fashion Junction pays
const half = Math.round(sharma.owedAmount / 2)
const splitSeries = simulate([
  ...without(['e-sharma']),
  { id: 'fix-split-1', kind: 'outflow', label: 'Sharma Yarn Mills (part 1)', amount: half, day: 34 },
  { id: 'fix-split-2', kind: 'outflow', label: 'Sharma Yarn Mills (part 2)', amount: sharma.owedAmount - half, day: 48 },
]).map((p) => p.balance)

// 3. Sharma gives a 10-day extension
const extendSeries = simulate([
  ...without(['e-sharma']),
  { id: 'fix-extend', kind: 'outflow', label: 'Sharma Yarn Mills (extended)', amount: sharma.owedAmount, day: 44 },
]).map((p) => p.balance)

// 4. Finance Kaveri's invoice at 92% advance
const financedAmount = Math.round(kaveri.owedAmount * 0.92)
const financeSeries = simulate([
  ...without(['e-kaveri']),
  { id: 'fix-finance', kind: 'inflow', label: 'Invoice financing advance', amount: financedAmount, day: 28 },
]).map((p) => p.balance)

export const fixOptions: FixOption[] = [
  {
    id: 'early-payment',
    title: 'Ask Kaveri Boutique to pay early for 2% off',
    summary: 'Offer a small discount if the pending bill is cleared by Day 30.',
    tag: 'Easiest',
    icon: 'percent',
    cost: `${formatINR(kaveri.owedAmount - earlyAmount)} discount`,
    newLowest: lowest(earlySeries),
    afterSeries: earlySeries,
    recipient: { name: kaveri.name, phone: kaveri.phone, amount: kaveri.owedAmount },
  },
  {
    id: 'split-payment',
    title: 'Pay Sharma Yarn Mills in two parts',
    summary: 'Pay half on the due date and the rest after Fashion Junction pays.',
    tag: 'Cheapest',
    icon: 'split',
    cost: 'No cost',
    newLowest: lowest(splitSeries),
    afterSeries: splitSeries,
    recipient: { name: sharma.name, phone: sharma.phone, amount: sharma.owedAmount },
  },
  {
    id: 'extension',
    title: 'Request a 10-day extension from Sharma Yarn Mills',
    summary: 'Move the payment to Day 44, just after Kaveri Boutique settles.',
    tag: 'Quickest',
    icon: 'calendar',
    cost: 'No cost',
    newLowest: lowest(extendSeries),
    afterSeries: extendSeries,
    recipient: { name: sharma.name, phone: sharma.phone, amount: sharma.owedAmount },
  },
  {
    id: 'invoice-financing',
    title: 'Get the Kaveri Boutique invoice financed',
    summary: 'Receive 92% of the pending bill from a finance partner by Day 28.',
    tag: 'Last resort',
    icon: 'receipt',
    cost: `${formatINR(kaveri.owedAmount - financedAmount)} fee`,
    newLowest: lowest(financeSeries),
    afterSeries: financeSeries,
    recipient: { name: 'BillBridge Finance', phone: '+91 98000 00301', amount: kaveri.owedAmount },
  },
]
