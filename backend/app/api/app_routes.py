"""Application API (PRD 15). Every handler takes business_id from the session."""
from __future__ import annotations

import csv
import io
import json
import re
import threading
import uuid
from datetime import date, timedelta
from datetime import date as Date
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..core.auth import ANYONE, FINANCE, OWNER, Principal, for_role, hash_password, limit_ai, limiter
from ..core.db import delete_business_data, insert, query, query_one, today, tx, update, update_business, bump_data_version
from ..intake.drafts import DraftStore
from ..intake.extractor import GroqExtractor
from ..intake.schemas import BusinessFacts, IntakeRequest
from ..records import repo
from ..records.importer import import_facts
from ..records.seed import seed_business
from ..simulation.comparison import compare_scenarios
from ..simulation.engine import simulate
from ..simulation.schemas import MAX_SAFE_INTEGER, ComparisonRequest, SimulationRequest
from ..snapshot.builder import build_from_records, load_records, OPEN_ORDER_STAGES
from ..services import fixes as fixes_service
from ..services import datasheet, munim, risk as risk_service, runs
from ..services.inventory import inventory_rows, movement_rows
from ..services.messages import CUSTOMER_INTENTS, INTENTS, human_date, render, rupees, wa_link
from ..services.position import delay_model, exposures, open_invoices, position
from ..services.views import cached_views, do_today, event_views, headline, network, run_payload, week_strip, why_the_dip

router = APIRouter()


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


Paise = Field(gt=0, le=MAX_SAFE_INTEGER // 1000)
Id = Field(min_length=1, max_length=160)


# ---------------------------------------------------------------- recompute pipeline

def kick_risk(business_id: str, run: runs.Run, delay_s: float = 0.0) -> str:
    key = f"{run.built.snapshot_hash}:baseline"
    buffer = run.derived["summary"]["buffer_paise"]

    def job() -> dict[str, Any]:
        current = runs.baseline(business_id)
        if current.built.snapshot_hash != run.built.snapshot_hash:
            raise RuntimeError("superseded")
        return risk_service.compute(business_id, run.built, buffer)

    risk_service.jobs.submit(key, job, delay_s)
    return key


def after_write(business_id: str) -> runs.Run:
    """Write -> invalidate -> rebuild snapshot -> baseline run -> debounced risk run (PRD 13.3)."""
    runs.invalidate(business_id)
    run = runs.baseline(business_id)
    kick_risk(business_id, run, delay_s=2.0)
    return run


def current_run(principal: Principal) -> runs.Run:
    try:
        return runs.baseline(principal.business_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "UNKNOWN_BUSINESS"}) from exc


def risk_for(run: runs.Run) -> dict[str, Any]:
    key = f"{run.built.snapshot_hash}:baseline"
    result = risk_service.jobs.get(key)
    if result is not None:
        return result
    status = risk_service.jobs.status(key)
    if status == "MISSING":
        kick_risk(run.business_id, run)
        status = "COMPUTING"
    return {"status": status}


def run_meta(run: runs.Run) -> dict[str, Any]:
    return {"run_id": run.id, "created_at": run.created_at, "engine_version": run.result.engine_version,
            "schema_version": run.result.schema_version, "event_count": len(run.result.event_results),
            "snapshot_hash": run.built.snapshot_hash, "duration_ms": run.duration_ms, "as_of": run.as_of.isoformat(),
            "data_version": run.data_version, "warnings": run.built.warnings}


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, repo.RecordError):
        return HTTPException(status_code=exc.status, detail={"code": exc.code, **exc.details})
    if isinstance(exc, fixes_service.FixError):
        return HTTPException(status_code=422, detail={"code": exc.code, **exc.details})
    raise exc


# ---------------------------------------------------------------- today and alerts

@router.get("/today")
def get_today(principal: Principal = Depends(FINANCE)):
    run = current_run(principal)
    risk = risk_for(run)
    summary = run.derived["summary"]
    week = week_strip(run)
    dip = why_the_dip(run)
    bid = principal.business_id
    t = today().isoformat()
    awaited = query("SELECT COUNT(*) c FROM purchase_order WHERE business_id = ? AND status IN ('ORDERED','PAID')", (bid,))[0]["c"]
    received = query("SELECT COUNT(*) c FROM stock_movement WHERE business_id = ? AND reason = 'PURCHASE_ARRIVAL' AND date = ?", (bid, t))[0]["c"]
    to_deliver = query("SELECT COUNT(*) c FROM sales_order WHERE business_id = ? AND stage IN ('PLANNED','MATERIALS_READY','IN_PRODUCTION','READY')", (bid,))[0]["c"]
    delivered = query("SELECT COUNT(*) c FROM stock_movement WHERE business_id = ? AND reason = 'DISPATCH' AND date = ?", (bid, t))[0]["c"]
    day0 = week[0]
    changes = None
    previous = runs.previous_baseline(bid, run)
    if previous and previous["meta"].get("summary"):
        before = previous["meta"]["summary"]
        new_txns = query("SELECT t.*, p.name AS party_name FROM txn t LEFT JOIN party p ON p.id = t.party_id WHERE t.business_id = ? AND t.created_at >= ? ORDER BY t.created_at DESC LIMIT 5",
                         (bid, previous["created_at"]))
        changes = {
            "since": previous["created_at"],
            "runway_before": before.get("runway_days"), "runway_after": summary["runway_days"],
            "lowest_before_paise": (before.get("lowest") or {}).get("net_paise"), "lowest_after_paise": (summary.get("lowest") or {}).get("net_paise"),
            "transactions": [{"party_name": x["party_name"], "direction": x["direction"], "amount_paise": x["amount_paise"],
                              "medium": x["medium"], "reference": x["reference"], "status": x["status"]} for x in new_txns],
        }
    return {
        "date": t, "horizon_days": summary["horizon_days"],
        "headline": headline(summary, week, dip),
        "position": position(bid),
        "summary": summary,
        "do_today": do_today(bid, run, risk if risk.get("status") == "READY" else None),
        "week": week[1:],
        "from_suppliers": {"awaited": awaited, "received_today": received},
        "to_customers": {"to_deliver": to_deliver, "delivered_today": delivered},
        "money_today": {"in_count": len(day0["in_items"]), "in_paise": day0["in_paise"],
                        "out_count": len(day0["out_items"]) + len(day0["blocked_items"]),
                        "out_paise": day0["out_paise"] + sum(i["amount_paise"] or 0 for i in day0["blocked_items"])},
        "changes": changes,
        "risk": _risk_brief(risk),
        "run": run_meta(run),
    }


def _risk_brief(risk: dict[str, Any]) -> dict[str, Any]:
    if risk.get("status") != "READY":
        return {"status": risk.get("status")}
    return {"status": "READY", "shortfall_chance": risk["shortfall_chance"], "drivers": risk["drivers"][:3], "n_samples": risk["n_samples"]}


@router.get("/alerts")
def get_alerts(principal: Principal = Depends(ANYONE)):
    bid = principal.business_id
    alerts: list[dict[str, Any]] = []
    if principal.role != "SUPERVISOR":
        run = current_run(principal)
        s = run.derived["summary"]
        if s["buffer_breach"]:
            alerts.append({"id": "buffer", "kind": "BUFFER_BREACH", "severity": "out" if s["first_shortfall"] else "attention",
                           "date": s["buffer_breach"]["date"], "day": s["buffer_breach"]["day"], "link": "/app/book",
                           "shortfall_paise": s["first_shortfall"]["shortfall_paise"] if s["first_shortfall"] else None,
                           "shortfall_date": s["first_shortfall"]["date"] if s["first_shortfall"] else None})
        names = {p["id"]: p["name"] for p in query("SELECT id, name FROM party WHERE business_id = ?", (bid,))}
        for inv in open_invoices(bid, "RECEIVABLE"):
            if inv["days_overdue"] > 0:
                alerts.append({"id": f"overdue-{inv['id']}", "kind": "OVERDUE", "severity": "attention", "party_name": names.get(inv["party_id"]),
                               "party_id": inv["party_id"], "amount_paise": inv["outstanding_paise"], "days_overdue": inv["days_overdue"],
                               "invoice": inv["number"], "link": "/app/khata"})
        soon = (today() + timedelta(days=3)).isoformat()
        for inv in open_invoices(bid, "PAYABLE"):
            if inv["due_date"] <= soon:
                alerts.append({"id": f"due-{inv['id']}", "kind": "DUE_SOON", "severity": "attention", "party_name": names.get(inv["party_id"]),
                               "party_id": inv["party_id"], "amount_paise": inv["outstanding_paise"], "date": inv["due_date"],
                               "invoice": inv["number"], "link": "/app/khata"})
        risk = risk_for(run)
        if risk.get("status") == "READY":
            chance = risk["shortfall_chance"]["30"]
            if chance >= 0.25:
                alerts.append({"id": "risk", "kind": "RISK", "severity": "out" if chance >= 0.5 else "attention",
                               "chance": chance, "link": "/app/book"})
    else:
        run = current_run(principal)
    inv = inventory_rows(bid, run)
    for m in inv["materials"]:
        if m["status"] == "SHORT":
            alerts.append({"id": f"stock-{m['id']}", "kind": "STOCK_SHORT", "severity": "out", "material": m["name"],
                           "orders": m["short_orders"], "link": "/app/inventory"})
    return {"alerts": alerts, "count": len(alerts)}


