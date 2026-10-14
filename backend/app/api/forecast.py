"""Adapter between the khata (parties) and the deterministic simulation engine.

Flow:
    parties + recurring costs -> BusinessSnapshot (paise) -> simulation.engine.simulate
    -> engine daily cash + event execution results -> forecast shaped for the UI

Two views of cash come out of one engine run:

* **Executable cash** (engine): the greedy scheduler never lets cash go below
  zero. A payment it can't afford stays pending and is paid late.
* **Committed cash** (what the chart shows): every bill is paid on its due day.
  It is derived from the engine run by re-attributing each late payment to its
  due day, so the red dip is exactly the amount of the commitments the engine
  could not honour on time. When nothing slips, both views are identical.

Fix options are real engine scenarios (receipt moves, supplier instalments,
credit bridges) or adapter-level snapshot changes, each re-simulated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable

from ..simulation.engine import simulate
from ..simulation.schemas import (
    AddCreditBridge,
    BusinessSnapshot,
    CreditFacility,
    Event,
    EventStatus,
    EventType,
    MoveReceiptDate,
    Scenario,
    SimulationResult,
    SplitSupplierPayment,
    SupplierInstalment,
)
from ..simulation.transformations import apply_scenario
from . import config
from .models import format_compact, format_inr
from .store import PartyRecord

PAISE = 100


@dataclass
class PlannedEvent:
    id: str
    kind: str  # inflow | outflow
    label: str
    amount: int  # rupees
    day: int
    party_id: str | None = None


@dataclass
class EngineRun:
    snapshot: BusinessSnapshot
    transformed: BusinessSnapshot
    result: SimulationResult
    labels: dict[str, str]
    series: list[dict] = field(default_factory=list)

    @property
    def lowest(self) -> float:
        return min(p["balance"] for p in self.series)


# ── snapshot building ─────────────────────────────────────────────────────


def planned_events(parties: list[PartyRecord], today: date) -> list[PlannedEvent]:
    events: list[PlannedEvent] = []
    for p in parties:
        if p.owed_amount <= 0:
            continue
        if p.kind == "customer":
            expected = p.expected_pay_date or p.due_date
            day = (expected - today).days
            if day < 0:
                # Overdue with no promised date: assume it lands after a grace period.
                day = config.OVERDUE_CUSTOMER_GRACE_DAYS
            events.append(PlannedEvent(f"rcv-{p.id}", "inflow", p.name, p.owed_amount, day, p.id))
        else:
            day = max(0, (p.due_date - today).days)  # overdue bills are treated as due today
            events.append(PlannedEvent(f"pay-{p.id}", "outflow", p.name, p.owed_amount, day, p.id))
    for r in config.RECURRING_EVENTS:
        events.append(PlannedEvent(r.id, r.kind, r.label, r.amount, r.day))
    in_window = [e for e in events if 0 <= e.day <= config.HORIZON_DAYS]
    return sorted(in_window, key=lambda e: (e.day, e.id))


def build_snapshot(events: list[PlannedEvent], today: date, opening_cash: int) -> BusinessSnapshot:
    engine_events: list[Event] = []
    for e in events:
        when = today + timedelta(days=e.day)
        if e.kind == "inflow":
            etype = EventType.CASH_RECEIPT
        elif e.party_id:
            etype = EventType.SUPPLIER_PAYMENT
        else:
            etype = EventType.OTHER_EXPENSE
        engine_events.append(
            Event(
                id=e.id,
                type=etype,
                counterparty_id=e.party_id,
                earliest_date=when,
                due_date=when,
                amount_paise=e.amount * PAISE,
            )
        )
    return BusinessSnapshot(
        business_id=config.BUSINESS.business_id,
        start_date=today,
        horizon_days=config.HORIZON_DAYS + 1,
        opening_cash_paise=opening_cash * PAISE,
        events=engine_events,
    )


# ── running the engine ────────────────────────────────────────────────────


def run_engine(snapshot: BusinessSnapshot, labels: dict[str, str], scenario: Scenario | None = None) -> EngineRun:
    result = simulate(snapshot, scenario)
    transformed, _ = apply_scenario(snapshot, scenario)
    run = EngineRun(snapshot=snapshot, transformed=transformed, result=result, labels=labels)
    run.series = committed_series(run)
    return run


def committed_series(run: EngineRun) -> list[dict]:
    start = run.transformed.start_date
    days = len(run.result.daily_balances)
    executed_day: dict[str, int | None] = {}
    for er in run.result.event_results:
        executed_day[er.id] = (er.actual_execution_date - start).days if er.status == EventStatus.EXECUTED and er.actual_execution_date else None

    facilities = {f.id: f for f in run.transformed.approved_credit_facilities}
    late_adjust = [0] * days
    inflow_paise = [0] * days
    labels_by_day: list[list[tuple[str, str]]] = [[] for _ in range(days)]

    for ev in run.transformed.events:
        sched = (ev.earliest_date - start).days
        if not 0 <= sched < days:
            continue
        label = run.labels.get(ev.id, ev.id)
        if ev.type == EventType.CASH_RECEIPT:
            inflow_paise[sched] += ev.amount_paise or 0
            labels_by_day[sched].append(("inflow", label))
        elif ev.type == EventType.CREDIT_DRAWDOWN:
            fee = facilities[ev.facility_id].drawdown_fee_paise if ev.facility_id in facilities else 0
            inflow_paise[sched] += (ev.principal_paise or 0) - fee
            labels_by_day[sched].append(("inflow", label))
        elif ev.type in (EventType.SUPPLIER_PAYMENT, EventType.OTHER_EXPENSE):
            labels_by_day[sched].append(("outflow", label))
            done = executed_day.get(ev.id)
            for d in range(sched, days if done is None else min(done, days)):
                late_adjust[d] += ev.amount_paise or 0
        elif ev.type == EventType.CREDIT_REPAYMENT:
            labels_by_day[sched].append(("outflow", label))

    series: list[dict] = []
    prev = run.transformed.opening_cash_paise
    for d, bal in enumerate(run.result.daily_balances):
        committed = bal.cash_paise - late_adjust[d]
        delta = committed - prev
        inflow = inflow_paise[d]
        outflow = inflow - delta
        series.append(
            {
                "day": d,
                "date": bal.date.isoformat(),
                "balance": committed / PAISE,
                "inflow": inflow / PAISE,
                "outflow": max(0, outflow) / PAISE,
                "events": [{"kind": k, "label": lbl} for k, lbl in labels_by_day[d]],
            }
        )
        prev = committed
    return series


# ── forecast bundle ───────────────────────────────────────────────────────


@dataclass
class Baseline:
    today: date
    events: list[PlannedEvent]
    run: EngineRun
    summary: dict
    key_supplier: PlannedEvent | None
    key_customer: PlannedEvent | None
    parties: dict[str, PartyRecord]


def compute_baseline(parties: list[PartyRecord]) -> Baseline:
    today = config.today()
    events = planned_events(parties, today)
    snapshot = build_snapshot(events, today, config.BUSINESS.cash_today)
    labels = {e.id: e.label for e in events}
    run = run_engine(snapshot, labels)
    summary = summarise(run.series, events)
    has_dip = summary["lowest"]["balance"] < config.BUSINESS.safety_buffer
    key_supplier = _key_supplier(events, summary["lowest"]["day"]) if has_dip else None
    key_customer = _key_customer(events, summary["lowest"]["day"], {p.id: p for p in parties}, today) if has_dip else None
    return Baseline(today, events, run, summary, key_supplier, key_customer, {p.id: p for p in parties})


def summarise(series: list[dict], events: list[PlannedEvent]) -> dict:
    buffer = config.BUSINESS.safety_buffer
    inflows = sum(e.amount for e in events if e.kind == "inflow")
    outflows = sum(e.amount for e in events if e.kind == "outflow")
    lowest = series[0]
    for p in series:
        if p["balance"] < lowest["balance"]:
            lowest = p
    lo = hi = lowest["day"]
    while lo > 0 and series[lo - 1]["balance"] < buffer:
        lo -= 1
    while hi < len(series) - 1 and series[hi + 1]["balance"] < buffer:
        hi += 1
    first_dip = next((p["day"] for p in series if p["balance"] < buffer), config.HORIZON_DAYS)
    return {
        "cashToday": config.BUSINESS.cash_today,
        "inflows": inflows,
        "outflows": outflows,
        "net": inflows - outflows,
        "lowest": {"day": lowest["day"], "balance": lowest["balance"], "date": lowest["date"]},
        "bufferLevel": buffer,
        "dipRange": {"from": lo, "to": hi},
        "firstDipDay": first_dip,
    }


def _key_supplier(events: list[PlannedEvent], low_day: int) -> PlannedEvent | None:
    supplier_bills = [e for e in events if e.kind == "outflow" and e.party_id]
    near = [e for e in supplier_bills if low_day - 3 <= e.day <= low_day]
    pool = near or [e for e in supplier_bills if e.day <= low_day]
    return max(pool, key=lambda e: (e.amount, e.day)) if pool else None


def _key_customer(events: list[PlannedEvent], low_day: int, parties: dict[str, PartyRecord], today: date) -> PlannedEvent | None:
    after = [e for e in events if e.kind == "inflow" and e.party_id and e.day > low_day]
    late = [e for e in after if (parties[e.party_id].due_date - today).days <= low_day]
    pool = late or [e for e in after if e.day <= low_day + 14]
    return max(pool, key=lambda e: (e.amount, -e.day)) if pool else None


def _grouped(events: list[PlannedEvent], kind: str) -> list[dict]:
    totals: dict[str, int] = {}
    for e in events:
        if e.kind == kind:
            totals[e.label] = totals.get(e.label, 0) + e.amount
    return sorted(({"name": k, "amount": v} for k, v in totals.items()), key=lambda x: -x["amount"])


def dip_causes(b: Baseline) -> list[dict]:
    low_day = b.summary["lowest"]["day"]
    if b.summary["lowest"]["balance"] >= config.BUSINESS.safety_buffer:
        return []
    causes: list[dict] = []
    slips = {er.id: er for er in b.run.result.event_results}
    sup = b.key_supplier
    if sup:
        biggest = max(e.amount for e in b.events if e.kind == "outflow")
        detail = f"{format_compact(sup.amount)} goes out in one payment" + (
            ", the largest bill of the quarter." if sup.amount == biggest else " on the day your cash is tightest."
        )
        er = slips.get(sup.id)
        if er and er.actual_execution_date and er.lateness_days:
            paid_day = (er.actual_execution_date - b.today).days
            detail += f" Without a fix, the engine can only clear it on Day {paid_day}, {er.lateness_days} days late."
        elif er and er.status != EventStatus.EXECUTED:
            detail += " Without a fix, the engine can't clear it inside the 90-day window."
        causes.append({"id": "c-supplier", "kind": "outflow", "title": f"{sup.label} is due on Day {sup.day}", "detail": detail, "amount": sup.amount, "day": sup.day})
    cus = b.key_customer
    if cus:
        party = b.parties[cus.party_id]
        overdue = (b.today - party.due_date).days
        gap = cus.day - (sup.day if sup else low_day)
        after_whom = f"after {sup.label} needs paying" if sup else "after your cash runs short"
        gap_text = "a week" if gap == 7 else f"{gap} days"
        if overdue > 0:
            title = f"{cus.label} has not paid"
            detail = f"{format_compact(cus.amount)} is {overdue} days overdue. The forecast expects it on Day {cus.day}, {gap_text} {after_whom}."
        else:
            title = f"{cus.label} pays after the dip"
            detail = f"{format_compact(cus.amount)} is expected on Day {cus.day}, {gap_text} {after_whom}."
        causes.append({"id": "c-customer", "kind": "inflow", "title": title, "detail": detail, "amount": cus.amount, "day": cus.day})
    anchor = sup.day if sup else low_day
    others = [e for e in b.events if e.kind == "outflow" and anchor - 5 <= e.day < anchor and (not sup or e.id != sup.id)]
    if others:
        o = max(others, key=lambda e: e.amount)
        whose = f"the {sup.label} payment" if sup else "the dip"
        causes.append(
            {
                "id": "c-other",
                "kind": "outflow",
                "title": f"{o.label} lands on Day {o.day}",
                "detail": f"{format_compact(o.amount)} leaves {anchor - o.day} days before {whose}, which removes your cushion.",
                "amount": o.amount,
                "day": o.day,
            }
        )
    return causes


def forecast_bundle(b: Baseline) -> dict:
    result = b.run.result
    late = [
        {"label": b.run.labels.get(er.id, er.id), "dueDay": (er.original_due_date - b.today).days if er.original_due_date else None,
         "paidDay": (er.actual_execution_date - b.today).days if er.actual_execution_date else None, "daysLate": er.lateness_days}
        for er in result.missed_commitments
    ]
    return {
        "series": b.run.series,
        "summary": b.summary,
        "causes": dip_causes(b),
        "receivables": _grouped(b.events, "inflow"),
        "payables": _grouped(b.events, "outflow"),
        "engine": {
            "engineVersion": result.engine_version,
            "schemaVersion": result.schema_version,
            "policy": result.scheduling_policy.name.value,
            "minimumExecutableCash": result.metrics.minimum_executable_cash_paise / PAISE,
            "closingCash": result.metrics.closing_cash_paise / PAISE,
            "lateCommitments": late,
        },
    }


# ── fix options ───────────────────────────────────────────────────────────


def _variant(snapshot: BusinessSnapshot, event_id: str, mutate: Callable[[Event], None]) -> BusinessSnapshot:
    copy = snapshot.model_copy(deep=True)
    for ev in copy.events:
        if ev.id == event_id:
            mutate(ev)
    return copy


def _fix_payload(run: EngineRun, **fields) -> dict:
    balances = [p["balance"] for p in run.series]
    return {
        **fields,
        "newLowest": min(balances),
        "afterSeries": balances,
        "engine": {
            "missedCommitments": run.result.metrics.missed_commitment_count,
            "closingCash": run.result.metrics.closing_cash_paise / PAISE,
            "financingCost": run.result.metrics.accrued_financing_cost_paise / PAISE,
        },
    }


def fix_options(b: Baseline) -> list[dict]:
    if b.summary["lowest"]["balance"] >= config.BUSINESS.safety_buffer:
        return []
    low_day = b.summary["lowest"]["day"]
    snap = b.run.snapshot
    labels = dict(b.run.labels)
    today = b.today
    fixes: list[dict] = []
    cus, sup = b.key_customer, b.key_supplier
    min_ok = 0  # a fix "works" once the balance never goes below zero

    if cus:
        party = b.parties[cus.party_id]
        # 1. Early payment for a 2% discount (engine scenario: MOVE_RECEIPT_DATE).
        early_day = max(1, low_day - 4)
        if early_day < cus.day:
            discounted = round(cus.amount * (1 - config.EARLY_PAYMENT_DISCOUNT))
            variant = _variant(snap, cus.id, lambda ev: setattr(ev, "amount_paise", discounted * PAISE))
            scenario = Scenario(
                scenario_id="early-payment",
                changes=[MoveReceiptDate(type="MOVE_RECEIPT_DATE", event_id=cus.id, new_earliest_date=today + timedelta(days=early_day),
                                         assumption=f"{cus.label} agrees to pay early for a {int(config.EARLY_PAYMENT_DISCOUNT * 100)}% discount.")],
            )
            run = run_engine(variant, {**labels, cus.id: f"{cus.label} (early, 2% off)"}, scenario)
            fixes.append(_fix_payload(
                run,
                id="early-payment",
                title=f"Ask {cus.label} to pay early for 2% off",
                summary=f"Offer a small discount if the pending bill is cleared by Day {early_day}.",
                tag="Easiest",
                icon="percent",
                cost=f"{format_inr(cus.amount - discounted)} discount",
                recipient={"name": party.name, "phone": party.phone, "amount": cus.amount},
            ))

    if sup:
        party = b.parties[sup.party_id]
        # 2. Split the supplier bill in two (engine scenario: SPLIT_SUPPLIER_PAYMENT).
        first = round(sup.amount / 2)
        candidates = sorted({min(e.day + 3, config.HORIZON_DAYS) for e in b.events if e.kind == "inflow" and e.party_id and e.day > sup.day})
        best: tuple[EngineRun, int, str] | None = None
        for second_day in candidates:
            payer = max((e for e in b.events if e.kind == "inflow" and e.party_id and e.day <= second_day and e.day > sup.day), key=lambda e: e.day)
            scenario = Scenario(
                scenario_id="split-payment",
                changes=[SplitSupplierPayment(
                    type="SPLIT_SUPPLIER_PAYMENT",
                    event_id=sup.id,
                    instalments=[
                        SupplierInstalment(id=f"{sup.id}-part-1", amount_paise=first * PAISE, earliest_date=today + timedelta(days=sup.day)),
                        SupplierInstalment(id=f"{sup.id}-part-2", amount_paise=(sup.amount - first) * PAISE, earliest_date=today + timedelta(days=second_day)),
                    ],
                    supplier_agreement_assumption=f"{sup.label} accepts two instalments.",
                )],
            )
            run = run_engine(snap, {**labels, f"{sup.id}-part-1": f"{sup.label} (part 1)", f"{sup.id}-part-2": f"{sup.label} (part 2)"}, scenario)
            if best is None or run.lowest > best[0].lowest:
                best = (run, second_day, payer.label)
            if run.lowest >= config.BUSINESS.safety_buffer:
                best = (run, second_day, payer.label)
                break
        if best:
            run, second_day, payer = best
            fixes.append(_fix_payload(
                run,
                id="split-payment",
                title=f"Pay {sup.label} in two parts",
                summary=f"Pay half on the due date and the rest after {payer} pays.",
                tag="Cheapest",
                icon="split",
                cost="No cost",
                recipient={"name": party.name, "phone": party.phone, "amount": sup.amount},
            ))

        # 3. Ask for an extension (adapter-level snapshot change, then engine run).
        chosen: tuple[EngineRun, int] | None = None
        for extra in (10, 14, 21, 30):
            new_day = sup.day + extra
            if new_day > config.HORIZON_DAYS:
                break
            variant = _variant(snap, sup.id, lambda ev, d=new_day: (setattr(ev, "earliest_date", today + timedelta(days=d)), setattr(ev, "due_date", today + timedelta(days=d))))
            run = run_engine(variant, {**labels, sup.id: f"{sup.label} (extended)"})
            if chosen is None or run.lowest > chosen[0].lowest:
                chosen = (run, extra)
            if run.lowest >= min_ok:
                chosen = (run, extra)
                break
        if chosen:
            run, extra = chosen
            new_day = sup.day + extra
            settles = [e for e in b.events if e.kind == "inflow" and e.party_id and sup.day < e.day <= new_day]
            after = f", just after {max(settles, key=lambda e: e.day).label} settles" if settles else ""
            fixes.append(_fix_payload(
                run,
                id="extension",
                title=f"Request a {extra}-day extension from {sup.label}",
                summary=f"Move the payment to Day {new_day}{after}.",
                tag="Quickest",
                icon="calendar",
                cost="No cost",
                recipient={"name": party.name, "phone": party.phone, "amount": sup.amount},
            ))

    if cus:
        # 4. Invoice financing (engine scenario: ADD_CREDIT_BRIDGE with simple daily interest).
        draw_day = max(1, low_day - 6)
        if draw_day < cus.day:
            principal = round(cus.amount * config.FINANCING_ADVANCE_RATE)
            fee = round(principal * 0.01)
            facility = CreditFacility(
                id="invoice-finance",
                approved_limit_paise=principal * PAISE,
                available_from_date=today + timedelta(days=draw_day),
                annual_interest_rate_bps=config.FINANCING_INTEREST_BPS,
                drawdown_fee_paise=fee * PAISE,
                contractual_repayment_date=today + timedelta(days=cus.day),
                assumptions=[f"{config.FINANCE_PARTNER['name']} advances {int(config.FINANCING_ADVANCE_RATE * 100)}% against the {cus.label} invoice."],
            )
            scenario = Scenario(
                scenario_id="invoice-financing",
                changes=[AddCreditBridge(
                    type="ADD_CREDIT_BRIDGE", facility=facility, facility_id=facility.id,
                    drawdown_event_id="finance-draw", repayment_event_id="finance-repay",
                    principal_paise=principal * PAISE, drawdown_date=today + timedelta(days=draw_day),
                    assumption="Repaid in full when the customer pays.",
                )],
            )
            partner = config.FINANCE_PARTNER["name"]
            run = run_engine(snap, {**labels, "finance-draw": f"{partner} advance", "finance-repay": f"Repay {partner}"}, scenario)
            cost = fee + run.result.metrics.accrued_financing_cost_paise / PAISE
            fixes.append(_fix_payload(
                run,
                id="invoice-financing",
                title=f"Get the {cus.label} invoice financed",
                summary=f"Receive {int(config.FINANCING_ADVANCE_RATE * 100)}% of the pending bill from a finance partner by Day {draw_day}.",
                tag="Last resort",
                icon="receipt",
                cost=f"{format_inr(cost)} fee and interest",
                recipient={"name": partner, "phone": config.FINANCE_PARTNER["phone"], "amount": cus.amount},
            ))
    return fixes


def shortfall_party_ids(b: Baseline) -> set[str]:
    return {e.party_id for e in (b.key_supplier, b.key_customer) if e and e.party_id}
