"""Fix candidates and their evaluation (PRD 8.5 "Ways to fix", 8.4.7 scenarios).

Every candidate is derived from the engine's own blocker for the first shortfall, then
evaluated by running the engine on the changed snapshot. "Dip after" is the lowest net
position the engine produces with the fix; it is never estimated.

Two fixes change amounts (a discount, a financing fee). The five engine transformations
cannot express an amount change, so those fixes edit a copy of the snapshot before the
run and state that edit as an assumption.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Any

from ..simulation.schemas import BusinessSnapshot, EventType, Scenario
from ..simulation.validation import SimulationValidationError
from .position import round_up
from .runs import Run, run_variant

DISCOUNT_BP = 200          # 2% early-payment discount
FINANCE_ADVANCE_BP = 9_000  # 90% advance
FINANCE_FEE_BP_PER_30D = 150  # 1.5% per 30 days on the advance
EXTENSION_DAYS = 10


class FixError(ValueError):
    def __init__(self, code: str, details: dict[str, Any] | None = None):
        self.code = code
        self.details = details or {}
        super().__init__(code)


def _situation(run: Run) -> dict[str, Any] | None:
    summary = run.derived["summary"]
    snapshot = run.built.snapshot
    events = {e.id: e for e in snapshot.events}
    results = {r.id: r for r in run.result.event_results}
    meta = run.built.meta["events"]
    if summary["first_shortfall"] and summary["first_shortfall"]["blockers"]:
        day = summary["first_shortfall"]["day"]
        blocker = max(summary["first_shortfall"]["blockers"], key=lambda b: b["required_paise"])
        payment_id, gap = blocker["event_id"], summary["first_shortfall"]["shortfall_paise"]
    elif summary["buffer_breach"]:
        day = summary["buffer_breach"]["day"]
        due = [r for r in run.result.event_results if r.type == EventType.SUPPLIER_PAYMENT and r.original_due_date
               and abs((r.original_due_date - snapshot.start_date).days - day) <= 3]
        if not due:
            return None
        payment_id = max(due, key=lambda r: events[r.id].amount_paise or 0).id
        gap = summary["buffer_paise"] - summary["buffer_breach"]["net_paise"]
    else:
        return None
    payment = events.get(payment_id)
    if payment is None or payment.type != EventType.SUPPLIER_PAYMENT:
        return None
    # The receipt that arrives after the dip and would most reduce it.
    late = []
    for event in snapshot.events:
        info = meta.get(event.id, {})
        if event.type != EventType.CASH_RECEIPT or info.get("receipt_kind") != "FIXED_DATE":
            continue
        executed = results[event.id].actual_execution_date
        executed_day = (executed - snapshot.start_date).days if executed else 10**6
        if executed_day > day:
            late.append((event, executed_day))
    late.sort(key=lambda item: (-(item[0].due_date is not None and item[0].due_date < snapshot.start_date), -(item[0].amount_paise or 0)))
    receipt = late[0][0] if late else None
    open_order_receipts = [e for e in snapshot.events if e.type == EventType.CASH_RECEIPT and meta.get(e.id, {}).get("receipt_kind") == "DELIVERY_RELATIVE"]
    deposit_target = max(open_order_receipts, key=lambda e: e.amount_paise or 0) if open_order_receipts else None
    cash_on_day = run.result.daily_balances[day].cash_paise if day < len(run.result.daily_balances) else 0
    return {"day": day, "gap": gap, "payment": payment, "receipt": receipt, "deposit_target": deposit_target,
            "cash_on_day": cash_on_day, "meta": meta}


def candidates(run: Run) -> list[dict[str, Any]]:
    situation = _situation(run)
    if situation is None:
        return []
    start = run.built.snapshot.start_date
    day, payment, receipt = situation["day"], situation["payment"], situation["receipt"]
    meta = situation["meta"]
    supplier = meta.get(payment.id, {}).get("party_name", "the supplier")
    supplier_id = meta.get(payment.id, {}).get("party_id")
    amount = payment.amount_paise or 0
    due = payment.due_date or payment.earliest_date
    out: list[dict[str, Any]] = []

    if receipt is not None:
        customer = meta[receipt.id]["party_name"]
        pay_by = min(start + timedelta(days=max(1, day - 1)), start + timedelta(days=7))
        discount = (receipt.amount_paise or 0) * DISCOUNT_BP // 10_000
        out.append({
            "id": "early-discount", "kind": "EARLY_DISCOUNT", "party_id": receipt.counterparty_id, "party_name": customer,
            "title": f"Ask {customer} to pay early for 2% off",
            "summary": f"{customer} pays {receipt.id.replace('receipt-', '').upper()} by {_human(pay_by)} and keeps a 2% discount.",
            "cost_paise": discount, "cost_label": "discount",
            "params": {"event_id": receipt.id, "date": pay_by.isoformat(), "discount_paise": discount},
            "message": {"intent": "early_discount", "party_id": receipt.counterparty_id},
        })
    part1 = max(amount // 10, (situation["cash_on_day"] - run.derived["summary"]["buffer_paise"]) // 100_000 * 100_000)
    part1 = min(part1, amount - 100_000)
    if part1 > 0:
        out.append({
            "id": "split-supplier", "kind": "SPLIT_SUPPLIER_PAYMENT", "party_id": supplier_id, "party_name": supplier,
            "title": f"Pay {supplier} in two parts",
            "summary": f"Pay part on {_human(due)}, the rest later; {supplier} releases goods after the first part.",
            "cost_paise": 0, "cost_label": "none",
            "params": {"event_id": payment.id, "first_paise": part1, "first_date": due.isoformat(), "second_after_days": None},
            "message": {"intent": "instalment", "party_id": supplier_id},
        })
    out.append({
        "id": "extension", "kind": "EXTENSION", "party_id": supplier_id, "party_name": supplier,
        "title": f"Ask {supplier} for a {EXTENSION_DAYS}-day extension",
        "summary": f"Move the {supplier} payment from {_human(due)} to {_human(due + timedelta(days=EXTENSION_DAYS))}.",
        "cost_paise": 0, "cost_label": "none",
        "params": {"event_id": payment.id, "days": EXTENSION_DAYS},
        "message": {"intent": "extension", "party_id": supplier_id},
    })
    if receipt is not None:
        customer = meta[receipt.id]["party_name"]
        advance_date = start + timedelta(days=2)
        expected = run_expected(run, receipt.id) or receipt.earliest_date
        advance = (receipt.amount_paise or 0) * FINANCE_ADVANCE_BP // 10_000
        days = max(30, (expected - advance_date).days)
        fee = -(-advance * FINANCE_FEE_BP_PER_30D * days // (10_000 * 30))
        out.append({
            "id": "invoice-finance", "kind": "INVOICE_FINANCE", "party_id": receipt.counterparty_id, "party_name": customer,
            "title": f"Finance the {customer} invoice",
            "summary": f"A financier advances 90% on {_human(advance_date)}; the rest, less a fee of 1.5% per 30 days, arrives when {customer} pays.",
            "cost_paise": fee, "cost_label": "fee",
            "params": {"event_id": receipt.id, "advance_paise": advance, "advance_date": advance_date.isoformat(), "fee_paise": fee},
            "message": None,
        })
    for facility in run.built.snapshot.approved_credit_facilities:
        principal = min(facility.approved_limit_paise, round_up(situation["gap"] + run.derived["summary"]["buffer_paise"], 1_000_000))
        draw = max(facility.available_from_date, due - timedelta(days=1), start)
        if draw >= facility.contractual_repayment_date or principal <= facility.drawdown_fee_paise:
            continue
        label = run.built.meta["facilities"].get(facility.id, {}).get("label", "Approved credit")
        out.append({
            "id": f"bridge-{facility.id}", "kind": "ADD_CREDIT_BRIDGE", "party_id": None, "party_name": label,
            "title": f"Draw {_rupees(principal)} from {label.split(' (')[0]}",
            "summary": f"Draw on {_human(draw)}, repay in full on {_human(facility.contractual_repayment_date)} with simple daily interest.",
            "cost_paise": None, "cost_label": "interest and fee",
            "params": {"facility_id": facility.id, "principal_paise": principal, "drawdown_date": draw.isoformat()},
            "message": None,
        })
        break
    target = situation["deposit_target"]
    if target is not None:
        customer = meta[target.id]["party_name"]
        deposit = round_up((target.amount_paise or 0) * 3 // 10, 100_000)
        deposit_date = start + timedelta(days=5)
        if deposit < (target.amount_paise or 0):
            out.append({
                "id": "deposit", "kind": "SPLIT_CUSTOMER_COLLECTION", "party_id": target.counterparty_id, "party_name": customer,
                "title": f"Ask {customer} for a 30% deposit on {meta[target.id].get('order_id')}",
                "summary": f"{customer} pays {_rupees(deposit)} by {_human(deposit_date)}; the balance stays on delivery terms.",
                "cost_paise": 0, "cost_label": "none",
                "params": {"event_id": target.id, "deposit_paise": deposit, "deposit_date": deposit_date.isoformat()},
                "message": {"intent": "deposit", "party_id": target.counterparty_id},
            })
    return out


def run_expected(run: Run, event_id: str) -> date | None:
    for result in run.result.event_results:
        if result.id == event_id:
            return result.actual_execution_date
    return None


def build_variant(run: Run, fix: dict[str, Any]) -> tuple[BusinessSnapshot, Scenario | None, list[str]]:
    """Returns (snapshot, scenario, assumptions) for a fix. Snapshot edits only where a transformation cannot express it."""
    snapshot = run.built.snapshot.model_copy(deep=True)
    events = {e.id: e for e in snapshot.events}
    params = fix["params"]
    kind = fix["kind"]
    assumptions: list[str] = []
    changes: list[dict[str, Any]] = []

    def event(event_id: str):
        if event_id not in events:
            raise FixError("UNKNOWN_EVENT", {"event_id": event_id})
        return events[event_id]

    if kind == "EARLY_DISCOUNT":
        target = event(params["event_id"])
        target.amount_paise = (target.amount_paise or 0) - params["discount_paise"]
        assumptions.append(f"Snapshot edit: {target.id} amount reduced by the agreed discount.")
        changes.append({"type": "MOVE_RECEIPT_DATE", "event_id": target.id, "new_earliest_date": params["date"],
                        "assumption": "Customer agrees to pay early in exchange for the discount."})
    elif kind == "MOVE_RECEIPT_DATE":
        changes.append({"type": "MOVE_RECEIPT_DATE", "event_id": params["event_id"], "new_earliest_date": params["date"],
                        "assumption": params.get("assumption") or "Owner what-if: the customer pays on this date."})
    elif kind == "DELAY_ARRIVAL":
        changes.append({"type": "DELAY_ARRIVAL", "event_id": params["event_id"], "delay_days": int(params["days"]),
                        "assumption": "Owner what-if: the material arrives later."})
    elif kind == "SPLIT_SUPPLIER_PAYMENT":
        target = event(params["event_id"])
        first = int(params["first_paise"])
        if not 0 < first < (target.amount_paise or 0):
            raise FixError("INVALID_SPLIT", {"first_paise": first})
        first_date = date.fromisoformat(params["first_date"])
        after = params.get("second_after_days")
        options = [int(after)] if after else [7, 14, 21, 28]
        best = None
        for days in options:
            trial = _split_change(target, first, first_date, days, params.get("release", "RELEASE_AFTER_FIRST_INSTALMENT"))
            if len(options) == 1:
                best = trial
                break
            try:
                result, derived = run_variant(run.built, snapshot, Scenario(scenario_id="probe", changes=[trial]), run.derived["summary"]["buffer_paise"])
            except SimulationValidationError:
                continue
            best = trial
            if derived["summary"]["first_shortfall"] is None:
                break
        if best is None:
            raise FixError("INVALID_SPLIT", {})
        changes.append(best)
    elif kind == "EXTENSION":
        target = event(params["event_id"])
        if target.type != EventType.SUPPLIER_PAYMENT:
            raise FixError("NOT_A_SUPPLIER_PAYMENT", {"event_id": target.id})
        days = int(params["days"])
        target.earliest_date = target.earliest_date + timedelta(days=days)
        if target.due_date:
            target.due_date = target.due_date + timedelta(days=days)
        assumptions.append(f"Snapshot edit: {target.id} due date moved by {days} days, as agreed with the supplier.")
    elif kind == "INVOICE_FINANCE":
        target = event(params["event_id"])
        target.amount_paise = (target.amount_paise or 0) - params["fee_paise"]
        assumptions.append(f"Snapshot edit: financier's fee deducted from {target.id}.")
        changes.append({"type": "SPLIT_CUSTOMER_COLLECTION", "event_id": target.id, "deposit_event_id": f"{target.id}-advance",
                        "deposit_amount_paise": params["advance_paise"], "deposit_date": params["advance_date"],
                        "customer_agreement_assumption": "Invoice financier advances 90% against the invoice."})
    elif kind == "SPLIT_CUSTOMER_COLLECTION":
        target = event(params["event_id"])
        changes.append({"type": "SPLIT_CUSTOMER_COLLECTION", "event_id": target.id, "deposit_event_id": f"{target.id}-deposit",
                        "deposit_amount_paise": int(params["deposit_paise"]), "deposit_date": params["deposit_date"],
                        "customer_agreement_assumption": "Customer agrees to pay a deposit before delivery."})
    elif kind == "ADD_CREDIT_BRIDGE":
        changes.append({"type": "ADD_CREDIT_BRIDGE", "facility_id": params["facility_id"], "drawdown_event_id": "bridge-draw",
                        "repayment_event_id": "bridge-repay", "principal_paise": int(params["principal_paise"]),
                        "drawdown_date": params["drawdown_date"], "assumption": "Drawdown on an approved facility."})
    else:
        raise FixError("UNSUPPORTED_FIX", {"kind": kind})
    scenario = Scenario(scenario_id=fix["id"], assumptions=assumptions, changes=changes) if changes or assumptions else None
    return snapshot, scenario, assumptions


def _split_change(target, first: int, first_date: date, after_days: int, release: str) -> dict[str, Any]:
    second_date = first_date + timedelta(days=after_days)
    return {
        "type": "SPLIT_SUPPLIER_PAYMENT", "event_id": target.id,
        "instalments": [
            {"id": f"{target.id}-part-1", "amount_paise": first, "earliest_date": first_date.isoformat(), "due_date": first_date.isoformat()},
            {"id": f"{target.id}-part-2", "amount_paise": (target.amount_paise or 0) - first,
             "earliest_date": second_date.isoformat(), "due_date": second_date.isoformat()},
        ],
        "release_policy": release,
        "supplier_agreement_assumption": f"Supplier accepts two instalments, {after_days} days apart.",
    }


def evaluate(run: Run, fix: dict[str, Any]) -> dict[str, Any]:
    snapshot, scenario, edits = build_variant(run, fix)
    buffer = run.derived["summary"]["buffer_paise"]
    result, derived = run_variant(run.built, snapshot, scenario, buffer)
    base_results = {r.id: r for r in run.result.event_results}
    changed = []
    for r in result.event_results:
        before = base_results.get(r.id)
        before_date = before.actual_execution_date if before else None
        if before is None or before_date != r.actual_execution_date or before.status != r.status:
            delta = (r.actual_execution_date - before_date).days if (before_date and r.actual_execution_date) else None
            changed.append({"event_id": r.id, "baseline_date": before_date.isoformat() if before_date else None,
                            "scenario_date": r.actual_execution_date.isoformat() if r.actual_execution_date else None,
                            "delta_days": delta, "new": before is None, "status": r.status.value})
    removed = [eid for eid in base_results if eid not in {r.id for r in result.event_results}]
    cost = fix.get("cost_paise")
    if fix["kind"] == "ADD_CREDIT_BRIDGE":
        cost = result.metrics.accrued_financing_cost_paise + result.transaction_totals.get("drawdown_fees_paise", 0)
    summary = derived["summary"]
    base_summary = run.derived["summary"]
    return {
        "fix": {**fix, "cost_paise": cost},
        "scenario": scenario.model_dump(mode="json") if scenario else None,
        "snapshot_edits": edits,
        "dip_after_paise": summary["lowest"]["net_paise"] if summary["lowest"] else None,
        "dip_after_day": summary["lowest"]["day"] if summary["lowest"] else None,
        "dip_before_paise": base_summary["lowest"]["net_paise"] if base_summary["lowest"] else None,
        "runway_after_days": summary["runway_days"],
        "first_shortfall_after": summary["first_shortfall"],
        "buffer_breach_after": summary["buffer_breach"],
        "missed_commitments_delta": result.metrics.missed_commitment_count - run.result.metrics.missed_commitment_count,
        "late_orders_after": summary["late_orders"],
        "changed_events": changed,
        "removed_events": removed,
        "series": derived["series"],
        "assumptions": result.assumptions[-6:],
        "_snapshot": snapshot,
        "_scenario": scenario,
        "_result": result,
    }


def fix_key(snapshot_hash: str, fix: dict[str, Any]) -> str:
    payload = json.dumps({"kind": fix["kind"], "params": fix["params"]}, sort_keys=True)
    return f"{snapshot_hash}:{hashlib.sha256(payload.encode()).hexdigest()[:12]}"


def _human(day: date) -> str:
    return f"{day.day} {day.strftime('%b')}"


def _rupees(paise: int) -> str:
    rupees = paise // 100
    text = str(rupees)
    if len(text) > 3:
        head, tail = text[:-3], text[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        text = ",".join(groups) + "," + tail
    return f"₹{text}"
