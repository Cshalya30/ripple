from __future__ import annotations

import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..core import auth
from ..core.auth import ANYONE, Principal, client_ip, limiter
from ..core.db import delete_business_data, execute, insert, now_iso, query, query_one, today, tx, update
from ..records.seed import seed_business

router = APIRouter()

DEMO_BUSINESS = "mahalakshmi"
DEMO_ACCOUNTS = [
    ("owner@ripple.demo", "Meera Sundaram", "OWNER"),
    ("accountant@ripple.demo", "Ravi Kumar", "ACCOUNTANT"),
    ("supervisor@ripple.demo", "Selvi Murugan", "SUPERVISOR"),
]
SANDBOX_TTL_HOURS = 24
MAX_SANDBOXES = int(os.getenv("MAX_SANDBOXES", "400"))


def demo_password() -> str:
    return os.getenv("DEMO_PASSWORD", "ripple-demo-2026")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginBody(Strict):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class SignupBody(Strict):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    password_confirmation: str = Field(min_length=8, max_length=200)

    @field_validator("name", mode="before")
    @classmethod
    def tidy_name(cls, value: Any) -> Any:
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: Any) -> Any:
        return value.strip().lower() if isinstance(value, str) else value


class PrefsBody(Strict):
    language_ui: Literal["en", "ta", "hi"] | None = None
    language_assistant: Literal["en", "ta", "hi", "te", "kn", "ml", "pa", "de", "es", "zh"] | None = None
    language_messages: Literal["en", "ta", "hi"] | None = None
    theme: Literal["night", "day", "lamp"] | None = None
    text_size: Literal["S", "M", "L", "XL"] | None = None
    density: Literal["auto", "simple", "instrument"] | None = None
    number_format: Literal["indian", "international"] | None = None
    reduce_motion: bool | None = None
    high_contrast: bool | None = None
    read_aloud: bool | None = None
    large_targets: bool | None = None


def ensure_demo() -> None:
    """Seed the shared, credentialed demo business once (README test accounts)."""
    if query_one("SELECT id FROM business WHERE id = ?", (DEMO_BUSINESS,)) is None:
        with tx() as conn:
            seed_business(conn, DEMO_BUSINESS, today())
    for email, name, role in DEMO_ACCOUNTS:
        if query_one("SELECT id FROM user WHERE email = ?", (email,)) is None:
            with tx() as conn:
                insert(conn, "user", {"id": f"u-{role.lower()}", "business_id": DEMO_BUSINESS, "email": email,
                                      "password_hash": auth.hash_password(demo_password()), "name": name, "role": role,
                                      "prefs_json": "{}"})


def cleanup_sandboxes() -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=SANDBOX_TTL_HOURS)).isoformat(timespec="seconds")
    old = query("SELECT id FROM business WHERE is_sandbox = 1 AND created_at < ?", (cutoff,))
    for row in old:
        with tx() as conn:
            delete_business_data(conn, row["id"])
            conn.execute("DELETE FROM session WHERE business_id = ?", (row["id"],))
            conn.execute("DELETE FROM user WHERE business_id = ?", (row["id"],))
            conn.execute("DELETE FROM business WHERE id = ?", (row["id"],))
    execute("DELETE FROM session WHERE expires_at < ?", (now_iso(),))
    return len(old)


def me_payload(principal: Principal) -> dict[str, Any]:
    business = query_one("SELECT * FROM business WHERE id = ?", (principal.business_id,))
    return {
        "user": {"id": principal.user_id, "email": principal.email, "name": principal.name, "role": principal.role},
        "prefs": principal.prefs,
        "business": {
            "name": business["name"], "owner_name": business["owner_name"], "udyam_number": business["udyam_number"],
            "msme_category": business["msme_category"], "safety_buffer_paise": business["safety_buffer_paise"] if principal.role != "SUPERVISOR" else None,
            "horizon_days": business["horizon_days"], "is_sandbox": bool(business["is_sandbox"]), "gstin": business["gstin"],
        },
        "today": today().isoformat(),
        "demo_accounts": [{"email": e, "role": r} for e, _, r in DEMO_ACCOUNTS],
    }


@router.post("/auth/login")
def login(body: LoginBody, request: Request, response: Response):
    limiter.check(f"login:{client_ip(request)}", 10, 60)
    # A second, slower limit per account: one address cannot be the only thing standing between a guesser and a password.
    limiter.check(f"login:acct:{body.email.strip().lower()[:120]}", 30, 900)
    user = query_one("SELECT * FROM user WHERE email = ?", (body.email.strip().lower(),))
    if not auth.check_password_or_dummy(body.password, user["password_hash"] if user else None):
        raise HTTPException(status_code=401, detail={"code": "BAD_CREDENTIALS", "message": "Email or password is wrong"})
    auth.create_session(response, request, user)
    business = query_one("SELECT is_sandbox FROM business WHERE id = ?", (user["business_id"],))
    principal = Principal(user["id"], user["business_id"], user["role"], user["email"], user["name"],
                          {**auth.DEFAULT_PREFS, **json.loads(user["prefs_json"] or "{}")}, bool(business["is_sandbox"]))
    return me_payload(principal)


