# Ripple engine reference

This document describes the running simulation system in this repository: how
business records become a simulation snapshot, how the deterministic engine
executes that snapshot, how scenarios and risk use it, and which HTTP endpoints
expose the results.

The contract is `simulation.contract.v1`. The current engine version is
`simulation-engine.v1.0.0`.

## What the engine is for

The engine plays a business forward one calendar day at a time. It answers:

- Which receipts, purchases, production steps, deliveries, expenses, and credit
  events can execute?
- When does each event execute, and why is it blocked when it cannot?
- How do cash, inventory, and debt change each day?
- Which orders or commitments are late or unresolved?
- What is the first cash shortfall or safety-buffer breach?

It is a deterministic greedy scheduler, not an optimiser. The same validated
snapshot, scenario, and scheduling policy always produce the same result.
Amounts are integer paise, quantities are integer units, and dates are ISO
calendar dates. The browser does not calculate forecasts or money.

## End-to-end pipeline

```text
SQLite records
    -> snapshot.builder.load_records()
    -> snapshot.builder.build_from_records()
    -> BusinessSnapshot + metadata + snapshot hash
    -> simulation.validation.validate_snapshot()
    -> simulation.engine.simulate()
    -> SimulationResult
    -> services.runs.derive()
    -> API view models and cached run
```

### 1. Records and the as-of position

`load_records(business_id)` reads only the current business's records:
business settings, parties, materials, products and recipes, stock
movements, sales and purchase orders, unpaid invoices, transactions,
recurring/scheduled expenses, and approved credit facilities.

The builder uses the current application date (`today()`) as the snapshot start:

- Opening cash is the configured opening balance plus cleared transactions up
  to the as-of date. Incoming transactions add cash; outgoing transactions
  subtract it.
- Opening inventory is the positive on-hand quantity calculated from stock
  movements up to the as-of date.
- Paid invoice amounts are removed from open receivables/payables.
- A negative calculated opening cash position is clamped to zero and returned
  as a snapshot warning.
- The horizon defaults to the business horizon and is capped by the contract
  at 730 days.

The builder skips closed/cancelled/arrived records and creates stable event IDs.
The snapshot hash is the first 16 hexadecimal characters of the SHA-256 hash of
the canonical JSON snapshot. It is used to cache and identify runs.

### 2. Records mapped into events

The builder creates these event chains and dependencies:

| Source | Events and behavior |
|---|---|
| Open sales order | `PRODUCTION_START` -> `PRODUCTION_COMPLETE` -> `DELIVERY` -> relative `CASH_RECEIPT` |
| Open customer invoice | Fixed-date `CASH_RECEIPT`; promised date is preferred, then due date, then today for an already overdue invoice |
| Open supplier invoice | `SUPPLIER_PAYMENT` on/after its due date |
| Purchase order | `INVENTORY_ARRIVAL`, plus a payment before arrival, on delivery, or after arrival according to supplier terms |
| Recurring/scheduled expense | `OTHER_EXPENSE` events |
| Credit facility | `CREDIT_DRAWDOWN` and/or `CREDIT_REPAYMENT` events, subject to facility configuration |

Sales-order material requirements come from explicit order material JSON when
present, otherwise from the product recipe. Recipe quantities include wastage
and are rounded up per material. Orders already in production or ready have
their already-spent material and production cost removed from the future work
the engine must perform.

Metadata beside the snapshot supplies labels, lanes, parties, source record IDs,
directions, and quantities for the UI. It does not contain computed forecast
values.

### 3. Validation

Pydantic validates field shapes and event-specific fields. Snapshot validation
then rejects:

- duplicate order, event, facility, inventory, or material-requirement IDs;
- missing order, facility, or dependency references;
- self-dependencies and dependency cycles;
- missing or incorrectly lagged production dependencies;
- deliveries without production completion dependencies;
- unsupported credit configurations (more than one drawdown or repayment per
  facility, repayment without drawdown, or missing drawdown dependency);
- drawdowns above an approved limit or before a facility is available; and
- unsafe numeric totals.

