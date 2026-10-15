import { create } from 'zustand'
import type { ChanceAfter, Evaluation, RunPayload } from './types'

export type EngineView = 'network' | 'flow' | 'decisions'

export interface ActiveScenario {
  key: string
  label: string
  evaluation: Evaluation
  run: RunPayload
  /** Chance of a shortfall under this scenario, once the risk run has finished. */
  chance?: ChanceAfter
  /** The request that made it, so the risk figure can be fetched again while it is still being computed. */
  request?: Record<string, unknown>
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

export type PlaySpeed = 1 | 2 | 4

interface UIState {
  day: number
  setDay: (day: number) => void
  /** Playback of the forecast, shared by the timeline and every view that lights up the current day. */
  playing: boolean
  setPlaying: (value: boolean) => void
  speed: PlaySpeed
  setSpeed: (value: PlaySpeed) => void
  /** While playing, jump between days where something happens instead of stepping through quiet ones. */
  skipQuiet: boolean
  setSkipQuiet: (value: boolean) => void
  /** Flow: light what has happened by the chosen day, dim what is still to come. */
  spotlight: boolean
  setSpotlight: (value: boolean) => void
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
  setDay: (day) => set({ day: Math.max(0, Math.round(day)) }),
  playing: false,
  setPlaying: (playing) => set({ playing }),
  speed: 1,
  setSpeed: (speed) => set({ speed }),
  skipQuiet: true,
  setSkipQuiet: (skipQuiet) => set({ skipQuiet }),
  spotlight: true,
  setSpotlight: (spotlight) => set({ spotlight }),
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
  munimOpen: typeof window !== 'undefined' && window.innerWidth >= 1700,
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
