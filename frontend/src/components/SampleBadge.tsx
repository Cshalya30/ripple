import { FlaskConical } from 'lucide-react'

export function SampleBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-muted ${className}`}
    >
      <FlaskConical size={12} aria-hidden="true" />
      Sample data
    </span>
  )
}
