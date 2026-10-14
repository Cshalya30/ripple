"""Baseline and scenario runs, stored for audit, plus server-side derivations (PRD 6.3, 9.3).

Net position = engine cash balance minus unpaid dues. The engine never lets cash go
below zero; a blocked payment is recorded instead. Net position is therefore derived
here from the engine result, never in the browser.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from ..core.db import execute, get_conn, insert, now_iso, query_one, today
from ..simulation.engine import simulate
from ..simulation.schemas import ENGINE_VERSION, SCHEMA_VERSION, BusinessSnapshot, EventType, Scenario, SimulationResult
from ..snapshot.builder import BuiltSnapshot, build_from_records, load_records

OBLIGATION_TYPES = {EventType.SUPPLIER_PAYMENT, EventType.OTHER_EXPENSE, EventType.CREDIT_REPAYMENT}


@dataclass
class Run:
    id: str
    business_id: str
    data_version: int
    as_of: date
    built: BuiltSnapshot
    result: SimulationResult
    derived: dict[str, Any]
    created_at: str
    duration_ms: float
    kind: str = "BASELINE"


_cache: dict[str, Run] = {}
_lock = threading.Lock()


def business_row(business_id: str) -> dict[str, Any]:
    row = query_one("SELECT * FROM business WHERE id = ?", (business_id,))
    if row is None:
        raise KeyError(business_id)
    return row


def build_current(business_id: str, horizon_days: int | None = None) -> BuiltSnapshot:
    return build_from_records(load_records(business_id), today(), horizon_days)


def baseline(business_id: str) -> Run:
    """Latest baseline for the business's current records; recomputed after any write."""
    business = business_row(business_id)
    as_of = today()
    with _lock:
        cached = _cache.get(business_id)
        if cached and cached.data_version == business["data_version"] and cached.as_of == as_of:
            return cached
    built = build_current(business_id)
    started = time.perf_counter()
    result = simulate(built.snapshot, include_execution_log=True)
    duration = (time.perf_counter() - started) * 1000
    run = Run(
        id=f"run-{uuid.uuid4().hex[:10]}",
        business_id=business_id,
        data_version=business["data_version"],
        as_of=as_of,
        built=built,
        result=result,
        derived=derive(built, result, business["safety_buffer_paise"]),
        created_at=now_iso(),
        duration_ms=round(duration, 2),
    )
    _store(run, None)
    with _lock:
        _cache[business_id] = run
    return run


def run_variant(built: BuiltSnapshot, snapshot: BusinessSnapshot, scenario: Scenario | None, buffer_paise: int) -> tuple[SimulationResult, dict[str, Any]]:
    result = simulate(snapshot, scenario, include_execution_log=True)
    return result, derive(built, result, buffer_paise, snapshot=snapshot)


def store_scenario(base: Run, result: SimulationResult, scenario: dict[str, Any], snapshot: BusinessSnapshot) -> str:
    run_id = f"run-{uuid.uuid4().hex[:10]}"
    conn = get_conn()
    insert(conn, "sim_run", {
        "id": run_id, "business_id": base.business_id, "data_version": base.data_version,
        "snapshot_hash": base.built.snapshot_hash, "scenario_json": scenario,
        "snapshot_json": json.dumps(snapshot.model_dump(mode="json")) if snapshot is not base.built.snapshot else "{}",
        "result_json": json.dumps(result.model_dump(mode="json", exclude={"execution_log"})),
        "meta_json": "{}", "schema_version": SCHEMA_VERSION, "engine_version": ENGINE_VERSION, "kind": "SCENARIO",
        "duration_ms": None,
    })
    _prune(base.business_id)
    return run_id


def previous_baseline(business_id: str, current: Run) -> dict[str, Any] | None:
    row = query_one(
        "SELECT * FROM sim_run WHERE business_id = ? AND kind = 'BASELINE' AND data_version < ? ORDER BY created_at DESC, data_version DESC LIMIT 1",
        (business_id, current.data_version),
    )
    if row is None:
        return None
    return {"id": row["id"], "data_version": row["data_version"], "created_at": row["created_at"], "meta": json.loads(row["meta_json"])}


def invalidate(business_id: str) -> None:
    with _lock:
        _cache.pop(business_id, None)


def _store(run: Run, scenario: dict | None) -> None:
    conn = get_conn()
    insert(conn, "sim_run", {
        "id": run.id, "business_id": run.business_id, "data_version": run.data_version,
        "snapshot_hash": run.built.snapshot_hash, "scenario_json": scenario,
        "snapshot_json": json.dumps(run.built.snapshot.model_dump(mode="json")),
        "result_json": json.dumps(run.result.model_dump(mode="json", exclude={"execution_log"})),
        "meta_json": json.dumps({"summary": run.derived["summary"], "as_of": run.as_of.isoformat()}),
        "schema_version": run.result.schema_version, "engine_version": run.result.engine_version, "kind": run.kind,
        "duration_ms": run.duration_ms,
    })
    _prune(run.business_id)


