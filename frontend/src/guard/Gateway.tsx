import type { Guard } from './types'

interface Props { guard: Guard }

export function Gateway({ guard }: Props) {
  const checks = guard.finance.checks_passed
  const total = guard.finance.checks.length
  const integrity = total > 0 ? Math.round((checks / total) * 100) : 100

  return (
    <div className="gw">
      <div className="gw-arch">
        <Zone id="internal" name="Internal System" chips={['AI Risk', 'AI Finance', 'Books', 'Simulations']}
          metric={`${integrity}%`} metricLabel="integrity" />
        <Arrow label="Request" returnLabel="Ticket" />
        <Zone id="dmz" name="DMZ Boundary" chips={['Token Gen', 'Validation', 'Audit Log']} />
        <Arrow label="Token" returnLabel="Result" />
        <Zone id="gateway" name="Payment Gateway" chips={['Processing', 'Settlement', 'Reconciliation', 'Bank APIs']} />
      </div>

      <div className="gw-legend">
        <div className="gw-legend-row"><span className="dot out" />Outbound: request terminates at DMZ, new token issued, gateway processes independently</div>
        <div className="gw-legend-row"><span className="dot ok" />Inbound: result terminates at DMZ, new ticket issued, system updates internally</div>
      </div>

      <div className="gw-refs">
        <div className="gw-ref">
          <div className="label">Nuclear reactor air-gap</div>
          <p className="small muted">No shared medium between zones. The rest of the system can fail without touching payment processing.</p>
        </div>
        <div className="gw-ref">
          <div className="label">Industry 4.0 OT/IT DMZ</div>
          <p className="small muted">Data terminates at the boundary. A separate token is generated for each crossing — auditable, tamper-proof trail.</p>
        </div>
      </div>
    </div>
  )
}

function Zone({ id, name, chips, metric, metricLabel }: {
  id: string; name: string; chips: string[]; metric?: string; metricLabel?: string
}) {
  return (
    <div className={`gw-zone gw-z-${id}`}>
      <div className="gw-z-head">
        <span className="gw-z-name">{name}</span>
        {metric && <span className="gw-z-metric mono">{metric}<span className="gw-z-metric-label"> {metricLabel}</span></span>}
      </div>
      <div className="gw-z-chips">
        {chips.map(c => <span key={c} className="gw-z-chip">{c}</span>)}
      </div>
    </div>
  )
}

function Arrow({ label, returnLabel }: { label: string; returnLabel: string }) {
  return (
    <div className="gw-arrow">
      <span className="gw-arrow-tag mono">{label} {'→'}</span>
      <div className="gw-arrow-line" />
      <span className="gw-arrow-tag ret mono">{'←'} {returnLabel}</span>
    </div>
  )
}
