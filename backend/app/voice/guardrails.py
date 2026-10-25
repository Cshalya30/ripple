"""Server-side guardrails for Ripple Voice (PRD-equivalent: Bolna Buildathon scope).

Every guardrail is checked here, never in the browser, and every failure is a GuardrailError with a
code the frontend can show verbatim. The call-window clock is read through `_now()` so tests can
monkeypatch a frozen time instead of waiting on the real clock.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ..core.db import today

IST = timezone(timedelta(hours=5, minutes=30))


class GuardrailError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _now() -> datetime:
    return datetime.now(IST)


def _call_window() -> tuple[int, int]:
    return int(os.getenv("CALL_WINDOW_START", "9")), int(os.getenv("CALL_WINDOW_END", "19"))


def check_time_window() -> None:
    start, end = _call_window()
    hour = _now().astimezone(IST).hour
    if not (start <= hour < end):
        raise GuardrailError("OUTSIDE_CALL_WINDOW", f"Calls are only made between {start:02d}:00 and {end:02d}:00 (Asia/Kolkata).")


def check_invoice_callable(invoice: dict[str, Any], party: dict[str, Any]) -> None:
    if party.get("do_not_call"):
        raise GuardrailError("DO_NOT_CALL", f"{party['name']} asked not to be called again.")
    if invoice.get("disputed"):
        raise GuardrailError("DISPUTED", "This invoice is disputed; the owner should call personally.")
    days_overdue = (today() - date.fromisoformat(invoice["due_date"])).days
    if days_overdue <= 0:
        raise GuardrailError("NOT_OVERDUE", "This invoice is not overdue yet.")
    if not resolve_phone(party):
        raise GuardrailError("NO_PHONE", f"{party['name']} has no phone number on file.")


def check_daily_limit(invoice: dict[str, Any]) -> None:
    """One call per invoice per calendar day. Stamped on invoice.last_called_at (a date, not a timestamp),
    so the check stays correct under RIPPLE_TODAY in tests instead of racing real wall-clock timestamps."""
    if invoice.get("last_called_at") == today().isoformat():
        raise GuardrailError("ALREADY_CALLED_TODAY", "This invoice has already been called today.")


def resolve_phone(party: dict[str, Any]) -> str | None:
    """The number actually dialled: DEMO_PHONE_OVERRIDE in demo mode, else the customer's own phone."""
    override = os.getenv("DEMO_PHONE_OVERRIDE", "").strip()
    if override:
        return override
    phone = (party.get("phone") or "").strip()
    return phone or None


def demo_mode() -> bool:
    return bool(os.getenv("DEMO_PHONE_OVERRIDE", "").strip())


def run_all(invoice: dict[str, Any], party: dict[str, Any]) -> None:
    check_invoice_callable(invoice, party)
    check_daily_limit(invoice)
    check_time_window()
