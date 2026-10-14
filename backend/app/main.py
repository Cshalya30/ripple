from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .simulation.comparison import compare_scenarios
from .simulation.engine import simulate
from .simulation.schemas import ComparisonRequest, SimulationRequest
from .simulation.validation import SimulationValidationError


app = FastAPI(title="Supplier-Business-Customer Loop API")


@app.exception_handler(SimulationValidationError)
async def simulation_validation_error_handler(_: Request, exc: SimulationValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": exc.code, "details": jsonable_encoder(exc.details)}})


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "details": _safe_errors(exc)}})


@app.exception_handler(ValidationError)
async def pydantic_validation_error_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "details": jsonable_encoder(exc.errors())}})


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
