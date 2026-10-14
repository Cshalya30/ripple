import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Download, FileUp, Plus, Search, TrendingUp } from 'lucide-react'
import { PartyCard } from '../components/PartyCard'
import { Modal } from '../components/Modal'
import { PartyFormModal } from '../components/PartyFormModal'
import { UploadModal } from '../components/UploadModal'
import { SampleBadge } from '../components/SampleBadge'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { useApp } from '../context/AppContext'
import { exportPartiesCsv } from '../services/partyService'
import { formatINR } from '../lib/format'
import type { Party, PartyKind } from '../types'

type SortKey = 'owed' | 'due' | 'name' | 'total'

const sorters: Record<SortKey, (a: Party, b: Party) => number> = {
  owed: (a, b) => b.owedAmount - a.owedAmount,
  due: (a, b) => a.dueDate.localeCompare(b.dueDate),
  name: (a, b) => a.name.localeCompare(b.name),
  total: (a, b) => b.totalAmount - a.totalAmount,
}

function Column({ kind, parties, onDelete, initialQuery = '' }: { kind: PartyKind; parties: Party[]; onDelete: (party: Party) => void; initialQuery?: string }) {
  const isCustomer = kind === 'customer'
  const [query, setQuery] = useState(initialQuery)
  const [sort, setSort] = useState<SortKey>('owed')
  const id = `col-${kind}`

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return parties
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.details.toLowerCase().includes(q) || p.products.some((x) => x.toLowerCase().includes(q)))
      .sort(sorters[sort])
  }, [parties, query, sort])

  return (
    <section className="card flex flex-col overflow-hidden" aria-labelledby={`${id}-title`}>
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-center justify-between">
          <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold">
            {isCustomer ? <ArrowDownLeft size={18} className="text-gain" aria-hidden="true" /> : <ArrowUpRight size={18} className="text-loss" aria-hidden="true" />}
            {isCustomer ? 'Customers' : 'Suppliers'}
          </h2>
          <span className="num rounded-full bg-sunken px-2.5 py-0.5 text-sm font-semibold">{parties.length}</span>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <label htmlFor={`${id}-search`} className="sr-only">
              Search {isCustomer ? 'customers' : 'suppliers'}
            </label>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input id={`${id}-search`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or product" className="field py-2 !pl-10" />
          </div>
          <div>
            <label htmlFor={`${id}-sort`} className="sr-only">
              Sort {isCustomer ? 'customers' : 'suppliers'}
            </label>
            <select id={`${id}-sort`} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="field w-auto py-2">
              <option value="owed">{isCustomer ? 'Owes most' : 'Owed most'}</option>
              <option value="due">Due soonest</option>
              <option value="total">Highest total</option>
              <option value="name">Name A to Z</option>
            </select>
          </div>
        </div>
      </div>
      <div className="max-h-[640px] flex-1 overflow-y-auto p-4">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            {query ? `No ${isCustomer ? 'customers' : 'suppliers'} match "${query}". Clear the search to see everyone.` : `No ${isCustomer ? 'customers' : 'suppliers'} yet. Add one to start your khata.`}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((p) => (
              <PartyCard key={p.id} party={p} onDelete={onDelete} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Tally({ parties }: { parties: Party[] }) {
  const rows = useMemo(() => parties.filter((p) => p.owedAmount > 0).sort((a, b) => b.owedAmount - a.owedAmount), [parties])
  const receive = parties.filter((p) => p.kind === 'customer').reduce((s, p) => s + p.owedAmount, 0)
  const pay = parties.filter((p) => p.kind === 'supplier').reduce((s, p) => s + p.owedAmount, 0)
  const net = receive - pay

  return (
    <section className="card flex flex-col overflow-hidden" aria-labelledby="tally-title">
      <div className="border-b border-line p-4">
        <h2 id="tally-title" className="text-lg font-bold">
          Tally
        </h2>
        <p className="text-sm text-muted">Everything you will receive and everything you owe.</p>
      </div>
      <div className="max-h-[420px] flex-1 overflow-y-auto lg:max-h-[440px]">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Nothing outstanding. Add a customer or supplier to see it here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((p) => {
              const incoming = p.kind === 'customer'
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">{incoming ? 'will receive' : 'to pay'}</p>
                  </div>
                  <p className={`num shrink-0 text-sm font-bold ${incoming ? 'text-gain' : 'text-loss'}`}>{incoming ? formatINR(p.owedAmount, { sign: true }) : formatINR(-p.owedAmount)}</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="space-y-3 border-t border-line bg-sunken/60 p-4">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Total to receive</dt>
            <dd className="num font-semibold text-gain">{formatINR(receive, { sign: true })}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Total to pay</dt>
            <dd className="num font-semibold text-loss">{formatINR(-pay)}</dd>
          </div>
        </dl>
        <div className={`rounded-xl px-4 py-3 ${net < 0 ? 'bg-loss-soft' : 'bg-gain-soft'}`}>
          <p className="text-sm font-medium text-muted">Net position</p>
          <p className={`font-display text-3xl font-extrabold ${net < 0 ? 'text-loss' : 'text-gain'}`}>
            <AnimatedNumber value={net} format={(n) => formatINR(n, { sign: true })} duration={0.6} />
          </p>
        </div>
        <Link to="/forecast" className="btn btn-primary w-full">
          <TrendingUp size={16} aria-hidden="true" />
          View forecast
        </Link>
      </div>
    </section>
  )
}

export default function Khata() {
  const { parties, partiesLoading, deleteParty, pushToast } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [modal, setModal] = useState<'customer' | 'supplier' | 'upload' | null>(null)
  const [partyToDelete, setPartyToDelete] = useState<Party | null>(null)

  // Open a modal when another page (like the assistant) asks for it.
  useEffect(() => {
    const open = (location.state as { open?: string } | null)?.open
    if (open === 'customer' || open === 'supplier' || open === 'upload') {
      setModal(open)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location, navigate])

  const customers = parties.filter((p) => p.kind === 'customer')
  const suppliers = parties.filter((p) => p.kind === 'supplier')
  const selectedParty = searchParams.get('party') ?? ''
  const selectedPartyId = searchParams.get('partyId')

  const handleDelete = (party: Party) => {
    setPartyToDelete(party)
  }

  const confirmDelete = async () => {
    if (!partyToDelete) return
    const party = partyToDelete
    setPartyToDelete(null)
    await deleteParty(party.id)
    pushToast(`${party.name} removed from the khata.`)
  }

  const downloadTemplate = async () => {
    const csv = await exportPartiesCsv(parties)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `ripple-khata-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold sm:text-3xl">Your khata</h2>
            <SampleBadge />
          </div>
          <p className="text-muted">Who owes you, who you owe. This feeds your forecast.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setModal('customer')}>
            <Plus size={16} aria-hidden="true" />
            Add customer
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setModal('supplier')}>
            <Plus size={16} aria-hidden="true" />
            Add supplier
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setModal('upload')}>
            <FileUp size={16} aria-hidden="true" />
            Upload Excel/CSV
          </button>
          <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>
            <Download size={16} aria-hidden="true" />
            Download CSV
          </button>
        </div>
      </div>

      {partiesLoading ? (
        <p className="py-16 text-center text-muted">Loading your khata…</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <Column
            kind="customer"
            parties={customers}
            onDelete={handleDelete}
            initialQuery={selectedParty || customers.find((party) => party.id === selectedPartyId)?.name || ''}
          />
          <Column
            kind="supplier"
            parties={suppliers}
            onDelete={handleDelete}
            initialQuery={selectedParty || suppliers.find((party) => party.id === selectedPartyId)?.name || ''}
          />
          <Tally parties={parties} />
        </div>
      )}

      <PartyFormModal kind="customer" open={modal === 'customer'} onClose={() => setModal(null)} />
      <PartyFormModal kind="supplier" open={modal === 'supplier'} onClose={() => setModal(null)} />
      <UploadModal open={modal === 'upload'} onClose={() => setModal(null)} />
      <Modal
        open={partyToDelete !== null}
        onClose={() => setPartyToDelete(null)}
        title={`Delete ${partyToDelete?.name ?? 'party'}?`}
        description="This removes the party from your khata and tally."
        maxWidth="max-w-md"
      >
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setPartyToDelete(null)}>
            Cancel
          </button>
          <button type="button" className="btn bg-loss text-white hover:opacity-90" onClick={confirmDelete}>
            Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}
