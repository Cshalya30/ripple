export type Role = 'OWNER' | 'ACCOUNTANT' | 'SUPERVISOR'
export type Lang = 'en' | 'ta' | 'hi'
export type Theme = 'night' | 'day' | 'lamp'

export interface Prefs {
  language_ui: Lang
  language_assistant: Lang
  language_messages: Lang
  theme: Theme
  text_size: 'S' | 'M' | 'L' | 'XL'
  density: 'auto' | 'simple' | 'instrument'
  number_format: 'indian' | 'international'
  reduce_motion: boolean
  high_contrast: boolean
  read_aloud: boolean
  large_targets: boolean
}

export interface Me {
  user: { id: string; email: string; name: string; role: Role }
  prefs: Prefs
  business: {
    name: string
    owner_name: string | null
    udyam_number: string | null
    msme_category: string | null
    safety_buffer_paise: number | null
    horizon_days: number
    is_sandbox: boolean
    gstin: string | null
  }
  today: string
  demo_accounts: { email: string; role: Role }[]
}

export interface RunMeta {
  run_id: string
  created_at: string
  engine_version: string
  schema_version: string
  event_count: number
  snapshot_hash: string
  duration_ms: number | null
  as_of: string
  data_version: number
  warnings: string[]
}

export interface SeriesPoint {
  day: number
  date: string
  cash_paise: number
  unpaid_dues_paise: number
  net_paise: number
}

export interface Blocker {
  event_id: string
  required_paise: number
  available_paise: number
  shortfall_paise: number
}

export interface Summary {
  opening_cash_paise: number
  closing_cash_paise: number
  buffer_paise: number
  horizon_days: number
  runway_days: number | null
  first_shortfall: { day: number; date: string; net_paise: number; shortfall_paise: number; blockers: Blocker[] } | null
  buffer_breach: { day: number; date: string; net_paise: number } | null
  lowest: { day: number; date: string; net_paise: number } | null
  missed_commitment_count: number
  unresolved_order_count: number
  late_orders: { order_id: string; lateness_days: number | null; delivery_date: string | null; promised_date: string; status: string }[]
}

export interface Position {
  cash_now_paise: number
  to_receive_paise: number
  to_pay_paise: number
  net_paise: number
  customers_owing: number
  suppliers_owed: number
  materials_on_the_way: { count: number; value_paise: number }
  goods_to_deliver: { count: number; value_paise: number }
  pending_cheques: { count: number; value_paise: number }
}

export interface Wait {
  code: string
  from_day: number
  to_day: number
  first_details: Record<string, any>
  details: Record<string, any>
  max_shortfall_paise?: number
}

export type EventState = 'EXECUTED' | 'BLOCKED' | 'WAITING' | 'LATER'

export interface EngineEvent {
  id: string
  type: string
  group: 'BRING_IN' | 'MOVE_GOODS' | 'PAY_OUT'
  label: string
  detail: string
  lane: string
  party_id: string | null
  party_name: string | null
  order_id: string | null
  record_type: string | null
  record_id: string | null
  amount_paise: number | null
  direction: 'IN' | 'OUT' | 'NONE'
  quantity: number | null
  material_id: string | null
  materials: { material_id: string; quantity: number }[] | null
  earliest_date: string | null
  earliest_day: number | null
  due_date: string | null
  due_day: number | null
  executed_date: string | null
  executed_day: number | null
  state: EventState
  status: string
  lateness_days: number | null
  waited_from_day: number | null
  waits: Wait[]
  depends_on: { event_id: string; lag_days: number }[]
  unblocks: { event_id: string; lag_days: number }[]
  assumptions: string[]
  x_day: number
  row: number
}

export interface Lane {
  id: string
  label: string
  kind: string
}

export interface StockSeries {
  material_id: string
  name: string
  unit: string
  base_unit: string
  unit_factor: number
  sku: string
  series: number[]
}

export interface RunPayload {
  run_id: string
  created_at: string
  as_of: string
  data_version: number
  snapshot_hash: string
  schema_version: string
  engine_version: string
  event_count: number
  duration_ms: number | null
  horizon_days: number
  scheduling_policy: string
  series: SeriesPoint[]
  summary: Summary
  events: EngineEvent[]
  lanes: Lane[]
  stock: StockSeries[]
  orders: { order_id: string; promised_delivery_date: string; delivery_date: string | null; delivery_lateness_days: number | null; status: string }[]
  assumptions: string[]
  warnings: string[]
  facilities: { id: string; label: string }[]
}

