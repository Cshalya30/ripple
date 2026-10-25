"""Thin HTTP wrapper around the Bolna voice API (api.bolna.ai).

Kept to exactly the two calls `services.voice_service` needs, so tests can monkeypatch `place_call` and
`get_execution` without a network. TODO (PLAN_VOICE.md): response shapes below are assumed from the
Bolna docs brief, not verified against a real account yet.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

BASE_URL = "https://api.bolna.ai"
TIMEOUT_S = 20.0


class BolnaError(RuntimeError):
    def __init__(self, status: int | None, body: Any):
        self.status = status
        self.body = body
        super().__init__(f"Bolna API error ({status}): {body}")


def _headers() -> dict[str, str]:
    key = os.getenv("BOLNA_API_KEY", "")
    scheme = os.getenv("BOLNA_AUTH_SCHEME", "bearer").strip().lower()
    value = f"Bearer {key}" if scheme == "bearer" else key
    return {"Authorization": value, "Content-Type": "application/json"}


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text


def place_call(agent_id: str, recipient_phone_number: str, user_data: dict[str, Any], from_phone_number: str | None = None) -> dict[str, Any]:
    """POST /call. Returns the Bolna response, which carries an execution id (key name unconfirmed; service.py
    checks a short list of candidates — see PLAN_VOICE.md open issues)."""
    body: dict[str, Any] = {"agent_id": agent_id, "recipient_phone_number": recipient_phone_number, "user_data": user_data}
    if from_phone_number:
        body["from_phone_number"] = from_phone_number
    try:
        response = httpx.post(f"{BASE_URL}/call", json=body, headers=_headers(), timeout=TIMEOUT_S)
    except httpx.HTTPError as exc:
        raise BolnaError(None, str(exc)) from exc
    if response.status_code >= 400:
        raise BolnaError(response.status_code, _safe_json(response))
    return response.json()


def get_execution(execution_id: str) -> dict[str, Any]:
    """GET /executions/{execution_id}."""
    try:
        response = httpx.get(f"{BASE_URL}/executions/{execution_id}", headers=_headers(), timeout=TIMEOUT_S)
    except httpx.HTTPError as exc:
        raise BolnaError(None, str(exc)) from exc
    if response.status_code >= 400:
        raise BolnaError(response.status_code, _safe_json(response))
    return response.json()


def execution_id_from_call_response(payload: dict[str, Any]) -> str | None:
    """The brief does not pin the exact field name; accept the documented one plus likely synonyms."""
    for key in ("execution_id", "id", "call_id"):
        value = payload.get(key)
        if value:
            return str(value)
    return None