The snapshot contract allows at most 500 events and 730 horizon days. The HTTP
endpoints additionally reject snapshots where `events * horizon_days` exceeds
60,000 (`SNAPSHOT_TOO_LARGE`) to protect request latency.

Validation failures are returned as the API error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "details": []
  }
}
```

Simulation-specific failures use stable codes such as
`MISSING_EVENT_REFERENCE`, `DEPENDENCY_CYCLE`,
`MISSING_PRODUCTION_START_DEPENDENCY`, and
`DRAWDOWN_EXCEEDS_APPROVED_LIMIT`.

## Deterministic scheduling policy

The default and currently supported policy is `GREEDY_DAILY`.

For each day in the horizon, the engine repeatedly selects the next executable
event until no more events can execute:

1. Resource-adding events (`CASH_RECEIPT`, `INVENTORY_ARRIVAL`,
   `CREDIT_DRAWDOWN`).
2. Neutral movement events (`PRODUCTION_COMPLETE`, `DELIVERY`).
3. Resource-consuming events (`SUPPLIER_PAYMENT`, `OTHER_EXPENSE`,
   `PRODUCTION_START`, `CREDIT_REPAYMENT`).

Within a group, the stable ordering is:

1. lower order priority;
2. lower event priority;
3. original due date, with undated events after dated events; and
4. stable event ID.

An event is eligible only when its earliest date has arrived and every
dependency has executed with its lag satisfied. An event that needs cash,
inventory, or available credit and cannot obtain it is skipped for that
iteration; the scheduler does not reserve resources for it. This means a later
event may execute if it is independently feasible.

The engine never makes cash negative. A blocked event remains pending, records
machine-readable blocker history, and can be retried on later days. At the end
of the horizon, each event is classified as:

- `EXECUTED`;
- `RESOURCE_BLOCKED_AT_HORIZON`;
- `DEPENDENCY_BLOCKED_AT_HORIZON`; or
- `NOT_YET_ELIGIBLE_WITHIN_HORIZON`.

The engine records `missed_commitments` for unresolved events and for executed
events whose execution date is later than the original due date.

### State transitions

`RuntimeState` contains:

- `cash_paise`;
- inventory by material ID;
- pending event IDs;
- actual execution days;
- blocker history;
- debt state by facility; and
- conservation totals for receipts, drawdowns, ordinary payments, production
  costs, fees, repayments, interest, arrivals, and consumption.

Event effects are:

- customer receipts increase cash;
- supplier payments and other expenses decrease cash;
- inventory arrivals increase stock;
- production starts require materials and cash, then consume materials and
  production-start cost;
- production completion and delivery move the order through its dependency
  chain without a direct cash effect;
- credit drawdowns add principal to cash and charge the drawdown fee; and
- credit repayments pay outstanding principal plus payable interest when cash
  permits.

### Financing

Each facility supports at most one drawdown and one repayment in a snapshot.
Interest is simple daily interest:

```text
ceil(principal_paise * annual_interest_rate_bps * elapsed_days
     / (365 * 10,000))
