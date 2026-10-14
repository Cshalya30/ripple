# Simulation Engine Handoff

## What this component is

This repository contains the deterministic simulation core and a thin FastAPI
boundary. It calculates outcomes from a normalized `BusinessSnapshot`; it does
not fetch data from an ERP, accounting package, bank, warehouse, or lender.

The files under
[`fixtures/simulation/examples/`](../fixtures/simulation/examples/) are
hardcoded, deterministic examples used for demos and regression coverage.
They are not loaded by the API in production. A consuming application must
provide a contract-compliant request or add an adapter that builds one from
real business systems. See
[`SIMULATION_EXAMPLES.md`](SIMULATION_EXAMPLES.md) for the integration flow.

## Delivered

- Typed Pydantic v2 schemas for snapshots, events, scenarios, results, and
  financing summaries.
- Validation for IDs, references, cycles, operational dependencies, financing
  limits, and integer-safe monetary totals.
- Pure scenario transformations for receipt moves, arrival delays, customer
  deposits, supplier instalments, and credit bridges.
- Deterministic daily execution with explicit blocker history and conservation
  totals.
- Financing drawdown, fee, repayment, simple daily interest, and maturity
  reporting.
- Baseline/scenario comparison and thin FastAPI endpoints:
  `POST /simulation/run` and `POST /simulation/compare`.
- Mandatory fixtures, checked-in request/response examples, and regression
  tests.

## API handoff

Start the service from the repository root:

```powershell
uvicorn backend.app.main:app --reload
```

Endpoints:

- `GET /health`
- `POST /simulation/run`
- `POST /simulation/compare`

Request and response shapes are defined by
[`SIMULATION_CONTRACT.md`](SIMULATION_CONTRACT.md) and the typed models in
[`backend/app/simulation/schemas.py`](../backend/app/simulation/schemas.py).
Both request parsing failures and domain validation failures return HTTP `422`
with an `error.code` and machine-readable `error.details`.

For a real integration, the caller is responsible for:

- loading and authenticating the business data;
- converting source currencies to integer paise;
- normalizing inventory quantities and units;
- generating stable IDs and dependency links;
- choosing a consistent snapshot cutoff;
- preserving the submitted snapshot and engine versions for audit.

## Validation run

Command:

```text
python -m unittest discover -s tests -v
```

Result: **23 tests passed** on 2026-10-14 with Python 3.14.7,
Pydantic 2.13.5, and FastAPI 0.143.0.

The suite covers all five mandatory fixtures, validation errors, dependency
cycles, conservation of cash/inventory/debt, financing fees and interest,
scenario immutability, deterministic repeated runs, resource contention, and
both HTTP endpoints.

## Integration decisions

1. The current scheduler is intentionally greedy and deterministic, not a
   global optimiser.
2. Inventory is allocated when production starts; there is no advance
   reservation.
3. The engine reports `extra_funding_needed_to_preserve_target_schedule` as
   `UNSUPPORTED`; funding optimisation is not silently inferred.
4. Credit facilities support one drawdown and one repayment per facility.
5. The engine is currently synchronous and in-memory. Persistence,
   authentication, rate limiting, and lender integrations remain outside this
   module.
6. The API returns `422` for both Pydantic request errors and domain validation
   errors using the documented machine-readable envelope.

## Known integration gaps

- No ERP, accounting, banking, inventory, or lender adapters are included.
- The API is synchronous and in-memory; results are request-scoped.
- Authentication, authorization, persistence, audit storage, rate limiting, and
  production observability are not implemented.
- The engine requires a fully normalized dependency graph; it does not infer
  business dependencies from arbitrary source-system records.
- The current implementation supports the documented financing extension:
  one drawdown and one repayment per facility. Confirm this extension against
  the team's v1 contract before enabling it in a production workflow.

## Recommended next handoff tasks

1. Choose the first source system and define its field mapping to
   `BusinessSnapshot`.
2. Implement an adapter and snapshot builder outside the simulation engine.
3. Add reconciliation checks for cash, inventory, dates, currency, and units.
4. Add authenticated business-scoped API access and persistence.
5. Store the normalized input, output, `schema_version`, and `engine_version`.
6. Add integration tests using sanitized source-system payloads.
7. Reconfirm the scheduling and financing policy before production rollout.
