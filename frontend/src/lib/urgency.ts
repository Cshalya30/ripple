import { AlertTriangle, CheckCircle2, Clock, type LucideIcon } from 'lucide-react'
import type { Party, Urgency } from '../types'
import { daysFromToday } from './dates'
import { relativeDue } from './format'

export function urgencyOf(p: Party): Urgency {
  if (p.owedAmount <= 0) return 'ok'
  const days = daysFromToday(p.dueDate)
  if (days < 0 || p.causesShortfall) return 'risk'
  if (days <= 7) return 'soon'
  return 'ok'
}

export const urgencyMeta: Record<Urgency, { label: string; icon: LucideIcon; text: string; soft: string; border: string }> = {
  ok: { label: 'On track', icon: CheckCircle2, text: 'text-gain', soft: 'bg-gain-soft', border: 'border-gain/40' },
  soon: { label: 'Due soon', icon: Clock, text: 'text-warn', soft: 'bg-warn-soft', border: 'border-warn/50' },
  risk: { label: 'Needs attention', icon: AlertTriangle, text: 'text-loss', soft: 'bg-loss-soft', border: 'border-loss/50' },
}

/** Timing sentence for hover tooltips and the drawer, e.g. "Payment due in 4 days". */
export function timingText(p: Party): string {
  const days = daysFromToday(p.dueDate)
  if (p.owedAmount <= 0) return 'Fully settled'
  if (p.kind === 'supplier') {
    return days < 0 ? `Payment ${relativeDue(days)}` : `Payment due ${relativeDue(days)}`
  }
  return days < 0 ? `Payment ${relativeDue(days)}` : `Payment expected ${relativeDue(days)}`
}