def _prune(business_id: str, keep: int = 40) -> None:
    execute(
        "DELETE FROM sim_run WHERE business_id = ? AND id NOT IN (SELECT id FROM sim_run WHERE business_id = ? ORDER BY created_at DESC LIMIT ?)",
        (business_id, business_id, keep),
    )


# ---------------------------------------------------------------- derivations

def obligation_amount(event_result, snapshot_event) -> int:
    if snapshot_event is not None and snapshot_event.amount_paise:
        return snapshot_event.amount_paise
    for record in reversed(event_result.blocking_history):
        for reason in record.reasons:
            if reason.code == "INSUFFICIENT_CASH":
                return int(reason.details["required_paise"])
    return 0


def derive(built: BuiltSnapshot, result: SimulationResult, buffer_paise: int, snapshot: BusinessSnapshot | None = None) -> dict[str, Any]:
    snap = snapshot or built.snapshot
    events = {event.id: event for event in snap.events}
    start = snap.start_date
    horizon = len(result.daily_balances)
    dues = [0] * horizon
    actual = {r.id: r.actual_execution_date for r in result.event_results}
    for event_result in result.event_results:
        if event_result.type not in OBLIGATION_TYPES:
            continue
        event = events.get(event_result.id)
        due = event_result.original_due_date
        if due is None and event is not None:
            # No contractual date: it falls due once its predecessors (e.g. the goods arriving) plus lag have happened.
            due = event.earliest_date
            for dependency in event.dependencies:
                predecessor = actual.get(dependency.predecessor_event_id)
                if predecessor is None:
                    due = None
                    break
                due = max(due, predecessor + timedelta(days=dependency.lag_days))
        if due is None:
            continue
        due_day = max(0, (due - start).days)
        executed_day = (event_result.actual_execution_date - start).days if event_result.actual_execution_date else horizon
        amount = obligation_amount(event_result, event)
        for day in range(due_day, min(executed_day, horizon)):
            dues[day] += amount

    series = []
    for balance in result.daily_balances:
        net = balance.cash_paise - dues[balance.day]
        series.append({"day": balance.day, "date": balance.date.isoformat(), "cash_paise": balance.cash_paise,
                       "unpaid_dues_paise": dues[balance.day], "net_paise": net})

    first_short = next((point for point in series if point["net_paise"] < 0), None)
    breach = next((point for point in series if point["net_paise"] < buffer_paise), None)
    lowest = min(series, key=lambda point: (point["net_paise"], point["day"])) if series else None
    blockers: list[dict[str, Any]] = []
    if first_short is not None:
        day = first_short["day"]
        for event_result in result.event_results:
            for record in event_result.blocking_history:
                if record.day != day:
                    continue
                for reason in record.reasons:
                    if reason.code == "INSUFFICIENT_CASH" and event_result.type in OBLIGATION_TYPES:
                        blockers.append({"event_id": event_result.id, "required_paise": reason.details["required_paise"],
                                         "available_paise": reason.details["available_paise"],
                                         "shortfall_paise": reason.details["shortfall_paise"]})
    summary = {
        "opening_cash_paise": snap.opening_cash_paise,
        "closing_cash_paise": result.metrics.closing_cash_paise,
        "buffer_paise": buffer_paise,
        "horizon_days": horizon,
        "runway_days": first_short["day"] if first_short else None,
        "first_shortfall": None if first_short is None else {
            "day": first_short["day"], "date": first_short["date"], "net_paise": first_short["net_paise"],
            "shortfall_paise": -first_short["net_paise"], "blockers": blockers,
        },
        "buffer_breach": None if breach is None else {"day": breach["day"], "date": breach["date"], "net_paise": breach["net_paise"]},
        "lowest": None if lowest is None else {"day": lowest["day"], "date": lowest["date"], "net_paise": lowest["net_paise"]},
        "missed_commitment_count": result.metrics.missed_commitment_count,
        "unresolved_order_count": result.metrics.unresolved_order_count,
        "late_orders": [
            {"order_id": order.order_id, "lateness_days": order.delivery_lateness_days, "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
             "promised_date": order.promised_delivery_date.isoformat(), "status": order.status}
            for order in result.order_results if order.status != "DELIVERED" or (order.delivery_lateness_days or 0) > 0
        ],
    }
    return {"series": series, "summary": summary}


def day_to_date(start: date, day: int) -> str:
    return (start + timedelta(days=day)).isoformat()
