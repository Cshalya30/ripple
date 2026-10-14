export type PartyKind = 'customer' | 'supplier'

/** A customer (owes you) or a supplier (you owe them). */
export interface Party {
  id: string
  kind: PartyKind
  name: string
  phone: string
  /** Shop / business name and city, e.g. "Saree boutique, Mysuru" */
  details: string
  products: string[]
  quantity: number
  totalAmount: number
  paidAmount: number
  owedAmount: number
  /** ISO date (yyyy-mm-dd). */
  transactionDate: string
  /** ISO date (yyyy-mm-dd). */
  dueDate: string
  /** Marks parties that drive the projected shortfall. */
  causesShortfall?: boolean
}

export type Urgency = 'ok' | 'soon' | 'risk'

/** A dated movement of money used by the forecast. */
export interface Transaction {
  id: string
  partyId?: string
  kind: 'inflow' | 'outflow'
  label: string
  amount: number
  /** Days from today (0 = today) */
  day: number
}

export interface ForecastPoint {
  day: number
  date: string
  label: string
  balance: number
  inflow: number
  outflow: number
  events: string[]
}

export type FixIcon = 'percent' | 'split' | 'calendar' | 'receipt'

export interface FixOption {
  id: string
  title: string
  summary: string
  tag: 'Easiest' | 'Cheapest' | 'Quickest' | 'Last resort'
  icon: FixIcon
  cost: string
  /** Lowest balance in the 90-day window after applying the fix. */
  newLowest: number
  /** Balance per day (index = day) after the fix. */
  afterSeries: number[]
  /** Who the WhatsApp message goes to. */
  recipient: { name: string; phone: string; amount: number }
}

export interface ForecastSummary {
  cashToday: number
  inflows: number
  outflows: number
  net: number
  lowest: { day: number; balance: number; date: string }
  bufferLevel: number
  dipRange: { from: number; to: number }
  firstDipDay: number
}

export interface DipCause {
  id: string
  title: string
  detail: string
  amount: number
  kind: 'inflow' | 'outflow'
  day: number
}

export interface BreakdownItem {
  name: string
  amount: number
}

export type LanguageCode = 'en' | 'hi' | 'te' | 'ta' | 'kn' | 'mr' | 'bn'
export type Tone = 'polite' | 'firm'
