from __future__ import annotations

import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import app_routes, auth_routes
from .intake.builder import SnapshotBuildError
from .intake.extractor import ExtractionError
from .simulation.validation import SimulationValidationError
from .snapshot.builder import SnapshotBuilderError

log = logging.getLogger("ripple")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

MAX_BODY_BYTES = 256 * 1024
DIST = Path(os.getenv("FRONTEND_DIST", str(Path(__file__).resolve().parents[2] / "frontend" / "dist")))


@asynccontextmanager
async def lifespan(_: FastAPI):
    auth_routes.ensure_demo()
    removed = auth_routes.cleanup_sandboxes()
    log.info("startup: demo ready, %s expired sandboxes removed", removed)
    yield


class BodyLimit:
    """Refuses a write whose body is over the limit, counting the bytes as they arrive.

    The Content-Length header is only a claim; a body sent in chunks has none, so the claim check alone let an 8 MB body through."""

    def __init__(self, inner, limit: int) -> None:
        self.inner = inner
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH", "DELETE") or not scope["path"].startswith("/api/"):
            return await self.inner(scope, receive, send)
        seen = 0
        refused = False

        async def counted():
            nonlocal seen, refused
            message = await receive()
            if message["type"] == "http.request" and not refused:
                seen += len(message.get("body", b""))
                if seen > self.limit:
                    # Answer now and tell the app the client is gone, so the handler never runs on a half-read body.
                    refused = True
                    body = json.dumps({"error": {"code": "BODY_TOO_LARGE", "details": {"max_bytes": self.limit}}}).encode()
                    await send({"type": "http.response.start", "status": 413,
                                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"cache-control", b"no-store")]})
                    await send({"type": "http.response.body", "body": body})
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message):
            if not refused:
                await send(message)

        await self.inner(scope, counted, guarded_send)


class SelectiveGzip:
    """Compresses text (pages, scripts, styles, JSON) but never fonts or images, which are already compressed.
    Without this the app shell was about 580 KB of script sent raw, slow on a phone connection."""

    TEXT_SUFFIXES = (".js", ".css", ".svg", ".json", ".html", ".txt", ".xml", ".map")

    def __init__(self, inner, minimum_size: int = 1024) -> None:
        self.inner = inner
        self.gzip = GZipMiddleware(inner, minimum_size=minimum_size)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.inner(scope, receive, send)
        path = scope["path"]
        last = path.rsplit("/", 1)[-1]
        is_file = "." in last
        compress = path.startswith("/api/") or not is_file or path.endswith(self.TEXT_SUFFIXES)
        return await (self.gzip if compress else self.inner)(scope, receive, send)


app = FastAPI(title="Ripple API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-Ripple"])


@app.middleware("http")
async def guard(request: Request, call_next):
    started = time.perf_counter()
    path = request.url.path
    if path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        # CSRF: a custom header forces a CORS preflight, which other origins fail.
        if request.headers.get("x-ripple") != "1":
            return _envelope(403, "MISSING_CSRF_HEADER", None)
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            return _envelope(413, "BODY_TOO_LARGE", {"max_bytes": MAX_BODY_BYTES})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(self)"
    if (request.headers.get("x-forwarded-proto") or request.url.scheme) == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"  # only ever sent over HTTPS
    if not path.startswith("/api/"):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
            "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
    else:
        response.headers["Cache-Control"] = "no-store"
        log.info("%s %s %s %.0fms", request.method, path, response.status_code, (time.perf_counter() - started) * 1000)
    return response


def _envelope(status: int, code: str, details) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "details": jsonable_encoder(details)}})


@app.exception_handler(SimulationValidationError)
async def simulation_validation_error_handler(_: Request, exc: SimulationValidationError) -> JSONResponse:
    return _envelope(422, exc.code, exc.details)


@app.exception_handler(SnapshotBuilderError)
async def builder_error_handler(_: Request, exc: SnapshotBuilderError) -> JSONResponse:
    return _envelope(422, exc.code, exc.details)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return _envelope(422, "VALIDATION_ERROR", _safe_errors(exc))


@app.exception_handler(ValidationError)
async def pydantic_validation_error_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return _envelope(422, "VALIDATION_ERROR", [{k: v for k, v in e.items() if k in ("loc", "msg", "type")} for e in exc.errors()])


