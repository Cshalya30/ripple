import { APP_NAME } from '../lib/brand'

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="9" className="fill-brand" />
      <circle cx="16" cy="16" r="3.2" className="fill-on-brand" />
      <circle cx="16" cy="16" r="7.2" fill="none" strokeWidth="1.6" className="stroke-on-brand" strokeOpacity="0.7" />
      <circle cx="16" cy="16" r="11.4" fill="none" strokeWidth="1.4" className="stroke-on-brand" strokeOpacity="0.35" />
    </svg>
  )
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-display text-xl font-bold tracking-tight">{APP_NAME}</span>
    </div>
  )
}
