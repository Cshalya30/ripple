import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useApp } from '../context/AppContext'
import { BUSINESS } from '../data/parties'
import { formatINR } from '../lib/format'

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { businessName, setBusinessName, pushToast, theme, toggleTheme } = useApp()
  const [name, setName] = useState(businessName)
  useEffect(() => {
    if (open) setName(businessName)
  }, [open, businessName])

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusinessName(trimmed)
    pushToast('Business name saved')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings" description="Basics for your business profile." maxWidth="max-w-md">
      <div className="space-y-4">
        <div>
          <label htmlFor="set-biz" className="mb-1.5 block text-sm font-medium">
            Business name
          </label>
          <input id="set-biz" data-autofocus className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="set-buffer" className="mb-1.5 block text-sm font-medium">
            Safety buffer
          </label>
          <input id="set-buffer" className="field" value={formatINR(BUSINESS.safetyBuffer)} readOnly aria-describedby="set-buffer-help" />
          <p id="set-buffer-help" className="mt-1 text-xs text-muted">
            Ripple warns you when your balance is projected to fall below this amount.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-sunken px-3.5 py-3">
          <span className="text-sm font-medium">Dark mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label="Dark mode"
            onClick={toggleTheme}
            className={`relative h-6 w-11 rounded-full transition ${theme === 'dark' ? 'bg-brand' : 'bg-line'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${theme === 'dark' ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Save changes
          </button>
        </div>
      </div>
    </Modal>
  )
}
