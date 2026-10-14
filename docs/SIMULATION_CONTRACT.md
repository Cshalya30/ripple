# Simulation Contract

The simulation API uses `simulation.contract.v1`. All monetary values are integer
paise and all inventory quantities are integer units. Dates are ISO-8601 calendar
dates.

## Endpoints

### `POST /simulation/run`

Request:

```json
{
  "snapshot": {},
  "scenario": null,
  "policy": {
    "name": "GREEDY_DAILY"
  }
}
```

`scenario` is optional. The response is a `SimulationResult` containing:

- `daily_balances`: cash, inventory, debt, and pending-event count for every
  horizon day.
- `event_results`: deterministic, ID-sorted execution results and blocker
  history.
- `order_results`: delivery dates and lateness for each order.
- `financing_summary`: paid/accrued interest, principal, and overdue facilities.
- `metrics`: cash, debt, unresolved-order, and missed-commitment measures.
- `transaction_totals`: conservation ledger for cash, inventory, and debt.

### `POST /simulation/compare`

Request:

```json
{
  "snapshot": {},
  "scenario": {},
  "policy": {
    "name": "GREEDY_DAILY"
  }
}
```

The response includes both baseline and scenario results plus deltas for
delivery dates, closing cash, missed commitments, unresolved orders, debt, and
financing cost. Delivery differences are schedule attribution, not proof of
causation.

## Scheduling and validation

The engine uses a deterministic daily greedy policy:

1. Eligible cash/inventory-adding events.
2. Neutral production completion and delivery events.
3. Cash-consuming events.

Within a group, lower order priority, lower event priority, earlier due date,
and then event ID win. Events that cannot execute remain pending and include
machine-readable blocker history.

Snapshots reject duplicate IDs, missing references, dependency cycles,
invalid operational dependencies, unsupported financing configurations, and
unsafe numeric totals. Request validation and simulation validation both return
HTTP `422` with:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "details": []
  }
}
```

Simulation-specific errors use a stable code such as
`MISSING_EVENT_REFERENCE` or `DRAWDOWN_EXCEEDS_APPROVED_LIMIT`.

## Financing assumptions

Credit uses one drawdown and one repayment per facility. Interest is simple
daily interest with a 365-day denominator, excludes the drawdown day, includes
the repayment day, and rounds cumulative interest up to the nearest paise.
Repayment is attempted on the contractual repayment date and remains unresolved
if cash is insufficient.

