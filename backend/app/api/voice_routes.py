"""Ripple Voice endpoints (PLAN_VOICE.md). `router` mounts under /api like the rest of the app and is
protected by the normal session/CSRF middleware. `webhook_router` is mounted directly on the app in
main.py, outside /api, because Bolna cannot send the `X-Ripple` CSRF header the /api middleware requires.
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import Field

from ..core.auth import FINANCE, OWNER, Principal
from .app_routes import Id, Strict, after_write
from ..voice import service as voice_service
from ..voice.guardrails import GuardrailError

router = APIRouter()
webhook_router = APIRouter()

WEBHOOK_IPS = {"13.203.39.153", "13.126.9.249", "13.202.133.53"}


def _voice_error(exc: Exception) -> HTTPException:
    if isinstance(exc, voice_service.VoiceError):
        return HTTPException(status_code=exc.status, detail={"code": exc.code, **exc.details})
    if isinstance(exc, GuardrailError):
        return HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})
    raise exc


class InvoiceIdBody(Strict):
    invoice_id: str = Id


class CallBody(Strict):
    invoice_id: str = Id
    approved: bool = Field(default=False)


@router.post("/voice/calls/preview")
def preview_call(body: InvoiceIdBody, principal: Principal = Depends(FINANCE)) -> dict[str, Any]:
    try:
        return voice_service.preview(principal.business_id, body.invoice_id)
    except (voice_service.VoiceError, GuardrailError) as exc:
        raise _voice_error(exc) from exc


@router.post("/voice/calls")
def create_call(body: CallBody, principal: Principal = Depends(OWNER)) -> dict[str, Any]:
    if not body.approved:
        raise HTTPException(status_code=422, detail={"code": "APPROVAL_REQUIRED"})
    try:
        call = voice_service.create_call(principal.business_id, body.invoice_id, principal.user_id)
    except (voice_service.VoiceError, GuardrailError) as exc:
        raise _voice_error(exc) from exc
    after_write(principal.business_id)
    return {"voice_call": call}


@router.get("/voice/calls/{call_id}")
def get_call(call_id: str, principal: Principal = Depends(FINANCE)) -> dict[str, Any]:
    try:
        return {"voice_call": voice_service.get_call(principal.business_id, call_id)}
    except voice_service.VoiceError as exc:
        raise _voice_error(exc) from exc


@router.get("/voice/calls")
def list_calls(invoice_id: str | None = Query(default=None), principal: Principal = Depends(FINANCE)) -> dict[str, Any]:
    return {"voice_calls": voice_service.list_calls(principal.business_id, invoice_id)}


# ---------------------------------------------------------------- webhook (outside /api, token-authenticated)

def _check_webhook_source(request: Request) -> None:
    if os.getenv("BOLNA_IP_ALLOWLIST", "false").lower() not in ("1", "true", "yes"):
        return
    ip = request.client.host if request.client else None
    if ip not in WEBHOOK_IPS:
        raise HTTPException(status_code=403, detail={"code": "UNKNOWN_SOURCE"})


@webhook_router.post("/webhooks/bolna")
async def bolna_webhook(request: Request, background: BackgroundTasks, token: str = Query(default="")) -> dict[str, Any]:
    expected = os.getenv("BOLNA_WEBHOOK_SECRET", "")
    if not expected or token != expected:
        raise HTTPException(status_code=403, detail={"code": "BAD_WEBHOOK_TOKEN"})
    _check_webhook_source(request)
    payload = await request.json()

    def process() -> None:
        # The voice_call row (found by execution_id) is the registry: one shared DB, every row scoped by
        # business_id, so there is no separate tenant lookup to maintain (PLAN_VOICE.md).
        row = voice_service.process_result(payload)
        if row is not None:
            after_write(row["business_id"])

    background.add_task(process)
    return {"status": "accepted"}
