/** Custom 16px domain glyphs, 1.5px strokes (PRD 17.8). */
import type { SVGProps } from 'react'

export type GlyphName =
  | 'CASH_RECEIPT' | 'SUPPLIER_PAYMENT' | 'INVENTORY_ARRIVAL' | 'PRODUCTION_START' | 'PRODUCTION_COMPLETE'
  | 'DELIVERY' | 'OTHER_EXPENSE' | 'CREDIT_DRAWDOWN' | 'CREDIT_REPAYMENT' | 'SUPPLIER' | 'CUSTOMER' | 'SEAL' | 'NIB'
  | 'CHECK' | 'CROSS' | 'CLOCK' | 'WAIT' | 'DOT'

const paths: Record<GlyphName, JSX.Element> = {
  CASH_RECEIPT: (<><path d="M2.5 9.5v4h11v-4" /><path d="M8 2v8" /><path d="M5 7l3 3 3-3" /></>),
  SUPPLIER_PAYMENT: (<><path d="M2.5 9.5v4h11v-4" /><path d="M8 10V2" /><path d="M5 5l3-3 3 3" /></>),
  INVENTORY_ARRIVAL: (<><path d="M2.5 6.5h11v7h-11z" /><path d="M2.5 6.5L4 3h8l1.5 3.5" /><path d="M8 8v3.5" /><path d="M6.5 10l1.5 1.5L9.5 10" /></>),
  PRODUCTION_START: (<><path d="M2 8c2-3 10-3 12 0-2 3-10 3-12 0z" /><path d="M5 8h6" /></>),
  PRODUCTION_COMPLETE: (<><path d="M2 7c2-3 10-3 12 0-2 3-10 3-12 0z" /><path d="M6 13l1.5 1.5L11 11" /></>),
  DELIVERY: (<><path d="M1.5 4.5h8v7h-8z" /><path d="M9.5 7h3l2 2.5v2h-5" /><circle cx="4.5" cy="12.5" r="1.2" /><circle cx="12" cy="12.5" r="1.2" /></>),
  OTHER_EXPENSE: (<><path d="M4 1.5h8v13l-2-1.2-2 1.2-2-1.2-2 1.2z" /><path d="M6 5h4M6 8h4" /></>),
  CREDIT_DRAWDOWN: (<><path d="M3 14.5h10M4 13V6M12 13V6M2.5 5.5L8 2l5.5 3.5" /><path d="M8 7v5M6.5 10.5L8 12l1.5-1.5" /></>),
  CREDIT_REPAYMENT: (<><path d="M3 14.5h10M4 13V6M12 13V6M2.5 5.5L8 2l5.5 3.5" /><path d="M8 12V7M6.5 8.5L8 7l1.5 1.5" /></>),
  SUPPLIER: (<><ellipse cx="8" cy="3.5" rx="4" ry="1.5" /><ellipse cx="8" cy="12.5" rx="4" ry="1.5" /><path d="M4 3.5v9M12 3.5v9M5.5 6.5h5M5.5 9.5h5" /></>),
  CUSTOMER: (<><path d="M2.5 6.5V14h11V6.5" /><path d="M1.5 6.5L3 2.5h10l1.5 4z" /><path d="M6.5 14v-4h3v4" /></>),
  SEAL: (<><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="3" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2" /></>),
  NIB: (<><path d="M8 1.5l4 5-4 8-4-8z" /><path d="M8 7.5v3" /><circle cx="8" cy="7" r=".9" /></>),
  CHECK: <path d="M3 8.5l3 3 7-7" />,
  CROSS: <path d="M4 4l8 8M12 4l-8 8" />,
  CLOCK: (<><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>),
  WAIT: (<><path d="M4 2h8M4 14h8" /><path d="M5 2c0 4 6 4 6 6s-6 2-6 6M11 2c0 4-6 4-6 6s6 2 6 6" /></>),
  DOT: <circle cx="8" cy="8" r="2.5" />,
}

export function Glyph({ name, size = 16, ...rest }: { name: GlyphName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name] ?? paths.DOT}
    </svg>
  )
}

/** Wordmark: a stone and waves moving one way (PRD 17.13). */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="6.5" cy="11" r="3" fill="var(--haldi)" />
        <path d="M12 5.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="var(--haldi)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16 2.5a11.5 11.5 0 0 1 0 17" fill="none" stroke="var(--haldi)" strokeWidth="1.8" strokeLinecap="round" opacity=".55" />
      </svg>
      {!compact && <span className="rail-text" style={{ fontWeight: 680, fontStretch: '112%', fontSize: 18, letterSpacing: '-0.01em' }}>ripple</span>}
    </span>
  )
}