# ---------------------------------------------------------------- engine

_scenarios: dict[str, Any] = {}
_scenario_lock = threading.Lock()


class ScenarioRun:
    def __init__(self, base: runs.Run, evaluation: dict[str, Any], key: str, run_id: str):
        self.id = run_id
        self.business_id = base.business_id
        self.data_version = base.data_version
        self.as_of = base.as_of
        self.built = base.built
        self.result = evaluation["_result"]
        self.snapshot = evaluation["_snapshot"]
        self.derived = {"series": evaluation["series"], "summary": {**base.derived["summary"], **_summary_of(evaluation)}}
        self.created_at = base.created_at
        self.duration_ms = None
        self.key = key


def _summary_of(evaluation: dict[str, Any]) -> dict[str, Any]:
    return {"runway_days": evaluation["runway_after_days"], "first_shortfall": evaluation["first_shortfall_after"],
            "buffer_breach": evaluation["buffer_breach_after"], "late_orders": evaluation["late_orders_after"],
            "lowest": {"net_paise": evaluation["dip_after_paise"], "day": evaluation["dip_after_day"],
                       "date": (evaluation["series"][evaluation["dip_after_day"]]["date"] if evaluation["dip_after_day"] is not None else None)}}


def scenario_by_key(principal: Principal, key: str | None):
    if not key:
        return current_run(principal)
    with _scenario_lock:
        found = _scenarios.get(f"{principal.business_id}|{key}")
    run = current_run(principal)
    if found is None or found.data_version != run.data_version:
        raise HTTPException(status_code=404, detail={"code": "SCENARIO_EXPIRED"})
    return found


@router.get("/engine/run")
def engine_run(scenario: str | None = Query(default=None, max_length=80), principal: Principal = Depends(FINANCE)):
    run = scenario_by_key(principal, scenario)
    if isinstance(run, ScenarioRun):
        evs = event_views(run.built, run.result, run.snapshot)
        payload = run_payload(run, evs)
    else:
        payload = run_payload(run)
    return payload


@router.get("/engine/graph")
def engine_graph(view: Literal["network", "flow"] = "network", scenario: str | None = Query(default=None, max_length=80),
                 principal: Principal = Depends(FINANCE)):
    if view == "flow":
        return engine_run(scenario, principal)
    return network(principal.business_id, current_run(principal))


@router.get("/engine/day/{day}")
def engine_day(day: int, scenario: str | None = Query(default=None, max_length=80), principal: Principal = Depends(FINANCE)):
    run = scenario_by_key(principal, scenario)
    horizon = len(run.result.daily_balances)
    if not 0 <= day < horizon:
        raise HTTPException(status_code=422, detail={"code": "DAY_OUT_OF_RANGE", "horizon_days": horizon})
    views = {e["id"]: e for e in (event_views(run.built, run.result, run.snapshot) if isinstance(run, ScenarioRun) else cached_views(run))}
    rows = []
    for entry in run.result.execution_log or []:
        if entry.day != day:
            continue
        ev = views.get(entry.event_id, {})
        rows.append({"seq": entry.seq, "event_id": entry.event_id, "type": entry.type.value, "group": entry.group,
                     "label": ev.get("label", entry.event_id), "party_name": ev.get("party_name"), "amount_paise": ev.get("amount_paise"),
                     "direction": ev.get("direction"), "sort_key": entry.sort_key, "outcome": entry.outcome,
                     "cash_before_paise": entry.cash_before_paise, "cash_after_paise": entry.cash_after_paise,
                     "reasons": [r.model_dump(mode="json") for r in entry.reasons]})
    balances = run.result.daily_balances
    opening = balances[day - 1].cash_paise if day > 0 else run.built.snapshot.opening_cash_paise
    return {"day": day, "date": balances[day].date.isoformat(), "opening_cash_paise": opening, "closing_cash_paise": balances[day].cash_paise,
            "net_paise": run.derived["series"][day]["net_paise"], "rows": rows, "source": "execution_log",
            "policy": run.result.scheduling_policy.description}


