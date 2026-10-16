import { useCallback, useEffect, useRef, useState } from 'react'
import type { Guard } from './types'

interface Props { guard: Guard }

const STEPS = [
  { id: 'validate', label: 'Validate', sub: 'Luhn + format + bounds', zone: 'internal',
    detail: 'Card number passes Luhn check. Expiry and CVV format verified. Amount checked against business limits.' },
  { id: 'fraud', label: 'Fraud Screen', sub: 'Velocity, geo, device', zone: 'internal',
    detail: 'Pattern analysis on velocity, device fingerprint and geo-location. Cross-referenced against known fraud vectors. No PII leaves this zone.' },
  { id: 'risk', label: 'Risk Check', sub: 'Shortfall analysis', zone: 'internal',
    detail: 'Risk engine evaluates whether this outflow triggers a shortfall within 30 days. Flagged with projected gap, not blocked.' },
  { id: 'tokenise', label: 'Tokenise', sub: 'Opaque one-time token', zone: 'internal',
    detail: 'Original request destroyed. A one-time token carries only amount, currency, idempotency key and a hash. No party names cross the boundary.' },
  { id: 'dmz-out', label: 'DMZ Out', sub: 'Air-gap crossing', zone: 'dmz',
    detail: 'Token enters the air-gapped DMZ. Internal connection terminates here. A new, isolated connection forwards the token to the gateway. Audit trail logged.' },
  { id: 'gateway', label: 'Gateway', sub: 'Route to bank API', zone: 'gateway',
    detail: 'Completely isolated from the internal system. Decodes the token, routes to the appropriate bank API (UPI, NEFT, RTGS, IMPS) and initiates the transfer.' },
  { id: 'settlement', label: 'Settlement', sub: 'Bank confirm + UTR', zone: 'gateway',
    detail: 'Bank processes the instruction. UPI: near-instant. NEFT: next batch. RTGS: real-time gross. Settlement confirmation with UTR returned.' },
  { id: 'dmz-in', label: 'DMZ In', sub: 'Air-gap return', zone: 'dmz',
    detail: 'Result destroyed at the DMZ boundary. A new ticket with only status, UTR and timestamp is generated for the internal system. No bank metadata leaks in.' },
  { id: 'reconcile', label: 'Reconcile', sub: '8 verification checks', zone: 'internal',
    detail: 'Finance engine runs 8 checks: no overpaid bill, bill status matches payments, no negative stock, no dangling links, nothing cleared in the future.' },
  { id: 'books', label: 'Books', sub: 'Ledger + recompute', zone: 'internal',
    detail: 'Transaction recorded. Engine cache invalidated, next read triggers full recompute. Risk recalculates within 2 seconds on the worker process.' },
] as const

type StepId = typeof STEPS[number]['id']

