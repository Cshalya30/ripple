import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Glyph } from '../components/Glyph'
import { Amount, ErrorNote, Section, Skeleton, SkeletonRows, StripCell } from '../components/ui'
import type { GuardBrief } from '../guard/types'
import { api, errorText } from '../lib/api'
import { clock, compact, dayDate, percent, rupees, shortDate, weekday } from '../lib/format'
import { useToday, useWrite, type TodayData } from '../lib/queries'
import { useUI } from '../lib/store'

export function Today() {
  const { t } = useTranslation()
  const today = useToday()
  const navigate = useNavigate()

  if (today.isLoading) {
    return (
      <div className="page">
        <Skeleton h={18} w={160} />
        <Skeleton h={28} w="70%" style={{ marginTop: 16 }} />
        <Skeleton h={84} style={{ marginTop: 24 }} />
        <div style={{ marginTop: 28 }}><SkeletonRows rows={5} h={48} /></div>
      </div>
    )
  }
  if (today.isError || !today.data) {
    const empty = (today.error as any)?.status === 404
    return (
      <div className="page">
        {empty ? (
          <div className="empty">
            <p className="lead">Set up your khata to see today.</p>
            <div className="row"><Link className="btn btn-primary" to="/setup">Describe your business</Link></div>
          </div>
        ) : <ErrorNote text={`Couldn't reach the engine. ${errorText(today.error)}`} retry={() => today.refetch()} />}
      </div>
    )
  }
  const d = today.data
  const s = d.summary

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="lead" style={{ fontWeight: 600 }}>{dayDate(d.date)}</span>
        <span className="mono small faint">Day 0 of {d.horizon_days}</span>
      </div>

      <Headline data={d} />

      <div className="strip" style={{ marginTop: 20 }}>
        <StripCell label={t('common.cashNow')}>{rupees(d.position.cash_now_paise)}</StripCell>
        <StripCell label={t('common.toReceive')} sub={t('common.customers', { count: d.position.customers_owing })}>
          <span className="amt-in">{rupees(d.position.to_receive_paise, { sign: true })}</span>
        </StripCell>
        <StripCell label={t('common.toPay')} sub={t('common.suppliers', { count: d.position.suppliers_owed })}>
          <span className="amt-out">{rupees(-d.position.to_pay_paise)}</span>
        </StripCell>
        <StripCell label={t('common.runway')}
          sub={s.buffer_breach ? t('common.bufferBreach', { date: shortDate(s.buffer_breach.date) }) : t('common.noShortfall', { days: s.horizon_days })}>
          {s.runway_days !== null ? t('common.days', { count: s.runway_days }) : `${s.horizon_days}+ days`}
        </StripCell>
      </div>

      <div className="today-grid">
        <Section title={t('today.doToday')}>
          <DoToday items={d.do_today} />
        </Section>
        <Section title={t('today.thisWeek')}>
          <Week days={d.week} />
        </Section>
      </div>

      <GuardStrip brief={d.guard} />

      {d.changes && (
        <Section title={t('today.changed')} aside={<span className="micro faint mono">since {clock(d.changes.since)}</span>}>
          <Changes changes={d.changes} />
        </Section>
      )}
      <p className="micro faint" style={{ marginTop: 24 }}>
        Every figure on this page comes from engine run {d.run.run_id} at {clock(d.run.created_at)}.{' '}
        <button className="btn-quiet micro" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => navigate('/app/engine')}>Open the engine</button>
      </p>
    </div>
  )
}