class ScenarioBody(Strict):
    fix_id: str | None = Field(default=None, max_length=80)
    kind: Literal["MOVE_RECEIPT_DATE", "DELAY_ARRIVAL", "SPLIT_CUSTOMER_COLLECTION", "SPLIT_SUPPLIER_PAYMENT", "ADD_CREDIT_BRIDGE", "EXTENSION"] | None = None
    event_id: str | None = Field(default=None, max_length=160)
    date: Date | None = None
    days: int | None = Field(default=None, ge=1, le=365)
    amount_paise: int | None = Field(default=None, gt=0, le=MAX_SAFE_INTEGER // 1000)
    facility_id: str | None = Field(default=None, max_length=80)


def resolve_fix(run: runs.Run, body: ScenarioBody) -> dict[str, Any]:
    if body.fix_id:
        fix = next((f for f in fixes_service.candidates(run) if f["id"] == body.fix_id), None)
        if fix is None:
            raise HTTPException(status_code=404, detail={"code": "UNKNOWN_FIX"})
        return fix
    if body.kind is None:
        raise HTTPException(status_code=422, detail={"code": "FIX_OR_KIND_REQUIRED"})
    p: dict[str, Any] = {"event_id": body.event_id}
    start = run.as_of
    last = start + timedelta(days=run.built.snapshot.horizon_days)

    def need(*fields: str) -> None:
        missing = [f for f in fields if getattr(body, f) is None]
        if missing:
            raise HTTPException(status_code=422, detail={"code": "MISSING_FIELDS", "fields": missing})

    if body.date is not None and not (start <= body.date < last):
        raise HTTPException(status_code=422, detail={"code": "DATE_OUTSIDE_HORIZON"})
    if body.kind == "MOVE_RECEIPT_DATE":
        need("event_id", "date"); p["date"] = body.date.isoformat()
    elif body.kind in ("DELAY_ARRIVAL", "EXTENSION"):
        need("event_id", "days"); p["days"] = body.days
    elif body.kind == "SPLIT_CUSTOMER_COLLECTION":
        need("event_id", "amount_paise", "date"); p.update(deposit_paise=body.amount_paise, deposit_date=body.date.isoformat())
    elif body.kind == "SPLIT_SUPPLIER_PAYMENT":
        need("event_id", "amount_paise"); event = next((e for e in run.built.snapshot.events if e.id == body.event_id), None)
        if event is None:
            raise HTTPException(status_code=422, detail={"code": "UNKNOWN_EVENT"})
        p.update(first_paise=body.amount_paise, first_date=max(start, event.due_date or event.earliest_date).isoformat(), second_after_days=body.days)
    elif body.kind == "ADD_CREDIT_BRIDGE":
        need("facility_id", "amount_paise", "date"); p = {"facility_id": body.facility_id, "principal_paise": body.amount_paise, "drawdown_date": body.date.isoformat()}
    return {"id": f"custom-{body.kind.lower()}", "kind": body.kind, "params": p, "title": "Your what-if", "cost_paise": 0}


def _evaluate(principal: Principal, body: ScenarioBody) -> tuple[runs.Run, dict[str, Any], dict[str, Any]]:
    run = current_run(principal)
    fix = resolve_fix(run, body)
    try:
        evaluation = fixes_service.evaluate(run, fix)
    except (fixes_service.FixError, repo.RecordError) as exc:
        raise _error(exc) from exc
    except ValueError as exc:
        code = getattr(exc, "code", "INVALID_SCENARIO")
        raise HTTPException(status_code=422, detail={"code": code, "details": getattr(exc, "details", None) or str(exc)[:200]}) from exc
    return run, fix, evaluation


def _public(evaluation: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in evaluation.items() if not k.startswith("_")}


@router.post("/engine/scenario")
def engine_scenario(body: ScenarioBody, principal: Principal = Depends(FINANCE)):
    run, fix, evaluation = _evaluate(principal, body)
    key = fixes_service.fix_key(run.built.snapshot_hash, fix)[-12:]
    run_id = runs.store_scenario(run, evaluation["_result"], evaluation["scenario"] or {}, evaluation["_snapshot"])
    scenario_run = ScenarioRun(run, evaluation, key, run_id)
    with _scenario_lock:
        _scenarios[f"{principal.business_id}|{key}"] = scenario_run
        if len(_scenarios) > 500:
            for old in list(_scenarios)[:100]:
                _scenarios.pop(old, None)
    evs = event_views(run.built, evaluation["_result"], evaluation["_snapshot"])
    return {"key": key, "run_id": run_id, "evaluation": _public(evaluation), "run": run_payload(scenario_run, evs),
            "chance_after": _chance_after(run, fix)}


@router.post("/engine/scenario/chance")
def engine_scenario_chance(body: ScenarioBody, principal: Principal = Depends(FINANCE)):
    """Just the shortfall-chance status of a scenario: cheap to poll while the risk run finishes (no engine run here)."""
    run = current_run(principal)
    fix = resolve_fix(run, body)
    return {"chance_after": _chance_after(run, fix)}


# ---------------------------------------------------------------- book, fixes, risk

@router.get("/book/summary")
def book_summary(principal: Principal = Depends(FINANCE)):
    run = current_run(principal)
    return {"position": position(principal.business_id), "series": run.derived["series"], "summary": run.derived["summary"],
            "why": why_the_dip(run), "run": run_meta(run)}


def _chance_after(run: runs.Run, fix: dict[str, Any]) -> dict[str, Any]:
    key = fixes_service.fix_key(run.built.snapshot_hash, fix)
    result = risk_service.jobs.get(key)
    if result is not None:
        if result.get("status") != "READY":
            return {"status": result.get("status")}
        return {"status": "READY", "shortfall_chance": result["shortfall_chance"], "n_samples": result["n_samples"]}
    if risk_service.jobs.status(key) == "MISSING":
        buffer = run.derived["summary"]["buffer_paise"]

        def job() -> dict[str, Any]:
            snapshot, scenario, _ = fixes_service.build_variant(run, fix)
            return risk_service.compute(run.business_id, run.built, buffer, snapshot=snapshot, scenario=scenario,
                                        scenario_key=key.split(":")[1], with_drivers=False, samples=risk_service.fix_samples())

        risk_service.jobs.submit(key, job)
    return {"status": risk_service.jobs.status(key)}


@router.get("/fixes")
def list_fixes(principal: Principal = Depends(FINANCE)):
    run = current_run(principal)
    out = []
    for fix in fixes_service.candidates(run):
        try:
            evaluation = fixes_service.evaluate(run, fix)
        except ValueError:
            continue
        public = _public(evaluation)
        public.pop("series", None)
        out.append({**public, "chance_after": _chance_after(run, fix)})
    return {"fixes": out, "run": run_meta(run), "baseline_risk": _risk_brief(risk_for(run))}


@router.post("/fixes/evaluate")
def evaluate_fix(body: ScenarioBody, principal: Principal = Depends(FINANCE)):
    run, fix, evaluation = _evaluate(principal, body)
    return {**_public(evaluation), "chance_after": _chance_after(run, fix)}


@router.get("/risk/forecast")
def risk_forecast(principal: Principal = Depends(FINANCE)):
    run = current_run(principal)
    result = risk_for(run)
    return {**result, "run_id": run.id, "snapshot_hash": run.built.snapshot_hash}


# ---------------------------------------------------------------- transactions

class PaymentBody(Strict):
    party_id: str = Id
    direction: Literal["IN", "OUT"]
    amount_paise: int = Paise
    date: Date
    medium: Literal["UPI", "NEFT", "RTGS", "IMPS", "CASH", "CHEQUE"]
    reference: str | None = Field(default=None, max_length=60)
    invoice_id: str | None = Field(default=None, max_length=160)
    status: Literal["CLEARED", "PENDING"] | None = None
    details: str | None = Field(default=None, max_length=200)


@router.get("/transactions")
def list_transactions(party: str | None = Query(default=None, max_length=160), medium: str | None = Query(default=None, max_length=10),
                      direction: Literal["IN", "OUT"] | None = None, limit: int = Query(default=200, ge=1, le=1000),
                      principal: Principal = Depends(FINANCE)):
    bid = principal.business_id
    business = query_one("SELECT opening_balance_paise, opening_balance_date FROM business WHERE id = ?", (bid,))
    rows = query("SELECT t.*, p.name AS party_name, i.number AS invoice_number FROM txn t LEFT JOIN party p ON p.id = t.party_id "
                 "LEFT JOIN invoice i ON i.id = t.invoice_id WHERE t.business_id = ? ORDER BY t.date, t.created_at, t.id", (bid,))
    balance = business["opening_balance_paise"]
    for row in rows:
        if row["status"] == "CLEARED":
            balance += row["amount_paise"] if row["direction"] == "IN" else -row["amount_paise"]
        row["balance_paise"] = balance
    filtered = [r for r in rows if (not party or r["party_id"] == party) and (not medium or r["medium"] == medium)
                and (not direction or r["direction"] == direction)]
    cleared = [r for r in filtered if r["status"] == "CLEARED"]
    totals = {"in_paise": sum(r["amount_paise"] for r in cleared if r["direction"] == "IN"),
              "out_paise": sum(r["amount_paise"] for r in cleared if r["direction"] == "OUT")}
    keep = ("id", "date", "party_id", "party_name", "details", "medium", "reference", "direction", "amount_paise", "balance_paise", "status", "invoice_number")
    return {"rows": [{k: r[k] for k in keep} for r in reversed(filtered)][:limit], "count": len(filtered), "totals": totals,
            "opening_balance_paise": business["opening_balance_paise"], "opening_balance_date": business["opening_balance_date"]}


@router.post("/transactions")
def post_transaction(body: PaymentBody, principal: Principal = Depends(FINANCE)):
    try:
        txn = repo.record_payment(principal.business_id, principal.user_id, body.model_dump(mode="json"))
    except repo.RecordError as exc:
        raise _error(exc) from exc
    run = after_write(principal.business_id)
    return {"transaction": txn, "run": run_meta(run), "summary": run.derived["summary"]}


class TxnStatusBody(Strict):
    status: Literal["CLEARED", "BOUNCED"]


@router.patch("/transactions/{txn_id}")
def patch_transaction(txn_id: str, body: TxnStatusBody, principal: Principal = Depends(FINANCE)):
    try:
        txn = repo.set_txn_status(principal.business_id, txn_id, body.status)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"transaction": txn}


