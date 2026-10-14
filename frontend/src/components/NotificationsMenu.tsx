import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Clock, TrendingDown } from 'lucide-react'

const items = [
  { icon: TrendingDown, tone: 'text-loss', title: 'Cash dip expected on Day 34', body: 'Balance falls to −₹1.2L unless you act.' },
  { icon: AlertTriangle, tone: 'text-loss', title: 'Kaveri Boutique is 12 days overdue', body: '₹1,45,000 still pending.' },
  { icon: Clock, tone: 'text-warn', title: 'Rajdhani Roadlines due in 3 days', body: '₹38,000 to pay.' },
]

export function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications, 3 new"
        aria-expanded={open}
        aria-haspopup="true"
        className="relative rounded-xl border border-line bg-surface p-2.5 text-muted transition hover:text-ink"
      >
        <Bell size={18} />
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-loss" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-2 shadow-lift">
          <p className="px-3 pb-1 pt-2 text-sm font-semibold">Notifications</p>
          <ul>
            {items.map((n) => (
              <li key={n.title} className="flex gap-3 rounded-xl px-3 py-2.5 hover:bg-sunken">
                <n.icon size={18} className={`mt-0.5 shrink-0 ${n.tone}`} aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-muted">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
