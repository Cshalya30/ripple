import { useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, Factory, Phone, Store, TrendingUp, X } from 'lucide-react'
import type { Party } from '../types'
import { useDialog } from '../hooks/useDialog'
import { formatINR } from '../lib/format'
import { timingText, urgencyMeta, urgencyOf } from '../lib/urgency'

interface Props {
  party: Party | null
  onClose: () => void
}

export function PartyDrawer({ party, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialog(!!party, onClose, ref)

  return (
    <AnimatePresence>
      {party && <DrawerBody key={party.id} party={party} onClose={onClose} refNode={ref} titleId={titleId} />}
    </AnimatePresence>
  )
}

function DrawerBody({ party, onClose, refNode, titleId }: { party: Party; onClose: () => void; refNode: React.RefObject<HTMLDivElement>; titleId: string }) {
  const urgency = urgencyOf(party)
  const meta = urgencyMeta[urgency]
  const isSupplier = party.kind === 'supplier'
  const Icon = isSupplier ? Factory : Store
  const StatusIcon = meta.icon

  return (
    <div className="fixed inset-0 z-[60]">
      <motion.div className="absolute inset-0 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden="true" />
      <motion.aside
        ref={refNode}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 36 }}
        className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-line bg-surface shadow-lift"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${meta.soft} ${meta.text}`}>
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold leading-tight">
              {party.name}
            </h2>
            <p className="text-sm text-muted">
              {isSupplier ? 'Supplier' : 'Customer'}, {party.details}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details" className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink" data-autofocus>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className={`rounded-2xl ${meta.soft} px-4 py-4`}>
            <p className="text-sm font-medium text-muted">{isSupplier ? 'You owe' : 'Owes you'}</p>
            <p className={`num font-display text-3xl font-extrabold ${isSupplier ? 'text-loss' : 'text-gain'}`}>
              {isSupplier ? formatINR(-party.owedAmount) : formatINR(party.owedAmount, { sign: true })}
            </p>
            <p className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${meta.text}`}>
              <StatusIcon size={15} aria-hidden="true" />
              {meta.label}: {timingText(party).toLowerCase()}
            </p>
            {party.causesShortfall && <p className="mt-1 text-sm text-muted">This payment is part of what causes the Day 34 cash dip.</p>}
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-line px-3 py-2.5">
              <dt className="text-muted">{isSupplier ? 'Total supplied' : 'Total billed'}</dt>
              <dd className="num mt-0.5 font-semibold">{formatINR(party.totalAmount)}</dd>
            </div>
            <div className="rounded-xl border border-line px-3 py-2.5">
              <dt className="text-muted">{isSupplier ? 'Paid so far' : 'Received so far'}</dt>
              <dd className="num mt-0.5 font-semibold">{formatINR(party.paidAmount)}</dd>
            </div>
          </dl>

          <div>
            <h3 className="mb-2 text-sm font-semibold">{isSupplier ? 'Products supplied' : 'Products sold'}</h3>
            <ul className="flex flex-wrap gap-2">
              {party.products.map((p) => (
                <li key={p} className="rounded-full bg-sunken px-3 py-1 text-sm">
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <p className="flex items-center gap-2 text-sm text-muted">
            <Phone size={15} aria-hidden="true" />
            <span className="num">{party.phone}</span>
          </p>
        </div>

        <div className="flex gap-2 border-t border-line px-5 py-4">
          <Link to="/khata" className="btn btn-ghost flex-1" onClick={onClose}>
            <BookOpen size={16} aria-hidden="true" />
            Open khata
          </Link>
          <Link to="/forecast" className="btn btn-primary flex-1" onClick={onClose}>
            <TrendingUp size={16} aria-hidden="true" />
            See forecast
          </Link>
        </div>
      </motion.aside>
    </div>
  )
}
