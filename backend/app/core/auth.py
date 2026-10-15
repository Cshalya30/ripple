"""Sessions, password hashing, roles. Access control is enforced here, in the API,
never by hiding UI. business_id always comes from the session, never the request body."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, Response

from .db import execute, get_conn, insert, now_iso, query_one

COOKIE = "ripple_session"
SESSION_DAYS = 7
ROLES = ("OWNER", "ACCOUNTANT", "SUPERVISOR")

DEFAULT_PREFS = {
    "language_ui": "en", "language_assistant": "en", "language_messages": "en",
    "theme": "night", "text_size": "M", "density": "auto", "number_format": "indian",
    "reduce_motion": False, "high_contrast": False, "read_aloud": False, "large_targets": False,
}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = hash_password(secrets.token_hex(8))


@dataclass
class Principal:
    user_id: str
    business_id: str
    role: str
    email: str
    name: str
    prefs: dict[str, Any]
    is_sandbox: bool


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(response: Response, request: Request, user: dict[str, Any]) -> None:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    insert(get_conn(), "session", {
        "token_hash": _token_hash(token), "user_id": user["id"], "business_id": user["business_id"],
        "expires_at": expires.isoformat(timespec="seconds"), "user_agent": (request.headers.get("user-agent") or "")[:200],
        "created_at": now_iso(),
    })
    response.set_cookie(
        COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax",
        secure=_secure(request), path="/",
    )


def _secure(request: Request) -> bool:
    setting = os.getenv("COOKIE_SECURE", "auto").lower()
    if setting in ("1", "true", "yes"):
        return True
    if setting in ("0", "false", "no"):
        return False
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return proto == "https"


def end_session(request: Request, response: Response, everywhere: bool = False) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        row = query_one("SELECT user_id FROM session WHERE token_hash = ?", (_token_hash(token),))
        if everywhere and row:
            execute("DELETE FROM session WHERE user_id = ?", (row["user_id"],))
        else:
            execute("DELETE FROM session WHERE token_hash = ?", (_token_hash(token),))
    response.delete_cookie(COOKIE, path="/")


def current(request: Request) -> Principal:
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 100:
        raise HTTPException(status_code=401, detail={"code": "NOT_SIGNED_IN"})
    row = query_one(
        "SELECT s.expires_at, u.*, b.is_sandbox FROM session s JOIN user u ON u.id = s.user_id JOIN business b ON b.id = u.business_id WHERE s.token_hash = ?",
        (_token_hash(token),),
    )
    if row is None or row["expires_at"] < now_iso():
        raise HTTPException(status_code=401, detail={"code": "NOT_SIGNED_IN"})
    prefs = {**DEFAULT_PREFS, **json.loads(row["prefs_json"] or "{}")}
    return Principal(row["id"], row["business_id"], row["role"], row["email"], row["name"], prefs, bool(row["is_sandbox"]))


def require(*roles: str) -> Callable[[Request], Principal]:
    allowed = set(roles or ROLES)

    def dependency(principal: Principal = Depends(current)) -> Principal:
        if principal.role not in allowed:
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN_FOR_ROLE", "role": principal.role})
        return principal

    return dependency


FINANCE = require("OWNER", "ACCOUNTANT")
ANYONE = require("OWNER", "ACCOUNTANT", "SUPERVISOR")
OWNER = require("OWNER")


def redact_amounts(value: Any) -> Any:
    """Remove every money field for supervisors. Money fields are named *_paise throughout the API."""
    if isinstance(value, dict):
        return {k: redact_amounts(v) for k, v in value.items() if not k.endswith("_paise") and k not in {"value", "cost"}}
    if isinstance(value, list):
        return [redact_amounts(v) for v in value]
    return value


def for_role(principal: Principal, payload: Any) -> Any:
    return redact_amounts(payload) if principal.role == "SUPERVISOR" else payload


def check_password_or_dummy(password: str, stored: str | None) -> bool:
    """Always spend the same work so response time does not reveal whether an email exists."""
    return verify_password(password, stored or _DUMMY_HASH) and stored is not None


# ---------------------------------------------------------------- rate limiting

class RateLimiter:
    """Sliding-window counters per key, in memory (single instance deployment)."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: int) -> None:
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < window_s]
            if len(hits) >= limit:
                retry = int(window_s - (now - hits[0])) + 1
                raise HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "retry_after_s": retry}, headers={"Retry-After": str(retry)})
            hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > 20_000:
                for stale in [k for k, v in self._hits.items() if not v or now - v[-1] > 3600][:5000]:
                    self._hits.pop(stale, None)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    """The address rate limits are counted against.

    Behind a proxy, each proxy appends the address it saw to X-Forwarded-For, so everything to the LEFT of the entries our own
    proxies added was written by the client and can be anything. The Nth entry from the right (N = TRUSTED_PROXY_HOPS, default 1)
    is the one a trusted proxy recorded. Taking the leftmost entry, as this used to, let one client dodge every limit by sending
    a different X-Forwarded-For header each time. Set TRUST_PROXY=0 when the app is not behind a proxy.
    """
    if os.getenv("TRUST_PROXY", "1") == "1":
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            parts = [part.strip() for part in forwarded.split(",") if part.strip()]
            try:
                hops = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))
            except ValueError:
                hops = 1
            if parts:
                return parts[-min(hops, len(parts))][:64]
    return request.client.host if request.client else "unknown"


def limit_ai(request: Request, principal: Principal) -> None:
    limiter.check(f"ai:s:{principal.user_id}", 20, 60)
    limiter.check(f"ai:ip:{client_ip(request)}", 60, 3600)
