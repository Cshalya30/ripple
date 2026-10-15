import type { Risk } from '../lib/types'

export type Level = 'ok' | 'watch' | 'act'

export interface Verdict { level: Level; headline: string; reasons: string[] }

export interface Signal { id: string; severity: 'out' | 'attention' | 'ok'; title: string; detail: string; link: string; metric: string | null }

export interface LadderRow { days: number; plan_paise: number; cautious_paise: number | null; binding_day: number; binding_date: string }

export interface PaymentRow {
  event_id: string; party_id: string | null; party_name: string; label: string; detail: string | null; amount_paise: number
  due_date: string; due_day: number; executed_date: string | null; verdict: 'OK' | 'TIGHT' | 'LATE' | 'BLOCKED'; message: string
  headroom_paise: number; invoice_id: string | null
}

export interface Flag {
  key: string; rule: string; rule_label: string; severity: 'high' | 'medium' | 'low'; confidence: string; title: string; detail: string
  party_id?: string; party_name?: string; amount_paise?: number; date?: string; txn_id?: string; invoice_id?: string; link: string; status: 'OPEN' | 'CONFIRMED'
}

export interface RuleStat { rule: string; label: string; confirmed: number; dismissed: number; missed: number; precision: number | null; sensitivity: string | null }

export interface Check { id: string; title: string; ok: boolean; count: number; detail: string }

export interface Opportunity {
  id: string; kind: 'CAPITAL' | 'RESOURCE'; title: string; detail: string; amount_paise: number; gain_paise: number | null; days: number | null
  link: string | null; cta: string | null
}

export interface Path { net: number[]; short: number | null }

export interface Guard {
  as_of: string
  run_id: string
  buffer_paise: number
  verdict: Verdict
  risk: {
    status: Risk['status']
    shortfall_chance: Record<string, number> | null
    first_shortfall: Risk['first_shortfall'] | null
    expected_shortfall_paise: number | null
    drivers: NonNullable<Risk['drivers']>
    paths: Path[] | null
    path_days: number[] | null
    fan: NonNullable<Risk['fan']> | null
    n_samples: number | null
    payments_used?: number
    customers_with_history?: number
    customers_without_history: string[]
    series: { day: number; net_paise: number }[]
    ladder: LadderRow[]
    payments: PaymentRow[]
    signals: Signal[]
  }
  finance: {
    flags: { open: Flag[]; open_count: number; confirmed: Flag[]; rules: RuleStat[]; scanned: { payments: number; bills: number; rules: number } }
    checks: Check[]
    checks_passed: number
    activity: { at: string; kind: string; direction: 'IN' | 'OUT' | null; amount_paise: number | null; text: string }[]
    opportunities: { yield_bp: number; items: Opportunity[]; reason_none: string | null; note: string }
  }
  calibration: { status: 'READY' | 'TOO_FEW'; tested: number; hits?: number; coverage?: number; target?: number; median_error_days?: number; message: string }
}

export interface GuardBrief {
  verdict: Verdict
  safe_30: { plan_paise: number; cautious_paise: number | null } | null
  flags_open: number
  checks_passed: number
  checks_total: number
}

export interface OptionRow {
  id: string; title: string; summary: string; request: Record<string, unknown> | null
  verdict: 'SAFE' | 'TIGHT' | 'SHORTFALL' | 'ERROR'
  near_low_paise?: number; near_low_day?: number; near_low_date?: string; near_change_paise?: number
  lowest_paise?: number; lowest_day?: number; lowest_change_paise?: number
  first_shortfall?: { day: number; date: string; shortfall_paise: number } | null; shortfall_unchanged?: boolean; late_orders?: number; error?: string
}

export interface PaymentCheckResult {
  subject: string; options: OptionRow[]; best: string | null; recommendation: string | null; buffer_paise: number; window_days: number
}