export function PaymentFlow({ guard }: Props) {
  const [method, setMethod] = useState<'card' | 'upi'>('card')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [active, setActive] = useState(-1)
  const [completed, setCompleted] = useState<Set<StepId>>(new Set())
  const [hovered, setHovered] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const integrity = guard.finance.checks.length > 0
    ? Math.round((guard.finance.checks_passed / guard.finance.checks.length) * 100) : 100

  const runStep = useCallback((idx: number) => {
    if (idx >= STEPS.length) { setPhase('done'); setActive(-1); return }
    setActive(idx)
    const dur = [400, 500, 600, 300, 500, 700, 900, 400, 500, 300][idx]
    timerRef.current = setTimeout(() => {
      setCompleted(prev => { const n = new Set(prev); n.add(STEPS[idx].id); return n })
      timerRef.current = setTimeout(() => runStep(idx + 1), 100)
    }, dur)
  }, [])

  const start = () => {
    if (phase === 'running') return
    setCompleted(new Set()); setPhase('running'); setActive(0); runStep(0)
  }
  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPhase('idle'); setActive(-1); setCompleted(new Set())
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const focused = hovered ?? (active >= 0 ? active : null)
  const reached = (idx: number) => active >= idx || completed.has(STEPS[idx].id)

  return (
    <div className="pgw">
      <div className="pgw-top">
        {/* ---- Checkout card ---- */}
        <div className="pgw-co">
          <div className="pgw-co-head">
            <span className="pgw-co-brand">Ripple<span className="pgw-co-hl">Pay</span></span>
            <span className="pgw-co-amt mono">{'₹'}12,500</span>
          </div>
          <div className="pgw-co-tabs">
            <button className={`pgw-co-tab ${method === 'card' ? 'on' : ''}`} onClick={() => setMethod('card')}>Card</button>
            <button className={`pgw-co-tab ${method === 'upi' ? 'on' : ''}`} onClick={() => setMethod('upi')}>UPI</button>
          </div>
          {method === 'card' ? (
            <div className="pgw-co-fields">
              <label className="pgw-co-lbl">Card number</label>
              <input className="pgw-co-inp mono" placeholder="4242 4242 4242 4242" maxLength={19} />
              <div className="pgw-co-pair">
                <div><label className="pgw-co-lbl">Expiry</label><input className="pgw-co-inp mono" placeholder="MM / YY" maxLength={5} /></div>
                <div><label className="pgw-co-lbl">CVV</label><input className="pgw-co-inp mono" placeholder="---" type="password" maxLength={4} /></div>
              </div>
            </div>
          ) : (
            <div className="pgw-co-fields">
              <label className="pgw-co-lbl">UPI ID</label>
              <input className="pgw-co-inp mono" placeholder="business@upi" />
            </div>
          )}
          <button className={`pgw-co-pay ${phase}`} onClick={phase === 'done' ? reset : start} disabled={phase === 'running'}>
            {phase === 'idle' && `Pay ₹12,500`}
            {phase === 'running' && 'Processing…'}
            {phase === 'done' && 'Run again'}
          </button>
          <div className="pgw-co-foot mono">Secured by Ripple DMZ Gateway</div>
        </div>

        {/* ---- Info panel ---- */}
        <div className="pgw-info">
          <div className="pgw-info-grid">
            <KV label="Status"><span className={`pgw-badge ${phase}`}>{phase === 'idle' ? 'STANDBY' : phase === 'running' ? 'LIVE' : 'OK'}</span></KV>
            <KV label="Integrity"><span className="mono">{integrity}%</span></KV>
            <KV label="Checks"><span className="mono">{guard.finance.checks_passed}/{guard.finance.checks.length}</span></KV>
            <KV label="DMZ crossings"><span className="mono">2</span></KV>
            <KV label="Zones"><span className="mono">3 isolated</span></KV>
            <KV label="Air gaps"><span className="mono">2 boundaries</span></KV>
          </div>
          <div className="pgw-refs">
            <div className="pgw-ref">
              <span className="pgw-ref-t">Nuclear reactor air-gap</span>
              <span className="pgw-ref-d">No shared medium between zones. System failure cannot touch payment processing.</span>
            </div>
            <div className="pgw-ref">
              <span className="pgw-ref-t">Industry 4.0 OT/IT DMZ</span>
              <span className="pgw-ref-d">Data terminates at each boundary. Separate token generated per crossing.</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Architecture diagram ---- */}
      <div className="pgw-arch">
        {/* Zone background strips */}
        <div className="pgw-strip pgw-strip-int" />
        <div className="pgw-strip pgw-strip-dmz" />
        <div className="pgw-strip pgw-strip-gw" />

        {/* Zone headers (row 1) */}
        <ZH col={1} label="Internal System" zone="int" />
        <ZH col={3} label="DMZ Boundary" zone="dmz" />
        <ZH col={5} label="Payment Gateway" zone="gw" />

        {/* Forward path: Internal column (rows 2-8) */}
        <Block idx={0} active={active} completed={completed} onHover={setHovered} gc={1} gr={2} />
        <VC lit={reached(1)} gc={1} gr={3} />
        <Block idx={1} active={active} completed={completed} onHover={setHovered} gc={1} gr={4} />
        <VC lit={reached(2)} gc={1} gr={5} />
        <Block idx={2} active={active} completed={completed} onHover={setHovered} gc={1} gr={6} />
        <VC lit={reached(3)} gc={1} gr={7} />

        {/* Forward crossing (row 8): Tokenise -> DMZ Out -> Gateway */}
        <Block idx={3} active={active} completed={completed} onHover={setHovered} gc={1} gr={8} />
        <HC lit={reached(4)} dir="fw" gc={2} gr={8} />
        <Block idx={4} active={active} completed={completed} onHover={setHovered} gc={3} gr={8} />
        <HC lit={reached(5)} dir="fw" gc={4} gr={8} />
        <Block idx={5} active={active} completed={completed} onHover={setHovered} gc={5} gr={8} />

        {/* Gateway column: Gateway -> Settlement (rows 9-10) */}
        <VC lit={reached(6)} gc={5} gr={9} />
        <Block idx={6} active={active} completed={completed} onHover={setHovered} gc={5} gr={10} />

        {/* Turn connector (row 11) */}
        <VC lit={reached(7)} gc={5} gr={11} />

        {/* Return crossing (row 12): Reconcile <- DMZ In <- (bend from Gateway) */}
        <Block idx={8} active={active} completed={completed} onHover={setHovered} gc={1} gr={12} />
        <HC lit={reached(8)} dir="ret" gc={2} gr={12} />
        <Block idx={7} active={active} completed={completed} onHover={setHovered} gc={3} gr={12} />
        <HC lit={reached(7)} dir="ret" gc={4} gr={12} />
        <Bend lit={reached(7)} gc={5} gr={12} />

        {/* Return path: Reconcile -> Books (rows 13-14) */}
        <VC lit={reached(9)} gc={1} gr={13} />
        <Block idx={9} active={active} completed={completed} onHover={setHovered} gc={1} gr={14} />
      </div>

      {/* Detail explainer */}
      {focused !== null && (
        <div className={`pgw-detail z-${zoneKey(STEPS[focused].zone)}`}>
          <span className="pgw-detail-n mono">{String(focused + 1).padStart(2, '0')}</span>
          <div>
            <div className="pgw-detail-t">{STEPS[focused].label} <span className="pgw-detail-z mono">{STEPS[focused].zone.toUpperCase()}</span></div>
            <div className="pgw-detail-b">{STEPS[focused].detail}</div>
          </div>
        </div>
      )}

      {/* Receipt */}
      {phase === 'done' && (
        <div className="pgw-receipt">
          <div className="pgw-receipt-h">Transaction complete</div>
          <table className="table dense pgw-receipt-tbl">
            <tbody>
              <tr><td className="muted">Status</td><td className="money"><span style={{ color: 'var(--in)', fontWeight: 600 }}>SUCCESS</span></td></tr>
              <tr><td className="muted">Amount</td><td className="money mono">{'₹'}12,500</td></tr>
              <tr><td className="muted">Method</td><td className="money mono">{method === 'card' ? 'CARD ****4242' : 'UPI'}</td></tr>
              <tr><td className="muted">UTR</td><td className="money mono">RIPPLE{Date.now().toString(36).toUpperCase().slice(0, 8)}</td></tr>
              <tr><td className="muted">Integrity</td><td className="money mono">{guard.finance.checks_passed}/{guard.finance.checks.length} passed</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ---- helpers ---- */

function zoneKey(z: string) { return z === 'internal' ? 'int' : z === 'dmz' ? 'dmz' : 'gw' }

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="pgw-kv"><span className="label">{label}</span>{children}</div>
}

function ZH({ col, label, zone }: { col: number; label: string; zone: string }) {
  return (
    <div className="pgw-zh" style={{ gridColumn: col, gridRow: 1 }}>
      <span className={`pgw-zh-dot ${zone}`} /><span>{label}</span>
    </div>
  )
}

function Block({ idx, active, completed, onHover, gc, gr }: {
  idx: number; active: number; completed: Set<StepId>; onHover: (i: number | null) => void; gc: number; gr: number
}) {
  const s = STEPS[idx]
  const isActive = active === idx
  const isDone = completed.has(s.id)
  const z = zoneKey(s.zone)
  return (
    <div
      className={`pgw-block z-${z}${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}
      style={{ gridColumn: gc, gridRow: gr }}
      onMouseEnter={() => onHover(idx)}
      onMouseLeave={() => onHover(null)}
      role="button" tabIndex={0}
    >
      <span className="pgw-block-n mono">{String(idx + 1).padStart(2, '0')}</span>
      <div className="pgw-block-body">
        <span className="pgw-block-name">{s.label}</span>
        <span className="pgw-block-sub">{s.sub}</span>
      </div>
      {isActive && <span className="pgw-block-ind pulse" />}
      {isDone && <span className="pgw-block-ind ok" />}
    </div>
  )
}

function VC({ lit, gc, gr }: { lit: boolean; gc: number; gr: number }) {
  return <div className={`pgw-vc${lit ? ' lit' : ''}`} style={{ gridColumn: gc, gridRow: gr }}><i /></div>
}

function HC({ lit, dir, gc, gr }: { lit: boolean; dir: 'fw' | 'ret'; gc: number; gr: number }) {
  return <div className={`pgw-hc ${dir}${lit ? ' lit' : ''}`} style={{ gridColumn: gc, gridRow: gr }}><i /></div>
}

function Bend({ lit, gc, gr }: { lit: boolean; gc: number; gr: number }) {
  return <div className={`pgw-bend${lit ? ' lit' : ''}`} style={{ gridColumn: gc, gridRow: gr }} />
}
