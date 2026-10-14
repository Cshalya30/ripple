# Simulation Engine Handoff

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

## Next integration choices

- Decide where authenticated business snapshots will be loaded from.
- Decide whether simulation results should be persisted or remain request-scoped.
- Add production observability and request limits before exposing the endpoints
  publicly.
- Version the contract deliberately before adding breaking fields or event
  types.

