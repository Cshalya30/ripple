"""Screen view models built from one engine run. Arithmetic here is limited to
grouping, sorting and layout; every amount and date is taken from the run."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from ..core.db import query, today
from ..simulation.schemas import BusinessSnapshot, EventStatus, EventType, SimulationResult
from ..snapshot.builder import BuiltSnapshot
from .position import delay_model, exposures, open_invoices, position

RESOURCE_CODES = {"INSUFFICIENT_CASH", "INSUFFICIENT_INVENTORY", "UNSUPPORTED_MULTIPLE_DRAWDOWNS"}
TIMING_CODES = {"DEPENDENCY_PENDING", "LAG_NOT_ELAPSED"}
GROUP = {
    EventType.CASH_RECEIPT: "BRING_IN", EventType.INVENTORY_ARRIVAL: "BRING_IN", EventType.CREDIT_DRAWDOWN: "BRING_IN",
    EventType.PRODUCTION_COMPLETE: "MOVE_GOODS", EventType.DELIVERY: "MOVE_GOODS",
}


def event_views(built: BuiltSnapshot, result: SimulationResult, snapshot: BusinessSnapshot | None = None) -> list[dict[str, Any]]:
    snap = snapshot or built.snapshot
    start = snap.start_date
    events = {e.id: e for e in snap.events}
    meta = built.meta["events"]
    dependents: dict[str, list[dict[str, Any]]] = {}
    for event in snap.events:
        for dep in event.dependencies:
            dependents.setdefault(dep.predecessor_event_id, []).append({"event_id": event.id, "lag_days": dep.lag_days})
    out = []
    for r in result.event_results:
        event = events.get(r.id)
        info = meta.get(r.id) or _derived_meta(r.id, meta, event)
        executed_day = (r.actual_execution_date - start).days if r.actual_execution_date else None
        earliest_day = max(0, (event.earliest_date - start).days) if event else None
        waits = _wait_ranges(r.blocking_history, earliest_day or 0)
        resource_waits = [w for w in waits if w["code"] in RESOURCE_CODES]
        if r.status == EventStatus.EXECUTED:
            state = "EXECUTED"
        elif r.status == EventStatus.RESOURCE_BLOCKED_AT_HORIZON:
            state = "BLOCKED"
        elif r.status == EventStatus.DEPENDENCY_BLOCKED_AT_HORIZON:
            state = "WAITING"
        else:
            state = "LATER"
        amount = event.amount_paise if event and event.amount_paise else info.get("amount_paise")
        if event is not None and event.type == EventType.CREDIT_DRAWDOWN:
            amount = event.principal_paise
        out.append({
            "id": r.id,
            "type": r.type.value,
            "group": GROUP.get(r.type, "PAY_OUT"),
            "label": info.get("label", r.id),
            "detail": info.get("detail", ""),
            "lane": info.get("lane", "credit"),
            "party_id": info.get("party_id"),
            "party_name": info.get("party_name"),
            "order_id": r.order_id,
            "record_type": info.get("record_type"),
            "record_id": info.get("record_id"),
            "amount_paise": amount,
            "direction": info.get("direction", "IN" if r.type in (EventType.CASH_RECEIPT, EventType.CREDIT_DRAWDOWN) else ("OUT" if r.type in (EventType.SUPPLIER_PAYMENT, EventType.OTHER_EXPENSE, EventType.CREDIT_REPAYMENT) else "NONE")),
            "quantity": info.get("quantity"),
            "material_id": info.get("material_id"),
            "materials": info.get("materials"),
            "earliest_date": event.earliest_date.isoformat() if event else None,
            "earliest_day": earliest_day,
            "due_date": r.original_due_date.isoformat() if r.original_due_date else None,
            "due_day": (r.original_due_date - start).days if r.original_due_date else None,
            "executed_date": r.actual_execution_date.isoformat() if r.actual_execution_date else None,
            "executed_day": executed_day,
            "state": state,
            "status": r.status.value,
            "lateness_days": r.lateness_days,
            "waited_from_day": resource_waits[0]["from_day"] if resource_waits else None,
            "waits": waits,
            "depends_on": [{"event_id": d.predecessor_event_id, "lag_days": d.lag_days} for d in (event.dependencies if event else [])],
            "unblocks": dependents.get(r.id, []),
            "assumptions": event.assumptions if event else [],
        })
    return out


def cached_views(run) -> list[dict[str, Any]]:
    views = getattr(run, "_views", None)
    if views is None:
        views = event_views(run.built, run.result)
        layout_rows(views)
        run._views = views
    return views


def _derived_meta(event_id: str, meta: dict[str, dict[str, Any]], event) -> dict[str, Any]:
    """Labels for events a scenario created (instalments, deposits, credit)."""
    for suffix, word in (("-part-1", "part 1"), ("-part-2", "part 2"), ("-advance", "financier advance"), ("-deposit", "deposit")):
        if event_id.endswith(suffix):
            parent = meta.get(event_id[: -len(suffix)], {})
            info = {**parent, "label": f"{parent.get('label', event_id)} ({word})"}
            if event is not None and event.amount_paise:
                info["amount_paise"] = event.amount_paise
            return info
    if event_id == "bridge-draw":
        return {"label": "Draw credit", "detail": "Bridge drawdown", "lane": "credit", "direction": "IN"}
    if event_id == "bridge-repay":
        return {"label": "Repay credit", "detail": "Principal plus interest", "lane": "credit", "direction": "OUT"}
    return {"label": event_id, "lane": "credit"}


def _wait_ranges(history, earliest_day: int) -> list[dict[str, Any]]:
    """Compress the engine's day-by-day blocking history into ranges of the same reason."""
    ranges: list[dict[str, Any]] = []
    for record in history:
        if record.day < earliest_day:
            continue
        for reason in record.reasons:
            last = ranges[-1] if ranges else None
            if last and last["code"] == reason.code and last["to_day"] == record.day - 1:
                last["to_day"] = record.day
                last["details"] = reason.details
                if reason.code == "INSUFFICIENT_CASH":
                    last["max_shortfall_paise"] = max(last.get("max_shortfall_paise", 0), reason.details.get("shortfall_paise", 0))
            elif last and last["code"] == reason.code and last["to_day"] == record.day:
                continue
            else:
                entry = {"code": reason.code, "from_day": record.day, "to_day": record.day, "first_details": reason.details, "details": reason.details}
                if reason.code == "INSUFFICIENT_CASH":
                    entry["max_shortfall_paise"] = reason.details.get("shortfall_paise", 0)
                ranges.append(entry)
    return ranges


