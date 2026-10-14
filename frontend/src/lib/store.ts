import { create } from 'zustand'
import type { Evaluation, RunPayload } from './types'

export type EngineView = 'network' | 'flow' | 'decisions'

export interface ActiveScenario {
  key: string
  label: string
  evaluation: Evaluation
  run: RunPayload
}

export interface ComposerState {
  partyId: string
  intent: 'reminder' | 'early_discount' | 'extension' | 'instalment' | 'deposit'
  fixId?: string
  invoiceId?: string
  tone?: 'polite' | 'firm'
}

export interface PaymentState {
  partyId?: string
  invoiceId?: string
  direction?: 'IN' | 'OUT'
  amountPaise?: number
}

export interface MunimContext {
  route?: string
  event_id?: string
  party_id?: string
  day?: number
  scenario?: string
}

interface Toast {
  id: number
  text: string
}

interface UIState {
  day: number
  setDay: (day: number) => void
  engineView: EngineView
  setEngineView: (view: EngineView) => void
  tableView: boolean
  setTableView: (value: boolean) => void
  selectedEventId: string | null
  selectedPartyId: string | null
  selectEvent: (id: string | null) => void
  selectParty: (id: string | null) => void
  diff: boolean
  setDiff: (value: boolean) => void
  scenario: ActiveScenario | null
  setScenario: (scenario: ActiveScenario | null) => void
  scenarioBarOpen: boolean
  setScenarioBarOpen: (value: boolean) => void
  munimOpen: boolean
  setMunimOpen: (value: boolean) => void
  munimSeed: { text: string; context: MunimContext; nonce: number } | null
  askMunim: (text: string, context?: MunimContext) => void
  railCollapsed: boolean
  toggleRail: () => void
  composer: ComposerState | null
  openComposer: (state: ComposerState | null) => void
  payment: PaymentState | null
  openPayment: (state: PaymentState | null) => void
  drawerPartyId: string | null
  openParty: (id: string | null) => void
  commandOpen: boolean
  setCommandOpen: (value: boolean) => void
  toasts: Toast[]
  toast: (text: string) => void
}

let toastId = 0

export const useUI = create<UIState>((set) => ({
  day: 0,
  setDay: (day) => set({ day: Math.max(0, day) }),
  engineView: 'network',
  setEngineView: (engineView) => set({ engineView }),
  tableView: typeof window !== 'undefined' && window.innerWidth < 900,
  setTableView: (tableView) => set({ tableView }),
  selectedEventId: null,
  selectedPartyId: null,
  selectEvent: (selectedEventId) => set({ selectedEventId, selectedPartyId: null }),
  selectParty: (selectedPartyId) => set({ selectedPartyId, selectedEventId: null }),
  diff: true,
  setDiff: (diff) => set({ diff }),
  scenario: null,
  setScenario: (scenario) => set({ scenario }),
  scenarioBarOpen: false,
  setScenarioBarOpen: (scenarioBarOpen) => set({ scenarioBarOpen }),
  munimOpen: typeof window !== 'undefined' && window.innerWidth >= 1280,
  setMunimOpen: (munimOpen) => set({ munimOpen }),
  munimSeed: null,
  askMunim: (text, context = {}) => set({ munimOpen: true, munimSeed: { text, context, nonce: Date.now() } }),
  railCollapsed: false,
  toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
  composer: null,
  openComposer: (composer) => set({ composer }),
  payment: null,
  openPayment: (payment) => set({ payment }),
  drawerPartyId: null,
  openParty: (drawerPartyId) => set({ drawerPartyId }),
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  toasts: [],
  toast: (text) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200)
  },
}))
