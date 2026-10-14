from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.config import FRONTEND_DIST
from .api.routes import router as api_router
from .simulation.comparison import compare_scenarios
from .simulation.engine import simulate
from .simulation.schemas import ComparisonRequest, SimulationRequest
from .simulation.validation import SimulationValidationError


app = FastAPI(title="Supplier-Business-Customer Loop API")

_cors = os.getenv("RIPPLE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors.split(",") if o.strip()],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Workspace-Id"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


@app.exception_handler(SimulationValidationError)
async def simulation_validation_error_handler(_: Request, exc: SimulationValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": exc.code, "details": jsonable_encoder(exc.details)}})


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "details": _safe_errors(exc)}})


@app.exception_handler(ValidationError)
async def pydantic_validation_error_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "details": jsonable_encoder(exc.errors())}})


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": jsonable_encoder(detail)})


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    # Never leak stack traces to clients.
    return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "Something went wrong."}})


def _safe_errors(exc: RequestValidationError) -> list[dict]:
    details: list[dict] = []
    for error in exc.errors():
        safe = {key: value for key, value in error.items() if key not in ("ctx", "input")}
        if "ctx" in error:
            safe["ctx"] = {key: str(value) for key, value in error["ctx"].items()}
        details.append(jsonable_encoder(safe))
    return details


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/simulation/run")
async def run_simulation(request: SimulationRequest):
    return simulate(request.snapshot, request.scenario, request.policy)


@app.post("/simulation/compare")
async def compare_simulation(request: ComparisonRequest):
    return compare_scenarios(request.snapshot, request.scenario, request.policy)


app.include_router(api_router)


# ── serve the built React app (frontend/dist) from the same origin ────────
_RESERVED = ("api/", "simulation/", "docs", "redoc", "openapi.json", "health")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    if full_path.startswith(_RESERVED) or not (FRONTEND_DIST / "index.html").is_file():
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Not found."})
    root = FRONTEND_DIST.resolve()
    candidate = (root / full_path).resolve()
    if full_path and candidate.is_file() and root in candidate.parents:
        return FileResponse(candidate)
    return FileResponse(root / "index.html")
