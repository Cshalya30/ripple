# Repository Guidelines

Please follow these guidelines throughout the Bug Bounty event.

### 1. Branch Rules
- Each team must maintain a single repository with three branches: `main`, `bugbounty`, and `fixing`.
- `main` is for ongoing development, `bugbounty` is for deployment and peer testing, and `fixing` is for bug fixes.
- Keep `main` and `bugbounty` in sync until the Attack Phase begins.
- **Never delete the `bugbounty` or `fixing` branches.**

### 2. Attack Phase (12:00 AM – 2:00 AM)
- The `bugbounty` branch will be frozen at the start of the Attack Phase. No changes or commits are allowed to this branch after the phase begins.
- Only the code on the `bugbounty` branch will be deployed for peer testing.
- Development may continue on `main`.
- Test only assigned projects and follow the event's testing guidelines.

### 3. Fixing Phase (2:00 AM – 3:30 AM)
- **Create the `fixing` branch directly from `bugbounty`** at the start of the Fixing Phase. Do not create it from `main` or any other branch.
- Commit all bug fixes to the `fixing` branch only.
- Keep `bugbounty` frozen throughout the Fixing Phase and subsequent evaluation.
- All fixing work must stop when the Fixing Phase ends at 3:30 AM.
- **Do not make any commits to the `fixing` branch after the Fixing Phase ends.** Post-deadline commits may result in disqualification from the Bug Bounty round.
- Merge validated fixes into `main` only after the Fixing Phase ends.
- Update `bugbounty` only after the organizers explicitly announce that evaluation is complete and development may resume.

### 4. Bug Reporting Rules
- Each team may report a maximum of **10 bugs overall**, with a maximum of **4 bugs per target team**.
- Bug reports must be clear and reproducible.
- Report critical vulnerabilities or exposed data privately to the organizers.

### 5. Important
- **Do not modify the `bugbounty` branch after the Attack Phase begins.** Unauthorized changes may result in disqualification from the Bug Bounty round.
- **Do not commit to the `fixing` branch after the Fixing Phase ends at 3:30 AM.** Violations may result in disqualification from the Bug Bounty round.
- Do not modify another team's branches or attempt to bypass repository restrictions.
- Test only assigned projects and authorized accounts. Destructive testing, denial-of-service attacks, phishing, malware deployment, and attempts to access unrelated systems are prohibited.

All teams are expected to follow these rules strictly throughout the event.

## Ripple: what's in this repository

Ripple helps a small business see how one late payment ripples through its
suppliers, stock and customers. It forecasts the next 90 days of cash, shows
the dip, proposes fixes (each one re-simulated) and drafts the WhatsApp message.

```text
backend/
  app/simulation/   deterministic simulation engine (unchanged)
  app/api/          Ripple REST API: khata store, Excel/CSV import, forecast + fixes adapter
  app/assistant/    "Ask Ripple": Gemini via LangChain, Whisper speech-to-text
  app/main.py       FastAPI app; also serves the built React app
frontend/           React + Vite + TypeScript UI (only src/services/* talk to the API)
fixtures/           simulation fixtures and examples
tests/              engine tests + API tests (41 total)
docs/               simulation contract, handoff notes, optional UI patch
```

### How it fits together

```text
React UI ── src/services/*.ts ──HTTP──> /api/*  (FastAPI)
                                           │
              khata (SQLite, per-browser workspace)
                                           │
          parties + recurring costs ──> BusinessSnapshot (paise)
                                           │
                     simulation engine (GREEDY_DAILY) ──> forecast, dip causes
                                           │
         fixes = engine scenarios (MOVE_RECEIPT_DATE, SPLIT_SUPPLIER_PAYMENT,
                 ADD_CREDIT_BRIDGE) or snapshot changes, each re-simulated
```

The engine never lets cash go below zero: a bill it can't afford is paid late.
The chart shows **committed cash** (every bill paid on its due day), derived
from the same engine run by moving each late payment back to its due day. So
the red dip equals exactly what the engine could not pay on time, and the
"Why the dip happens" card says how late (e.g. Sharma Yarn Mills: Day 41, 7 days late).

Engine docs: [contract](docs/SIMULATION_CONTRACT.md), [fixtures](docs/SIMULATION_FIXTURES.md),
[examples](docs/SIMULATION_EXAMPLES.md), [handoff](docs/SIMULATION_HANDOFF.md).

## Run it

Requirements: Python 3.11+ and Node 18+.

```bash
# 1. backend (repository root)
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt                     # add -r requirements-voice.txt for the mic
cp .env.example .env                                # then put your GOOGLE_API_KEY in .env
uvicorn backend.app.main:app --reload               # http://localhost:8000

# 2a. frontend in dev mode (second terminal)
cd frontend && npm install && npm run dev           # http://localhost:5173, calls :8000

# 2b. or one-URL mode: build once and let FastAPI serve it
cd frontend && npm install && npm run build && cd ..
uvicorn backend.app.main:app                        # UI + API on http://localhost:8000
```

