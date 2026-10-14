# Simulation Examples and Integration Boundary

Checked-in request and response examples are under
[`fixtures/simulation/examples/`](../fixtures/simulation/examples/).
These JSON files are deterministic demos and regression fixtures. They are not
read by the API at runtime and they are not a production data source.

## Runtime data flow

The simulation endpoint accepts a normalized `SimulationRequest`:

```text
ERP / accounting / inventory / banking systems
                    |
             integration adapters
                    |
             normalization layer
                    |
            BusinessSnapshot + Scenario
                    |
             simulation API/engine
                    |
             SimulationResult for UI/API
```

The engine is deliberately independent of external systems. A production
integration must build a `BusinessSnapshot` from current business data before
calling the endpoint. The snapshot must use:

- integer paise for money;
- integer inventory quantities and an explicit unit;
- ISO-8601 calendar dates;
- stable unique IDs for orders, events, materials, and facilities;
- explicit dependency and lag records;
- a consistent `start_date` cutoff across cash, inventory, orders, and events.

For example, an accounting invoice is not sent directly to the engine. An
adapter maps it into a contract event:

```json
{
  "id": "receipt-INV-1042",
  "type": "CASH_RECEIPT",
  "counterparty_id": "customer-7",
  "earliest_date": "2026-10-15",
  "due_date": "2026-10-15",
  "amount_paise": 6000000
}
```

The repository does not yet include ERP, accounting, banking, or inventory
connectors. Those adapters, reconciliation rules, authentication, persistence,
and access control are integration work outside the simulation core.

Run the FastAPI application from the repository root:

```powershell
uvicorn backend.app.main:app --reload
```

Run the baseline example:

```powershell
curl.exe -X POST http://127.0.0.1:8000/simulation/run `
  -H "Content-Type: application/json" `
  --data-binary "@fixtures\simulation\examples\example-input-baseline.json"
```

Run the comparison example:

```powershell
curl.exe -X POST http://127.0.0.1:8000/simulation/compare `
  -H "Content-Type: application/json" `
  --data-binary "@fixtures\simulation\examples\example-input-compare.json"
```

The API returns JSON dates and enum values. A client should use the
`schema_version` and `engine_version` fields when persisting or displaying
results.

## Handoff checks for an integration

Before sending real data to the API, an adapter should:

1. reconcile the snapshot timestamp and `start_date`;
2. convert currency and units without silently rounding;
3. generate dependencies from verified business rules;
4. preserve source-system IDs for traceability;
5. record assumptions for estimates such as production duration or collection
   timing;
6. validate the payload and handle `422` errors;
7. retain the input snapshot and engine versions with the result for audit.