@router.get("/export/transactions.csv")
def export_transactions(principal: Principal = Depends(FINANCE)):
    data = list_transactions(None, None, None, 1000, principal)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["date", "party", "details", "medium", "reference", "in_rupees", "out_rupees", "balance_rupees", "status"])
    for r in reversed(data["rows"]):
        amount = f"{r['amount_paise'] / 100:.2f}"
        writer.writerow([r["date"], r["party_name"] or "", _csv_safe(r["details"] or ""), r["medium"], _csv_safe(r["reference"] or ""),
                         amount if r["direction"] == "IN" else "", amount if r["direction"] == "OUT" else "", f"{r['balance_paise'] / 100:.2f}", r["status"]])
    return PlainTextResponse(buffer.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=ripple-transactions.csv"})


def _csv_download(text: str, stem: str) -> PlainTextResponse:
    return PlainTextResponse(text, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{stem}.csv"'})


@router.get("/export/party/{party_id}/datasheet.csv")
def export_party_datasheet(party_id: str, principal: Principal = Depends(FINANCE)):
    """One customer or one supplier: profile, summary, invoices, payments, orders, forecast and notes."""
    try:
        text, stem = datasheet.party_sheet(principal.business_id, party_id)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    return _csv_download(text, stem)


@router.get("/export/company/datasheet.csv")
def export_company_datasheet(principal: Principal = Depends(FINANCE)):
    """The whole business on one sheet: profile, position, forecast, parties, orders, stock, settings."""
    text, stem = datasheet.company_sheet(principal.business_id)
    return _csv_download(text, stem)


def _csv_safe(value: str) -> str:
    """Prevent spreadsheet formula injection in exported text (one guard for every export)."""
    return datasheet.safe(value)


# ---------------------------------------------------------------- khata

class PartyBody(Strict):
    kind: Literal["SUPPLIER", "CUSTOMER"]
    name: str = Field(min_length=1, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=24, pattern=r"^[0-9+ ()-]*$")
    gstin: str | None = Field(default=None, max_length=15)
    udyam_number: str | None = Field(default=None, max_length=30)
    msme_category: Literal["MICRO", "SMALL", "MEDIUM"] | None = None
    terms_type: Literal["ADVANCE", "ON_DELIVERY", "CREDIT"] | None = None
    terms_days: int = Field(default=30, ge=0, le=365)
    lead_time_days: int = Field(default=0, ge=0, le=365)
    tags: list[str] | None = Field(default=None, max_length=8)


class PartyPatch(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=24, pattern=r"^[0-9+ ()-]*$")
    gstin: str | None = Field(default=None, max_length=15)
    udyam_number: str | None = Field(default=None, max_length=30)
    msme_category: Literal["MICRO", "SMALL", "MEDIUM"] | None = None
    terms_type: Literal["ADVANCE", "ON_DELIVERY", "CREDIT"] | None = None
    terms_days: int | None = Field(default=None, ge=0, le=365)
    lead_time_days: int | None = Field(default=None, ge=0, le=365)
    tags: list[str] | None = Field(default=None, max_length=8)


def _party_rows(principal: Principal, kind: str | None) -> list[dict[str, Any]]:
    bid = principal.business_id
    business = query_one("SELECT udyam_number FROM business WHERE id = ?", (bid,))
    exp = exposures(bid)
    model = delay_model(bid)
    run = current_run(principal)
    risk = risk_service.jobs.get(f"{run.built.snapshot_hash}:baseline") or {}
    shares = {d["party_id"]: d["share"] for d in risk.get("drivers", [])}
    invoices = open_invoices(bid)
    sql = "SELECT * FROM party WHERE business_id = ?" + (" AND kind = ?" if kind else "") + " ORDER BY name"
    rows = []
    for p in query(sql, (bid, kind) if kind else (bid,)):
        e = exp.get(p["id"], {})
        mine = [i for i in invoices if i["party_id"] == p["id"]]
        row = {"id": p["id"], "kind": p["kind"], "name": p["name"], "city": p["city"], "description": p["description"], "phone": p["phone"],
               "tags": json.loads(p["tags_json"] or "[]"), "terms_type": p["terms_type"], "terms_days": p["terms_days"],
               "lead_time_days": p["lead_time_days"], "msme_category": p["msme_category"], "udyam_number": p["udyam_number"],
               "outstanding_paise": e.get("outstanding_paise", 0), "exposure_bp": e.get("exposure_bp", 0),
               "oldest_due": e.get("oldest_due"), "days_overdue": e.get("max_days_overdue", 0), "open_items": len(mine),
               "risk_share": shares.get(p["id"])}
        if p["kind"] == "CUSTOMER":
            stats = model["customers"].get(p["id"], {})
            row.update(n_payments=stats.get("n", 0), on_time_share=stats.get("on_time_share"), avg_delay_days=stats.get("avg_delay_days"),
                       last6=stats.get("last6", []), p50_days=stats.get("p50_days"), p90_days=stats.get("p90_days"))
            if business["udyam_number"] and mine:
                oldest = min(mine, key=lambda i: i["invoice_date"])
                age = (today() - date.fromisoformat(oldest["invoice_date"])).days
                row["msme_clock_days_left"] = 45 - age
        else:
            nxt = min(mine, key=lambda i: i["due_date"]) if mine else None
            row["next_due"] = nxt and {"date": nxt["due_date"], "amount_paise": nxt["outstanding_paise"], "invoice": nxt["number"]}
        rows.append(row)
    rows.sort(key=lambda r: (-(r["risk_share"] or 0), -r["outstanding_paise"], r["name"]))
    return rows


@router.get("/parties")
def list_parties(kind: Literal["SUPPLIER", "CUSTOMER"] | None = None, principal: Principal = Depends(FINANCE)):
    rows = _party_rows(principal, kind)
    return {"parties": rows, "total_outstanding_paise": sum(r["outstanding_paise"] for r in rows)}


@router.post("/parties")
def create_party(body: PartyBody, principal: Principal = Depends(FINANCE)):
    party = repo.create_party(principal.business_id, body.model_dump())
    after_write(principal.business_id)
    return {"party": party}


@router.patch("/parties/{party_id}")
def patch_party(party_id: str, body: PartyPatch, principal: Principal = Depends(FINANCE)):
    try:
        party = repo.update_party(principal.business_id, party_id, body.model_dump(exclude_unset=True))
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"party": party}


@router.get("/parties/{party_id}")
def get_party(party_id: str, principal: Principal = Depends(FINANCE)):
    bid = principal.business_id
    try:
        p = repo.owned("party", party_id, bid)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    row = next(r for r in _party_rows(principal, p["kind"]) if r["id"] == party_id)
    billed = query_one("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM invoice WHERE business_id = ? AND party_id = ?", (bid, party_id))["s"]
    invoices = {i["id"]: i for i in query("SELECT * FROM invoice WHERE business_id = ? AND party_id = ?", (bid, party_id))}
    history = []
    for t in query("SELECT * FROM txn WHERE business_id = ? AND party_id = ? ORDER BY date DESC, created_at DESC LIMIT 60", (bid, party_id)):
        inv = invoices.get(t["invoice_id"])
        late = None
        if inv and inv["kind"] == "RECEIVABLE":
            late = (date.fromisoformat(t["date"]) - date.fromisoformat(inv["due_date"])).days
        history.append({"id": t["id"], "date": t["date"], "direction": t["direction"], "amount_paise": t["amount_paise"], "medium": t["medium"],
                        "reference": t["reference"], "invoice": inv["number"] if inv else t["details"], "days_late": late, "status": t["status"]})
    run = current_run(principal)
    events = [e for e in cached_views(run) if e["party_id"] == party_id]
    return {"party": {**row, "gstin": p["gstin"], "since": p["since"], "notes": json.loads(p["notes_json"] or "[]")},
            "billed_paise": billed,
            "open_items": [{"id": i["id"], "number": i["number"], "description": i["description"], "amount_paise": i["outstanding_paise"],
                            "invoice_date": i["invoice_date"], "due_date": i["due_date"], "promised_date": i["promised_date"],
                            "days_overdue": i["days_overdue"], "kind": i["kind"]}
                           for i in open_invoices(bid) if i["party_id"] == party_id],
            "history": history,
            "forecast": [{k: e[k] for k in ("id", "label", "executed_date", "due_date", "amount_paise", "state", "lateness_days", "direction")} for e in events],
            "risk_model": {"k": 5, "pool_size": delay_model(bid)["pool_size"]} if p["kind"] == "CUSTOMER" else None}


class NoteBody(Strict):
    text: str = Field(min_length=1, max_length=500)


@router.post("/parties/{party_id}/notes")
def post_note(party_id: str, body: NoteBody, principal: Principal = Depends(FINANCE)):
    try:
        party = repo.add_note(principal.business_id, party_id, principal.name.split()[0], body.text)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    return {"notes": json.loads(party["notes_json"])}


class InvoiceBody(Strict):
    party_id: str = Id
    number: str = Field(min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=200)
    amount_paise: int = Paise
    invoice_date: Date
    due_date: Date | None = None
    promised_date: Date | None = None


@router.post("/invoices")
def post_invoice(body: InvoiceBody, principal: Principal = Depends(FINANCE)):
    try:
        inv = repo.create_invoice(principal.business_id, body.model_dump(mode="json"))
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"invoice": inv}


class PromiseBody(Strict):
    promised_date: Date | None


@router.patch("/invoices/{invoice_id}")
def patch_invoice(invoice_id: str, body: PromiseBody, principal: Principal = Depends(FINANCE)):
    try:
        inv = repo.set_promised_date(principal.business_id, invoice_id, body.promised_date.isoformat() if body.promised_date else None)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"invoice": inv}


# ---------------------------------------------------------------- orders

def _qty_label(qty: int, material: dict[str, Any] | None) -> str:
    if not material:
        return str(qty)
    f = material["unit_factor"] or 1
    if f == 1:
        return f"{qty:,} {material['unit']}"
    decimals = len(str(f)) - 1
    text = f"{qty / f:,.{decimals}f}".rstrip("0").rstrip(".")
    return f"{text} {material['unit']}"


def _last_stage_change(raw: str | None) -> dict[str, Any] | None:
    try:
        log = json.loads(raw or "[]")
    except ValueError:
        return None
    return {k: log[-1].get(k) for k in ("at", "from", "to", "direction")} if log else None


@router.get("/sales-orders")
def sales_orders(principal: Principal = Depends(ANYONE)):
    bid = principal.business_id
    run = current_run(principal)
    results = {o.order_id: o for o in run.result.order_results}
    views = cached_views(run)
    starts = {e["order_id"]: e for e in views if e["type"] == "PRODUCTION_START"}
    receipts = {e["order_id"]: e for e in views if e["type"] == "CASH_RECEIPT" and e["order_id"]}
    materials = {m["id"]: m for m in query("SELECT * FROM material WHERE business_id = ?", (bid,))}
    names = {p["id"]: p["name"] for p in query("SELECT id, name FROM party WHERE business_id = ?", (bid,))}
    products = {p["id"]: p for p in query("SELECT * FROM product WHERE business_id = ?", (bid,))}
    out = []
    for so in query("SELECT * FROM sales_order WHERE business_id = ? ORDER BY number DESC", (bid,)):
        res = results.get(so["number"])
        start = starts.get(so["number"])
        materials_state = None
        if so["stage"] in OPEN_ORDER_STAGES and start:
            wait = next((w for w in start["waits"] if w["code"] == "INSUFFICIENT_INVENTORY"), None)
            if wait:
                d = wait["first_details"]
                materials_state = {"status": "SHORT", "material": materials.get(d["material_id"], {}).get("name"),
                                   "short_label": _qty_label(d["shortfall_quantity"], materials.get(d["material_id"])),
                                   "waits_from_day": wait["from_day"], "waits_to_day": wait["to_day"], "event_id": start["id"]}
            else:
                materials_state = {"status": "READY"}
        receipt = receipts.get(so["number"])
        out.append({
            "id": so["id"], "number": so["number"], "customer_id": so["customer_id"], "customer": names.get(so["customer_id"]),
            "product": products.get(so["product_id"], {}).get("name") if so["product_id"] else "Custom order", "qty": so["qty"],
            "value_paise": so["qty"] * so["unit_price_paise"], "deposit_paise": so["deposit_paise"], "promised_date": so["promised_date"],
            "forecast_delivery": res.delivery_date.isoformat() if res and res.delivery_date else None,
            "forecast_lateness_days": res.delivery_lateness_days if res else None,
            "forecast_receipt": receipt["executed_date"] if receipt else None,
            "production_start": start["executed_date"] if start else None,
            "stage": so["stage"], "materials": materials_state, "priority": so["priority"],
            "last_change": _last_stage_change(so["stage_history_json"]),
        })
    return for_role(principal, {"orders": out, "run": run_meta(run)})


