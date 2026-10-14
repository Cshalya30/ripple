import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Party } from '../types'
import { createParty, deleteParty as deletePartyRequest, importSampleFile, listParties, type NewParty } from '../services/partyService'
import { BUSINESS_DEFAULT } from '../lib/brand'

type Theme = 'light' | 'dark'
export type ToastTone = 'success' | 'info' | 'error'
export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

interface AppState {
  theme: Theme
  toggleTheme: () => void
  parties: Party[]
  partiesLoading: boolean
  addParty: (input: NewParty) => Promise<Party>
  deleteParty: (partyId: string) => Promise<void>
  importParties: () => Promise<Party[]>
  businessName: string
  setBusinessName: (name: string) => void
  toasts: Toast[]
  pushToast: (message: string, tone?: ToastTone) => void
  dismissToast: (id: number) => void
}

const Ctx = createContext<AppState | null>(null)

function initialTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [parties, setParties] = useState<Party[]>([])
  const [partiesLoading, setPartiesLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [businessName, setBusinessName] = useState(BUSINESS_DEFAULT)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('ripple-theme', theme)
    } catch {
      /* storage can be unavailable */
    }
  }, [theme])

  useEffect(() => {
    let alive = true
    listParties().then((p) => {
      if (alive) {
        setParties(p)
        setPartiesLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const pushToast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t.slice(-2), { id, message, tone }])
      setTimeout(() => dismissToast(id), 4200)
    },
    [dismissToast],
  )

  const addParty = useCallback(async (input: NewParty) => {
    const party = await createParty(input)
    setParties((p) => [party, ...p])
    return party
  }, [])

  const deleteParty = useCallback(async (partyId: string) => {
    await deletePartyRequest(partyId)
    setParties((p) => p.filter((party) => party.id !== partyId))
  }, [])

  const importParties = useCallback(async () => {
    const added = await importSampleFile()
    setParties((p) => [...added, ...p])
    return added
  }, [])

  const value = useMemo<AppState>(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      parties,
      partiesLoading,
      addParty,
      deleteParty,
      importParties,
      businessName,
      setBusinessName,
      toasts,
      pushToast,
      dismissToast,
    }),
    [theme, parties, partiesLoading, addParty, deleteParty, importParties, businessName, toasts, pushToast, dismissToast],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside AppProvider')
  return v
}
