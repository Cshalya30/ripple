"""Ripple Voice: the owner approves, Bolna dials, the result writes `invoice.promised_date`, the engine
re-runs. This module never computes a date or amount; every number stored here is copied from an engine
run (`services.runs`) or from Bolna's own extraction output.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import date, datetime, timezone
from typing import Any

from ..core.db import get_conn, insert, now_iso, query, query_one, today, tx, update
from ..records import repo
from ..services import runs
from . import bolna_client
from .guardrails import GuardrailError, demo_mode, resolve_phone, run_all

log = logging.getLogger("ripple")

TERMINAL_STATUSES = {"completed", "no_answer", "busy", "failed"}
STATUS_MAP = {"completed": "completed", "no-answer": "no_answer", "no_answer": "no_answer", "busy": "busy", "failed": "failed"}
OUTCOMES = {"promised", "partial", "disputed", "callback", "refused", "wrong_person", "NA"}

OPENING_HI = "Namaste, main {business_name} ki taraf se ek AI assistant bol rahi hoon. {owner_name} ji ne mujhe invoice {invoice_no} ke baare mein baat karne ko kaha hai."
OPENING_EN = ("Hello, I'm an AI assistant calling on behalf of {business_name}. "
              "{owner_name} asked me to speak with you about invoice {invoice_no}.")


class VoiceError(ValueError):
    def __init__(self, code: str, details: dict[str, Any] | None = None, status: int = 422):
        self.code = code
        self.details = details or {}
        self.status = status
        super().__init__(code)


def _invoice_and_party(business_id: str, invoice_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    invoice = query_one("SELECT * FROM invoice WHERE id = ? AND business_id = ?", (invoice_id, business_id))
    if invoice is None or invoice["kind"] != "RECEIVABLE":
        raise VoiceError("NOT_FOUND", {"invoice_id": invoice_id}, status=404)
    party = query_one("SELECT * FROM party WHERE id = ? AND business_id = ?", (invoice["party_id"], business_id))
    if party is None:
        raise VoiceError("NOT_FOUND", {"party_id": invoice["party_id"]}, status=404)
    return invoice, party


def _mask(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = phone.strip()
    return digits[:2] + "•" * max(0, len(digits) - 4) + digits[-2:] if len(digits) > 4 else "••"


def _business(business_id: str) -> dict[str, Any]:
    return query_one("SELECT * FROM business WHERE id = ?", (business_id,))


def _current_shortfall(business_id: str) -> dict[str, Any] | None:
    """Normalised to {date, shortfall_paise}: first_shortfall already carries shortfall_paise; buffer_breach
    only carries net_paise, so the gap to the buffer is computed here, once, from the same summary."""
    run = runs.baseline(business_id)
    summary = run.derived["summary"]
    if summary["first_shortfall"]:
        fs = summary["first_shortfall"]
        return {"date": fs["date"], "shortfall_paise": fs["shortfall_paise"], "kind": "first_shortfall"}
    if summary["buffer_breach"]:
        bb = summary["buffer_breach"]
        return {"date": bb["date"], "shortfall_paise": summary["buffer_paise"] - bb["net_paise"], "kind": "buffer_breach"}
    return None


def preview(business_id: str, invoice_id: str) -> dict[str, Any]:
    invoice, party = _invoice_and_party(business_id, invoice_id)
    business = _business(business_id)
    days_overdue = max(0, (today() - date.fromisoformat(invoice["due_date"])).days)
    blocked: str | None = None
    try:
        run_all(invoice, party)
    except GuardrailError as exc:
        blocked = exc.code
    slots = {"business_name": business["name"], "owner_name": business.get("owner_name") or "the owner", "invoice_no": invoice["number"]}
    return {
        "invoice_id": invoice_id, "customer_name": party["name"], "masked_phone": _mask(resolve_phone(party)),
        "amount_paise": repo.invoice_outstanding(invoice), "days_overdue": days_overdue,
        "current_shortfall": _current_shortfall(business_id), "blocked_by": blocked,
        "opening_hi": OPENING_HI.format(**slots), "opening_en": OPENING_EN.format(**slots),
        "demo_mode": demo_mode(),
    }


def create_call(business_id: str, invoice_id: str, approved_by: str) -> dict[str, Any]:
    invoice, party = _invoice_and_party(business_id, invoice_id)
    run_all(invoice, party)  # raises GuardrailError on any block

    agent_id = os.getenv("BOLNA_AGENT_ID", "")
    business = _business(business_id)
    shortfall_before = _current_shortfall(business_id)
    call_id = repo.new_id(business_id, "voice")
    phone = resolve_phone(party)
    with tx() as conn:
        insert(conn, "voice_call", {
            "id": call_id, "business_id": business_id, "invoice_id": invoice_id, "party_id": party["id"],
            "execution_id": None, "status": "queued", "outcome": None, "promised_date": None,
            "partial_amount_paise": None, "partial_date": None, "transcript": None, "recording_url": None,
            "duration_s": None, "cost_paise": None, "raw_payload_json": None,
            "shortfall_before_date": shortfall_before["date"] if shortfall_before else None,
            "shortfall_before_paise": shortfall_before["shortfall_paise"] if shortfall_before else None,
            "shortfall_after_date": None, "shortfall_after_paise": None,
            "approved_by": approved_by, "approved_at": now_iso(),
        })
        update(conn, "invoice", invoice_id, business_id, {"last_called_at": today().isoformat()})
    try:
        response = bolna_client.place_call(
            agent_id=agent_id, recipient_phone_number=phone or "",
            user_data={
                "business_name": business["name"], "owner_name": business.get("owner_name") or "the owner",
                "customer_name": party["name"], "invoice_no": invoice["number"],
                "amount": invoice["amount_paise"] / 100, "due_date": invoice["due_date"],
                "days_overdue": max(0, (today() - date.fromisoformat(invoice["due_date"])).days),
                "business_id": business_id, "voice_call_id": call_id,
            },
        )
    except bolna_client.BolnaError as exc:
        with tx() as conn:
            update(conn, "voice_call", call_id, business_id, {"status": "failed", "raw_payload_json": json.dumps({"error": str(exc)})})
        raise VoiceError("BOLNA_CALL_FAILED", {"message": str(exc)}, status=502) from exc

    execution_id = bolna_client.execution_id_from_call_response(response)
    with tx() as conn:
        update(conn, "voice_call", call_id, business_id, {"execution_id": execution_id, "raw_payload_json": json.dumps(response)})
    return get_call(business_id, call_id)


def _mark_replay(row: dict[str, Any]) -> dict[str, Any]:
    """scripts/replay_webhook.py stamps replayed payloads `{"replay": true}`; surface that here rather than
    adding a column, so the UI never shows a rehearsal as a live call result."""
    try:
        is_replay = bool(json.loads(row.get("raw_payload_json") or "{}").get("replay"))
    except (TypeError, ValueError):
        is_replay = False
    return {**row, "is_replay": is_replay}


def get_call(business_id: str, call_id: str) -> dict[str, Any]:
    row = query_one("SELECT * FROM voice_call WHERE id = ? AND business_id = ?", (call_id, business_id))
    if row is None:
        raise VoiceError("NOT_FOUND", {"id": call_id}, status=404)
    return _mark_replay(row)


def list_calls(business_id: str, invoice_id: str | None = None) -> list[dict[str, Any]]:
    if invoice_id:
        rows = query("SELECT * FROM voice_call WHERE business_id = ? AND invoice_id = ? ORDER BY created_at DESC", (business_id, invoice_id))
    else:
        rows = query("SELECT * FROM voice_call WHERE business_id = ? ORDER BY created_at DESC LIMIT 100", (business_id,))
    return [_mark_replay(row) for row in rows]


# ---------------------------------------------------------------- webhook + poller, same processing path

def _category(extracted: dict[str, Any], name: str, kind: str) -> Any:
    try:
        return extracted.get("Payment", {}).get(name, {}).get(kind)
    except AttributeError:
        return None


def _parse_future_date(value: Any) -> str | None:
    if not value:
        return None
    try:
        parsed = date.fromisoformat(str(value)[:10])
    except ValueError:
        return None
    return parsed.isoformat() if parsed > today() else None


def _extract(payload: dict[str, Any]) -> dict[str, Any]:
    extracted = payload.get("extracted_data") or {}
    outcome = _category(extracted, "call_outcome", "objective")
    outcome = outcome if outcome in OUTCOMES else None
    promised = _parse_future_date(_category(extracted, "promised_payment_date", "subjective"))
    partial_amount = _category(extracted, "partial_amount", "subjective")
    try:
        partial_amount_paise = int(round(float(partial_amount) * 100)) if partial_amount is not None else None
    except (TypeError, ValueError):
        partial_amount_paise = None
    partial_date = _parse_future_date(_category(extracted, "partial_payment_date", "subjective"))
    do_not_call = str(_category(extracted, "do_not_call", "objective") or "").strip().lower() == "yes"
    return {"outcome": outcome, "promised_date": promised, "partial_amount_paise": partial_amount_paise,
            "partial_date": partial_date, "do_not_call": do_not_call}


def _recompute(business_id: str) -> runs.Run:
    """The same invalidate -> rebuild the write path (app_routes.after_write) runs, without a risk job here:
    the risk refresh is already debounced elsewhere and this path can fire several times per call (webhook retries)."""
    runs.invalidate(business_id)
    return runs.baseline(business_id)


def process_result(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Idempotent: safe to call several times with the same payload (Bolna retries the webhook, and the
    fallback poller may also observe the same execution). Returns the updated voice_call row, or None if
    the execution id is not one of ours."""
    execution_id = payload.get("execution_id") or payload.get("id") or payload.get("call_id")
    if not execution_id:
        return None
    row = query_one("SELECT * FROM voice_call WHERE execution_id = ?", (execution_id,))
    if row is None:
        return None
    business_id = row["business_id"]
    status_raw = str(payload.get("status", "")).strip().lower()
    status = STATUS_MAP.get(status_raw, "in_progress" if status_raw else row["status"])

    if status != "completed":
        if row["status"] != status:
            update(get_conn(), "voice_call", row["id"], business_id, {"status": status, "raw_payload_json": json.dumps(payload)})
        return get_call(business_id, row["id"])

    if row["status"] == "completed" and row.get("outcome") is not None:
        return row  # already processed this completed execution; nothing new to do

    fields = _extract(payload)
    telephony = payload.get("telephony_data") or {}
    changes: dict[str, Any] = {
        "status": "completed", "outcome": fields["outcome"], "promised_date": fields["promised_date"],
        "partial_amount_paise": fields["partial_amount_paise"], "partial_date": fields["partial_date"],
        "transcript": payload.get("transcript"), "recording_url": telephony.get("recording_url") or telephony.get("recording_url_sip"),
        "duration_s": payload.get("duration") or telephony.get("duration"), "cost_paise": _to_paise(payload.get("cost")),
        "raw_payload_json": json.dumps(payload),
    }

    invoice = query_one("SELECT * FROM invoice WHERE id = ? AND business_id = ?", (row["invoice_id"], business_id))
    party_changes: dict[str, Any] = {}
    invoice_changes: dict[str, Any] = {}
    if fields["outcome"] == "promised" and fields["promised_date"]:
        invoice_changes["promised_date"] = fields["promised_date"]
    elif fields["outcome"] == "partial" and fields["partial_date"]:
        # Documented choice (PLAN_VOICE.md): a partial commitment still moves the forecast to the promised
        # partial date; the remaining balance keeps its original due date, so the engine is not told the
        # whole invoice clears then.
        invoice_changes["promised_date"] = fields["partial_date"]
    if fields["outcome"] == "disputed":
        invoice_changes["disputed"] = 1
    if fields["do_not_call"]:
        party_changes["do_not_call"] = 1

    with tx() as conn:
        update(conn, "voice_call", row["id"], business_id, changes)
        if invoice_changes and invoice is not None:
            update(conn, "invoice", invoice["id"], business_id, invoice_changes)
        if party_changes:
            update(conn, "party", row["party_id"], business_id, party_changes)

    if invoice_changes:
        _recompute(business_id)
        after = _current_shortfall(business_id)
        with tx() as conn:
            update(conn, "voice_call", row["id"], business_id, {
                "shortfall_after_date": after["date"] if after else None,
                "shortfall_after_paise": after["shortfall_paise"] if after else None,
            })

    return get_call(business_id, row["id"])


