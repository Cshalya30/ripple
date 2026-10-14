import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileSpreadsheet, UploadCloud } from 'lucide-react'
import { Modal } from './Modal'
import { useApp } from '../context/AppContext'
import { DEFAULT_MAPPING, FIELD_OPTIONS, FILE_COLUMNS, sampleRows } from '../data/uploadSample'
import { isoFromOffset } from '../lib/dates'
import { formatINR } from '../lib/format'

type Step = 'drop' | 'map'

const samplePreviewRows = sampleRows.slice(0, 5).map((r) => ({
  'Party name': r.party,
  Type: r.type,
  Phone: r.phone,
  Item: r.item,
  Qty: String(r.qty),
  'Bill amount': formatINR(r.bill),
  'Received / Paid': formatINR(r.settled),
  'Bill date': isoFromOffset(-r.billedDaysAgo),
  'Due date': isoFromOffset(r.dueIn),
}))

type PreviewRow = Record<(typeof FILE_COLUMNS)[number], string>

function parseCsv(text: string): { rows: PreviewRow[]; count: number } {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)

  const headers = rows.shift()?.map((header) => header.replace(/^\ufeff/, '').trim()) ?? []
  return {
    rows: rows.slice(0, 5).map((values) => Object.fromEntries(FILE_COLUMNS.map((column) => [column, values[headers.indexOf(column)] ?? ''])) as PreviewRow),
    count: rows.length,
  }
}

export function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { importParties, pushToast } = useApp()
  const [step, setStep] = useState<Step>('drop')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>(DEFAULT_MAPPING)
  const [importing, setImporting] = useState(false)
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>(samplePreviewRows)
  const [rowCount, setRowCount] = useState(sampleRows.length)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setStep('drop')
      setFileName('')
      setError('')
      setDragging(false)
      setMapping(DEFAULT_MAPPING)
      setImporting(false)
      setPreviewRows(samplePreviewRows)
      setRowCount(sampleRows.length)
    }
  }, [open])

  const accept = async (file: File | undefined) => {
    if (!file) return
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError(`"${file.name}" is not supported. Upload an .xlsx or .csv file.`)
      return
    }
    setError('')
    setFileName(file.name)
    if (file.size > 0 && /\.csv$/i.test(file.name)) {
      const parsed = parseCsv(await file.text())
      if (parsed.count === 0) {
        setError(`"${file.name}" does not contain any data rows.`)
        return
      }
      setPreviewRows(parsed.rows)
      setRowCount(parsed.count)
    } else {
      setPreviewRows(samplePreviewRows)
      setRowCount(sampleRows.length)
    }
    setStep('map')
  }

  const mapped = Object.values(mapping)
  const missing = [
    !mapped.includes('Name') && 'Name',
    !mapped.includes('Customer or Supplier') && 'Customer or Supplier',
    !mapped.includes('Total amount') && 'Total amount',
  ].filter(Boolean) as string[]

  const doImport = async () => {
    setImporting(true)
    const added = await importParties()
    const customers = added.filter((party) => party.kind === 'customer').length
    pushToast(`Imported ${added.length} rows: ${customers} customers and ${added.length - customers} suppliers`)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Upload Excel or CSV" description={step === 'drop' ? 'Bring in your whole ledger in one go.' : 'Check how your columns match Ripple fields.'} maxWidth="max-w-3xl">
      {step === 'drop' ? (
        <div>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              accept(e.dataTransfer.files[0])
            }}
            className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${dragging ? 'border-brand bg-brand-soft' : 'border-line bg-sunken/50'}`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <UploadCloud size={28} aria-hidden="true" />
            </span>
            <p className="font-display text-lg font-bold">Drop your file here</p>
            <p className="text-sm text-muted">Accepts .xlsx and .csv</p>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" id="upload-file" onChange={(e) => accept(e.target.files?.[0])} />
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn btn-primary" data-autofocus onClick={() => inputRef.current?.click()}>
                Choose a file
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => accept(new File([], 'ripple-sample-ledger.xlsx'))}>
                <FileSpreadsheet size={16} aria-hidden="true" />
                Try a sample file
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-3 rounded-xl bg-loss-soft px-3 py-2 text-sm font-medium text-loss" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl bg-sunken px-4 py-3">
            <FileSpreadsheet size={20} className="text-gain" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{fileName}</p>
              <p className="text-xs text-muted">{rowCount} rows found. Showing the first {Math.min(rowCount, 5)}.</p>
            </div>
            <button type="button" className="btn btn-ghost px-3 py-1.5" onClick={() => setStep('drop')}>
              <ArrowLeft size={14} aria-hidden="true" />
              Change file
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Preview of the first rows of your file</caption>
              <thead>
                <tr className="border-b border-line bg-sunken/70">
                  {FILE_COLUMNS.map((c) => (
                    <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {FILE_COLUMNS.map((c) => (
                      <td key={c} className="num whitespace-nowrap px-3 py-2">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 font-sans text-sm font-semibold tracking-normal">Match columns</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {FILE_COLUMNS.map((c) => (
                <div key={c} className="flex items-center gap-3">
                  <label htmlFor={`map-${c}`} className="w-32 shrink-0 text-sm text-muted">
                    {c}
                  </label>
                  <select id={`map-${c}`} className="field py-2" value={mapping[c]} onChange={(e) => setMapping((m) => ({ ...m, [c]: e.target.value }))}>
                    {FIELD_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn" role="status">
                Match a column to: {missing.join(', ')}.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={missing.length > 0 || importing} onClick={doImport}>
              {importing ? 'Importing…' : `Import ${rowCount} rows`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
