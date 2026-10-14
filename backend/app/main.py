from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .simulation.comparison import compare_scenarios
from .simulation.engine import simulate
from .simulation.schemas import ComparisonRequest, SimulationRequest
from .simulation.validation import SimulationValidationError
from .intake.builder import SnapshotBuildError, build_snapshot
from .intake.drafts import DraftStore
from .intake.extractor import ExtractionError, GroqExtractor
from .intake.schemas import ApprovalRequest, DraftCorrection, DraftResponse, IntakeRequest


app = FastAPI(title="Supplier-Business-Customer Loop API")
draft_store = DraftStore()
extractor = GroqExtractor()


@app.exception_handler(SimulationValidationError)
async def simulation_validation_error_handler(_: Request, exc: SimulationValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": exc.code, "details": jsonable_encoder(exc.details)}})


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "details": _safe_errors(exc)}})


@app.exception_handler(ValidationError)
async def pydantic_validation_error_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "details": jsonable_encoder(exc.errors())}})


@app.exception_handler(ExtractionError)
async def extraction_error_handler(_: Request, exc: ExtractionError) -> JSONResponse:
    return JSONResponse(
        status_code=502 if exc.status is None else exc.status,
        content={"error": {"code": exc.code, "details": {"message": str(exc)}}},
    )


@app.exception_handler(SnapshotBuildError)
async def snapshot_build_error_handler(_: Request, exc: SnapshotBuildError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": "SNAPSHOT_NOT_READY", "details": exc.issues}})


def _safe_errors(exc: RequestValidationError) -> list[dict]:
    details: list[dict] = []
    for error in exc.errors():
        safe = {key: value for key, value in error.items() if key != "ctx"}
        if "ctx" in error:
            safe["ctx"] = {key: str(value) for key, value in error["ctx"].items()}
        details.append(safe)
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


@app.post("/snapshot/draft", response_model=DraftResponse)
def create_snapshot_draft(request: IntakeRequest):
    facts = request.reviewed_facts or extractor.extract(request.source_text)
    return draft_store.create(request, facts).response()


@app.patch("/snapshot/draft/{draft_id}", response_model=DraftResponse)
def update_snapshot_draft(draft_id: str, correction: DraftCorrection):
    try:
        return draft_store.update(draft_id, correction.facts).response()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "UNKNOWN_DRAFT"}) from exc


@app.post("/snapshot/approve")
def approve_snapshot(request: ApprovalRequest):
    if request.approval != "APPROVE":
        raise HTTPException(status_code=422, detail={"code": "EXPLICIT_APPROVAL_REQUIRED"})
    try:
        draft = draft_store.get(request.draft_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "UNKNOWN_DRAFT"}) from exc
    if request.draft_version != draft.version:
        raise HTTPException(status_code=409, detail={"code": "STALE_DRAFT_VERSION", "current_version": draft.version})
    response = draft.response()
    if response.unresolved_questions or response.validation_issues or response.draft_snapshot is None:
        raise HTTPException(status_code=422, detail={
            "code": "DRAFT_NOT_READY",
            "unresolved_questions": response.unresolved_questions,
            "validation_issues": response.validation_issues,
        })
    snapshot = build_snapshot(draft.facts, draft.metadata())
    draft.approved = True
    return {"schema_version": snapshot.schema_version, "draft_id": draft.draft_id, "draft_version": draft.version, "snapshot": snapshot}
