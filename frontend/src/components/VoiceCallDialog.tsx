import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorText } from '../lib/api'
import { dayDate, rupees } from '../lib/format'
import { useWrite } from '../lib/queries'
import { useUI } from '../lib/store'
import type { VoiceCall, VoiceCallPreview } from '../lib/types'
import { Dialog, ErrorNote, Skeleton } from './ui'

const BLOCK_REASON: Record<string, string> = {
  DO_NOT_CALL: 'This customer asked not to be called again.',
  DISPUTED: 'This invoice is marked disputed; call them yourself instead.',
  NOT_OVERDUE: 'This invoice is not overdue yet.',
  NO_PHONE: 'There is no phone number on file for this customer.',
  ALREADY_CALLED_TODAY: 'This invoice has already been called today.',
  OUTSIDE_CALL_WINDOW: 'Calls are only placed between 09:00 and 19:00.',
}

const OUTCOME_LABEL: Record<string, string> = {
  promised: 'Promised to pay',
  partial: 'Will pay part now',
  disputed: 'Disputed the invoice',
  callback: 'Asked to be called back',
  refused: 'Asked not to be called again',
  wrong_person: 'Reached the wrong person',
  NA: 'No clear outcome',
}

const TERMINAL = new Set(['completed', 'no_answer', 'busy', 'failed'])

export function VoiceCallDialog() {
  const invoiceId = useUI((s) => s.voiceCallInvoiceId)
  const close = useUI((s) => s.openVoiceCall)
  const toast = useUI((s) => s.toast)
  const qc = useQueryClient()
  const [approved, setApproved] = useState(false)
  const [callId, setCallId] = useState<string | null>(null)

  const preview = useQuery({
    queryKey: ['voice-preview', invoiceId],
    enabled: !!invoiceId && !callId,
    queryFn: () => api.post<VoiceCallPreview>('/voice/calls/preview', { invoice_id: invoiceId }),
  })

  const status = useQuery({
    queryKey: ['voice-call', callId],
    enabled: !!callId,
    refetchInterval: (query) => (query.state.data && TERMINAL.has((query.state.data as { voice_call: VoiceCall }).voice_call.status) ? false : 3000),
    queryFn: () => api.get<{ voice_call: VoiceCall }>(`/voice/calls/${callId}`),
  })

  const place = useWrite((invoice_id: string) => api.post<{ voice_call: VoiceCall }>('/voice/calls', { invoice_id, approved: true }))

  if (!invoiceId) return null
  const data = preview.data
  const call = status.data?.voice_call

  const reset = () => {
    setApproved(false)
    setCallId(null)
    close(null)
  }

  return (
    <Dialog open onClose={reset} title={`Call customer${data ? ` · ${data.customer_name}` : ''}`}
      description="The owner approves, Ripple dials. The result writes the promised date and the forecast re-runs.">
      {!callId && (
        <>
          {preview.isLoading && <Skeleton h={160} />}
          {preview.isError && <ErrorNote text={errorText(preview.error)} />}
          {data && (
            <div className="stack" style={{ gap: 10 }}>
              {data.demo_mode && (
                <span className="badge" style={{ background: 'var(--haldi)', color: 'var(--ink)' }}>
                  Demo mode: calling the team number, not {data.customer_name}
                </span>
              )}
              <p className="small muted" style={{ margin: 0 }}>
                Invoice {rupees(data.amount_paise)}, {data.days_overdue} days overdue · {data.masked_phone ?? 'no phone on file'}
              </p>
              {data.current_shortfall && (
                <p className="small" style={{ margin: 0 }}>
                  Current forecast: short {rupees(data.current_shortfall.shortfall_paise)} on {dayDate(data.current_shortfall.date)}.
                </p>
              )}
              <div className="notice" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                <strong lang="hi">{data.opening_hi}</strong>
                <div className="micro faint" style={{ marginTop: 6 }}>{data.opening_en}</div>
              </div>
              {data.blocked_by ? (
                <ErrorNote text={BLOCK_REASON[data.blocked_by] ?? `Blocked: ${data.blocked_by}`} />
              ) : (
                <label className="check small">
                  <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
                  I approve this call on my behalf.
                </label>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button className="btn btn-secondary" onClick={reset}>Cancel</button>
            <button className="btn btn-primary" disabled={!data || !!data.blocked_by || !approved || place.isPending}
              onClick={async () => {
                try {
                  const result = await place.mutateAsync(invoiceId)
                  setCallId(result.voice_call.id)
                } catch (err) {
                  toast(errorText(err))
                }
              }}>
              {place.isPending ? 'Calling…' : 'Approve and call'}
            </button>
          </div>
        </>
      )}
      {callId && (
        <CallResult call={call} onClose={() => { reset(); void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }) }} />
      )}
    </Dialog>
  )
}

function CallResult({ call, onClose }: { call?: VoiceCall; onClose: () => void }) {
  const [showTranscript, setShowTranscript] = useState(false)
  if (!call) return <Skeleton h={120} />
  const live = !TERMINAL.has(call.status)
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="row" style={{ margin: 0, gap: 6 }}>
        <span className={`badge ${live ? '' : 'level-ok'}`}>
          {live ? call.status.replace('_', ' ') : (OUTCOME_LABEL[call.outcome ?? ''] ?? call.status.replace('_', ' '))}
        </span>
        {call.is_replay && <span className="badge level-watch">Replay — not a live call</span>}
      </p>
      {call.status === 'no_answer' && <p className="muted small">No answer. Try again later, or chase another way.</p>}
      {call.status === 'failed' && <p className="muted small">The call could not be placed.</p>}
      {call.promised_date && <p className="small">Promised to pay by <strong>{dayDate(call.promised_date)}</strong>.</p>}
      {call.partial_amount_paise != null && (
        <p className="small">Agreed to pay {rupees(call.partial_amount_paise)}{call.partial_date ? ` by ${dayDate(call.partial_date)}` : ''}.</p>
      )}
      {(call.shortfall_before_paise != null || call.shortfall_after_paise != null) && (
        <p className="small">
          {call.shortfall_before_paise != null
            ? <>Was short {rupees(call.shortfall_before_paise)}{call.shortfall_before_date ? ` on ${dayDate(call.shortfall_before_date)}` : ''}.</>
            : 'No shortfall before the call.'}{' '}
          {call.shortfall_after_paise != null
            ? <>Now short {rupees(call.shortfall_after_paise)}{call.shortfall_after_date ? ` on ${dayDate(call.shortfall_after_date)}` : ''}.</>
            : 'No shortfall in the next 60 days after the call.'}
        </p>
      )}
      {call.transcript && (
        <div>
          <button className="btn btn-sm btn-quiet" onClick={() => setShowTranscript(!showTranscript)}>
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
          {showTranscript && <div className="notice micro" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{call.transcript}</div>}
        </div>
      )}
      {call.recording_url && (
        <a className="btn btn-sm btn-secondary" href={call.recording_url} target="_blank" rel="noopener noreferrer">Play recording</a>
      )}
      <div className="dialog-actions">
        <button className="btn btn-primary" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
