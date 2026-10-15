import { useEffect, useState } from 'react'
import { compact, percent } from '../lib/format'
import type { Guard } from './types'

type Tone = 'ok' | 'watch' | 'act' | 'idle'

interface NodeInfo { id: string; group: 'books' | 'risk' | 'finance'; name: string; metric: string; sub: string; tone: Tone; anchor: string }

function nodes(g: Guard): NodeInfo[] {
  const chance = g.risk.shortfall_chance?.['30']
  const thirty = g.risk.ladder.find((r) => r.days === 30)
  const safe = thirty ? (thirty.cautious_paise ?? thirty.plan_paise) : null
  const flags = g.finance.flags
  const high = flags.open.some((f) => f.severity === 'high')
  return [
    { id: 'books', group: 'books', name: 'Your books', metric: String(flags.scanned.payments + flags.scanned.bills), sub: 'payments and bills read', tone: 'idle', anchor: 'guard-checks' },
    { id: 'predict', group: 'risk', name: 'Predict', metric: chance === undefined ? '…' : percent(chance), sub: `shortfall chance, 30 days${g.risk.n_samples ? ` · ${g.risk.n_samples} futures` : ''}`,
      tone: chance === undefined ? 'idle' : chance >= 0.5 ? 'act' : chance >= 0.25 ? 'watch' : 'ok', anchor: 'guard-futures' },
    { id: 'calculate', group: 'risk', name: 'Calculate', metric: safe === null ? '…' : compact(safe), sub: g.risk.ladder[0]?.cautious_paise === null ? 'safe to spend, 30 days (plan)' : 'safe to spend, 30 days',
      tone: safe === null ? 'idle' : safe <= 0 ? 'watch' : 'ok', anchor: 'guard-safe' },
    { id: 'whatif', group: 'risk', name: 'If I pay this', metric: 'Check', sub: 'engine re-run per option', tone: 'idle', anchor: 'guard-check' },
    { id: 'flag', group: 'finance', name: 'Flag', metric: String(flags.open_count), sub: flags.open_count === 1 ? 'entry to review' : 'entries to review', tone: high ? 'act' : flags.open_count ? 'watch' : 'ok', anchor: 'guard-flags' },
    { id: 'verify', group: 'finance', name: 'Verify', metric: `${g.finance.checks_passed}/${g.finance.checks.length}`, sub: 'reconciliation checks pass', tone: g.finance.checks_passed === g.finance.checks.length ? 'ok' : 'act', anchor: 'guard-checks' },
    { id: 'grow', group: 'finance', name: 'Grow', metric: String(g.finance.opportunities.items.length), sub: g.finance.opportunities.items.length ? 'offers inside the safe amount' : 'none safe right now', tone: g.finance.opportunities.items.length ? 'ok' : 'idle', anchor: 'guard-grow' },
  ]
}

function reduced(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce'
  } catch {
    return false
  }
}

/** How the engine thinks, left to right: it reads the books, Risk looks forward, Finance checks the past and the cash, and the two agree on a verdict. */
export function Pipeline({ guard }: { guard: Guard }) {
  const list = nodes(guard)
  const total = list.length + 1
  const [lit, setLit] = useState(() => (reduced() ? total : -1))

  useEffect(() => {
    if (reduced()) { setLit(total); return }
    let step = -1
    const timer = window.setInterval(() => {
      step += 1
      setLit(step)
      if (step >= total) window.clearInterval(timer)
    }, 280)
    return () => window.clearInterval(timer)
  }, [total])

  const jump = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
  const cls = (i: number, tone: Tone) => `gp-node tone-${tone}${lit >= i ? ' lit' : ''}`
  const [books, ...rest] = list
  const risk = rest.filter((n) => n.group === 'risk')
  const fin = rest.filter((n) => n.group === 'finance')
  const node = (n: NodeInfo, i: number) => (
    <button key={n.id} type="button" className={cls(i, n.tone)} onClick={() => jump(n.anchor)} aria-label={`${n.name}: ${n.metric}, ${n.sub}. Jump to details.`}>
      <span className="gp-name">{n.name}</span>
      <span className="gp-metric">{n.metric}</span>
      <span className="gp-sub">{n.sub}</span>
    </button>
  )
  const link = (after: number) => <span className={`gp-link${lit > after ? ' lit' : ''}`} aria-hidden="true"><i /></span>

  return (
    <div className="gp" role="group" aria-label="How Risk and Finance reach one verdict">
      <div className="gp-col gp-books">{node(books, 0)}</div>
      {link(0)}
      <div className="gp-col gp-risk">
        <div className="gp-title">Risk <span className="faint">looks forward</span></div>
        {risk.map((n, i) => node(n, i + 1))}
      </div>
      {link(3)}
      <div className="gp-col gp-finance">
        <div className="gp-title">Finance <span className="faint">checks the books and the cash</span></div>
        {fin.map((n, i) => node(n, i + 4))}
      </div>
      {link(6)}
      <div className="gp-col gp-verdict">
        <div className={`gp-node gp-end tone-${guard.verdict.level}${lit >= total - 1 ? ' lit' : ''}`} role="status">
          <span className="gp-name">Verdict</span>
          <span className="gp-metric gp-headline">{guard.verdict.headline}</span>
          <span className="gp-sub">{guard.verdict.reasons[0]}</span>
        </div>
      </div>
      <p className="gp-note micro faint">Finance proposes, Risk disposes: every offer from Finance is checked against the amount Risk says is safe before it is shown. Nothing here changes your books; you decide.</p>
    </div>
  )
}
