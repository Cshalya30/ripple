"""REST endpoints used by the React frontend (all under /api)."""

from __future__ import annotations

import csv
import io
import time
from collections import defaultdict, deque
from datetime import datetime

from fastapi import APIRouter, File, Header, HTTPException, Request, Response, UploadFile
from starlette.concurrency import run_in_threadpool

from ..assistant import chat as chat_mod
from ..assistant import speech as speech_mod
from . import config
from .forecast import Baseline, compute_baseline, fix_options, forecast_bundle, shortfall_party_ids
from .importer import UploadError, parse_upload
from .models import ChatRequest, ImportRequest, PartyIn, format_compact, format_inr
from .store import PartyRecord, get_store, valid_workspace

router = APIRouter(prefix="/api", tags=["ripple"])


# ── tiny in-memory rate limiter (per client IP and bucket) ────────────────

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
LIMITS = {"write": (60, 60.0), "upload": (10, 60.0), "chat": (20, 60.0), "voice": (10, 60.0)}


def _rate_limit(request: Request, bucket: str) -> None:
    limit, window = LIMITS[bucket]
    key = (request.client.host if request.client else "unknown", bucket)
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "message": "Too many requests. Please wait a minute."})
    q.append(now)
    if len(_hits) > 10_000:  # keep memory bounded
        _hits.clear()


def _workspace(x_workspace_id: str | None) -> str:
    return valid_workspace(x_workspace_id)


# ── serialisation ─────────────────────────────────────────────────────────


def party_out(p: PartyRecord, shortfall: set[str]) -> dict:
    out = {
        "id": p.id,
        "kind": p.kind,
        "name": p.name,
        "phone": p.phone,
        "details": p.details,
        "products": p.products,
        "quantity": int(p.quantity) if float(p.quantity).is_integer() else p.quantity,
        "totalAmount": p.total_amount,
        "paidAmount": p.paid_amount,
        "owedAmount": p.owed_amount,
        "transactionDate": p.transaction_date.isoformat(),
        "dueDate": p.due_date.isoformat(),
    }
    if p.id in shortfall:
        out["causesShortfall"] = True
    return out


def _baseline(workspace: str) -> Baseline:
    return compute_baseline(get_store().list(workspace))


# ── endpoints ─────────────────────────────────────────────────────────────


@router.get("/health")
def api_health() -> dict:
    return {"status": "ok", "assistant": chat_mod.status(), "voice": speech_mod.status()}


@router.get("/business")
def business() -> dict:
    b = config.BUSINESS
    return {
        "name": b.name,
        "owner": b.owner,
        "city": b.city,
        "cashToday": b.cash_today,
        "safetyBuffer": b.safety_buffer,
        "horizonDays": config.HORIZON_DAYS,
        "today": config.today().isoformat(),
    }


@router.get("/parties")
def list_parties(x_workspace_id: str | None = Header(default=None)) -> list[dict]:
    ws = _workspace(x_workspace_id)
    parties = get_store().list(ws)
    shortfall = shortfall_party_ids(compute_baseline(parties))
    return [party_out(p, shortfall) for p in parties]


@router.post("/parties", status_code=201)
def create_party(body: PartyIn, request: Request, x_workspace_id: str | None = Header(default=None)) -> dict:
    _rate_limit(request, "write")
    ws = _workspace(x_workspace_id)
    try:
        [party] = get_store().add_many(ws, [body.to_record()])
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"code": "KHATA_FULL", "message": str(exc)}) from exc
    return party_out(party, set())


@router.post("/parties/import", status_code=201)
def import_parties(body: ImportRequest, request: Request, x_workspace_id: str | None = Header(default=None)) -> dict:
    _rate_limit(request, "upload")
    ws = _workspace(x_workspace_id)
    try:
        added = get_store().add_many(ws, [p.to_record() for p in body.parties])
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"code": "KHATA_FULL", "message": str(exc)}) from exc
    return {"added": [party_out(p, set()) for p in added], "skipped": []}


@router.post("/parties/upload", status_code=201)
async def upload_parties(request: Request, file: UploadFile = File(...), x_workspace_id: str | None = Header(default=None)) -> dict:
    _rate_limit(request, "upload")
    ws = _workspace(x_workspace_id)
    data = await file.read(config.MAX_UPLOAD_BYTES + 1)
    try:
        parties, skipped = parse_upload(file.filename or "", data)
    except UploadError as exc:
        raise HTTPException(status_code=422, detail={"code": "BAD_UPLOAD", "message": str(exc)}) from exc
    if not parties:
        raise HTTPException(status_code=422, detail={"code": "NO_VALID_ROWS", "message": "No valid rows found.", "skipped": skipped[:50]})
    try:
        added = get_store().add_many(ws, [p.to_record() for p in parties])
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"code": "KHATA_FULL", "message": str(exc)}) from exc
    return {"added": [party_out(p, set()) for p in added], "skipped": skipped[:50]}


EXPORT_HEADERS = [
    "Party name", "Type", "Phone", "Details", "Item", "Qty",
    "Bill amount", "Received / Paid", "Still owed", "Bill date", "Due date",
]


def _csv_safe(value: str) -> str:
    """Stop spreadsheet formula injection: cells starting with = + - @ are shown as text."""
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