@router.get("/purchase-orders")
def purchase_orders(principal: Principal = Depends(ANYONE)):
    bid = principal.business_id
    run = current_run(principal)
    views = cached_views(run)
    by_po: dict[str, dict[str, Any]] = {}
    for e in views:
        if e["record_type"] == "purchase_order":
            by_po.setdefault(e["record_id"], {})[e["type"]] = e
    materials = {m["id"]: m for m in query("SELECT * FROM material WHERE business_id = ?", (bid,))}
    names = {p["id"]: p["name"] for p in query("SELECT id, name FROM party WHERE business_id = ?", (bid,))}
    out = []
    for po in query("SELECT * FROM purchase_order WHERE business_id = ? ORDER BY number DESC", (bid,)):
        ev = by_po.get(po["id"], {})
        arrival, pay = ev.get("INVENTORY_ARRIVAL"), ev.get("SUPPLIER_PAYMENT")
        held = None
        if po["release_after_invoice_id"]:
            inv = query_one("SELECT number FROM invoice WHERE id = ?", (po["release_after_invoice_id"],))
            held = inv["number"] if inv else None
        m = materials.get(po["material_id"])
        out.append({"id": po["id"], "number": po["number"], "supplier_id": po["supplier_id"], "supplier": names.get(po["supplier_id"]),
                    "material": m["name"] if m else None, "qty_label": _qty_label(po["qty"], m), "value_paise": po["amount_paise"],
                    "terms_type": po["terms_type"], "status": po["status"], "expected_arrival": po["expected_arrival"],
                    "forecast_arrival": arrival["executed_date"] if arrival else None, "forecast_payment": pay["executed_date"] if pay else None,
                    "payment_due": po["payment_due"], "held_until_paid": held,
                    "arrival_event_id": arrival["id"] if arrival else None})
    return for_role(principal, {"orders": out})


class StageBody(Strict):
    """Any stage before PAID, forward or back. Going back undoes what the forward step recorded."""
    stage: Literal["PLANNED", "MATERIALS_READY", "IN_PRODUCTION", "READY", "DELIVERED"]


@router.patch("/sales-orders/{so_id}")
def patch_sales_order(so_id: str, body: StageBody, principal: Principal = Depends(ANYONE)):
    try:
        so = repo.advance_stage(principal.business_id, principal.user_id, so_id, body.stage, principal.role)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return for_role(principal, {"order": so})


class POStatusBody(Strict):
    """UNDO steps the order back one step (received -> ordered or paid, paid -> ordered, cancelled -> ordered)."""
    status: Literal["PAID", "ARRIVED", "CANCELLED", "UNDO"]


@router.patch("/purchase-orders/{po_id}")
def patch_purchase_order(po_id: str, body: POStatusBody, principal: Principal = Depends(ANYONE)):
    if body.status in ("PAID", "CANCELLED") and principal.role == "SUPERVISOR":
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN_FOR_ROLE"})
    try:
        po = repo.mark_po(principal.business_id, principal.user_id, po_id, body.status, principal.role)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return for_role(principal, {"order": po})


class NewSalesOrder(Strict):
    customer_id: str = Id
    product_id: str = Id
    qty: int = Field(gt=0, le=100_000)
    unit_price_paise: int | None = Field(default=None, gt=0, le=10**10)
    promised_date: Date
    earliest_start_date: Date | None = None
    deposit_paise: int = Field(default=0, ge=0, le=10**12)
    with_supporting_po: bool = True


class NewPurchaseOrder(Strict):
    supplier_id: str = Id
    material_id: str = Id
    qty: int = Field(gt=0, le=10**9)
    amount_paise: int | None = Field(default=None, gt=0, le=10**12)
    expected_arrival: Date | None = None


@router.post("/purchase-orders")
def post_purchase_order(body: NewPurchaseOrder, principal: Principal = Depends(FINANCE)):
    try:
        po = repo.create_purchase_order(principal.business_id, body.model_dump(mode="json"))
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"order": po}


