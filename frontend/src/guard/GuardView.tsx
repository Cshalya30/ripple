import { useMemo, useState } from 'react'
import { ErrorNote, Section, Skeleton, SkeletonRows, StripCell } from '../components/ui'
import { errorText } from '../lib/api'
import { percent, rupees } from '../lib/format'
import { useGuard } from '../lib/queries'
import { Futures } from './Futures'
import { parseYield } from './logic'
import { PaymentCheck } from './PaymentCheck'
import { Pipeline } from './Pipeline'
import { Activity, Checks, Drivers, Flags, Opportunities, SafeLadder, Signals, UpcomingPayments } from './Panels'
import type { Guard } from './types'

const LEVEL_WORD = { ok: 'All clear', watch: 'Keep an eye on it', act: 'Act this week' } as const
const TREND_LABEL = { improving: '↑ Improving', worsening: '↓ Worsening', stable: '→ Stable' } as const

function computeTrend(series: Guard['risk']['series']): 'improving' | 'worsening' | 'stable' {
  if (series.length < 10) return 'stable'
  const mid = Math.floor(series.length / 2)
  const first = series.slice(0, mid).reduce((s, p) => s + p.net_paise, 0) / mid
  const second = series.slice(mid).reduce((s, p) => s + p.net_paise, 0) / (series.length - mid)
  const change = second - first
  const threshold = Math.max(Math.abs(first) * 0.1, 100_000)
  if (change > threshold) return 'improving'
  if (change < -threshold) return 'worsening'
  return 'stable'
}

export function GuardView() {
  const [yieldText, setYieldText] = useState('6.5')
  const parsed = useMemo(() => parseYield(yieldText), [yieldText])
  const [bp, setBp] = useState(650)
  if (parsed.ok && parsed.bp !== bp) setBp(parsed.bp)
  const guard = useGuard(bp)

  if (guard.isLoading) return <div><Skeleton h={120} /><Skeleton h={300} style={{ marginTop: 16 }} /><div style={{ marginTop: 16 }}><SkeletonRows rows={5} /></div></div>
  if (guard.isError || !guard.data) return <ErrorNote text={`Couldn't reach the engine. ${errorText(guard.error)}`} retry={() => guard.refetch()} />
  const g = guard.data

  return (
    <div className="guard">
      <Hero g={g} />
      <Pipeline guard={g} />
      <Section title="The futures the risk engine simulated" id="guard-futures">
        <Futures guard={g} />
      </Section>

      <Section title="If I make this payment" id="guard-check"><PaymentCheck guard={g} /></Section>

      <div className="guard-cols">
        <div className="guard-col">
          <h2 className="guard-col-title risk">Risk <span className="faint">looks forward</span></h2>
          <Section title="Safe to spend" id="guard-safe"><SafeLadder rows={g.risk.ladder} hasRisk={g.risk.ladder.some((r) => r.cautious_paise !== null)} /></Section>
          <Section title="Payments coming due">
            <UpcomingPayments rows={g.risk.payments} />
          </Section>
          <Section title="Other ways this can hurt">
            <Signals rows={g.risk.signals} />
            <Drivers guard={g} />
          </Section>
        </div>
        <div className="guard-col">
          <h2 className="guard-col-title finance">Finance <span className="faint">checks the books and the cash</span></h2>
          <Section title="Suspicious entries" id="guard-flags" aside={<span className="micro faint">{g.finance.flags.open_count} to review</span>}><Flags guard={g} /></Section>
          <Section title="Books check" id="guard-checks" aside={<span className="micro faint">{g.finance.checks_passed} of {g.finance.checks.length} pass</span>}><Checks guard={g} /></Section>
          <Section title="Where spare cash could work" id="guard-grow">
            <Opportunities guard={g} yieldText={yieldText} setYieldText={setYieldText} yieldError={parsed.ok ? null : parsed.error} />
          </Section>
          <Section title="Latest changes taken in"><Activity guard={g} /></Section>
        </div>
      </div>

      <Trust g={g} />
    </div>
  )
}

function Hero({ g }: { g: Guard }) {
  const thirty = g.risk.ladder.find((r) => r.days === 30)
  const chance = g.risk.shortfall_chance?.['30']
  const trend = computeTrend(g.risk.series)
  return (
    <div className={`guard-hero level-${g.verdict.level}`}>
      <div className="guard-verdict">
        <span className="guard-light" aria-hidden="true" />
        <div>
          <div className="guard-headline">{LEVEL_WORD[g.verdict.level]}</div>
          <ul className="guard-reasons">{g.verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      </div>
      <div className="strip guard-strip">
        <StripCell label="Safe to spend, 30 days" sub={thirty?.cautious_paise === null || !thirty ? 'plan only; risk is running' : `plan ${rupees(thirty.plan_paise)}`}>{thirty ? rupees(thirty.cautious_paise ?? thirty.plan_paise) : '·'}</StripCell>
        <StripCell label="Shortfall chance, 30 days" sub={g.risk.n_samples ? `${g.risk.n_samples} simulated futures` : 'calculating'}>{chance === undefined ? '…' : percent(chance)}</StripCell>
        <StripCell label="To review" sub="suspicious entries">{g.finance.flags.open_count}</StripCell>
        <StripCell label="Books check" sub="reconciliation">{g.finance.checks_passed}/{g.finance.checks.length}</StripCell>
        <StripCell label="Position trend" sub="across forecast horizon"><span className={`trend-${trend}`}>{TREND_LABEL[trend]}</span></StripCell>
      </div>
    </div>
  )
}

function Trust({ g }: { g: Guard }) {
  const c = g.calibration
  return (
    <Section title="How far to trust it" id="guard-trust">
      <div className="trust">
        <div>
          <div className="label">Back-test</div>
          {c.status === 'READY' && c.coverage !== undefined ? (
            <>
              <div className="trust-gauge" role="img" aria-label={`${Math.round(c.coverage * 100)} percent of past payments fell inside the predicted range; target 80 percent`}>
                <div className="trust-fill" style={{ width: `${c.coverage * 100}%` }} />
                <div className="trust-target" style={{ left: '80%' }} />
              </div>
              <p className="small">{c.message}</p>
              <p className="micro faint">Typical miss: {c.median_error_days} day{c.median_error_days === 1 ? '' : 's'} on the middle estimate. The live model also blends in all customers' history for customers with few payments, which this test leaves out.</p>
            </>
          ) : <p className="small muted">{c.message}</p>}
        </div>
        <div>
          <div className="label">What it learned from</div>
          <p className="small">{g.risk.payments_used ?? 0} past customer payments from {g.risk.customers_with_history ?? 0} customers.
            {g.risk.customers_without_history.length ? ` ${g.risk.customers_without_history.join(', ')} ${g.risk.customers_without_history.length === 1 ? 'has' : 'have'} no history yet, so the average of all customers is used.` : ''}</p>
          <p className="micro faint">Payment history in the demo is synthetic. Guard reads records and runs the engine; it never writes to your books.</p>
        </div>
      </div>
    </Section>
  )
}