Deployment (Railway for backend, Vercel for frontend):

- **Backend (Railway)**: Deploy with Nixpacks. Root directory: repo root. Start command: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`. Environment variables: `RIPPLE_CORS_ORIGINS=<your-vercel-domain>` and `GOOGLE_API_KEY`.
- **Frontend (Vercel)**: Root directory: `frontend`. Build command: `npm run build`, output: `dist`. Environment variable: `VITE_API_URL=<your-railway-url>`.

Tests:

```bash
python -m unittest discover -s tests -v
```

### Environment variables

See [`.env.example`](.env.example). Only `GOOGLE_API_KEY` matters for the demo;
without it the assistant answers from built-in replies and everything else works.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/health`, `/api/health` | Liveness; `/api/health` also reports assistant/voice status |
| GET | `/api/business` | Business profile, safety buffer, today |
| GET | `/api/parties` | Customers and suppliers in this workspace |
| POST | `/api/parties` | Add a customer/supplier (validated) |
| DELETE | `/api/parties/{id}` | Remove one |
| POST | `/api/parties/upload` | Import an `.xlsx`/`.csv` ledger (multipart `file`) |
| POST | `/api/parties/import` | Import parties as JSON |
| POST | `/api/demo/reset` | Restore the demo khata for this workspace |
| GET | `/api/forecast` | 90-day series, summary, dip causes, breakdowns, engine notes |
| GET | `/api/fixes` | Fix options, each with its re-simulated series |
| POST | `/api/assistant/chat` | Gemini answer grounded in the live forecast (`en`, `hi`, `route`) |
| POST | `/api/assistant/transcribe` | Whisper transcript of an audio file |
| POST | `/simulation/run`, `/simulation/compare` | Raw engine contract (see docs) |

Every `/api` call takes an optional `X-Workspace-Id` header (16–64 chars of
`A-Z a-z 0-9 _ -`). The frontend generates one per browser, so visitors never see
or change each other's data. Errors always look like
`{"error": {"code": "...", "message"|"details": ...}}`.

No login is needed: there is no account system, and each browser gets its own
workspace automatically. Open the app and it is ready to test.

## Data

All data is **synthetic sample data** (fictional businesses and phone numbers);
nothing identifies a real person. Each new workspace starts with the same demo
khata as the frontend's mock data (Mahalakshmi Fabrics, 6 suppliers, 8 customers).
Demo rows move with today's date, so the dip is always on Day 34. Rows you add
or import keep their real dates.

## AI tools used

Disclose your team's tools here as required by the rulebook. This integration
(the `backend/app/api` and `backend/app/assistant` packages, the frontend
service-layer wiring, tests and this README) was written with Claude (Anthropic)
and reviewed by the team. The assistant feature itself calls Google Gemini via
LangChain and a local Whisper model (faster-whisper).

## Known limitations

Previously disclosed limitations are out of scope for Bug Bounty reports.

1. **UI copy that is still static** (it lives in UI components, which were deliberately not changed):
   - the red banner sentence on the Forecast page always names Sharma Yarn Mills and Kaveri Boutique;
   - the WhatsApp composer's dates and the financed party's name are fixed;
   - the upload dialog's preview table shows sample rows, not your file, and its toast counts customers from the sample (the actual import uses your file);
   - the mic button records nothing until the optional patch below is applied;
   - the assistant only shows English and Hindi, as before.
2. **Optional UI patch.** [`docs/optional-ui-patch.diff`](docs/optional-ui-patch.diff) wires the mic to Whisper and fixes the upload toast count. Apply it with `git apply docs/optional-ui-patch.diff`. It was left unapplied on purpose.
3. **Forecast model.** Customers who are overdue with no promised date are assumed to pay 7 days from today. Supplier bills already overdue are treated as due today. Bills due after Day 90 are outside the window.
4. **Fixes.** At most four are offered (early payment, split, extension, invoice financing), built around the biggest bill at the dip and the biggest late receivable. If the balance never drops below the safety buffer, no fixes are shown.
5. **Assistant.** It needs `GOOGLE_API_KEY`. Without it, or on any Gemini error, replies fall back to built-in keyword answers. Chat history lives in the browser tab only.
6. **Voice.** It needs `requirements-voice.txt`, and the first use downloads the Whisper model, so the server needs internet once. Recordings are capped at 10 MB.
7. **Limits:**
   - 300 parties per workspace, 200 rows per import, 2 MB per upload;
   - rate limits per client IP: 60 writes, 10 uploads, 20 chat and 10 voice requests per minute;
   - 2,000 workspaces, with the least recently used evicted first.
8. **Offline fallback.** If the backend can't be reached, the frontend falls back to its built-in sample data and logs a `[ripple]` warning in the browser console.
9. **Storage.** SQLite with a single process. Run one uvicorn worker.
