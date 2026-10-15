# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Ripple: a FastAPI + React app that keeps a small manufacturer's khata (parties, invoices, orders, stock, payments) and
plays the business forward day by day with a deterministic simulation engine to find cash shortfalls and fixes.
`README.md` has the product overview, screens, env vars, deployment and security notes.

## Hackathon branch rules (Bug Bounty event)

The repo has `main` (development), `bugbounty` (deployed for peer testing, frozen from the Attack Phase onward) and
`fixing` (created from `bugbounty` at the start of the Fixing Phase; no commits after 3:30 AM). Never commit to
`bugbounty` after the Attack Phase starts, never delete `bugbounty` or `fixing`, and confirm with the user before
committing or pushing to either of them.

## Commands

```
# Backend (from the repo root; the module path is backend.app.main)
python -m pip install -r requirements.txt
uvicorn backend.app.main:app --reload          # http://127.0.0.1:8000, SQLite at data/ripple.db, demo seeded on start

# Frontend
cd frontend && npm ci
npm run dev                                     # :5173, proxies /api to 127.0.0.1:8000
npm run build                                   # tsc -b && vite build -> frontend/dist (FastAPI serves it at /)
npx vitest run                                  # all frontend tests
npx vitest run src/lib/format.test.ts           # one file

# Backend tests (stdlib unittest; tests import `support`, so tests/ must be on the path)
python -m unittest discover -s tests -v
python -m unittest discover -s tests -p 'test_ripple_api.py' -k SecurityTests   # one class / name pattern
PYTHONPATH=tests python -m unittest test_ripple_api.SecurityTests.test_name    # one exact test

# Other
cd e2e && npm install && node smoke.mjs shots  # browser smoke against a running server (RIPPLE_URL, BROWSER_PATH)
python -m scripts.bench_engine                 # engine and risk timings on the demo data
python fixtures/simulation/generate_examples.py
```

Vite cannot build or test from a path containing `#`; use a copy at a plain path if needed.
There is no linter configured; TypeScript is `strict`, and `npm run build` is the type check.

## Architecture

### Backend request flow

`backend/app/main.py` mounts only two routers: `api/auth_routes.py` (login, sessions, demo sandboxes) and
`api/app_routes.py` (everything else, ~1.5k lines). It also adds a middleware that rejects any `/api` write without an
`X-Ripple: 1` header (CSRF) or with a body over 256 KB, and maps every exception to the envelope
`{"error": {"code", "details"}}`. Raise `HTTPException(detail={"code": ..., ...})` to produce a coded error.

**Legacy, unmounted code:** `backend/app/api/{routes,forecast,importer,models,store,config}.py`,
`backend/app/assistant/` and `frontend/src/services/api.ts` belong to an older build. Nothing imports them into the
running app. Make changes in `app_routes.py`, `services/` and `frontend/src/lib/` instead. The loose
`khata-csv-export.diff` and `docs/optional-ui-patch.diff` are patches, not applied code.

### Auth and tenancy (`core/auth.py`)

- Route dependencies `ANYONE`, `FINANCE`, `OWNER` (built by `require(...)`) resolve a `Principal`, which carries the
  role and `business_id`. Always scope SQL by `principal.business_id`; never take a business ID from the request.
- Supervisors must not see money. `for_role(principal, payload)` / `redact_amounts` strip every key ending in
  `_paise` (and `value`, `cost`). **Name every money field `*_paise`**, or it leaks to supervisors.
- Rate limiting goes through the in-process `limiter` / `limit_ai`. Because rate limits, the run cache, risk jobs and
  intake drafts all live in process memory, production runs one uvicorn worker and one replica.

### Data → snapshot → engine pipeline

1. **Records** (`core/db.py` schema, `records/repo.py` writes): standard-library `sqlite3`, using the
   `query`/`query_one`/`insert`/`update` helpers and the `tx()` context manager. All money is integer paise. Every write
   must call `bump_data_version`.
2. **After a write**, the route calls `after_write(business_id)` in `app_routes.py`. That invalidates the cached run,
   rebuilds the baseline, and queues a debounced risk job two seconds later.
3. **Snapshot** (`snapshot/builder.py`): turns records into a `BusinessSnapshot` with stable IDs and a
   `snapshot_hash`.
4. **Engine** (`simulation/`): a deterministic greedy daily policy under contract `simulation.contract.v1`
   (`docs/SIMULATION_CONTRACT.md`). Results carry `engine_version` and `schema_version`, and the optional
   `execution_log` feeds the Decisions view. The engine must stay deterministic and allocation-light (~9 ms per run).
   Scenarios use the transformations in `transformations.py`, and `comparison.py` diffs baseline against scenario.
5. **Runs** (`services/runs.py`): a cached baseline keyed by data version; every run is persisted in `sim_run`.
   `services/views.py` derives the Today, Network and Flow payloads from a run.
6. **Risk** (`services/risk.py`): not a model. It samples each customer's payment delay from their history and re-runs
   the same engine (Monte Carlo). It runs in a worker process (`RISK_PROCESSES`; 0 = in-process) via `risk.jobs`.
7. **Fixes** (`services/fixes.py`): every candidate fix is evaluated by an actual engine run on an edited snapshot copy.

Invariant: every amount and date shown in the UI comes from the engine or the records. Don't compute money or
forecasts in the browser or in an LLM.

### Intake and Munim (LLM, Groq)

- `intake/`: free text → `BusinessFacts` with supporting quotes (`extractor.py`, Groq) → draft (`drafts.py`, in
  memory) → user approval → `records/importer.py`. Without `GROQ_API_KEY`, only reviewed facts are accepted.
- `services/munim.py`: the assistant. It has read-only tools only, and a grounding check rejects any number that is
  not in the tool results. Without a key, it falls back to templates. `services/messages.py` holds the fixed
  en/ta/hi WhatsApp templates.

### Frontend (`frontend/src`)

React 18 + Vite + TanStack Query + Zustand. All HTTP goes through `lib/api.ts`, which adds `X-Ripple: 1` and throws
`ApiError(status, code, details)`; query and mutation hooks live in `lib/queries.ts`, and shared types in
`lib/types.ts`. `lib/format.ts` is the only place paise become rupees. Pages live in `pages/` (routes `/app/*`
plus `/setup`), and the Engine screen's views (Flow, Network, Timeline, Decisions, Inspector) live in `engine/`.
Flow layout is computed on the server. Charts are hand-drawn SVG. UI strings are in `lib/i18n.ts` (en/ta/hi).

### Tests

`tests/support.py` sets env vars before importing the app (in-memory DB, `RIPPLE_TODAY=2026-10-14`, no Groq, small
risk sample counts, `RISK_PROCESSES=0`). Any test that touches the app, database or API must import from `support`
before importing from `backend`; pure engine and intake tests don't need it. Use `signed_in(email)` for a demo-account client or `sandbox()` for a private demo copy. Engine tests
use the fixtures in `fixtures/simulation/`.