@router.get("/parties/export.csv")
def export_parties(x_workspace_id: str | None = Header(default=None)) -> Response:
    """The whole khata as CSV. Same columns as the upload template, so it can be re-imported."""
    parties = get_store().list(_workspace(x_workspace_id))
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(EXPORT_HEADERS)
    for p in parties:
        quantity = int(p.quantity) if float(p.quantity).is_integer() else p.quantity
        writer.writerow([
            _csv_safe(p.name),
            "Customer" if p.kind == "customer" else "Supplier",
            p.phone.removeprefix("+91 "),
            _csv_safe(p.details),
            _csv_safe(", ".join(p.products)),
            quantity,
            p.total_amount,
            p.paid_amount,
            p.owed_amount,
            p.transaction_date.isoformat(),
            p.due_date.isoformat(),
        ])
    filename = f"ripple-khata-{datetime.now(config.TIMEZONE):%Y-%m-%d}.csv"
    return Response(
        content="\ufeff" + buf.getvalue(),  # BOM so Excel shows ₹ and Indian names correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.delete("/parties/{party_id}", status_code=204)
def delete_party(party_id: str, request: Request, x_workspace_id: str | None = Header(default=None)) -> None:
    _rate_limit(request, "write")
    if len(party_id) > 64 or not get_store().delete(_workspace(x_workspace_id), party_id):
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "No such party."})


@router.post("/demo/reset")
def reset_demo(request: Request, x_workspace_id: str | None = Header(default=None)) -> dict:
    _rate_limit(request, "write")
    get_store().reset(_workspace(x_workspace_id))
    return {"status": "reset"}


@router.get("/forecast")
def forecast(x_workspace_id: str | None = Header(default=None)) -> dict:
    return forecast_bundle(_baseline(_workspace(x_workspace_id)))


@router.get("/fixes")
def fixes(x_workspace_id: str | None = Header(default=None)) -> list[dict]:
    return fix_options(_baseline(_workspace(x_workspace_id)))


# ── assistant ─────────────────────────────────────────────────────────────


def chat_context(workspace: str) -> str:
    parties = get_store().list(workspace)
    b = compute_baseline(parties)
    bundle = forecast_bundle(b)
    s = bundle["summary"]
    today = config.today()
    lines = [
        f"Business: {config.BUSINESS.name}, {config.BUSINESS.city}. Today is {today.isoformat()} (Day 0).",
        f"Cash today {format_inr(s['cashToday'])}. Next 90 days: {format_inr(s['inflows'])} coming in, {format_inr(s['outflows'])} going out, net {format_inr(s['net'])}.",
        f"Lowest point: {format_inr(s['lowest']['balance'])} on Day {s['lowest']['day']} ({s['lowest']['date']}). Safety buffer {format_inr(s['bufferLevel'])}.",
    ]
    if s["lowest"]["balance"] < s["bufferLevel"]:
        lines.append(f"Below the buffer from Day {s['dipRange']['from']} to Day {s['dipRange']['to']}.")
    for c in bundle["causes"]:
        lines.append(f"Dip cause: {c['title']}. {c['detail']}")
    owe_me = sorted((p for p in parties if p.kind == "customer" and p.owed_amount > 0), key=lambda p: -p.owed_amount)
    i_owe = sorted((p for p in parties if p.kind == "supplier" and p.owed_amount > 0), key=lambda p: -p.owed_amount)
    lines.append(f"Customers owe {format_inr(sum(p.owed_amount for p in owe_me))} in total; suppliers are owed {format_inr(sum(p.owed_amount for p in i_owe))}.")

    def due_text(p: PartyRecord) -> str:
        d = (p.due_date - today).days
        return f"{-d} days overdue" if d < 0 else f"due in {d} days"

    lines += [f"- Customer {p.name} ({p.details}) owes {format_compact(p.owed_amount)}, {due_text(p)}" for p in owe_me[:12]]
    lines += [f"- Supplier {p.name} ({p.details}) is owed {format_compact(p.owed_amount)}, {due_text(p)}" for p in i_owe[:12]]
    for f in fix_options(b):
        lines.append(f"Fix option '{f['title']}': {f['summary']} Lowest balance becomes {format_inr(f['newLowest'])}. Cost: {f['cost']}.")
    return "\n".join(lines)


@router.post("/assistant/chat")
async def assistant_chat(body: ChatRequest, request: Request, x_workspace_id: str | None = Header(default=None)) -> dict:
    _rate_limit(request, "chat")
    ws = _workspace(x_workspace_id)
    context = chat_context(ws)
    try:
        reply = await run_in_threadpool(chat_mod.ask, body.message, [t.model_dump() for t in body.history], context)
    except chat_mod.AssistantUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": "ASSISTANT_UNAVAILABLE", "message": exc.reason}) from exc
    return reply


@router.post("/assistant/transcribe")
async def assistant_transcribe(request: Request, file: UploadFile = File(...)) -> dict:
    _rate_limit(request, "voice")
    audio = await file.read(speech_mod.MAX_AUDIO_BYTES + 1)
    try:
        return await run_in_threadpool(speech_mod.transcribe, audio, file.filename or "")
    except chat_mod.AssistantUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": "VOICE_UNAVAILABLE", "message": exc.reason}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "BAD_AUDIO", "message": str(exc)}) from exc
