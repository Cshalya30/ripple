import * as RadixDialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { rupees } from '../lib/format'
import { useUI } from '../lib/store'
import { Glyph, type GlyphName } from './Glyph'

/** Money: mono, right-aligned by its container, + for in, − for out, colour never alone. */
export function Amount({ paise, direction, sign, className = '' }: {
  paise: number | null | undefined
  direction?: 'IN' | 'OUT' | 'NONE' | null
  sign?: boolean
  className?: string
}) {
  if (paise === null || paise === undefined) return <span className={`amt faint ${className}`}>·</span>
  const value = direction === 'OUT' ? -Math.abs(paise) : direction === 'IN' ? Math.abs(paise) : paise
  const tone = direction === 'IN' ? 'amt-in' : direction === 'OUT' ? 'amt-out' : ''
  return <span className={`amt ${tone} ${className}`}>{rupees(value, { sign: sign ?? direction === 'IN' })}</span>
}

export type Tone = 'in' | 'attn' | 'out' | 'wait'
const toneGlyph: Record<Tone, GlyphName> = { in: 'CHECK', attn: 'CLOCK', out: 'CROSS', wait: 'WAIT' }

/** Status is always a glyph plus a word. */
export function Status({ tone, children, glyph }: { tone: Tone; children: ReactNode; glyph?: GlyphName }) {
  return (
    <span className={`status status-${tone}`}>
      <Glyph name={glyph ?? toneGlyph[tone]} size={12} />
      {children}
    </span>
  )
}

export function StripCell({ label, children, sub, total }: { label: ReactNode; children: ReactNode; sub?: ReactNode; total?: boolean }) {
  return (
    <div className={`strip-cell${total ? ' total' : ''}`}>
      <div className="strip-label">{label}</div>
      <div className="strip-figure">{children}</div>
      {sub && <div className="strip-sub">{sub}</div>}
    </div>
  )
}

export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden="true" />
}

export function SkeletonRows({ rows = 6, h = 32 }: { rows?: number; h?: number }) {
  return (
    <div className="stack" style={{ gap: 6 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={h - 6} />)}
    </div>
  )
}

export function ErrorNote({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="notice bad row" role="alert">
      <span className="grow">{text}</span>
      {retry && <button className="btn btn-sm btn-secondary" onClick={retry}>Try again</button>}
    </div>
  )
}

export function Section({ title, aside, children, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <span className="spacer" />
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Dialog({ open, onClose, title, children, wide, description }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; description?: ReactNode
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay" />
        <RadixDialog.Content className={`dialog${wide ? ' wide' : ''}`} aria-describedby={undefined}>
          <div className="row" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
            <div className="grow">
              <RadixDialog.Title className="h2">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="small muted" style={{ marginTop: 4 }}>{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close className="icon-btn" aria-label="Close"><Glyph name="CROSS" /></RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export function Drawer({ open, onClose, title, children, head }: { open: boolean; onClose: () => void; title: string; children: ReactNode; head?: ReactNode }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay" />
        <RadixDialog.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer-head">
            <div className="grow">
              <RadixDialog.Title className="h2">{title}</RadixDialog.Title>
              {head}
            </div>
            <RadixDialog.Close className="icon-btn" aria-label="Close"><Glyph name="CROSS" /></RadixDialog.Close>
          </div>
          <div className="drawer-body">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

/** Six recent payments: filled when on time, outlined with days when late. */
export function LastSix({ delays }: { delays: number[] }) {
  if (!delays.length) return <span className="faint small">no history</span>
  return (
    <span className="marks" aria-label={`Last ${delays.length} payments: ${delays.map((d) => (d <= 0 ? 'on time' : `${d} days late`)).join(', ')}`}>
      {delays.map((d, i) => (
        <span key={i} className={`mark ${d <= 0 ? 'on-time' : 'late'}`} title={d <= 0 ? 'On time' : `${d} days late`}>{d > 0 ? d : ''}</span>
      ))}
    </span>
  )
}
