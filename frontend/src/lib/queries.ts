import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Guard, GuardBrief } from '../guard/types'
import type {
  DayLog, DipItem, Evaluation, Me, Network, OpenItem, PartyRow, Position, Risk, RunMeta, RunPayload, SeriesPoint, Summary,
} from './types'

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me'), retry: false, staleTime: 60_000 })

export interface TodayData {
  date: string
  horizon_days: number
  headline: {
    variant: 'SAFE' | 'BUFFER_BREACH' | 'SHORTFALL' | 'SHORTFALL_THIS_WEEK'
    week_covered: boolean
    first_shortfall: Summary['first_shortfall']
    buffer_breach: Summary['buffer_breach']
    buffer_paise: number
    rescue: { party_name: string; amount_paise: number; party_id: string } | null
    horizon_days: number
  }
  position: Position
  summary: Summary
  do_today: any[]
  week: { day: number; date: string; in_paise: number; out_paise: number; in_items: any[]; out_items: any[]; blocked_items: any[] }[]
  changes: null | {
    since: string; runway_before: number | null; runway_after: number | null; lowest_before_paise: number | null; lowest_after_paise: number | null
    transactions: { party_name: string | null; direction: string; amount_paise: number; medium: string; reference: string | null; status: string }[]
  }
  risk: { status: string; shortfall_chance?: Record<string, number>; drivers?: any[]; n_samples?: number }
  guard: GuardBrief
  run: RunMeta
}

export const useToday = () => useQuery({ queryKey: ['today'], queryFn: () => api.get<TodayData>('/today') })

export const useAlerts = (enabled = true) =>
  useQuery({ queryKey: ['alerts'], queryFn: () => api.get<{ alerts: any[]; count: number }>('/alerts'), enabled, refetchInterval: 60_000 })

export const useBook = () =>
  useQuery({ queryKey: ['book'], queryFn: () => api.get<{ position: Position; series: SeriesPoint[]; summary: Summary; why: DipItem[]; run: RunMeta }>('/book/summary') })

export const useRun = (scenarioKey?: string | null) =>
  useQuery({
    queryKey: ['run', scenarioKey ?? 'baseline'],
    queryFn: () => api.get<RunPayload>(`/engine/run${scenarioKey ? `?scenario=${encodeURIComponent(scenarioKey)}` : ''}`),
  })

export const useNetwork = () => useQuery({ queryKey: ['network'], queryFn: () => api.get<Network>('/engine/graph?view=network') })

export const useDayLog = (day: number, scenarioKey?: string | null) =>
  useQuery({
    queryKey: ['day', day, scenarioKey ?? 'baseline'],
    queryFn: () => api.get<DayLog>(`/engine/day/${day}${scenarioKey ? `?scenario=${encodeURIComponent(scenarioKey)}` : ''}`),
    placeholderData: (previous) => previous,
  })

function pollWhileComputing(data: { status?: string } | undefined) {
  return data && (data.status === 'COMPUTING' || data.status === 'MISSING') ? 1500 : false
}

export const useRisk = () =>
  useQuery({ queryKey: ['risk'], queryFn: () => api.get<Risk>('/risk/forecast'), refetchInterval: (q) => pollWhileComputing(q.state.data) })

export const useGuard = (yieldBp: number) =>
  useQuery({
    queryKey: ['guard', yieldBp],
    queryFn: () => api.get<Guard>(`/guard?yield_bp=${yieldBp}`),
    placeholderData: (previous) => previous,
    refetchInterval: (q) => (q.state.data && q.state.data.risk.status !== 'READY' && q.state.data.risk.status !== 'INSUFFICIENT_HISTORY' ? 1500 : false),
  })

export const useFixes = () =>
  useQuery({
    queryKey: ['fixes'],
    queryFn: () => api.get<{ fixes: Evaluation[]; run: RunMeta; baseline_risk: any }>('/fixes'),
    refetchInterval: (q) => (q.state.data?.fixes.some((f) => f.chance_after?.status === 'COMPUTING' || f.chance_after?.status === 'MISSING') ? 2000 : false),
  })

export const useParties = (kind: 'CUSTOMER' | 'SUPPLIER', enabled = true) =>
  useQuery({ queryKey: ['parties', kind], queryFn: () => api.get<{ parties: PartyRow[]; total_outstanding_paise: number }>(`/parties?kind=${kind}`), enabled })

export interface PartyDetail {
  party: PartyRow & { gstin: string | null; since: string | null; notes: { text: string; by: string; date: string }[] }
  billed_paise: number
  open_items: OpenItem[]
  history: { id: string; date: string; direction: string; amount_paise: number; medium: string; reference: string | null; invoice: string | null; days_late: number | null; status: string }[]
  forecast: { id: string; label: string; executed_date: string | null; due_date: string | null; amount_paise: number | null; state: string; lateness_days: number | null; direction: string }[]
  risk_model: { k: number; pool_size: number } | null
}

export const useParty = (id: string | null) =>
  useQuery({ queryKey: ['party', id], queryFn: () => api.get<PartyDetail>(`/parties/${encodeURIComponent(id!)}`), enabled: !!id })

export interface TxnRow {
  id: string; date: string; party_id: string | null; party_name: string | null; details: string | null; medium: string
  reference: string | null; direction: 'IN' | 'OUT'; amount_paise: number; balance_paise: number; status: string; invoice_number: string | null
}

export const useTransactions = (filters: { party?: string; medium?: string; direction?: string }) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => v && params.set(k, v))
  return useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => api.get<{ rows: TxnRow[]; count: number; totals: { in_paise: number; out_paise: number }; opening_balance_paise: number }>(`/transactions?${params}`),
  })
}

export const useSalesOrders = () => useQuery({ queryKey: ['sales-orders'], queryFn: () => api.get<{ orders: any[]; run?: RunMeta }>('/sales-orders') })
export const usePurchaseOrders = () => useQuery({ queryKey: ['purchase-orders'], queryFn: () => api.get<{ orders: any[] }>('/purchase-orders') })
export const useInventory = () => useQuery({ queryKey: ['inventory'], queryFn: () => api.get<any>('/inventory') })
export const useMovements = (enabled: boolean) => useQuery({ queryKey: ['movements'], queryFn: () => api.get<{ movements: any[] }>('/stock-movements'), enabled })
export const useSettings = (enabled = true) => useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/settings'), enabled })
export const useCatalogue = () => useQuery({ queryKey: ['catalogue'], queryFn: () => api.get<any>('/catalogue'), staleTime: 30_000 })

/** Any write: the server recomputes; every screen refetches. */
export function useWrite<TBody, TResult = unknown>(fn: (body: TBody) => Promise<TResult>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    },
  })
}
