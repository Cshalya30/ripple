import { ArrowRight, CalendarClock, Check, Percent, Receipt, Split, type LucideIcon } from 'lucide-react'
import type { FixIcon, FixOption } from '../types'
import { formatCompact } from '../lib/format'

const icons: Record<FixIcon, LucideIcon> = { percent: Percent, split: Split, calendar: CalendarClock, receipt: Receipt }
const tagStyle: Record<FixOption['tag'], string> = {
  Easiest: 'bg-gain-soft text-gain',
  Cheapest: 'bg-brand-soft text-brand',
  Quickest: 'bg-warn-soft text-warn',
  'Last resort': 'bg-loss-soft text-loss',
}

interface Props {
  options: FixOption[]
  baseLowest: number
  selectedId: string | null
  onSelect: (id: string) => void
}

export function FixCards({ options, baseLowest, selectedId, onSelect }: Props) {
  return (
    <div role="radiogroup" aria-label="Ways to fix the dip" className="grid gap-4 md:grid-cols-2">
      {options.map((o) => {
        const Icon = icons[o.icon]
        const selected = o.id === selectedId
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(o.id)}
            className={`lift relative flex flex-col gap-3 rounded-2xl border p-5 text-left shadow-soft ${
              selected ? 'border-brand bg-brand-soft/50 ring-2 ring-brand' : 'border-line bg-surface'
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-brand">
                <Icon size={20} aria-hidden="true" />
              </span>
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tagStyle[o.tag]}`}>{o.tag}</span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${selected ? 'border-brand bg-brand text-on-brand' : 'border-line text-transparent'}`}
                  aria-hidden="true"
                >
                  <Check size={14} />
                </span>
              </span>
            </span>
            <span>
              <span className="block font-display text-lg font-bold leading-snug">{o.title}</span>
              <span className="mt-1 block text-sm text-muted">{o.summary}</span>
            </span>
            <span className="mt-auto space-y-1.5 border-t border-line pt-3 text-sm">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                <span className="text-muted">Dip goes from</span>
                <span className="num text-loss">{formatCompact(baseLowest)}</span>
                <ArrowRight size={14} className="text-muted" aria-hidden="true" />
                <span className={`num ${o.newLowest >= 0 ? 'text-gain' : 'text-loss'}`}>{formatCompact(o.newLowest, { sign: true })}</span>
              </span>
              <span className="block text-muted">
                Cost: <span className="font-medium text-ink">{o.cost}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