def _to_paise(rupees: Any) -> int | None:
    try:
        return int(round(float(rupees) * 100))
    except (TypeError, ValueError):
        return None


def pending_for_poll(older_than_s: int = 180) -> list[dict[str, Any]]:
    """Calls with an execution id, no final webhook yet, created more than `older_than_s` seconds ago."""
    cutoff = datetime.now(timezone.utc)
    rows = query("SELECT * FROM voice_call WHERE execution_id IS NOT NULL AND status IN ('queued', 'in_progress')")
    out = []
    for row in rows:
        created = datetime.fromisoformat(row["created_at"])
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if (cutoff - created).total_seconds() >= older_than_s:
            out.append(row)
    return out


def poll_pending() -> int:
    """Fallback for a missed webhook: ask Bolna directly and run the result through the same `process_result`."""
    processed = 0
    for row in pending_for_poll():
        try:
            payload = bolna_client.get_execution(row["execution_id"])
        except bolna_client.BolnaError:
            continue
        payload.setdefault("execution_id", row["execution_id"])
        if process_result(payload) is not None:
            processed += 1
    return processed


# ---------------------------------------------------------------- background poller (production only)

_poller_thread: threading.Thread | None = None
_poller_stop = threading.Event()


def _poller_loop(interval_s: int) -> None:
    while not _poller_stop.wait(interval_s):
        try:
            poll_pending()
        except Exception:
            log.exception("voice poller failed")


def start_background_poller(interval_s: int = 60) -> None:
    """Started once from main.py's lifespan. Gated on BOLNA_API_KEY being set, so it never starts during
    tests (which never set it) and never runs uselessly with no account configured."""
    global _poller_thread
    if not os.getenv("BOLNA_API_KEY") or _poller_thread is not None:
        return
    _poller_stop.clear()
    _poller_thread = threading.Thread(target=_poller_loop, args=(interval_s,), daemon=True, name="voice-poller")
    _poller_thread.start()


def stop_background_poller() -> None:
    global _poller_thread
    _poller_stop.set()
    _poller_thread = None
