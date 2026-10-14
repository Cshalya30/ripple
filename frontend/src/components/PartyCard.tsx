import { Factory, Store, Trash2 } from 'lucide-react'
import type { Party } from '../types'
import { shortISODate } from '../lib/dates'
import { formatINR } from '../lib/format'

export function PartyCard({ party, onDelete }: { party: Party; onDelete: (party: Party) => void }) {
  const isSupplier = party.kind === 'supplier'
  const Icon = isSupplier ? Factory : Store
  const settled = party.owedAmount <= 0
  return (
    <li className="lift rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-brand">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate font-sans text-[15px] font-semibold leading-tight tracking-normal">{party.name}</h3>
            <button
              type="button"
              onClick={() => onDelete(party)}
              className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-loss-soft hover:text-loss"
              aria-label={`Delete ${party.name}`}
              title={`Delete ${party.name}`}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
          <p className="truncate text-sm text-muted">{party.details}</p>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={isSupplier ? 'Products supplied' : 'Products sold'}>
        {party.products.map((p) => (
          <li key={p} className="rounded-full bg-sunken px-2.5 py-0.5 text-xs">
            {p}
          </li>
        ))}
      </ul>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
        <div>
          <dt className="text-muted">{isSupplier ? 'Supply date' : 'Transaction date'}</dt>
          <dd className="mt-0.5 font-medium">{shortISODate(party.transactionDate)}</dd>
        </div>
        <div>
          <dt className="text-muted">Due date</dt>
          <dd className="mt-0.5 font-medium">{shortISODate(party.dueDate)}</dd>
        </div>
      </dl>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-muted">{isSupplier ? 'Total supplied' : 'Total billed'}</dt>
          <dd className="num font-semibold">{formatINR(party.totalAmount)}</dd>
        </div>
        <div>
          <dt className="text-muted">{isSupplier ? 'I still owe them' : 'Still owed to me'}</dt>
          <dd className={`num font-bold ${settled ? 'text-muted' : isSupplier ? 'text-loss' : 'text-gain'}`}>
            {settled ? 'Settled' : isSupplier ? formatINR(-party.owedAmount) : formatINR(party.owedAmount, { sign: true })}
          </dd>
        </div>
      </dl>
    </li>
  )
}
