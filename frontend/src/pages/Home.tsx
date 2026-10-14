import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, BookOpen, CalendarClock, MessageCircle, Users, Wallet, Workflow } from 'lucide-react'
import { EngineDiagram } from '../components/EngineDiagram'
import { PartyDrawer } from '../components/PartyDrawer'
import { SampleBadge } from '../components/SampleBadge'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { useApp } from '../context/AppContext'
import { useService } from '../hooks/useService'
import { getForecast } from '../services/forecastService'
import { BUSINESS } from '../data/parties'
import { formatINR } from '../lib/format'
import { urgencyMeta } from '../lib/urgency'
import type { Party } from '../types'

function Ripples() {
  return (
    <div className="pointer-events-none relative hidden h-56 w-56 shrink-0 lg:block" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute inset-0 animate-ripple rounded-full border-2 border-brand"
          style={{ animationDelay: `${i * 1.35}s` }}
        />
      ))}
      <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" />
    </div>
  )
}

const steps = [
  { icon: Users, title: 'Add your suppliers and customers', body: 'Type them in, or upload your Excel sheet.', to: '/khata' },
  { icon: Workflow, title: 'Ripple maps your money flow', body: 'See who supplies you and who owes you, in one picture.', to: '#engine' },
  { icon: CalendarClock, title: 'See your 90-day cash forecast and the dip', body: 'Spot the day your balance runs short, weeks ahead.', to: '/forecast' },
  { icon: MessageCircle, title: 'Pick a fix and send the WhatsApp message', body: 'Choose a way out and send a ready-made message.', to: '/forecast' },
]

export default function Home() {
  const { parties, partiesLoading, businessName } = useApp()
  const navigate = useNavigate()
  const { data: forecast } = useService(getForecast)
  const [selected, setSelected] = useState<Party | null>(null)
  const engineRef = useRef<HTMLElement>(null)
  const onSelect = useCallback((p: Party) => setSelected(p), [])

  const totals = useMemo(() => {
    const receive = parties.filter((p) => p.kind === 'customer').reduce((s, p) => s + p.owedAmount, 0)
    const pay = parties.filter((p) => p.kind === 'supplier').reduce((s, p) => s + p.owedAmount, 0)
    return { receive, pay }
  }, [parties])

  const dipDays = forecast?.summary.firstDipDay ?? 0

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      {/* Hero */}
      <section className="flex items-center justify-between gap-8 py-2 sm:py-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">See the ripple before it hits your cash.</h2>
          <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">
            One customer pays late, and suddenly you cannot pay your supplier or restock. Ripple shows who owes you, who you owe, and the exact day your money runs short.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/forecast" className="btn btn-primary px-5 py-3 text-base">
              <CalendarClock size={18} aria-hidden="true" />
              See my forecast
            </Link>
            <Link to="/khata" className="btn btn-ghost px-5 py-3 text-base">
              <BookOpen size={18} aria-hidden="true" />
              Open khata
            </Link>
          </div>
        </div>
        <Ripples />
      </section>

      {/* KPI strip */}
      <section aria-label="Cash summary" className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="text-sm font-semibold">Where you stand today</p>
          <SampleBadge />
        </div>
        <dl className="grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
          <div className="border-b border-line px-5 py-4 lg:border-b-0">
            <dt className="flex items-center gap-2 text-sm text-muted">
              <Wallet size={16} aria-hidden="true" /> Cash today
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold sm:text-3xl">
              <AnimatedNumber value={BUSINESS.cashToday} />
            </dd>
          </div>
          <div className="border-b border-l border-line px-5 py-4 lg:border-b-0 lg:border-l-0">
            <dt className="flex items-center gap-2 text-sm text-muted">
              <ArrowDownLeft size={16} className="text-gain" aria-hidden="true" /> To receive
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold text-gain sm:text-3xl">
              <AnimatedNumber value={totals.receive} format={(n) => formatINR(n, { sign: true })} />
            </dd>
          </div>
          <div className="px-5 py-4">
            <dt className="flex items-center gap-2 text-sm text-muted">
              <ArrowUpRight size={16} className="text-loss" aria-hidden="true" /> To pay
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold text-loss sm:text-3xl">
              <AnimatedNumber value={-totals.pay} />
            </dd>
          </div>
          <div className="border-l border-line px-5 py-4 lg:border-l-0">
            <dt className="flex items-center gap-2 text-sm text-muted">
              <AlertTriangle size={16} className="text-loss" aria-hidden="true" /> Days until cash dip
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold sm:text-3xl">
              {forecast ? <AnimatedNumber value={dipDays} format={(n) => `${Math.round(n)} days`} /> : <span className="text-muted">…</span>}
            </dd>
          </div>
        </dl>
      </section>

      {/* Engine */}
      <section id="engine" ref={engineRef} className="card overflow-hidden" aria-labelledby="engine-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id="engine-title" className="text-xl font-bold">
              Your money flow
            </h2>
            <p className="text-sm text-muted">Suppliers you pay on the left, customers who pay you on the right. Hover for timing, select for details.</p>
          </div>
          <SampleBadge />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-sunken/60 px-5 py-2.5 text-xs font-medium">
          <span className="flex items-center gap-2">
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2" className="text-brand" />
            </svg>
            Inventory
          </span>
          <span className="flex items-center gap-2">
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2" className="text-muted" />
            </svg>
            Goods
          </span>
          <span className="flex items-center gap-2">
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="text-gain" />
            </svg>
            Cash
          </span>
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
          {(['ok', 'soon', 'risk'] as const).map((u) => {
            const m = urgencyMeta[u]
            return (
              <span key={u} className={`flex items-center gap-1.5 ${m.text}`}>
                <m.icon size={14} aria-hidden="true" />
                {m.label}
              </span>
            )
          })}
        </div>

        {partiesLoading ? (
          <div className="flex h-[560px] items-center justify-center text-sm text-muted sm:h-[680px]">Mapping your money flow…</div>
        ) : (
          <EngineDiagram parties={parties} cash={BUSINESS.cashToday} businessName={businessName} onSelect={onSelect} />
        )}
      </section>

      {/* How it works */}
      <section aria-labelledby="how-title">
        <h2 id="how-title" className="mb-4 text-xl font-bold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <motion.li key={s.title} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }} className="list-none">
              <button
                type="button"
                onClick={() => {
                  if (s.to === '#engine') engineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  else navigate(s.to)
                }}
                className="card flex h-full w-full flex-col gap-3 p-5 text-left transition hover:shadow-lift"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <s.icon size={20} aria-hidden="true" />
                  </span>
                  <span className="font-display text-sm font-bold text-muted">Step {i + 1}</span>
                </span>
                <span className="font-display text-lg font-bold leading-snug">{s.title}</span>
                <span className="text-sm text-muted">{s.body}</span>
              </button>
            </motion.li>
          ))}
        </ol>
      </section>

      <PartyDrawer party={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
