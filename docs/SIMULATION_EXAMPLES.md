# Simulation Examples

Checked-in request and response examples are under
[`fixtures/simulation/examples/`](../fixtures/simulation/examples/).

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