export interface DecisionRow {
  seq: number
  event_id: string
  type: string
  group: 'BRING_IN' | 'MOVE_GOODS' | 'PAY_OUT'
  label: string
  party_name: string | null
  amount_paise: number | null
  direction: string | null
  sort_key: (number | string | null)[]
  outcome: 'EXECUTED' | 'BLOCKED' | 'NOT_ELIGIBLE'
  cash_before_paise: number
  cash_after_paise: number
  reasons: { code: string; details: Record<string, any> }[]
}

export interface DayLog {
  day: number
  date: string
  opening_cash_paise: number
  closing_cash_paise: number
  net_paise: number
  rows: DecisionRow[]
  source: string
  policy: string
}

export interface NetworkParty {
  id: string
  kind: 'SUPPLIER' | 'CUSTOMER'
  name: string
  city: string | null
  tags: string[]
  outstanding_paise: number
  exposure_bp: number
  oldest_due: string | null
  days_overdue: number
  blocked: boolean
  late_orders: { order_id: string; lateness_days: number }[]
  next_event: { id: string; label: string; executed_date: string | null; due_date: string | null; amount_paise: number | null; state: EventState; lateness_days: number | null } | null
  event_ids: string[]
  risk: { n: number; p50_days: number | null; p90_days: number | null; no_history: boolean } | null
}

export interface Network {
  parties: NetworkParty[]
  position: Position
  summary: Summary
}

export interface ChanceAfter {
  status: string
  shortfall_chance?: Record<string, number>
  n_samples?: number
}

export interface Fix {
  id: string
  kind: string
  title: string
  summary?: string
  party_id: string | null
  party_name: string | null
  cost_paise: number | null
  cost_label?: string
  params: Record<string, any>
  message: { intent: string; party_id: string } | null
}

export interface Evaluation {
  fix: Fix
  scenario: any
  snapshot_edits: string[]
  dip_after_paise: number | null
  dip_after_day: number | null
  dip_before_paise: number | null
  runway_after_days: number | null
  first_shortfall_after: Summary['first_shortfall']
  buffer_breach_after: Summary['buffer_breach']
  missed_commitments_delta: number
  late_orders_after: Summary['late_orders']
  changed_events: { event_id: string; baseline_date: string | null; scenario_date: string | null; delta_days: number | null; new: boolean; status: string }[]
  removed_events: string[]
  series?: SeriesPoint[]
  assumptions: string[]
  chance_after?: ChanceAfter
}

export interface RiskDriver {
  party_id: string
  name: string
  share: number
  reduction_paise: number
  no_history: boolean
}

export interface Risk {
  status: 'READY' | 'COMPUTING' | 'UNAVAILABLE' | 'INSUFFICIENT_HISTORY' | 'MISSING'
  snapshot_hash?: string
  payments_used?: number
  customers_with_history?: number
  customers_without_history?: string[]
  shortfall_chance?: Record<string, number>
  buffer_chance?: Record<string, number>
  first_shortfall?: { p10: { day: number; date: string } | null; p50: { day: number; date: string } | null; p90: { day: number; date: string } | null; samples_with_shortfall: number }
  expected_shortfall_paise?: number | null
  fan?: { day: number; date: string; p10_paise: number; p50_paise: number; p90_paise: number }[]
  drivers?: RiskDriver[]
  n_samples?: number
  m_samples?: number
  computed_at?: string
  method?: string
  seed?: number
}

export interface DipItem {
  kind: 'BLOCKED_PAYMENT' | 'LATE_RECEIPT' | 'RECENT_OUTFLOW'
  event_id: string
  title: string
  label: string
  amount_paise: number | null
  day: number
  party_id: string | null
  shortfall_paise?: number
  executed_day?: number | null
  lateness_days?: number | null
  days_overdue?: number
  days_before?: number
}

export interface PartyRow {
  id: string
  kind: 'SUPPLIER' | 'CUSTOMER'
  name: string
  city: string | null
  description: string | null
  phone: string | null
  tags: string[]
  terms_type: string
  terms_days: number
  lead_time_days: number
  msme_category: string | null
  udyam_number: string | null
  outstanding_paise: number
  exposure_bp: number
  oldest_due: string | null
  days_overdue: number
  open_items: number
  risk_share: number | null
  n_payments?: number
  on_time_share?: number | null
  avg_delay_days?: number | null
  last6?: number[]
  p50_days?: number | null
  p90_days?: number | null
  msme_clock_days_left?: number
  next_due?: { date: string; amount_paise: number; invoice: string } | null
}

export interface OpenItem {
  id: string
  number: string
  description: string | null
  amount_paise: number
  invoice_date: string
  due_date: string
  promised_date: string | null
  days_overdue: number
  kind: 'RECEIVABLE' | 'PAYABLE'
}
