"""Shared test setup: a fixed 'today', an in-memory database, no AI provider."""
import os

os.environ["DATABASE_URL"] = ":memory:"
os.environ["RIPPLE_TODAY"] = "2026-10-14"
os.environ.pop("GROQ_API_KEY", None)
os.environ.setdefault("RISK_SAMPLES", "40")
os.environ.setdefault("RISK_DRIVER_SAMPLES", "10")
os.environ.setdefault("RISK_FIX_SAMPLES", "20")
os.environ.setdefault("RISK_PROCESSES", "0")

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.main import app  # noqa: E402

HEADERS = {"X-Ripple": "1"}


def client() -> TestClient:
    from backend.app.core.auth import limiter
    limiter._hits.clear()  # tests create many sessions from one address
    return TestClient(app, headers=HEADERS)


def signed_in(email: str = "owner@ripple.demo") -> TestClient:
    c = client()
    c.__enter__()  # runs startup (demo seed)
    response = c.post("/api/auth/login", json={"email": email, "password": "ripple-demo-2026"})
    assert response.status_code == 200, response.text
    return c


def sandbox() -> TestClient:
    c = client()
    c.__enter__()
    response = c.post("/api/auth/demo")
    assert response.status_code == 200, response.text
    return c