```

The drawdown day is excluded and the repayment day is included. Cumulative
interest is rounded up to the nearest paise. A repayment that cannot be
funded remains an unresolved financing obligation and appears in
`financing_summary`.

## Engine result

`SimulationResult` contains:

- `schema_version`, `engine_version`, and `scenario_id`;
- the applied `scheduling_policy`;
- deduplicated assumptions, including scenario, event, facility, and engine
  assumptions;
- `daily_balances` with date, cash, inventory, debt, and pending-event count;
- `event_results` with execution date, status, lateness, dependencies, and
  blocker history;
- `order_results` with delivery date, delivery lateness, and status;
- `missed_commitments` and `unresolved_events`;
- `financing_summary` per facility and in total;
- `metrics`;
- conservation `transaction_totals`; and
- an optional `execution_log`.

Metrics include missed commitment count, unresolved order count, minimum
executable cash, closing cash, outstanding debt, accrued financing cost, and
overdue financing-obligation count. `extra_funding_needed_to_preserve_target_schedule`
is explicitly `UNSUPPORTED`.

When `include_execution_log` is enabled, each log row contains the day, sequence
number, event, scheduling group, sort key, outcome, cash before/after, and
blocker reasons. The Decisions view and `/engine/day/{day}` replay this log
rather than reconstructing decisions in the frontend.

## Scenarios and comparisons

Scenarios deep-copy the input snapshot, apply changes in order, validate the
transformed snapshot, and then run the same engine. Supported contract changes
are:

| Change | Effect |
|---|---|
| `MOVE_RECEIPT_DATE` | Moves a customer receipt's earliest and due date |
| `DELAY_ARRIVAL` | Delays an inventory arrival and its due date |
| `SPLIT_CUSTOMER_COLLECTION` | Replaces a receipt with a deposit and remaining receipt |
| `SPLIT_SUPPLIER_PAYMENT` | Replaces one supplier payment with instalments and rewires dependents according to the release policy |
| `ADD_CREDIT_BRIDGE` | Adds or uses a facility, then adds a drawdown and repayment bridge |

The product's fix service also evaluates amount-changing fixes (early-payment
discount, invoice finance, and some extensions) by editing a deep copy of the
snapshot before calling the engine. Those edits are recorded as assumptions;
they are not browser estimates.

`compare_scenarios` runs baseline and scenario independently and returns deltas
for delivery dates/status, closing cash, missed commitments, unresolved orders,
outstanding debt, and accrued financing cost. Delivery deltas describe the
greedy policy's result; they are not causal attribution.

## Cached runs, derived position, and risk

Every write to business records calls the `after_write` pipeline:

1. invalidate the in-process baseline cache;
2. rebuild the current snapshot;
3. run and persist a new baseline with execution log;
4. queue a debounced risk run two seconds later.

Baseline and scenario runs are stored in `sim_run` with snapshot hash, contract
versions, scenario JSON, result JSON, and data version. Up to 40 recent runs per
business are retained in storage. The process-local cache and risk jobs mean
production should use one uvicorn worker and one replica.

`services.runs.derive` computes UI-facing net position from the engine result:

```text
net_paise = engine_cash_paise - unpaid_due_paise
```

It also identifies the first shortfall, safety-buffer breach, lowest net
position, runway, and blocker explanations. This is server-side projection of
engine output; it is not a second forecast engine.

Risk is a wrapper around the deterministic core. It samples customer payment
delays from customer history, shrunk toward pooled history, creates an ordinary
snapshot for each sample, and calls `simulate`. A deterministic seed makes a
given run reproducible. Risk reports shortfall/buffer probabilities at 30, 60,
and 90 days, p10/p50/p90 net-position fan data, expected shortfall, and
drivers. Supplier-side dates are not sampled in v1.

## HTTP API

All routes below are mounted under `/api`. They require an authenticated
session and the `FINANCE` role unless noted otherwise. Session cookies are
created by the auth routes. All mutating `/api` requests must include
`X-Ripple: 1`; bodies over 256 KiB are rejected.

### Pure contract endpoints

These endpoints accept a complete caller-supplied `BusinessSnapshot`; they do
not read the business records to construct the snapshot.

#### `POST /api/simulation/run`

Request body:

```json
{
  "snapshot": {},
  "scenario": null,
  "policy": {
    "name": "GREEDY_DAILY"
  },
  "include_execution_log": false
}
```

Returns a `SimulationResult`. `scenario` is optional and `policy` defaults to
`GREEDY_DAILY`. The endpoint applies per-user rate limiting (30 requests/minute)
and the 60,000 event-day size guard.

#### `POST /api/simulation/compare`

Request body:

```json
{
  "snapshot": {},
  "scenario": {},
  "policy": {
    "name": "GREEDY_DAILY"
  }
}
```

Returns `ComparisonResult` containing `baseline`, `scenario`, and
`comparison_metrics`. It applies the same rate and size limits.

### Product engine endpoints

These endpoints build the snapshot from the signed-in business, use the cached
baseline where possible, and return UI-oriented projections.

| Method and path | Purpose |
|---|---|
| `GET /api/engine/run` | Return the baseline run payload, or a stored in-process scenario when `?scenario=<key>` is supplied. Includes run metadata, summary, series, event views, and execution-log-backed data. |
| `GET /api/engine/graph?view=network` | Return the supplier/customer exposure network. `view=flow` delegates to `/engine/run`; `?scenario=<key>` selects a stored scenario. |
| `GET /api/engine/day/{day}` | Return one day's execution-log rows, opening/closing cash, derived net position, date, and policy. Days are zero-based and must be within the horizon. |
| `POST /api/engine/scenario` | Evaluate and persist a what-if, store it under a short-lived scenario key, and return the evaluation, scenario run payload, run ID, and asynchronous risk status. |
| `POST /api/engine/scenario/chance` | Return only the scenario's shortfall-chance status for polling while risk calculation finishes; does not execute an engine run itself. |
| `GET /api/book/summary` | Return derived cash/net series, summary, dip explanation, current position, and run metadata. |
| `GET /api/fixes` | Generate candidate fixes from the first shortfall or buffer breach, evaluate each with an actual engine run, and include post-fix risk status. |
| `POST /api/fixes/evaluate` | Evaluate one generated or custom fix and return the engine-derived before/after evaluation and risk status. |
| `GET /api/risk/forecast` | Return baseline risk status/results, run ID, and snapshot hash. A missing result queues risk work and returns a computing status. |

`POST /api/engine/scenario` and `POST /api/fixes/evaluate` accept either a
`fix_id` or a custom `kind`. Custom kinds are
`MOVE_RECEIPT_DATE`, `DELAY_ARRIVAL`, `SPLIT_CUSTOMER_COLLECTION`,
`SPLIT_SUPPLIER_PAYMENT`, `ADD_CREDIT_BRIDGE`, and the product-level
`EXTENSION`. Required fields and horizon checks are enforced by the route.

### Record endpoints that trigger a new run

The following write endpoints change records and therefore invalidate/rebuild
the baseline and queue risk: transactions, parties, invoices, orders,
inventory/materials/recipes, business settings, recurring expenses, facilities,
team/data reset or demo loading, and setup/snapshot approval imports. The
complete route implementations are in
`backend/app/api/app_routes.py`; the important invariant is that every
successful write calls `after_write(business_id)`.

Read endpoints such as `/today`, `/alerts`, `/sales-orders`,
`/purchase-orders`, `/inventory`, `/parties`, and `/settings` expose projections
of the same current run or its source records. They do not run a separate
forecast in the browser.

## Error and consistency behavior

The application wraps errors as `{"error": {"code", "details"}}`. Common engine
and projection errors include:

- `SNAPSHOT_TOO_LARGE` (HTTP 422);
- `DAY_OUT_OF_RANGE` (HTTP 422);
- `SCENARIO_EXPIRED` (HTTP 404);
- `UNKNOWN_FIX` or `UNKNOWN_EVENT`;
- `DATE_OUTSIDE_HORIZON`;
- `FIX_OR_KIND_REQUIRED` and `MISSING_FIELDS`;
- simulation and snapshot validation codes (HTTP 422); and
- `INTERNAL_ERROR` (HTTP 500, logged server-side).

Money fields exposed by engine and finance views end in `_paise`. Supervisors
receive redacted money fields through the role projection.

## Source map

- `backend/app/simulation/schemas.py` — contract models, enums, limits, and result shapes
- `backend/app/simulation/validation.py` — snapshot and financing validation
- `backend/app/simulation/engine.py` — daily scheduler, event effects, blockers, results, and log
- `backend/app/simulation/transformations.py` — contract scenario changes
- `backend/app/simulation/comparison.py` — baseline/scenario comparison
- `backend/app/simulation/financing.py` — daily interest calculation
- `backend/app/snapshot/builder.py` — records-to-snapshot conversion and metadata
- `backend/app/services/runs.py` — baseline cache, persistence, and derived position
- `backend/app/services/risk.py` — sampled delays around the deterministic core
- `backend/app/services/fixes.py` — candidate generation and actual fix evaluation
- `backend/app/services/views.py` — engine-backed UI view models
- `backend/app/api/app_routes.py` — mounted product and pure-engine endpoints
- `backend/app/main.py` — middleware, error envelope, and router mounting