@router.post("/auth/signup")
def signup(body: SignupBody, request: Request, response: Response):
    limiter.check(f"signup:{client_ip(request)}", 5, 3600)
    if body.password != body.password_confirmation:
        raise HTTPException(status_code=400, detail={"code": "PASSWORD_MISMATCH", "message": "Passwords do not match"})
    if query_one("SELECT id FROM user WHERE email = ?", (body.email,)) is not None:
        raise HTTPException(status_code=409, detail={"code": "EMAIL_TAKEN", "message": "That email already has an account"})

    business_id = f"biz-{secrets.token_hex(8)}"
    user_id = f"u-{secrets.token_hex(8)}"
    timestamp = now_iso()
    with tx() as conn:
        try:
            insert(conn, "business", {
                "id": business_id,
                "name": "My business",
                "owner_name": body.name,
                "safety_buffer_paise": 0,
                "default_customer_terms_days": 30,
                "default_supplier_terms_days": 30,
                "horizon_days": 90,
                "opening_balance_paise": 0,
                "is_sandbox": False,
                "created_at": timestamp,
                "updated_at": timestamp,
            })
            insert(conn, "user", {
                "id": user_id,
                "business_id": business_id,
                "email": body.email,
                "password_hash": auth.hash_password(body.password),
                "name": body.name,
                "role": "OWNER",
                "prefs_json": "{}",
                "created_at": timestamp,
                "updated_at": timestamp,
            })
        except sqlite3.IntegrityError as exc:
            if "user.email" in str(exc) or "user.email" in str(exc).lower():
                raise HTTPException(status_code=409, detail={"code": "EMAIL_TAKEN", "message": "That email already has an account"}) from exc
            raise

    user = query_one("SELECT * FROM user WHERE id = ?", (user_id,))
    auth.create_session(response, request, user)
    principal = Principal(user_id, business_id, "OWNER", body.email, body.name, dict(auth.DEFAULT_PREFS), False)
    return me_payload(principal)


@router.post("/auth/demo")
def demo(request: Request, response: Response):
    """A private copy of the demo business for this visitor, deleted after 24 hours."""
    limiter.check(f"demo:{client_ip(request)}", 6, 60)
    limiter.check("demo:global", 120, 3600)
    cleanup_sandboxes()
    count = query_one("SELECT COUNT(*) AS c FROM business WHERE is_sandbox = 1")["c"]
    if count >= MAX_SANDBOXES:
        raise HTTPException(status_code=503, detail={"code": "DEMO_CAPACITY", "message": "Too many demo copies right now. Sign in with the demo owner account instead."})
    business_id = f"sbx-{secrets.token_hex(6)}"
    user_id = f"u-{secrets.token_hex(6)}"
    with tx() as conn:
        seed_business(conn, business_id, today(), is_sandbox=True)
        insert(conn, "user", {"id": user_id, "business_id": business_id, "email": f"{business_id}@sandbox.ripple",
                              "password_hash": auth.hash_password(secrets.token_urlsafe(16)), "name": "Meera Sundaram",
                              "role": "OWNER", "prefs_json": "{}"})
    user = query_one("SELECT * FROM user WHERE id = ?", (user_id,))
    auth.create_session(response, request, user)
    principal = Principal(user_id, business_id, "OWNER", user["email"], user["name"], dict(auth.DEFAULT_PREFS), True)
    return me_payload(principal)


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    auth.end_session(request, response)
    return {"ok": True}


@router.post("/auth/logout-all")
def logout_all(request: Request, response: Response, principal: Principal = Depends(ANYONE)):
    auth.end_session(request, response, everywhere=True)
    return {"ok": True}


@router.get("/me")
def me(principal: Principal = Depends(ANYONE)):
    return me_payload(principal)


@router.put("/me/prefs")
def put_prefs(body: PrefsBody, principal: Principal = Depends(ANYONE)):
    prefs = {**principal.prefs, **body.model_dump(exclude_none=True)}
    with tx() as conn:
        conn.execute("UPDATE user SET prefs_json = ?, updated_at = ? WHERE id = ?", (json.dumps(prefs), now_iso(), principal.user_id))
    principal.prefs = prefs
    return me_payload(principal)


@router.get("/sessions")
def sessions(principal: Principal = Depends(ANYONE)):
    rows = query("SELECT created_at, expires_at, user_agent FROM session WHERE user_id = ? ORDER BY created_at DESC", (principal.user_id,))
    return {"sessions": rows}