@app.exception_handler(ExtractionError)
async def extraction_error_handler(_: Request, exc: ExtractionError) -> JSONResponse:
    return _envelope(502 if exc.status is None else exc.status, exc.code, {"message": str(exc)})


@app.exception_handler(SnapshotBuildError)
async def snapshot_build_error_handler(_: Request, exc: SnapshotBuildError) -> JSONResponse:
    return _envelope(422, "SNAPSHOT_NOT_READY", exc.issues)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        code = detail["code"]
        details = {k: v for k, v in detail.items() if k != "code"} or None
    else:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        details = None
    response = _envelope(exc.status_code, code, details)
    for key, value in (getattr(exc, "headers", None) or {}).items():
        response.headers[key] = value
    return response


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error", exc_info=exc)
    return _envelope(500, "INTERNAL_ERROR", None)


def _safe_errors(exc: RequestValidationError) -> list[dict]:
    details: list[dict] = []
    for error in exc.errors():
        safe = {key: value for key, value in error.items() if key not in ("ctx", "input", "url")}
        if "ctx" in error:
            safe["ctx"] = {key: str(value) for key, value in error["ctx"].items()}
        details.append(safe)
    return details


@app.get("/api/health")
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.add_middleware(BodyLimit, limit=MAX_BODY_BYTES)
app.add_middleware(SelectiveGzip)
app.include_router(auth_routes.router, prefix="/api")
app.include_router(app_routes.router, prefix="/api")


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(rest: str):
    raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})


NEWLINE = chr(10)
PUBLIC_PAGES = ("login", "privacy", "terms")  # the only pages a search engine should know about
KNOWN_PAGES = {"", "login", "setup", "privacy", "terms"}
APP_SCREENS = {"today", "engine", "book", "khata", "orders", "inventory", "settings"}


def _public_base(request: Request) -> str:
    """Absolute site address for sitemaps and share images. Set PUBLIC_BASE_URL in production; otherwise the address the request used."""
    configured = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if configured.startswith(("http://", "https://")):
        return configured
    return str(request.base_url).rstrip("/")


@app.get("/robots.txt", include_in_schema=False)
async def robots(request: Request):
    lines = ["User-agent: *", "Allow: /", "Disallow: /app/", "Disallow: /api/", "Disallow: /setup", f"Sitemap: {_public_base(request)}/sitemap.xml", ""]
    body = NEWLINE.join(lines)
    return PlainTextResponse(body, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap(request: Request):
    base = _public_base(request)
    urls = "".join(f"<url><loc>{base}/{page}</loc></url>" for page in PUBLIC_PAGES)
    body = NEWLINE.join(['<?xml version="1.0" encoding="UTF-8"?>', f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>', ""])
    return Response(body, media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"})


def _page_status(path: str) -> int:
    """The app is one HTML shell; the address decides whether it is a real page. Unknown addresses get a real 404 status."""
    trimmed = path.strip("/")
    if trimmed in KNOWN_PAGES:
        return 200
    if trimmed == "app" or (trimmed.startswith("app/") and trimmed[4:].rstrip("/") in APP_SCREENS):
        return 200
    return 404


@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def spa(path: str, request: Request):
    if not DIST.exists():
        return JSONResponse({"status": "API running. Build the frontend (npm run build) to serve the app here."})
    candidate = (DIST / path).resolve()
    if path and candidate.is_file() and DIST.resolve() in candidate.parents:
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in f"/{path}" else {}
        return FileResponse(candidate, headers=headers)
    # A missing file (something with an extension, or under /assets) is a plain 404, not the app: scanners and broken links see the truth.
    last = path.rstrip("/").rsplit("/", 1)[-1]
    if path.startswith("assets/") or "." in last:
        return PlainTextResponse("Not found", status_code=404)
    index = DIST / "index.html"
    html = index.read_text(encoding="utf-8").replace("%PUBLIC_URL%", os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/") if os.getenv("PUBLIC_BASE_URL", "").startswith("http") else "")
    return HTMLResponse(html, status_code=_page_status(path), headers={"Cache-Control": "no-cache"})
