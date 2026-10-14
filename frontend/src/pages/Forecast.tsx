import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Landmark, MessageCircle, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { ForecastChart } from '../components/ForecastChart'
import { FixCards } from '../components/FixCards'
import { WhatsAppComposer } from '../components/WhatsAppComposer'
import { SampleBadge } from '../components/SampleBadge'
import { useService } from '../hooks/useService'
import { getFixOptions, getForecast } from '../services/forecastService'
import { formatCompact, formatINR } from '../lib/format'
import type { BreakdownItem } from '../types'

type Range = 30 | 60 | 90

function Skeleton() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card h-28 animate-pulse bg-sunken" />
        ))}
      </div>
      <div className="card h-[460px] animate-pulse bg-sunken" />
    </div>
  )
}

function BreakdownList({ title, items, tone }: { title: string; items: BreakdownItem[]; tone: 'gain' | 'loss' }) {
  const max = Math.max(...items.map((i) => i.amount), 1)
  const total = items.reduce((s, i) => s + i.amount, 0)
  const Icon = tone === 'gain' ? ArrowDownLeft : ArrowUpRight
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon size={16} className={tone === 'gain' ? 'text-gain' : 'text-loss'} aria-hidden="true" />
          {title}
        </h3>
        <span className={`num text-sm font-bold ${tone === 'gain' ? 'text-gain' : 'text-loss'}`}>{formatCompact(tone === 'gain' ? total : -total, { sign: true })}</span>
      </div>
      <ul className="space-y-3">
        {items.slice(0, 6).map((i) => (
          <li key={i.name}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span className="truncate">{i.name}</span>
              <span className={`num shrink-0 font-semibold ${tone === 'gain' ? 'text-gain' : 'text-loss'}`}>{formatINR(tone === 'gain' ? i.amount : -i.amount, { sign: true })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
              <div className={`h-full rounded-full ${tone === 'gain' ? 'bg-gain' : 'bg-loss'}`} style={{ width: `${(i.amount / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Forecast() {
  const { data, loading } = useService(getForecast)
  const { data: fixes } = useService(getFixOptions)
  const [range, setRange] = useState<Range>(90)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const messageRef = useRef<HTMLElement>(null)

  const selected = fixes?.find((f) => f.id === selectedId) ?? null

  useEffect(() => {
    if (!selected) return
    const t = setTimeout(() => messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 250)
    return () => clearTimeout(t)
  }, [selected])

  if (loading || !data) return <Skeleton />
  const { summary, series, causes, receivables, payables } = data

  const kpis = [
    { label: 'Cash today', value: summary.cashToday, icon: Wallet, tone: 'text-ink', fmt: (n: number) => formatINR(n) },
    { label: 'Expected inflows (90d)', value: summary.inflows, icon: ArrowDownLeft, tone: 'text-gain', fmt: (n: number) => formatINR(n, { sign: true }) },
    { label: 'Expected outflows (90d)', value: -summary.outflows, icon: ArrowUpRight, tone: 'text-loss', fmt: (n: number) => formatINR(n) },
    { label: 'Net profit (90d)', value: summary.net, icon: summary.net >= 0 ? TrendingUp : TrendingDown, tone: summary.net >= 0 ? 'text-gain' : 'text-loss', fmt: (n: number) => formatINR(n, { sign: true }) },
    { label: 'Lowest point', value: summary.lowest.balance, icon: TrendingDown, tone: 'text-loss', fmt: (n: number) => formatINR(n), hint: `Day ${summary.lowest.day}` },
  ]

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold sm:text-3xl">Your next 90 days of cash</h2>
          <p className="text-muted">See when money runs short, then pick a fix.</p>
        </div>
        <SampleBadge />
      </div>

      {/* KPI cards */}
      <section aria-label="Forecast summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="card lift p-4">
            <p className="flex items-center gap-2 text-sm text-muted">
              <k.icon size={16} className={k.tone} aria-hidden="true" />
              {k.label}
            </p>
            <p className={`mt-2 font-display text-2xl font-bold ${k.tone}`}>
              <AnimatedNumber value={k.value} format={k.fmt} />
            </p>
            {k.hint && <p className="mt-0.5 text-sm font-medium text-loss">{k.hint}</p>}
          </div>
        ))}
      </section>

      {/* Chart */}
      <section className="card p-4 sm:p-6" aria-labelledby="chart-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="chart-title" className="text-xl font-bold">
              Projected cash balance
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted">
              <span className="flex items-center gap-1.5">
                <svg width="22" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2.5" className="text-brand" />
                </svg>
                Original forecast
              </span>
              {selected && (
                <span className="flex items-center gap-1.5 text-gain">
                  <svg width="22" height="6" aria-hidden="true">
                    <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2.5" strokeDasharray="5 3" />
                  </svg>
                  After fix
                </span>
              )}
              <span className="flex items-center gap-1.5 text-loss">
                <span className="h-3 w-3 rounded-sm bg-loss/20 ring-1 ring-loss/40" aria-hidden="true" />
                Below safety buffer
              </span>
            </div>
          </div>
          <div role="radiogroup" aria-label="Forecast range" className="flex rounded-xl border border-line bg-sunken p-1">
            {([30, 60, 90] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={range === r}
                onClick={() => setRange(r)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${range === r ? 'bg-surface text-brand shadow-soft' : 'text-muted hover:text-ink'}`}
              >
                {r} days
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex items-start gap-3 rounded-xl bg-loss-soft px-4 py-3 text-sm">
          <TrendingDown size={18} className="mt-0.5 shrink-0 text-loss" aria-hidden="true" />
          <p>
            <span className="num font-bold text-loss">{formatCompact(Math.abs(summary.lowest.balance))} short on Day {summary.lowest.day}:</span>{' '}
            Sharma Yarn Mills payment due, Kaveri Boutique hasn't paid.
          </p>
        </div>

        <ForecastChart series={series} summary={summary} range={range} afterSeries={selected?.afterSeries ?? null} />
      </section>

      {/* Why + breakdown */}
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-2" aria-labelledby="why-title">
          <h2 id="why-title" className="text-xl font-bold">
            Why the dip happens
          </h2>
          <p className="mt-1 text-sm text-muted">Three things land close together and drain your cash before the money you are owed arrives.</p>
          <ul className="mt-4 space-y-4">
            {causes.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.kind === 'outflow' ? 'bg-loss-soft text-loss' : 'bg-warn-soft text-warn'}`}>
                  {c.kind === 'outflow' ? <ArrowUpRight size={18} aria-hidden="true" /> : <CalendarClock size={18} aria-hidden="true" />}
                </span>
                <div>
                  <p className="font-semibold leading-snug">{c.title}</p>
                  <p className="text-sm text-muted">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5 lg:col-span-3" aria-labelledby="flow-title">
          <h2 id="flow-title" className="text-xl font-bold">
            Where the money moves
          </h2>
          <div className="mt-4 grid gap-8 sm:grid-cols-2">
            <BreakdownList title="Who pays you" items={receivables} tone="gain" />
            <BreakdownList title="Who you pay" items={payables} tone="loss" />
          </div>
        </section>
      </div>

      {/* Fixes */}
      <section aria-labelledby="fix-title">
        <div className="mb-4">
          <h2 id="fix-title" className="text-xl font-bold">
            Ways to fix the dip
          </h2>
          <p className="text-sm text-muted">Select one to see your balance after the fix and get a message you can send.</p>
        </div>
        {fixes && <FixCards options={fixes} baseLowest={summary.lowest.balance} selectedId={selectedId} onSelect={setSelectedId} />}
      </section>

      {/* WhatsApp */}
      <AnimatePresence>
        {selected && (
          <motion.section
            ref={messageRef}
            key="wa"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="card p-5 sm:p-6"
            aria-labelledby="wa-title"
          >
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gain-soft text-gain">
                {selected.id === 'invoice-financing' ? <Landmark size={20} aria-hidden="true" /> : <MessageCircle size={20} aria-hidden="true" />}
              </span>
              <div>
                <h2 id="wa-title" className="text-xl font-bold">
                  Send this on WhatsApp
                </h2>
                <p className="text-sm text-muted">Ready to send for: {selected.title}</p>
              </div>
            </div>
            <WhatsAppComposer fix={selected} />
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