function Headline({ data }: { data: TodayData }) {
  const { t } = useTranslation()
  const h = data.headline
  const parts: string[] = [h.week_covered ? t('today.covered') : t('today.notCovered')]
  if (h.first_shortfall) {
    parts.push(t('today.shortfall', { date: dayDate(h.first_shortfall.date), amount: rupees(h.first_shortfall.shortfall_paise) }))
  } else if (h.buffer_breach) {
    parts.push(t('today.breach', { date: dayDate(h.buffer_breach.date), buffer: rupees(h.buffer_paise) }))
  } else {
    parts.push(t('today.safe', { days: h.horizon_days }))
  }
  let sentence = parts.join(' ')
  if ((h.first_shortfall || h.buffer_breach) && h.rescue) {
    sentence = sentence.replace(/[.।]$/, '') + ' ' + t('today.unless', { party: h.rescue.party_name, amount: rupees(h.rescue.amount_paise) })
  }
  return (
    <p className="h2" style={{ marginTop: 12, maxWidth: '62ch', fontStretch: '100%', fontWeight: 520 }}>
      {sentence}{' '}
      {(h.first_shortfall || h.buffer_breach) && <Link to="/app/book" className="btn-quiet lead" style={{ whiteSpace: 'nowrap', color: 'var(--haldi)' }}>{t('common.seeWhy')} ›</Link>}
    </p>
  )
}

function DoToday({ items }: { items: any[] }) {
  const { t } = useTranslation()
  const ui = useUI()
  const navigate = useNavigate()
  const receive = useWrite((poId: string) => api.patch(`/purchase-orders/${encodeURIComponent(poId)}`, { status: 'ARRIVED' }))
  if (!items.length) return <p className="muted">{t('today.nothing')}</p>
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((a, i) => (
        <li className="list-row" key={i}>
          <span className="list-index">{i + 1}</span>
          <div className="grow">
            {a.kind === 'CHASE' && (
              <>
                <div className="row"><span className="grow">{t('today.chase', { party: a.party_name })}</span><Amount paise={a.amount_paise} direction="IN" sign={false} /></div>
                <span className="sub" style={{ color: 'var(--haldi)' }}>
                  {a.risk_share ? t('today.overdueRisk', { days: a.days_overdue, share: percent(a.risk_share) }) : t('today.overdue', { days: a.days_overdue })} · {a.invoice_number}
                </span>
              </>
            )}
            {a.kind === 'PAY' && (
              <>
                <div className="row"><span className="grow">{t('today.pay', { party: a.party_name })}</span><Amount paise={a.amount_paise} direction="OUT" /></div>
                <span className="sub">{t('today.due', { date: dayDate(a.due_date) })} · {a.invoice_number}</span>
              </>
            )}
            {a.kind === 'RECEIVE' && (
              <>
                <div>{t('today.confirm', { party: a.party_name })}</div>
                <span className="sub">{a.po_number} expected today</span>
              </>
            )}
            {a.kind === 'STOCK' && (
              <>
                <div>{t('today.stock', { order: a.order_id })}</div>
                <span className="sub" style={{ color: 'var(--out)' }}>{a.material_name}: short {a.short_label} · waits D{a.from_day} to D{a.to_day}</span>
              </>
            )}
          </div>
          {a.kind === 'CHASE' && <button className="btn btn-secondary" onClick={() => ui.openComposer({ partyId: a.party_id, intent: 'reminder', invoiceId: a.invoice_id })}>{t('common.remind')}</button>}
          {a.kind === 'PAY' && <button className="btn btn-secondary" onClick={() => ui.openPayment({ partyId: a.party_id, invoiceId: a.invoice_id, amountPaise: a.amount_paise, direction: 'OUT' })}>{t('common.markPaid')}</button>}
          {a.kind === 'RECEIVE' && <button className="btn btn-secondary" disabled={receive.isPending} onClick={() => receive.mutate(a.po_id, { onSuccess: () => ui.toast('Goods received. Stock and forecast updated.') })}>{t('common.received')}</button>}
          {a.kind === 'STOCK' && <button className="btn btn-secondary" onClick={() => { ui.selectEvent(a.event_id); ui.setEngineView('flow'); ui.setDay(a.from_day); navigate('/app/engine') }}>{t('common.showInEngine')}</button>}
        </li>
      ))}
    </ol>
  )
}

