# Track B audit (Nandini): index

Covers Login, Setup, Khata, Orders, Inventory, Settings, the payment dialog, form validation, exports, languages, mobile and tablet layout, contrast, keyboard use and the website basics from the notebook. It also records the fixes for the findings in John's report that were present in this codebase.

| File | What it is |
|---|---|
| `final-report.md` | the 18-point report, ready to paste back |
| `production-readiness-audit.md` | scope, tools, results, checklist coverage, what was not tested, recommendation |
| `bug-ledger.md` | every bug (J- from John's report, B- from this round): cause, fix, test, status |
| `endpoint-inventory.json` | every route, auth, request model, frontend caller, Postman coverage |
| `ui-control-coverage.json` | every control at 1440 px and 390 px with PASS / FAIL / BLOCKED / NOT APPLICABLE, plus the journeys, accessibility and keyboard summaries |
| `evidence/` | raw run output (journeys, accessibility, keyboard, speed, Newman, sweeps) |
| `tools/` | the scripts that build the inventory and coverage files |

Code and tests added or changed (all in the repository, nothing committed): `tests/test_audit_round2.py` (26 regression tests), `tests/test_trackB_fuzz.py` (schema-driven fuzz, 4 tests), `frontend/src/lib/format.test.ts`, `frontend/src/lib/errorCodes.test.ts`,
`e2e/regression-trackB.mjs`, `e2e/audit-controls.mjs`, `e2e/audit-a11y.mjs`, `e2e/audit-keyboard.mjs`, `e2e/audit-speed.mjs`, `e2e/make-share-images.mjs`, `postman/trackB_folders.py` and the rebuilt `postman/collections/ripple-api.json`.

## Reproduce

From a copy of the repository on a path without `#` (for example `C:\ripple`):

```
python -m unittest discover -s tests -p "test_*.py"                          # backend, about 6 minutes
cd frontend && npm ci && npx tsc -b && npx vitest run && npm run build        # frontend
# serve the app (in-memory data, pinned date for the demo only)
set FRONTEND_DIST=frontend\dist & set RIPPLE_TODAY=2026-10-14 & set DATABASE_URL=:memory:
python -m uvicorn backend.app.main:app --port 8770
cd e2e && npm i
set RIPPLE_URL=http://localhost:8770
node regression-trackB.mjs ..\docs\audit\nandini\evidence                      # 65 journey checks
node audit-a11y.mjs ..\docs\audit\nandini\evidence                              # axe, contrast, overflow, titles, robots, sitemap
node audit-keyboard.mjs ..\docs\audit\nandini\evidence                          # tab order, focus mark, reflow at 320 px and 200% zoom
node audit-speed.mjs ..\docs\audit\nandini\evidence                             # phone profile: FCP, LCP, CLS
node audit-controls.mjs ..\docs\audit\nandini\evidence\final khata,orders,inventory,settings,login,privacy,terms,notfound,setup   # click every control (W=390 H=844 for phone)
python ..\postman\build_collection.py
node <newman>\bin\newman.js run ..\postman\collections\ripple-api.json --env-var base_url=http://localhost:8770
python ..\docs\audit\chirantan\tools\inventory.py nandini
python ..\docs\audit\nandini\tools\build_coverage.py
```

The demo-creation route allows 6 sandboxes a minute per address, so run the browser scripts one after another. The supervisor folders of the collection run only when `supervisor_password` is supplied at run time (`--env-var supervisor_password=...`).