def _what_if(principal: Principal, body: NewSalesOrder) -> dict[str, Any]:
    bid = principal.business_id
    run = current_run(principal)
    customer = repo.owned("party", body.customer_id, bid)
    product = repo.owned("product", body.product_id, bid)
    if body.promised_date <= today():
        raise repo.RecordError("PROMISED_DATE_IN_PAST", {})
    records = load_records(bid)
    price = body.unit_price_paise or product["unit_price_paise"]
    so = {"id": "what-if", "business_id": bid, "number": "NEW-ORDER", "customer_id": customer["id"], "product_id": product["id"],
          "qty": body.qty, "unit_price_paise": price, "order_date": today().isoformat(),
          "earliest_start_date": (body.earliest_start_date or today()).isoformat(), "promised_date": body.promised_date.isoformat(),
          "priority": 5, "stage": "PLANNED", "deposit_paise": body.deposit_paise, "materials_json": None, "production_cost_paise": None,
          "production_days": None, "collection_terms_days": None}
    from ..snapshot.builder import order_requirements
    recipes: dict[str, list] = {}
    for line in records["recipe_lines"]:
        recipes.setdefault(line["product_id"], []).append(line)
    needs = order_requirements(so, recipes)
    inv = inventory_rows(bid, run)
    free = {m["id"]: m for m in inv["materials"]}
    materials = {m["id"]: m for m in records["materials"]}
    suppliers = {p["id"]: p for p in records["parties"]}
    needs_view, purchases = [], []
    for material_id, qty in needs:
        row = free.get(material_id)
        available = max(0, (row["free"] if row else 0))
        short = max(0, qty - available)
        m = materials[material_id]
        entry = {"material_id": material_id, "material": m["name"], "needed_label": _qty_label(qty, m), "free_label": _qty_label(available, m),
                 "short_label": _qty_label(short, m) if short else None}
        if short and body.with_supporting_po and m["primary_supplier_id"] in suppliers:
            sup = suppliers[m["primary_supplier_id"]]
            step = m["unit_factor"] or 1
            qty_po = -(-short // step) * step
            amount = qty_po * m["avg_cost_paise"] // step
            po = {"id": "what-if-po-" + material_id[-6:], "business_id": bid, "number": f"NEW-PO-{len(purchases) + 1}", "supplier_id": sup["id"],
                  "material_id": material_id, "qty": qty_po, "amount_paise": amount, "ordered_date": today().isoformat(),
                  "expected_arrival": (today() + timedelta(days=sup["lead_time_days"])).isoformat() if sup["terms_type"] == "CREDIT" else None,
                  "payment_due": today().isoformat() if sup["terms_type"] != "CREDIT" else None, "terms_type": sup["terms_type"],
                  "release_after_invoice_id": None, "status": "ORDERED"}
            purchases.append(po)
            entry["supporting_po"] = {"supplier_id": sup["id"], "supplier": sup["name"], "qty": qty_po, "qty_label": _qty_label(qty_po, m),
                                      "amount_paise": amount, "lead_time_days": sup["lead_time_days"], "terms_type": sup["terms_type"]}
        needs_view.append(entry)
    records["sales_orders"] = records["sales_orders"] + [so]
    records["purchase_orders"] = records["purchase_orders"] + purchases
    built = build_from_records(records, today())
    result = simulate(built.snapshot)
    derived = runs.derive(built, result, run.derived["summary"]["buffer_paise"])
    new_order = next(o for o in result.order_results if o.order_id == "NEW-ORDER")
    base_orders = {o.order_id: o for o in run.result.order_results}
    delayed = []
    for o in result.order_results:
        b = base_orders.get(o.order_id)
        if b and (o.delivery_date != b.delivery_date):
            delta = (o.delivery_date - b.delivery_date).days if (o.delivery_date and b.delivery_date) else None
            if delta is None or delta > 0:
                delayed.append({"order_id": o.order_id, "delta_days": delta, "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None})
    before, after = run.derived["summary"], derived["summary"]
    n = risk_service.fix_samples()
    risk_before = risk_service.compute(bid, run.built, before["buffer_paise"], with_drivers=False, samples=n, scenario_key="what-if-base")
    risk_after = risk_service.compute(bid, built, before["buffer_paise"], with_drivers=False, samples=n, scenario_key="what-if-new")
    return {
        "materials": needs_view,
        "delivery": {"forecast": new_order.delivery_date.isoformat() if new_order.delivery_date else None,
                     "promised": body.promised_date.isoformat(), "lateness_days": new_order.delivery_lateness_days, "status": new_order.status},
        "value_paise": body.qty * price,
        "low_point_before": before["lowest"], "low_point_after": after["lowest"],
        "first_shortfall_before": before["first_shortfall"], "first_shortfall_after": after["first_shortfall"],
        "risk_30_before": risk_before.get("shortfall_chance", {}).get("30"), "risk_30_after": risk_after.get("shortfall_chance", {}).get("30"),
        "risk_samples": n if risk_before.get("status") == "READY" else 0,
        "other_orders_delayed": delayed,
    }


@router.post("/orders/what-if")
def orders_what_if(body: NewSalesOrder, request: Request, principal: Principal = Depends(FINANCE)):
    limiter.check(f"whatif:{principal.user_id}", 20, 60)
    try:
        return _what_if(principal, body)
    except repo.RecordError as exc:
        raise _error(exc) from exc


@router.post("/sales-orders")
def post_sales_order(body: NewSalesOrder, principal: Principal = Depends(FINANCE)):
    try:
        data = body.model_dump(mode="json")
        before = {m["id"]: m["free"] for m in inventory_rows(principal.business_id)["materials"]}
        so = repo.create_sales_order(principal.business_id, data)
        if body.with_supporting_po:
            # Buy only the extra shortfall this order creates, from each material's main supplier.
            for m in inventory_rows(principal.business_id)["materials"]:
                added = max(0, -m["free"]) - max(0, -before.get(m["id"], 0))
                if added > 0 and m["main_supplier"]:
                    step = m["unit_factor"] or 1
                    qty = -(-added // step) * step
                    repo.create_purchase_order(principal.business_id, {"supplier_id": m["main_supplier"]["id"], "material_id": m["id"], "qty": qty})
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"order": so}


# ---------------------------------------------------------------- inventory

@router.get("/inventory")
def get_inventory(principal: Principal = Depends(ANYONE)):
    run = current_run(principal)
    return for_role(principal, inventory_rows(principal.business_id, run))


@router.get("/inventory/summary")
def inventory_summary(principal: Principal = Depends(ANYONE)):
    run = current_run(principal)
    return for_role(principal, inventory_rows(principal.business_id, run)["summary"])


@router.get("/stock-movements")
def stock_movements(principal: Principal = Depends(ANYONE)):
    return {"movements": movement_rows(principal.business_id)}


class MovementBody(Strict):
    item_type: Literal["MATERIAL", "PRODUCT"]
    item_id: str = Id
    qty_delta: int = Field(ge=-10**9, le=10**9)
    note: str = Field(min_length=1, max_length=200)
    ref: str | None = Field(default=None, max_length=40)


@router.post("/stock-movements")
def post_movement(body: MovementBody, principal: Principal = Depends(ANYONE)):
    if body.qty_delta == 0:
        raise HTTPException(status_code=422, detail={"code": "ZERO_QUANTITY"})
    try:
        mv = repo.stock_adjustment(principal.business_id, principal.user_id, body.model_dump())
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"movement": mv}


class MaterialBody(Strict):
    name: str = Field(min_length=1, max_length=120)
    sku: str | None = Field(default=None, max_length=24, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,23}$")
    unit: Literal["kg", "g", "L", "ml", "m", "pc", "box"]
    cost_paise: int = Field(default=0, ge=0, le=10**9)
    opening_qty: Decimal = Field(default=Decimal(0), ge=0, le=Decimal(10**7), max_digits=12, decimal_places=3)
    supplier_id: str | None = Field(default=None, max_length=160)
    reorder_safety_days: int = Field(default=7, ge=0, le=90)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Give the material a name.")
        return value


class MaterialPatch(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sku: str | None = Field(default=None, max_length=24, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,23}$")
    cost_paise: int | None = Field(default=None, ge=0, le=10**9)
    supplier_id: str | None = Field(default=None, max_length=160)
    reorder_safety_days: int | None = Field(default=None, ge=0, le=90)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = " ".join(value.split())
        if not value:
            raise ValueError("Give the material a name.")
        return value


@router.post("/materials")
def post_material(body: MaterialBody, principal: Principal = Depends(FINANCE)):
    try:
        material = repo.create_material(principal.business_id, principal.user_id, body.model_dump())
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"material": material}


@router.patch("/materials/{material_id}")
def patch_material(material_id: str, body: MaterialPatch, principal: Principal = Depends(FINANCE)):
    try:
        material = repo.update_material(principal.business_id, material_id, body.model_dump(exclude_unset=True))
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"material": material}


@router.delete("/materials/{material_id}")
def remove_material(material_id: str, principal: Principal = Depends(FINANCE)):
    try:
        repo.delete_material(principal.business_id, material_id)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return {"ok": True}


class RecipeLine(Strict):
    material_id: str = Id
    qty_per_piece: int = Field(gt=0, le=10**7)
    wastage_bp: int = Field(ge=0, le=5000)


class RecipeBody(Strict):
    lines: list[RecipeLine] = Field(max_length=20)
    production_cost_paise: int | None = Field(default=None, ge=0, le=10**10)
    production_days: int | None = Field(default=None, ge=0, le=365)


@router.get("/recipes/{product_id}")
def get_recipe(product_id: str, principal: Principal = Depends(ANYONE)):
    run = current_run(principal)
    recipe = next((r for r in inventory_rows(principal.business_id, run)["recipes"] if r["product_id"] == product_id), None)
    if recipe is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
    return for_role(principal, recipe)


@router.put("/recipes/{product_id}")
def put_recipe(product_id: str, body: RecipeBody, principal: Principal = Depends(FINANCE)):
    try:
        repo.put_recipe(principal.business_id, product_id, [l.model_dump() for l in body.lines], body.production_cost_paise, body.production_days)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    after_write(principal.business_id)
    return get_recipe(product_id, principal)


@router.get("/catalogue")
def catalogue(principal: Principal = Depends(ANYONE)):
    bid = principal.business_id
    return for_role(principal, {
        "products": query("SELECT id, sku, name, unit_price_paise, production_days FROM product WHERE business_id = ? ORDER BY sku", (bid,)),
        "materials": query("SELECT id, sku, name, unit, unit_factor, primary_supplier_id FROM material WHERE business_id = ? ORDER BY sku", (bid,)),
        "customers": query("SELECT id, name FROM party WHERE business_id = ? AND kind = 'CUSTOMER' ORDER BY name", (bid,)),
        "suppliers": query("SELECT id, name, terms_type, lead_time_days FROM party WHERE business_id = ? AND kind = 'SUPPLIER' ORDER BY name", (bid,)),
    })


# ---------------------------------------------------------------- messages

class DraftBody(Strict):
    intent: Literal["reminder", "early_discount", "extension", "instalment", "deposit"]
    party_id: str = Id
    invoice_id: str | None = Field(default=None, max_length=160)
    fix_id: str | None = Field(default=None, max_length=80)
    tone: Literal["polite", "firm"] = "polite"
    language: Literal["en", "ta", "hi"] = "en"
    include_msme: bool = False


@router.post("/messages/draft")
def draft_message(body: DraftBody, principal: Principal = Depends(FINANCE)):
    bid = principal.business_id
    try:
        party = repo.owned("party", body.party_id, bid)
    except repo.RecordError as exc:
        raise _error(exc) from exc
    is_customer = party["kind"] == "CUSTOMER"
    if (body.intent in CUSTOMER_INTENTS) != is_customer:
        raise HTTPException(status_code=422, detail={"code": "INTENT_DOES_NOT_FIT_PARTY"})
    business = query_one("SELECT * FROM business WHERE id = ?", (bid,))
    lang = body.language
    items = [i for i in open_invoices(bid, "RECEIVABLE" if is_customer else "PAYABLE") if i["party_id"] == party["id"]]
    invoice = next((i for i in items if i["id"] == body.invoice_id), None) if body.invoice_id else (max(items, key=lambda i: (i["days_overdue"], i["outstanding_paise"])) if items else None)
    run = current_run(principal)
    fix = next((f for f in fixes_service.candidates(run) if f["id"] == body.fix_id), None) if body.fix_id else None
    slots: dict[str, str] = {"party": party["name"], "owner": (business["owner_name"] or "").split()[0] or business["name"], "business": business["name"]}
    key = body.intent
    if body.intent in ("reminder", "early_discount", "extension", "instalment"):
        if invoice is None:
            raise HTTPException(status_code=422, detail={"code": "NO_OPEN_INVOICE"})
        slots.update(invoice=invoice["number"], amount=rupees(invoice["outstanding_paise"]), due_date=human_date(invoice["due_date"], lang),
                     days_late=str(invoice["days_overdue"]), pay_by=human_date(today() + timedelta(days=7), lang))
    if body.intent == "reminder":
        key = "reminder_overdue" if invoice["days_overdue"] > 0 else "reminder_upcoming"
    elif body.intent == "early_discount":
        params = fix["params"] if fix and fix["kind"] == "EARLY_DISCOUNT" else {"date": (today() + timedelta(days=7)).isoformat(), "discount_paise": invoice["outstanding_paise"] * fixes_service.DISCOUNT_BP // 10_000}
        slots.update(pay_by=human_date(params["date"], lang), discount=rupees(params["discount_paise"]),
                     discounted=rupees(invoice["outstanding_paise"] - params["discount_paise"]))
    elif body.intent == "extension":
        days = fix["params"]["days"] if fix and fix["kind"] == "EXTENSION" else fixes_service.EXTENSION_DAYS
        slots["new_date"] = human_date(date.fromisoformat(invoice["due_date"]) + timedelta(days=days), lang)
    elif body.intent == "instalment":
        if fix and fix["kind"] == "SPLIT_SUPPLIER_PAYMENT":
            evaluation = fixes_service.evaluate(run, fix)
            parts = (evaluation["scenario"] or {}).get("changes", [{}])[0].get("instalments", [])
            first, second = parts[0], parts[1]
            slots.update(first_amount=rupees(first["amount_paise"]), second_amount=rupees(second["amount_paise"]), second_date=human_date(second["earliest_date"], lang))
        else:
            half = invoice["outstanding_paise"] // 2 // 100_000 * 100_000 or invoice["outstanding_paise"] // 2
            slots.update(first_amount=rupees(half), second_amount=rupees(invoice["outstanding_paise"] - half),
                         second_date=human_date(date.fromisoformat(invoice["due_date"]) + timedelta(days=14), lang))
    elif body.intent == "deposit":
        orders = query("SELECT * FROM sales_order WHERE business_id = ? AND customer_id = ? AND stage IN ('PLANNED','MATERIALS_READY') ORDER BY qty * unit_price_paise DESC", (bid, party["id"]))
        if not orders:
            raise HTTPException(status_code=422, detail={"code": "NO_OPEN_ORDER"})
        so = orders[0]
        value = so["qty"] * so["unit_price_paise"]
        deposit = fix["params"]["deposit_paise"] if fix and fix["kind"] == "SPLIT_CUSTOMER_COLLECTION" else value * 3 // 10
        pay_by = fix["params"]["deposit_date"] if fix and fix["kind"] == "SPLIT_CUSTOMER_COLLECTION" else (today() + timedelta(days=5)).isoformat()
        slots.update(order=so["number"], amount=rupees(value), deposit=rupees(deposit), pay_by=human_date(pay_by, lang))
    msme = None
    if body.include_msme and is_customer and business["udyam_number"] and business["msme_category"] in ("MICRO", "SMALL"):
        msme = {"udyam": business["udyam_number"]}
    text = render(key, body.tone, lang, slots, msme)
    return {"text": text, "wa_link": wa_link(party["phone"], text), "phone": party["phone"], "party_name": party["name"],
            "msme_line_available": bool(is_customer and business["udyam_number"] and business["msme_category"] in ("MICRO", "SMALL")),
            "template": f"{key}.{lang}.{body.tone}"}


# ---------------------------------------------------------------- Munim

# Munim can answer in ten languages (the AI service writes the reply; the templates cover English, Tamil and Hindi).
AssistantLang = Literal["en", "ta", "hi", "te", "kn", "ml", "pa", "de", "es", "zh"]


class ChatTurn(Strict):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatContext(Strict):
    route: str | None = Field(default=None, max_length=60)
    event_id: str | None = Field(default=None, max_length=160)
    party_id: str | None = Field(default=None, max_length=160)
    day: int | None = Field(default=None, ge=0, le=730)
    scenario: str | None = Field(default=None, max_length=80)


class ChatBody(Strict):
    message: str = Field(min_length=1, max_length=1000)
    context: ChatContext | None = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    language: AssistantLang | None = None


@router.post("/assistant/chat")
def assistant_chat(body: ChatBody, request: Request, principal: Principal = Depends(ANYONE)):
    limit_ai(request, principal)
    run = current_run(principal)
    lang = body.language or principal.prefs.get("language_assistant", "en")
    ctx = munim.Context(principal.business_id, run, lang, principal.role)
    business = query_one("SELECT name FROM business WHERE id = ?", (principal.business_id,))
    answer = munim.chat(ctx, body.message, (body.context.model_dump() if body.context else {}), business["name"],
                        [t.model_dump() for t in body.history])
    with tx() as conn:
        insert(conn, "assistant_turn", {"id": uuid.uuid4().hex, "business_id": principal.business_id, "user_id": principal.user_id,
                                        "message": body.message, "tool_calls_json": json.dumps([{"tool": t["tool"], "args": t["args"]} for t in answer["tools"]]),
                                        "reply": answer["reply"], "grounding_passed": int(answer["grounded"]), "mode": answer["mode"]})
    return {"reply": answer["reply"], "mode": answer["mode"], "reason": answer.get("reason"), "grounded": answer["grounded"],
            "language": answer.get("language", lang), "requested_language": lang,
            "tools": [t["tool"] for t in answer["tools"]], "actions": answer["actions"][:4],
            "run_id": run.id, "run_created_at": run.created_at}


# ---------------------------------------------------------------- settings, team, data

GSTIN_RE = re.compile(r"^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$")
UDYAM_RE = re.compile(r"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")
GST_STATE_CODES = {f"{n:02d}" for n in range(1, 39)} | {"97", "99"}


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())
    return value or None


class BusinessBody(Strict):
    """Only the fields the client sends are written (so a cleared field really clears)."""
    name: str | None = Field(default=None, max_length=120)
    owner_name: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=300)
    gstin: str | None = Field(default=None, max_length=20)
    udyam_number: str | None = Field(default=None, max_length=40)
    msme_category: Literal["MICRO", "SMALL", "MEDIUM"] | None = None
    fy_start: str | None = Field(default=None, pattern=r"^\d\d-\d\d$")

    @field_validator("name", "owner_name", "address", mode="before")
    @classmethod
    def _tidy_text(cls, value: Any) -> Any:
        return _blank_to_none(value) if isinstance(value, str) else value

    @field_validator("gstin", mode="before")
    @classmethod
    def _check_gstin(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        value = re.sub(r"[\s-]", "", value).upper()
        if not value:
            return None
        match = GSTIN_RE.match(value)
        if len(value) != 15 or not match:
            raise ValueError("GSTIN must be 15 characters: 2-digit state code, 10-character PAN, entity number, Z, check character (for example 33AAJFM4721K1Z9).")
        if match.group(1) not in GST_STATE_CODES:
            raise ValueError(f"GSTIN starts with {match.group(1)}, which is not a GST state code.")
        return value

    @field_validator("udyam_number", mode="before")
    @classmethod
    def _check_udyam(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        value = re.sub(r"\s", "", value).upper()
        if not value:
            return None
        if not UDYAM_RE.match(value):
            raise ValueError("Udyam number looks like UDYAM-TN-08-0012345 (state, district, 7 digits).")
        return value

    @field_validator("fy_start")
    @classmethod
    def _check_fy_start(cls, value: str | None) -> str | None:
        if value is None:
            return value
        month, day = int(value[:2]), int(value[3:])
        try:
            date(2024, month, day)  # 2024 is a leap year, so 02-29 is accepted
        except ValueError as exc:
            raise ValueError("Financial year start must be a real month-day, like 04-01.") from exc
        return value

    @model_validator(mode="after")
    def _name_stays(self) -> "BusinessBody":
        if "name" in self.model_fields_set and not self.name:
            raise ValueError("Business name cannot be empty.")
        return self


class MoneyBody(Strict):
    safety_buffer_paise: int | None = Field(default=None, ge=0, le=10**12)
    default_customer_terms_days: int | None = Field(default=None, ge=0, le=365)
    default_supplier_terms_days: int | None = Field(default=None, ge=0, le=365)
    horizon_days: Literal[30, 60, 90, 120, 180] | None = None
    msme_alerts: bool | None = None


class RecurringBody(Strict):
    label: str = Field(min_length=1, max_length=80)
    amount_paise: int = Paise
    day_of_month: int = Field(ge=1, le=31)
    active: bool = True

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Give the expense a name.")
        return value


class FacilityBody(Strict):
    label: str = Field(min_length=1, max_length=80)
    approved_limit_paise: int = Paise
    annual_rate_bps: int = Field(ge=0, le=10_000)
    drawdown_fee_paise: int = Field(default=0, ge=0, le=10**11)
    available_from: Date
    repayment_date: Date

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Give the facility a name.")
        return value


@router.get("/settings")
def get_settings(principal: Principal = Depends(FINANCE)):
    bid = principal.business_id
    b = query_one("SELECT * FROM business WHERE id = ?", (bid,))
    out = {"business": {k: b[k] for k in ("name", "owner_name", "address", "gstin", "udyam_number", "msme_category", "fy_start", "business_type")},
           "money": {k: b[k] for k in ("safety_buffer_paise", "default_customer_terms_days", "default_supplier_terms_days", "horizon_days")} | {"msme_alerts": bool(b["msme_alerts"])},
           "recurring": query("SELECT id, label, amount_paise, day_of_month, active FROM recurring_expense WHERE business_id = ? ORDER BY day_of_month", (bid,)),
           "facilities": query("SELECT id, label, approved_limit_paise, annual_rate_bps, drawdown_fee_paise, available_from, repayment_date FROM credit_facility WHERE business_id = ?", (bid,)),
           "is_sandbox": bool(b["is_sandbox"])}
    if principal.role == "OWNER":
        out["team"] = query("SELECT id, name, email, role FROM user WHERE business_id = ? ORDER BY role, name", (bid,))
    return out


@router.put("/settings/business")
def put_business(body: BusinessBody, principal: Principal = Depends(OWNER)):
    changes = body.model_dump(exclude_unset=True)
    with tx() as conn:
        update_business(conn, principal.business_id, changes)
        bump_data_version(conn, principal.business_id)
    after_write(principal.business_id)
    return get_settings(principal)


@router.put("/settings/money")
def put_money(body: MoneyBody, principal: Principal = Depends(FINANCE)):
    with tx() as conn:
        update_business(conn, principal.business_id, body.model_dump(exclude_none=True))
        bump_data_version(conn, principal.business_id)
    after_write(principal.business_id)
    return get_settings(principal)


@router.post("/settings/recurring")
def post_recurring(body: RecurringBody, principal: Principal = Depends(FINANCE)):
    with tx() as conn:
        insert(conn, "recurring_expense", {"id": repo.new_id(principal.business_id, "rx"), "business_id": principal.business_id, **body.model_dump()})
        bump_data_version(conn, principal.business_id)
    after_write(principal.business_id)
    return get_settings(principal)


@router.delete("/settings/recurring/{row_id}")
def delete_recurring(row_id: str, principal: Principal = Depends(FINANCE)):
    with tx() as conn:
        count = conn.execute("DELETE FROM recurring_expense WHERE id = ? AND business_id = ?", (row_id, principal.business_id)).rowcount
        if not count:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        bump_data_version(conn, principal.business_id)
    after_write(principal.business_id)
    return get_settings(principal)


@router.post("/settings/facilities")
def post_facility(body: FacilityBody, principal: Principal = Depends(FINANCE)):
    if body.repayment_date <= body.available_from:
        raise HTTPException(status_code=422, detail={"code": "REPAYMENT_BEFORE_AVAILABLE"})
    with tx() as conn:
        insert(conn, "credit_facility", {"id": repo.new_id(principal.business_id, "cf"), "business_id": principal.business_id, **body.model_dump(mode="json")})
        bump_data_version(conn, principal.business_id)
    after_write(principal.business_id)
    return get_settings(principal)


@router.delete("/settings/facilities/{row_id}")
def delete_facility(row_id: str, principal: Principal = Depends(FINANCE)):
    with tx() as conn:
        count = conn.execute("DELETE FROM credit_facility WHERE id = ? AND business_id = ?", (row_id, principal.business_id)).rowcount
        if not count:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        bump_data_version(conn, principal.business_id)
    after_write(principal.business_id)
    return get_settings(principal)


class InviteBody(Strict):
    email: str = Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=120)
    role: Literal["ACCOUNTANT", "SUPERVISOR", "OWNER"]


@router.post("/team")
def invite(body: InviteBody, request: Request, principal: Principal = Depends(OWNER)):
    import secrets
    limiter.check(f"invite:{principal.business_id}", 10, 3600)
    email = body.email.strip().lower()
    if query_one("SELECT id FROM user WHERE email = ?", (email,)):
        raise HTTPException(status_code=409, detail={"code": "EMAIL_TAKEN"})
    password = secrets.token_urlsafe(10)
    with tx() as conn:
        insert(conn, "user", {"id": f"u-{secrets.token_hex(6)}", "business_id": principal.business_id, "email": email,
                              "password_hash": hash_password(password), "name": body.name, "role": body.role, "prefs_json": "{}"})
    return {"email": email, "temporary_password": password, "note": "Shown once. Share it privately."}


@router.delete("/team/{user_id}")
def remove_member(user_id: str, principal: Principal = Depends(OWNER)):
    if user_id == principal.user_id:
        raise HTTPException(status_code=422, detail={"code": "CANNOT_REMOVE_SELF"})
    with tx() as conn:
        count = conn.execute("DELETE FROM user WHERE id = ? AND business_id = ?", (user_id, principal.business_id)).rowcount
        conn.execute("DELETE FROM session WHERE user_id = ?", (user_id,))
    if not count:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
    return {"ok": True}


class ConfirmBody(Strict):
    confirm: str = Field(max_length=120)


@router.post("/data/reset")
def reset_data(body: ConfirmBody, principal: Principal = Depends(OWNER)):
    business = query_one("SELECT * FROM business WHERE id = ?", (principal.business_id,))
    if body.confirm.strip() != business["name"]:
        raise HTTPException(status_code=422, detail={"code": "CONFIRMATION_MISMATCH", "expected": "the business name"})
    with tx() as conn:
        delete_business_data(conn, principal.business_id)
        conn.execute("UPDATE business SET opening_balance_paise = 0 WHERE id = ?", (principal.business_id,))
        bump_data_version(conn, principal.business_id)
    after_write(principal.business_id)
    return {"ok": True}


@router.post("/data/load-demo")
def load_demo(principal: Principal = Depends(OWNER)):
    limiter.check(f"reseed:{principal.business_id}", 6, 3600)
    business = query_one("SELECT * FROM business WHERE id = ?", (principal.business_id,))
    with tx() as conn:
        delete_business_data(conn, principal.business_id)
        version = business["data_version"]
        conn.execute("DELETE FROM business WHERE id = ?", (principal.business_id,))
        seed_business(conn, principal.business_id, today(), is_sandbox=bool(business["is_sandbox"]))
        conn.execute("UPDATE business SET data_version = ? WHERE id = ?", (version + 1, principal.business_id))
    after_write(principal.business_id)
    return {"ok": True}


@router.get("/export")
def export_all(principal: Principal = Depends(FINANCE)):
    bid = principal.business_id
    tables = ["party", "material", "product", "recipe_line", "stock_movement", "sales_order", "purchase_order", "invoice", "txn",
              "recurring_expense", "scheduled_expense", "credit_facility"]
    data = {t: query(f"SELECT * FROM {t} WHERE business_id = ?", (bid,)) for t in tables}
    data["business"] = query_one("SELECT * FROM business WHERE id = ?", (bid,))
    data["exported_at"] = today().isoformat()
    return data


# ---------------------------------------------------------------- set up (AI intake)

drafts = DraftStore()
extractor = GroqExtractor()
_draft_owner: dict[str, str] = {}


class SetupDraftBody(Strict):
    source_text: str = Field(min_length=1, max_length=8000)
    reviewed_facts: BusinessFacts | None = None


class SetupPatchBody(Strict):
    facts: BusinessFacts


class SetupApproveBody(Strict):
    draft_id: str = Field(max_length=60)
    draft_version: int = Field(gt=0)
    approval: str = Field(max_length=20)


def _draft_for(principal: Principal, draft_id: str):
    if _draft_owner.get(draft_id) != principal.business_id:
        raise HTTPException(status_code=404, detail={"code": "UNKNOWN_DRAFT"})
    return drafts.get(draft_id)


@router.post("/setup/draft")
@router.post("/snapshot/draft")
def setup_draft(body: SetupDraftBody, request: Request, principal: Principal = Depends(OWNER)):
    limit_ai(request, principal)
    business = query_one("SELECT horizon_days FROM business WHERE id = ?", (principal.business_id,))
    intake = IntakeRequest(business_id=principal.business_id, start_date=today(), horizon_days=business["horizon_days"],
                           source_text=body.source_text, reviewed_facts=body.reviewed_facts)
    facts = intake.reviewed_facts or extractor.extract(intake.source_text)
    draft = drafts.create(intake, facts)
    _draft_owner[draft.draft_id] = principal.business_id
    return {**draft.response().model_dump(mode="json"), "source_text": draft.source_text}


@router.patch("/setup/draft/{draft_id}")
def setup_patch(draft_id: str, body: SetupPatchBody, principal: Principal = Depends(OWNER)):
    _draft_for(principal, draft_id)
    draft = drafts.update(draft_id, body.facts)
    return {**draft.response().model_dump(mode="json"), "source_text": draft.source_text}


@router.post("/setup/approve")
@router.post("/snapshot/approve")
def setup_approve(body: SetupApproveBody, principal: Principal = Depends(OWNER)):
    if body.approval != "APPROVE":
        raise HTTPException(status_code=422, detail={"code": "EXPLICIT_APPROVAL_REQUIRED"})
    draft = _draft_for(principal, body.draft_id)
    if body.draft_version != draft.version:
        raise HTTPException(status_code=409, detail={"code": "STALE_DRAFT_VERSION", "current_version": draft.version})
    response = draft.response()
    if response.unresolved_questions or response.validation_issues or response.draft_snapshot is None:
        raise HTTPException(status_code=422, detail={"code": "DRAFT_NOT_READY", "unresolved_questions": response.unresolved_questions,
                                                     "validation_issues": response.validation_issues})
    counts = import_facts(principal.business_id, draft.facts)
    draft.approved = True
    run = after_write(principal.business_id)
    return {"imported": counts, "run": run_meta(run)}


# ---------------------------------------------------------------- pure engine endpoints

# Event-days per request on the open engine endpoints. The demo is about 5,000; the contract maximum
# (500 events x 730 days) would let one caller tie up the server for many seconds.
MAX_EVENT_DAYS = 60_000


def _check_size(snapshot) -> None:
    if len(snapshot.events) * snapshot.horizon_days > MAX_EVENT_DAYS:
        raise HTTPException(status_code=422, detail={"code": "SNAPSHOT_TOO_LARGE", "max_event_days": MAX_EVENT_DAYS})


@router.post("/simulation/run")
def simulation_run(request_body: SimulationRequest, principal: Principal = Depends(FINANCE)):
    limiter.check(f"sim:{principal.user_id}", 30, 60)
    _check_size(request_body.snapshot)
    return simulate(request_body.snapshot, request_body.scenario, request_body.policy, request_body.include_execution_log)


@router.post("/simulation/compare")
def simulation_compare(request_body: ComparisonRequest, principal: Principal = Depends(FINANCE)):
    limiter.check(f"sim:{principal.user_id}", 30, 60)
    _check_size(request_body.snapshot)
    return compare_scenarios(request_body.snapshot, request_body.scenario, request_body.policy)