function Week({ days }: { days: TodayData['week'] }) {
  const { t } = useTranslation()
  const cell = (key: number, paise: number, dir: 'IN' | 'OUT', title: string, blocked = false) => (
    <td key={key} className="money" title={title} style={{ padding: '0 4px' }}>
      {paise ? <span className={dir === 'IN' ? 'amt-in' : 'amt-out'}>{dir === 'IN' ? '+' : ''}{compact(dir === 'IN' ? paise : -paise)}</span>
        : blocked ? <span className="amt-out" title="Due but cannot be paid">✕</span> : <span className="faint">·</span>}
    </td>
  )
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th />
            {days.map((d) => <th key={d.day} className="money" style={{ padding: '8px 4px' }}>{weekday(d.date)}<span className="sub">{shortDate(d.date)}</span></th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="small muted">{t('common.in')}</td>
            {days.map((d) => cell(d.day, d.in_paise, 'IN', d.in_items.map((i: any) => `${i.label} ${rupees(i.amount_paise)}`).join('\n') || 'Nothing'))}
          </tr>
          <tr>
            <td className="small muted">{t('common.out')}</td>
            {days.map((d) => cell(d.day, d.out_paise, 'OUT', [...d.out_items, ...d.blocked_items.map((b: any) => ({ ...b, label: `${b.label} (cannot pay)` }))]
              .map((i: any) => `${i.label} ${rupees(i.amount_paise)}`).join('\n') || 'Nothing', d.blocked_items.length > 0))}
          </tr>
        </tbody>
      </table>
      <p className="micro faint" style={{ marginTop: 6 }}>Amounts abbreviated here only; hover a day for the full figures.</p>
    </div>
  )
}

function Changes({ changes }: { changes: NonNullable<TodayData['changes']> }) {
  const runwayDelta = changes.runway_before !== null && changes.runway_after !== null ? changes.runway_after - changes.runway_before : null
  const runwayText = changes.runway_before === changes.runway_after ? 'Runway unchanged.'
    : changes.runway_after === null ? 'No shortfall in the forecast any more.'
      : runwayDelta !== null ? `Runway ${runwayDelta > 0 ? '+' : '−'}${Math.abs(runwayDelta)} days.` : `Runway now ${changes.runway_after} days.`
  return (
    <div className="stack" style={{ gap: 4 }}>
      {changes.transactions.map((t, i) => (
        <p key={i} style={{ margin: 0 }}>
          <Glyph name={t.direction === 'IN' ? 'CASH_RECEIPT' : 'SUPPLIER_PAYMENT'} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {t.party_name ?? 'Expense'} {t.direction === 'IN' ? 'paid' : 'was paid'} <Amount paise={t.amount_paise} direction={t.direction as 'IN' | 'OUT'} sign={false} /> ({t.medium}{t.reference ? `, ref ${t.reference.slice(0, 4)}…` : ''}{t.status === 'PENDING' ? ', pending' : ''}).
        </p>
      ))}
      <p style={{ margin: 0 }} className="muted">{runwayText}{changes.lowest_before_paise !== null && changes.lowest_after_paise !== null && changes.lowest_before_paise !== changes.lowest_after_paise
        ? ` Lowest point ${rupees(changes.lowest_before_paise)} → ${rupees(changes.lowest_after_paise)}.` : ''}</p>
    </div>
  )
}

/** One line from the Risk and Finance engine; the detail lives in Book. */
function GuardStrip({ brief }: { brief: GuardBrief }) {
  const word = { ok: 'All clear', watch: 'Keep an eye on it', act: 'Act this week' }[brief.verdict.level]
  return (
    <Link to="/app/book?tab=risk" className={`guard-strip-link level-${brief.verdict.level}`} aria-label="Open Risk and Finance">
      <span className="guard-light" aria-hidden="true" />
      <span className="grow">
        <strong>Risk &amp; Finance: {word}.</strong>{' '}
        <span className="muted">{brief.verdict.reasons[0]}</span>
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  )
}
