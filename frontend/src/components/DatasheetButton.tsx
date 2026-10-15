import { DownloadSimpleIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { errorText } from '../lib/api'
import { downloadFile } from '../lib/download'
import { useUI } from '../lib/store'

/** Downloads one formatted CSV: a single customer, a single supplier, or the whole company. */
export function DatasheetButton({ target, label = 'Download datasheet (CSV)', className = 'btn btn-secondary', compact = false }: {
  target: { kind: 'party'; id: string; name: string } | { kind: 'company'; name?: string }
  label?: string
  className?: string
  compact?: boolean
}) {
  const toast = useUI((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const path = target.kind === 'party' ? `/export/party/${encodeURIComponent(target.id)}/datasheet.csv` : '/export/company/datasheet.csv'
  const subject = target.name ?? 'company'

  const run = async (event: React.MouseEvent) => {
    event.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const name = await downloadFile(path, 'ripple-datasheet.csv')
      toast(`Saved ${name}`)
    } catch (error) {
      toast(`Could not download the ${subject} datasheet. ${errorText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={className} disabled={busy} onClick={run} aria-label={compact ? `${label}: ${subject}` : undefined} title={compact ? label : undefined}>
      <DownloadSimpleIcon size={compact ? 14 : 16} />
      {!compact && <span>{busy ? 'Preparing' : label}</span>}
    </button>
  )
}
