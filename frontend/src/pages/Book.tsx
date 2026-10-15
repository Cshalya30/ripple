import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { RunwayChart, RunwayTable } from '../components/RunwayChart'
import { Amount, ErrorNote, Section, Seg, Skeleton, SkeletonRows, Status, StripCell } from '../components/ui'
import { api, errorText } from '../lib/api'
import { clock, dayDate, percent, rupees, shortDate } from '../lib/format'
import { useBook, useFixes, useRisk, useTransactions } from '../lib/queries'
import { useUI } from '../lib/store'
import type { ChanceAfter, DipItem, Evaluation, Me, Risk, RunPayload } from '../lib/types'

export function Book({ me }: { me: Me }) {
  const { t } = useTranslation()
  const book = useBook()
  const risk = useRisk()
  const location = useLocation()
  const [window, setWindow] = useState<30 | 60 | 90>(90)
  const [asTable, setAsTable] = useState(false)

  useEffect(() => {
    if (location.hash === '#fixes' && book.data) document.getElementById('fixes')?.scrollIntoView({ behavior: 'smooth' })
  }, [location.hash, book.data])

  if (book.isLoading) return <div className="page"><Skeleton h={84} /><Skeleton h={240} style={{ marginTop: 24 }} /><div style={{ marginTop: 24 }}><SkeletonRows /></div></div>
  if (book.isError || !book.data) return <div className="page"><ErrorNote text={`Couldn't reach the engine. ${errorText(book.error)}`} retry={() => book.refetch()} /></div>
  const { position: pos, series, summary, why, run } = book.data
  const fan = risk.data?.status === 'READY' && risk.data.snapshot_hash === run.snapshot_hash ? risk.data.fan : undefined

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="h1">{t('nav.book')}</h1>
        <span className="spacer" />
        <span className="mono micro faint">engine run {clock(run.created_at)} · {run.event_count} events</span>
      </div>

      <Section title={t('book.position')}>
        <div className="strip">
          <StripCell label={t('common.cashNow')} sub={pos.pending_cheques.count ? `${pos.pending_cheques.count} cheque pending, ${rupees(pos.pending_cheques.value_paise)}` : undefined}>{rupees(pos.cash_now_paise)}</StripCell>
          <StripCell label={t('common.toReceive')}><span className="amt-in">{rupees(pos.to_receive_paise, { sign: true })}</span></StripCell>
          <StripCell label={t('common.toPay')}><span className="amt-out">{rupees(-pos.to_pay_paise)}</span></StripCell>
          <StripCell label={t('common.net')} total sub="cash plus receivables minus payables, today">{rupees(pos.net_paise, { sign: true })}</StripCell>
        </div>
      </Section>
      <Section title={t('book.goods')}>
        <div className="strip compact">
          <StripCell label="Materials on the way" sub={`${pos.materials_on_the_way.count} lots`}>{rupees(pos.materials_on_the_way.value_paise)}</StripCell>
          <StripCell label="Goods to deliver" sub={`${pos.goods_to_deliver.count} orders`}>{rupees(pos.goods_to_deliver.value_paise)}</StripCell>
        </div>
      </Section>

      <div className="cols-2-1">
        <Section title={t('common.runway')} aside={
          <div className="row">
            <Seg label="Window" value={String(window) as '30' | '60' | '90'} onChange={(v) => setWindow(Number(v) as 30 | 60 | 90)}
              options={[{ value: '30', label: '30d' }, { value: '60', label: '60d' }, { value: '90', label: '90d' }]} />
            <button className="btn btn-sm btn-quiet" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>{asTable ? 'View as chart' : 'View as table'}</button>
          </div>
        }>
          <p className="small muted" style={{ margin: '6px 0 10px' }}>
            Net position = engine cash balance minus payments due but not yet made. {summary.first_shortfall
              ? <>First shortfall <strong className="amt-out">{rupees(-summary.first_shortfall.shortfall_paise)}</strong> on {dayDate(summary.first_shortfall.date)} (D{summary.first_shortfall.day}).</>
              : <>No shortfall in {summary.horizon_days} days.</>}
          </p>
          {asTable ? <RunwayTable series={series} fan={fan} window={window} /> : <RunwayChart series={series} fan={fan} buffer={summary.buffer_paise} window={window} />}
        </Section>
        <Section title={t('book.risk')}>
          <RiskPanel risk={risk.data} isError={risk.isError} runHash={run.snapshot_hash} />
        </Section>
      </div>

      <div className="cols-2-1">
        <Section title={t('book.why')}>
          <Why items={why} />
        </Section>
        <div />
      </div>

      <Section title={t('book.fixes')} id="fixes">
        <Fixes me={me} />
      </Section>

      <Section title={t('book.transactions')}>
        <Transactions />
      </Section>
    </div>
  )
}

