import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react'
import { useApp } from '../context/AppContext'

const icons = { success: CheckCircle2, info: Info, error: AlertCircle }
const tones = { success: 'text-gain', info: 'text-brand', error: 'text-loss' }

export function ToastHost() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[80] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icons[t.tone]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-lift"
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${tones[t.tone]}`} aria-hidden="true" />
              <p className="flex-1 text-sm font-medium">{t.message}</p>
              <button type="button" onClick={() => dismissToast(t.id)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Dismiss notification">
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
