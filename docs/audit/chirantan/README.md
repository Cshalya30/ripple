# Track A audit: index

| File | What it is |
|---|---|
| `production-readiness-audit.md` | scope, tools, results, checklist coverage, blocked areas, recommendation |
| `bug-ledger.md` | every confirmed bug with steps, root cause, fix, test and status |
| `endpoint-inventory.json` | every route found in the source: method, path, handler, auth, request model, frontend callers, mounted or not |
| `ui-control-coverage.json` | every control on the Track A screens at 1440 px and 390 px with PASS / FAIL / BLOCKED / NOT APPLICABLE, plus the user-journey checks |
| `hardcoded-vs-real.md` | notebook questions 1 to 3 |
| `final-report.md` | the 18-point report |
| `evidence/` | raw sweep results, Newman run output, regression results before and after, a few screenshots |
| `tools/` | the scripts that produced the evidence (inventory, probes, coverage builder) |
| `trackA.patch` | the whole code change as one patch against `main` `4a8d820b` |

Related files outside this folder: `postman/` (collection and environment template), `e2e/audit-controls.mjs`, `e2e/regression-trackA.mjs`,
`tests/test_trackA_fixes.py`, `tests/test_trackA_recompute.py`, `tests/test_trackA_munim_provider.py`, `frontend/src/lib/errorCodes.test.ts`.

## Reproduce

From a copy of the repository on a path without `#` (for example `C:\ripple`):

```
python -m unittest discover -s tests -p "test_*.py"                    # backend
cd frontend && npm ci && npx tsc -b && npx vitest run && npm run build  # frontend
# serve the app (in-memory data, pinned date for the demo only)
set FRONTEND_DIST=frontend\dist & set RIPPLE_TODAY=2026-10-14 & set DATABASE_URL=:memory:
python -m uvicorn backend.app.main:app --port 8766
# in another terminal
cd e2e && npm i
set RIPPLE_URL=http://localhost:8766
node regression-trackA.mjs ..\docs\audit\chirantan\evidence           # user journeys
node audit-controls.mjs ..\docs\audit\chirantan\evidence today        # click every control (filters: today, engine, book; W=390 H=844 for phone width)
python ..\postman\build_collection.py                                   # regenerate the collection
npx newman run ..\postman\collections\ripple-api.json --env-var base_url=http://localhost:8766
python ..\docs\audit\chirantan\tools\inventory.py                       # endpoint inventory
python ..\docs\audit\chirantan\tools\build_coverage.py                  # coverage file
```

The demo-creation endpoint allows 6 sandboxes a minute per address, so run the sweeps one after another.