def layout_rows(events: list[dict[str, Any]], width_days: int = 6) -> None:
    """Assign a row inside each lane so nodes do not overlap (deterministic)."""
    by_lane: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        event["x_day"] = event["executed_day"] if event["executed_day"] is not None else (
            max(event["earliest_day"] or 0, event.get("due_day") or 0) if event["state"] != "EXECUTED" else 0)
        by_lane.setdefault(event["lane"], []).append(event)
    for lane_events in by_lane.values():
        lane_events.sort(key=lambda e: (e["x_day"], e["id"]))
        row_ends: list[int] = []
        for event in lane_events:
            for index, end in enumerate(row_ends):
                if event["x_day"] >= end:
                    event["row"] = index
                    row_ends[index] = event["x_day"] + width_days
                    break
            else:
                event["row"] = len(row_ends)
                row_ends.append(event["x_day"] + width_days)


def run_payload(run, events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    built, result = run.built, run.result
    evs = events if events is not None else cached_views(run)
    if events is not None:
        layout_rows(evs)
    materials = built.meta["materials"]
    stock = []
    for material_id, info in materials.items():
        series = []
        for balance in result.daily_balances:
            qty = next((item.quantity for item in balance.inventory if item.material_id == material_id), 0)
            series.append(qty)
        stock.append({"material_id": material_id, **info, "series": series})
    lanes = list(built.meta["lanes"])
    if any(e["lane"] == "credit" for e in evs) and not any(l["id"] == "credit" for l in lanes):
        lanes.append({"id": "credit", "label": "Credit", "kind": "CREDIT"})
    return {
        "run_id": run.id,
        "created_at": run.created_at,
        "as_of": run.as_of.isoformat(),
        "data_version": run.data_version,
        "snapshot_hash": built.snapshot_hash,
        "schema_version": result.schema_version,
        "engine_version": result.engine_version,
        "event_count": len(result.event_results),
        "duration_ms": run.duration_ms,
        "horizon_days": len(result.daily_balances),
        "scheduling_policy": result.scheduling_policy.description,
        "series": run.derived["series"],
        "summary": run.derived["summary"],
        "events": evs,
        "lanes": lanes,
        "stock": stock,
        "orders": [o.model_dump(mode="json") for o in result.order_results],
        "assumptions": result.assumptions,
        "warnings": built.warnings,
    }


def network(business_id: str, run) -> dict[str, Any]:
    """Bloomberg SPLC-style view: suppliers left, customers right, sorted by exposure."""
    exp = exposures(business_id)
    parties = query("SELECT * FROM party WHERE business_id = ? ORDER BY name", (business_id,))
    evs = cached_views(run)
    by_party: dict[str, list[dict[str, Any]]] = {}
    for event in evs:
        if event["party_id"]:
            by_party.setdefault(event["party_id"], []).append(event)
    model = delay_model(business_id)
    nodes = []
    for party in parties:
        entry = exp.get(party["id"], {})
        party_events = sorted(by_party.get(party["id"], []), key=lambda e: (e["executed_day"] if e["executed_day"] is not None else 10**6, e["id"]))
        upcoming = [e for e in party_events if e["direction"] != "NONE" and (e["executed_day"] is None or e["executed_day"] >= 0)]
        next_money = next((e for e in upcoming if e["state"] != "EXECUTED" or e["executed_day"] is not None), None)
        blocked = any(e["state"] == "BLOCKED" or any(w["code"] in RESOURCE_CODES for w in e["waits"]) for e in party_events if e["direction"] == "OUT")
        late_days = entry.get("max_days_overdue", 0)
        nodes.append({
            "id": party["id"], "kind": party["kind"], "name": party["name"], "city": party["city"],
            "tags": _json_list(party["tags_json"]), "outstanding_paise": entry.get("outstanding_paise", 0),
            "exposure_bp": entry.get("exposure_bp", 0), "oldest_due": entry.get("oldest_due"), "days_overdue": late_days,
            "blocked": blocked, "next_event": next_money and {k: next_money[k] for k in ("id", "label", "executed_date", "due_date", "amount_paise", "state", "lateness_days")},
            "event_ids": [e["id"] for e in party_events],
            "risk": model["customers"].get(party["id"]),
        })
    pos = position(business_id)
    return {"parties": nodes, "position": pos, "summary": run.derived["summary"]}


def _json_list(value: str | None) -> list:
    import json
    try:
        return json.loads(value or "[]")
    except ValueError:
        return []


def week_strip(run) -> list[dict[str, Any]]:
    """Days 1 to 7: money in and money out the engine executes or cannot execute."""
    evs = cached_views(run)
    start = run.as_of
    days = []
    for offset in range(0, 8):
        day_in = [e for e in evs if e["executed_day"] == offset and e["direction"] == "IN" and e["amount_paise"]]
        day_out = [e for e in evs if e["executed_day"] == offset and e["direction"] == "OUT" and e["amount_paise"]]
        blocked = [e for e in evs if e["direction"] == "OUT" and e["due_day"] == offset and e["executed_day"] != offset]
        days.append({
            "day": offset, "date": (start + timedelta(days=offset)).isoformat(),
            "in_paise": sum(e["amount_paise"] for e in day_in), "out_paise": sum(e["amount_paise"] for e in day_out),
            "in_items": [{"label": e["label"], "amount_paise": e["amount_paise"]} for e in day_in],
            "out_items": [{"label": e["label"], "amount_paise": e["amount_paise"]} for e in day_out],
            "blocked_items": [{"label": e["label"], "amount_paise": e["amount_paise"]} for e in blocked],
        })
    return days


def why_the_dip(run) -> list[dict[str, Any]]:
    """Up to three causes of the first shortfall (or buffer breach), ranked by amount."""
    summary = run.derived["summary"]
    focus = summary["first_shortfall"] or summary["buffer_breach"]
    if focus is None:
        return []
    day = focus["day"]
    evs = {e["id"]: e for e in cached_views(run)}
    items: list[dict[str, Any]] = []
    for blocker in (summary["first_shortfall"] or {}).get("blockers", []):
        event = evs[blocker["event_id"]]
        items.append({"kind": "BLOCKED_PAYMENT", "event_id": event["id"], "title": f"{event['party_name'] or event['label']} due D{day}",
                      "label": event["label"], "amount_paise": event["amount_paise"], "day": event["due_day"], "party_id": event["party_id"],
                      "shortfall_paise": blocker["shortfall_paise"], "executed_day": event["executed_day"], "lateness_days": event["lateness_days"]})
    for event in evs.values():
        if event["direction"] == "IN" and event["type"] == "CASH_RECEIPT" and event["due_day"] is not None and event["due_day"] <= day \
                and (event["executed_day"] is None or event["executed_day"] > day):
            items.append({"kind": "LATE_RECEIPT", "event_id": event["id"], "title": event["party_name"] or event["label"],
                          "label": event["label"], "amount_paise": event["amount_paise"], "day": event["due_day"],
                          "executed_day": event["executed_day"], "party_id": event["party_id"],
                          "days_overdue": max(0, -event["due_day"]) if event["due_day"] < 0 else 0})
    for event in evs.values():
        if event["direction"] == "OUT" and event["executed_day"] is not None and day - 7 <= event["executed_day"] < day and event["amount_paise"]:
            items.append({"kind": "RECENT_OUTFLOW", "event_id": event["id"], "title": event["label"], "label": event["label"],
                          "amount_paise": event["amount_paise"], "day": event["executed_day"], "party_id": event["party_id"],
                          "days_before": day - event["executed_day"]})
    first = [i for i in items if i["kind"] == "BLOCKED_PAYMENT"][:1]
    rest = sorted([i for i in items if i not in first], key=lambda i: -(i["amount_paise"] or 0))
    return (first + rest)[:3]


def do_today(business_id: str, run, risk: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Ranked actions: overdue receivables by risk, dues within 3 days, stock blocking an order, reorders (PRD 8.3)."""
    actions: list[dict[str, Any]] = []
    drivers = {d["party_id"]: d["share"] for d in (risk or {}).get("drivers", [])}
    receivables = open_invoices(business_id, "RECEIVABLE")
    parties = {p["id"]: p for p in query("SELECT id, name, phone, kind FROM party WHERE business_id = ?", (business_id,))}
    overdue = [inv for inv in receivables if inv["days_overdue"] > 0]
    overdue.sort(key=lambda inv: (-drivers.get(inv["party_id"], 0), -inv["outstanding_paise"]))
    for inv in overdue:
        actions.append({"kind": "CHASE", "party_id": inv["party_id"], "party_name": parties[inv["party_id"]]["name"],
                        "invoice_id": inv["id"], "invoice_number": inv["number"], "amount_paise": inv["outstanding_paise"],
                        "days_overdue": inv["days_overdue"], "risk_share": drivers.get(inv["party_id"]), "action": "REMIND"})
    soon = today() + timedelta(days=3)
    for inv in open_invoices(business_id, "PAYABLE"):
        if inv["due_date"] <= soon.isoformat():
            actions.append({"kind": "PAY", "party_id": inv["party_id"], "party_name": parties[inv["party_id"]]["name"],
                            "invoice_id": inv["id"], "invoice_number": inv["number"], "amount_paise": inv["outstanding_paise"],
                            "due_date": inv["due_date"], "action": "MARK_PAID"})
    for po in query("SELECT * FROM purchase_order WHERE business_id = ? AND status IN ('ORDERED','PAID') AND expected_arrival IS NOT NULL AND expected_arrival <= ?",
                    (business_id, today().isoformat())):
        actions.append({"kind": "RECEIVE", "party_id": po["supplier_id"], "party_name": parties[po["supplier_id"]]["name"],
                        "po_id": po["id"], "po_number": po["number"], "action": "MARK_RECEIVED"})
    for event in cached_views(run):
        inventory_wait = [w for w in event["waits"] if w["code"] == "INSUFFICIENT_INVENTORY" and w["from_day"] <= 7]
        if event["type"] == "PRODUCTION_START" and inventory_wait:
            details = inventory_wait[0]["first_details"]
            actions.append({"kind": "STOCK", "order_id": event["order_id"], "material_id": details["material_id"],
                            "shortfall_quantity": details["shortfall_quantity"], "event_id": event["id"],
                            "from_day": inventory_wait[0]["from_day"], "to_day": inventory_wait[0]["to_day"], "action": "SHOW_ENGINE"})
    order = {"CHASE": 0, "PAY": 1, "RECEIVE": 2, "STOCK": 3, "REORDER": 4}
    actions.sort(key=lambda a: order[a["kind"]])
    return actions[:5]


def headline(summary: dict[str, Any], week: list[dict[str, Any]], dip: list[dict[str, Any]]) -> dict[str, Any]:
    """Template variant selection for Today's sentence; the client renders it in the owner's language."""
    blocked_this_week = any(day["blocked_items"] for day in week[1:])
    rescue = next((item for item in dip if item["kind"] == "LATE_RECEIPT"), None)
    if summary["first_shortfall"]:
        variant = "SHORTFALL_THIS_WEEK" if summary["first_shortfall"]["day"] <= 7 else "SHORTFALL"
    elif summary["buffer_breach"]:
        variant = "BUFFER_BREACH"
    else:
        variant = "SAFE"
    return {
        "variant": variant,
        "week_covered": not blocked_this_week,
        "first_shortfall": summary["first_shortfall"],
        "buffer_breach": summary["buffer_breach"],
        "buffer_paise": summary["buffer_paise"],
        "rescue": rescue and {"party_name": rescue["title"], "amount_paise": rescue["amount_paise"], "party_id": rescue["party_id"]},
        "horizon_days": summary["horizon_days"],
    }