function RiskPanel({ risk, isError, runHash }: { risk?: Risk; isError: boolean; runHash: string }) {
  if (isError || risk?.status === 'UNAVAILABLE') return <p className="muted">Risk unavailable. The plan above is still the engine's deterministic forecast.</p>
  if (!risk || risk.status === 'COMPUTING' || risk.status === 'MISSING' || (risk.snapshot_hash && risk.snapshot_hash !== runHash)) {
    return <div className="stack"><p className="muted" style={{ margin: 0 }}>Risk is being recalculated…</p><Skeleton h={18} w="60%" /><Skeleton h={18} w="40%" /></div>
  }
  if (risk.status === 'INSUFFICIENT_HISTORY') {
    return <p className="muted">Not enough payment history to estimate risk ({risk.payments_used} payments; 20 needed). Showing the plan only.</p>
  }
  const chance = risk.shortfall_chance!
  return (
    <div>
      <div className="label">Chance of a shortfall</div>
      <table className="table dense" style={{ marginTop: 4 }}>
        <tbody>
          {(['30', '60', '90'] as const).map((w) => (
            <tr key={w}><td className="muted">{w} days</td><td className="money" style={{ fontSize: 'var(--t-lead)' }}>{percent(chance[w])}</td></tr>
          ))}
        </tbody>
      </table>
      {risk.first_shortfall?.p50 && (
        <p className="small" style={{ margin: '12px 0' }}>
          Likely first shortfall <strong>{dayDate(risk.first_shortfall.p50.date)}</strong>
          {risk.first_shortfall.p10 && risk.first_shortfall.p90 && <span className="muted"> (range {shortDate(risk.first_shortfall.p10.date)} to {shortDate(risk.first_shortfall.p90.date)})</span>}
        </p>
      )}
      {!!risk.drivers?.length && (
        <>
          <div className="label" style={{ marginTop: 8 }}>Biggest drivers</div>
          {risk.drivers.filter((d) => d.share > 0).slice(0, 4).map((d) => (
            <div key={d.party_id} style={{ margin: '6px 0' }}>
              <div className="row small"><span className="grow">{d.name}{d.no_history ? <span className="faint"> · no history</span> : ''}</span><span className="mono">{percent(d.share)}</span></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round(d.share * 100)}%`, background: d.share > 0.5 ? 'var(--haldi)' : 'var(--text-2)' }} /></div>
            </div>
          ))}
        </>
      )}
      <p className="micro faint" style={{ marginTop: 10 }}>
        Based on {risk.payments_used} past payments from {risk.customers_with_history} customers, {risk.n_samples} simulated futures (seed {risk.seed}).
        {risk.customers_without_history?.length ? ` ${risk.customers_without_history.join(', ')} ${risk.customers_without_history.length === 1 ? 'has' : 'have'} no history: average of other customers used.` : ''}
        {' '}Payment history in the demo is synthetic.
      </p>
      <details className="small muted">
        <summary style={{ cursor: 'pointer' }}>How this is calculated</summary>
        <p>{risk.method}</p>
      </details>
    </div>
  )
}

function Why({ items }: { items: DipItem[] }) {
  const ui = useUI()
  const navigate = useNavigate()
  if (!items.length) return <p className="muted">Nothing dips below your buffer in the forecast.</p>
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((item, i) => (
        <li key={item.event_id} className="list-row clickable" style={{ cursor: 'pointer' }}
          onClick={() => { ui.selectEvent(item.event_id); ui.setEngineView('flow'); navigate('/app/engine') }}>
          <span className="list-index">{i + 1}</span>
          <div className="grow">
            <div>{item.kind === 'BLOCKED_PAYMENT' ? `${item.label}, due D${item.day}` : item.kind === 'LATE_RECEIPT' ? `${item.title} is late` : `${item.label}, paid D${item.day}`}</div>
            <span className="sub">
              {item.kind === 'BLOCKED_PAYMENT' && <>cannot be paid on the due day, short {rupees(item.shortfall_paise ?? 0)}{item.executed_day !== null && item.executed_day !== undefined ? `; paid D${item.executed_day}, ${item.lateness_days} days late` : '; not paid within the forecast'}</>}
              {item.kind === 'LATE_RECEIPT' && <>{item.days_overdue ? `${item.days_overdue} days overdue, ` : ''}expected {item.executed_day !== null && item.executed_day !== undefined ? `D${item.executed_day}` : 'after the forecast window'}</>}
              {item.kind === 'RECENT_OUTFLOW' && <>{item.days_before} days before the dip</>}
            </span>
          </div>
          <Amount paise={item.amount_paise} direction={item.kind === 'LATE_RECEIPT' ? 'IN' : 'OUT'} sign={item.kind === 'LATE_RECEIPT'} />
        </li>
      ))}
    </ol>
  )
}

function Fixes({ me }: { me: Me }) {
  const fixes = useFixes()
  const ui = useUI()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  if (fixes.isLoading) return <SkeletonRows rows={4} />
  if (fixes.isError || !fixes.data) return <ErrorNote text={errorText(fixes.error)} retry={() => fixes.refetch()} />
  if (!fixes.data.fixes.length) return <p className="muted">Nothing to fix: the forecast stays above your buffer.</p>

  const tryInEngine = async (evaluation: Evaluation) => {
    setBusy(evaluation.fix.id)
    try {
      const res = await api.post<{ key: string; evaluation: Evaluation; run: RunPayload; chance_after?: ChanceAfter }>('/engine/scenario', { fix_id: evaluation.fix.id })
      ui.setPlaying(false)
      ui.setScenario({ key: res.key, label: evaluation.fix.title, evaluation: res.evaluation, run: res.run, chance: res.chance_after, request: { fix_id: evaluation.fix.id } })
      ui.setDiff(true)
      ui.setEngineView('flow')
      ui.setDay(res.evaluation.first_shortfall_after?.day ?? (fixes.data!.fixes[0]?.dip_after_day ?? 0))
      navigate('/app/engine')
    } catch (error) {
      ui.toast(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const chosen = fixes.data.fixes.find((f) => f.fix.id === selected)
  const base = fixes.data.baseline_risk
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th>Option</th>
              <th className="money">Lowest point after</th>
              <th className="money">Chance of shortfall after<span className="sub">30d · 60d</span></th>
              <th className="money">Cost</th>
              <th>Shortfall after</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fixes.data.fixes.map((f) => (
              <tr key={f.fix.id} className={`clickable${selected === f.fix.id ? ' selected' : ''}`} onClick={() => setSelected(f.fix.id)}>
                <td><input type="radio" name="fix" checked={selected === f.fix.id} onChange={() => setSelected(f.fix.id)} aria-label={f.fix.title} /></td>
                <td className="wrap">{f.fix.title}<span className="sub">{f.fix.summary}</span></td>
                <td className="money"><span className={f.dip_after_paise !== null && f.dip_after_paise < 0 ? 'amt-out' : ''}>{rupees(f.dip_after_paise, { sign: true })}</span></td>
                <td className="money">
                  {f.chance_after?.status === 'READY'
                    ? <span title={`${f.chance_after.n_samples} samples`}>{percent(f.chance_after.shortfall_chance?.['30'])} · {percent(f.chance_after.shortfall_chance?.['60'])}</span>
                    : <span className="faint small">{f.chance_after?.status === 'INSUFFICIENT_HISTORY' ? 'no history' : 'calculating'}</span>}
                </td>
                <td className="money">{f.fix.cost_paise ? <span className="amt-out">{rupees(-f.fix.cost_paise)}</span> : <span className="faint">none</span>}<span className="sub">{f.fix.cost_paise ? f.fix.cost_label : ''}</span></td>
                <td>{f.first_shortfall_after ? <Status tone="out">D{f.first_shortfall_after.day}</Status> : <Status tone="in">None</Status>}</td>
                <td className="right"><button className="btn btn-sm btn-secondary" disabled={busy !== null} onClick={(e) => { e.stopPropagation(); void tryInEngine(f) }}>{busy === f.fix.id ? 'Running' : 'Try in engine'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro faint" style={{ marginTop: 8 }}>
        Lowest point after: the engine's lowest net position with the fix applied. Chance after: the risk engine re-run with the fix
        {base?.status === 'READY' ? ` (today, without a fix: ${percent(base.shortfall_chance['30'])} · ${percent(base.shortfall_chance['60'])})` : ''}. There is no single score.
      </p>
      {chosen && (
        <div className="notice row-wrap" style={{ marginTop: 12 }}>
          <span className="grow">
            <strong>{chosen.fix.title}.</strong> {chosen.changed_events.length} events move. {chosen.snapshot_edits.length ? chosen.snapshot_edits.join(' ') : ''}
            {chosen.late_orders_after.length ? ` Late orders after: ${chosen.late_orders_after.map((o) => `${o.order_id} +${o.lateness_days}d`).join(', ')}.` : ' No late orders after.'}
          </span>
          {chosen.fix.message && me.user.role !== 'SUPERVISOR' && (
            <button className="btn btn-primary" onClick={() => ui.openComposer({ partyId: chosen.fix.message!.party_id, intent: chosen.fix.message!.intent as any, fixId: chosen.fix.id })}>
              Draft the message
            </button>
          )}
        </div>
      )}
    </>
  )
}

function Transactions() {
  const { t } = useTranslation()
  const [direction, setDirection] = useState('')
  const [medium, setMedium] = useState('')
  const ui = useUI()
  const tx = useTransactions({ direction, medium })
  return (
    <>
      <div className="row-wrap" style={{ margin: '8px 0 12px' }}>
        <select className="select" style={{ width: 'auto' }} value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
          <option value="">All</option><option value="IN">{t('book.ledgerIn')} only</option><option value="OUT">{t('book.ledgerOut')} only</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={medium} onChange={(e) => setMedium(e.target.value)} aria-label="Medium">
          <option value="">Any medium</option>{['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE'].map((m) => <option key={m}>{m}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn btn-secondary" onClick={() => ui.openPayment({})}>{t('common.recordPayment')}</button>
        <a className="btn btn-quiet" href="/api/export/transactions.csv">Export CSV</a>
      </div>
      {tx.isLoading && <SkeletonRows />}
      {tx.isError && <ErrorNote text={errorText(tx.error)} />}
      {tx.data && (
        <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table className="table">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--ground)' }}>
              <tr>
                <th>{t('common.date')}</th><th>{t('common.party')}</th><th>{t('common.details')}</th><th>{t('common.medium')}</th><th>{t('common.ref')}</th>
                <th className="money money-first">{t('book.ledgerIn')}</th><th className="money">{t('book.ledgerOut')}</th><th className="money">{t('common.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {tx.data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono nowrap">{shortDate(r.date)} <span className="faint">{r.date.slice(2, 4)}</span></td>
                  <td className="truncate" style={{ maxWidth: 200 }}>{r.party_name ?? <span className="faint">·</span>}</td>
                  <td className="small truncate" style={{ maxWidth: 220 }}>{r.details}{r.status === 'PENDING' && <> <Status tone="wait">Pending</Status></>}{r.status === 'BOUNCED' && <> <Status tone="out">Bounced</Status></>}</td>
                  <td className="small">{r.medium}</td>
                  <td className="mono small faint">{r.reference ? `${r.reference.slice(0, 6)}…` : '·'}</td>
                  <td className="money money-first amt-in">{r.direction === 'IN' ? rupees(r.amount_paise) : ''}</td>
                  <td className="money amt-out">{r.direction === 'OUT' ? rupees(r.amount_paise) : ''}</td>
                  <td className="money">{rupees(r.balance_paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="right small muted">Totals, cleared ({tx.data.count} entries)</td>
                <td className="money money-first"><span>{rupees(tx.data.totals.in_paise)}</span></td>
                <td className="money"><span>{rupees(tx.data.totals.out_paise)}</span></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  )
}
