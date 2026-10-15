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

---

# Ripple

**See how one late payment travels through your business, before it does.**

Manipal Hackathon 2026 (M#26), Round 2, Microfinance track: "The Supplier-Business-Customer Loop".
Team HitNRun: Chirantan (lead), Aman, Moksha, Nandini, John.

## What it is

A small manufacturer pays suppliers on their terms and is paid by customers on theirs. Every order draws on one
shared pool of cash and one shared pool of material, so a single late payment can stall an unrelated order weeks later.

Ripple keeps the owner's khata (parties, invoices, orders, stock, payments), turns it into a structured snapshot,
and plays the business forward day by day with a **deterministic engine**. It shows the exact day cash runs short,
the chain of events that causes it, how likely that is given each customer's real payment habits, which fix closes
the gap and at what cost, and drafts the WhatsApp message to make the fix happen.

- **Every amount and date on screen comes from the engine or the records.** The browser only formats integer paise.
- **Risk wraps the engine; it is not a model.** Each customer's payment delay is sampled from their own history
  (shrunk towards everyone's history) and the same deterministic engine re-runs once per sample.
- **The engine shows how it decides.** The Decisions view replays the engine's own execution log for any day.
- **Munim**, the assistant, answers only from tool results; a grounding check rejects any number not in them.

## Live deployment and test accounts

Live URL: _add after deploying (see Deployment)._

| How | Credentials | Sees |
|---|---|---|
| "Open demo business" on the sign-in page | none | A private copy of the demo business, deleted after 24 hours |
| Owner | `owner@ripple.demo` / `ripple-demo-2026` | Everything (shared demo business) |
| Accountant | `accountant@ripple.demo` / `ripple-demo-2026` | Everything except team settings |
| Supervisor | `supervisor@ripple.demo` / `ripple-demo-2026` | Orders and inventory only; the server removes every amount |

The password comes from `DEMO_PASSWORD`. No admin or infrastructure credentials are needed to evaluate.

## Screens

| Route | Purpose |
|---|---|
| `/app/today` | Morning view: headline sentence, position strip, ranked actions, this week, one line from the Risk and Finance engine, what changed |
| `/app/engine` | Network (suppliers left, customers right, by exposure), Flow (the event graph the engine runs, with waiting bars and the cash and stock pools; the chosen day is lit, with numbered events and a day brief), Decisions (one day of the engine's loop), Timeline with play, pause and step, Inspector, Table, what-if scenarios with an impact panel and a baseline overlay |
| `/app/book` | Three tabs. **Position**: net today in one line, runway fan chart, risk at a glance, why the dip, ways to fix. **Risk & Finance**: the Risk and Finance engine (below). **Ledger**: transactions |
| `/app/khata` | Customers and suppliers, party drawer, reminders, 45-day MSME clock, one-click CSV datasheet per customer or supplier |
| `/app/orders` | Sales orders with forecast delivery and Undo (a step back removes exactly the records the step created), purchase orders with Undo received / Undo payment / Reopen, "Can I take this order?" |
| `/app/inventory` | Raw materials (add, edit, delete when unused; needed, free, cover, reorder point, ABC, filters), finished goods, recipes (editable), movements |
| `/app/settings` | Business profile (GSTIN and Udyam checked), money rules, team and access, display, language, voice (ten languages), accessibility, data (company datasheet), privacy, account |
| `/setup` | Describe the business in words, review what was understood against your own quotes, approve |

Keyboard: `/` or `Ctrl K` opens the command line (`ENG`, `BOOK`, `DAY 34`, `PAY KAVERI`, `FIX`), `M` toggles Munim.
In the Engine: `Space` play or pause, `←` `→` one step (one day, or the next day with events when "Skip quiet days" is on), `Shift ←` `Shift →` one week, `Home` `End`, `N` next issue.

Datasheets (priority export): `GET /api/export/party/{id}/datasheet.csv` for one customer or supplier and `GET /api/export/company/datasheet.csv` for the business. Sectioned UTF-8 CSV with a byte-order mark, plain-rupee numbers, ISO dates, formula-safe text.

## Risk and Finance engine (Book > Risk & Finance)

One engine with two halves that check each other. It reads records and the deterministic engine run; it never writes to the books.

| Half | Part | What it does | Where it comes from |
|---|---|---|---|
| Risk | Predict | Chance of a shortfall in 30, 60 and 90 days, the likely day, who drives it; 36 of the simulated futures are drawn | `risk.py`: each customer's delay is drawn from their own history, the engine re-runs per sample |
| Risk | Calculate | "Safe to spend": the most that can leave today with the buffer kept on every day up to 7, 14, 30, 45 and 60 days, from the plan and from the 1-in-10 worse future. Each payment coming due is judged: fine, tight, late or blocked | Minimum of the engine's net position (and of the risk fan's P10) minus the buffer |
| Risk | If I make this payment | A bill: pay on the due date, now, half then the rest, ask for 14 days. A new spend: on the date, a week later, two weeks later. Each option is a real engine run, with the shortfall chance re-run per option, ranked, and openable in the Engine | `guard.payment_options`, fix kinds `PAY_EARLY` and `ADD_PAYMENT` |
| Risk | Other signals | Customer concentration, overdue pile-up, customers paying later than before, 45-day MSME clock, stock gaps, credit backstop | Records and inventory measures |
| Finance | Flag | Duplicate payment, paid above the bill, payment not linked to its bill, unusual amount, cash rules (s.269ST, s.40A(3)), bounced and stale cheques. The owner marks each "Looks fine" or "It's real"; false alarms, confirmed issues and misses are counted per check, and the amount check loosens after repeated "fine" | `guard.flags`, table `guard_review` |
| Finance | Verify | Eight reconciliation checks on every load: no overpaid bill, bill status matches payments, no negative stock, received purchases have stock-in, delivered orders have stock-out and a bill, no dangling links, nothing cleared in the future, the forecast matches the current books | `guard.checks` |
| Finance | Grow | Spare cash for N days (capital), an early-payment discount to ask a supplier for, a restock that fits (resource). Offered only inside the cautious safe amount; with the assumed yearly return editable | `guard.opportunities` |
| Both | Trust | Back-test: how often a past payment landed inside the range predicted from earlier ones, against the 80% a 10-90 range should hit; what history the model learned from | `guard.calibration` |

`GET /api/guard` returns all of it, `POST /api/guard/payment-check` runs the dynamic check, `POST /api/guard/flags/review` and `POST /api/guard/missed` record the owner's verdicts. Owner and accountant only.

Product decisions made while adding it (the site had repeated itself and had too many boxes):
- It lives in **Book** as a tab, not a new page. Book already held the risk and the fixes; the engine completes it.
- Today lost its three count boxes (from suppliers, to customers, money today): each repeated something in Do today, This week or Orders. It gained one line from this engine.
- Book's position and goods strips became one sentence: Today already shows cash, receivables, payables and runway.
- Book's risk panel became a glance with a link; the drivers and the fuller figures moved into the engine.
- The transactions ledger got its own tab instead of sitting at the bottom of a long page.
- Offers are never shown beyond the safe amount, so Finance cannot suggest spending cash that Risk needs.

Voice: Munim listens and speaks English, Hindi, Tamil, Telugu, Kannada, Malayalam, Punjabi, German, Spanish and Chinese through the browser's own speech services (Chrome, Edge and Safari for listening; any browser with an installed voice for reading aloud). Replies in the languages beyond English, Hindi and Tamil are written by the AI service; the template fallback exists for those three only.

## Architecture

```
Browser (React SPA) ──HTTPS, cookie session──▶ FastAPI (one service, same origin)
                                                 ├─ records (SQLite, every row scoped by business_id)
                                                 ├─ snapshot builder: records → BusinessSnapshot
                                                 ├─ simulation core (deterministic contract, plus execution log)
                                                 ├─ risk engine: samples delays, re-runs the core (worker process)
                                                 ├─ fixes and scenarios: candidates evaluated by engine runs
                                                 ├─ Munim: read-only tools, Groq tool calling, number grounding, templates
                                                 └─ intake: text → facts with quotes → approval → records
```

Recompute pipeline: every write bumps the business's data version, which invalidates the cached run. The next read
rebuilds the snapshot and runs the engine (about 10 ms), and a risk run is queued two seconds later in a worker process.
Every baseline and scenario run is stored (`sim_run`) with its snapshot hash and its engine and schema versions.

| Path | What |
|---|---|
| `backend/app/simulation/` | Engine (contract `simulation.contract.v1`), validation, transformations, comparison |
| `backend/app/snapshot/builder.py` | Records → snapshot, stable IDs, labels (PRD 10) |
| `backend/app/services/runs.py` | Cached baseline, net position, runway, buffer breach |
| `backend/app/services/risk.py` | Delay sampling, Monte Carlo, drivers (PRD 11) |
| `backend/app/services/fixes.py` | Fix candidates and their evaluation |
| `backend/app/services/munim.py` | Assistant tools, LLM loop, grounding check, template answers |
| `backend/app/services/messages.py` | Fixed en/ta/hi message templates, `wa.me` links |
| `backend/app/records/seed.py` | Mahalakshmi Fabrics persona dataset (synthetic) |
| `frontend/src/lib/format.ts` | The only place paise become rupees |

## Stack and supported environments

- Backend: Python 3.14 (tests pass on 3.14.5), FastAPI, Pydantic v2, SQLite through the standard library `sqlite3`,
  Groq SDK. Passwords are hashed with `hashlib.scrypt`.
- Frontend: React 18, Vite 5, TypeScript (strict), TanStack Query, Zustand, React Flow (`@xyflow/react`), Radix
  Dialog and Popover, cmdk, i18next, Phosphor icons, self-hosted Anek (Latin, Tamil, Devanagari) and IBM Plex Mono.
- Browsers: latest Chrome, Edge, Firefox and Safari, on phone (Today, Khata, Book) and desktop. Voice input needs a
  Chromium browser and is hidden elsewhere.

## Run locally

Backend, from this directory:

```
python -m pip install -r requirements.txt
uvicorn backend.app.main:app --reload
```

The database is created at `data/ripple.db` on first start and the shared demo business is seeded automatically.

Frontend, in a second terminal:

```
cd frontend
npm ci
npm run dev          # http://localhost:5173, proxies /api to :8000
npm run build        # production build into frontend/dist, served by FastAPI at /
```

Vite cannot build from a folder whose path contains `#`. If your checkout path has one (for example `M# 2026`),
clone to a path without `#` or build from a copy.

## Deployment

One container serves the API and the built SPA from one origin (`Dockerfile`, `railway.json`).

1. Create a Railway service from this repository; it builds the `Dockerfile`.
2. Attach a persistent volume at `/data` (the SQLite file lives there).
3. Set `DEMO_PASSWORD` and, optionally, `GROQ_API_KEY`. Keep one replica.
4. Health check: `GET /api/health`.

Render works the same way with a persistent disk at `/data`. The Dockerfile has not yet been built on a team machine
(Docker is not installed on the build laptop), so do one deploy well before Checkpoint 1.

## Environment variables

See `.env.example`. `GROQ_API_KEY` is optional: without it, the set-up screen cannot read descriptions (the API still accepts reviewed facts) and Munim answers
from templates, labelled as such on screen. Others: `DATABASE_URL`, `DEMO_PASSWORD`, `ALLOWED_ORIGINS`,
`COOKIE_SECURE`, `RISK_SAMPLES`, `RISK_DRIVER_SAMPLES`, `RISK_FIX_SAMPLES`, `RISK_PROCESSES`, `MAX_SANDBOXES`,
`RIPPLE_TODAY`.

## Database

SQLite, created automatically on start (schema in `backend/app/core/db.py`). Money columns are integer paise. The
shared demo business is seeded on first start; owners can restore it from Settings > Data > Load demo data.

## Tests

```
python -m unittest discover -s tests -v        # 125 backend tests: engine, intake, builder, risk, fixes, API, security
cd frontend && npx vitest run                  # money and date formatting, input checks, voice helpers, flow line routing
                                               # (a repo path containing '#' breaks Vite: run from a copy at a plain path)
cd e2e && npm install && node smoke.mjs shots  # browser smoke against a running server (RIPPLE_URL, BROWSER_PATH)
python -m scripts.bench_engine                 # E-5: one engine run and one risk refresh on the demo data
```

Measured on the build laptop: one engine run on the demo data (52 events, 90 days) takes about 9 ms. A full risk
refresh (200 samples, plus 30 per customer for drivers) takes about 4 s in a worker process, and API responses stay
under 200 ms while it runs.

## Security notes (Bug Bounty)

- Sessions are random tokens stored hashed on the server, sent as `HttpOnly`, `SameSite=Lax` cookies. Login errors are generic.
- Roles are enforced by the API; supervisors' responses have every `*_paise` field removed on the server.
- `business_id` always comes from the session. Another business's IDs return 404.
- Writes require an `X-Ripple: 1` header (blocks cross-site form posts). Bodies are limited to 256 KB and validated
  by Pydantic with length limits.
- Rate limits: login 10 per minute per IP; Munim and set-up 20 per minute per user and 60 per hour per IP; demo
  copies 6 per minute per IP.
- CSP, `X-Frame-Options: DENY` and `nosniff` on every response; no stack traces in errors; CSV exports neutralise formulas.
- Munim has no write tools; tool results are wrapped as data; any prepared action needs a click in the normal UI.
- "Open demo business" gives each visitor a private copy, so one tester cannot wipe the demo for others.

## Known limitations

- The engine is a documented greedy daily policy, not an optimiser. "Optimal funding" stays unsupported.
- The risk engine samples customer payment timing only; supplier-side dates are not sampled in v1.
- The demo's payment history is synthetic. Risk numbers show the method working, not predictive accuracy.
- Tamil and Hindi UI strings and message templates were written by the build team and need review by a fluent speaker. Screens and message drafts exist in English, Tamil and Hindi only; Munim's voice and replies cover ten languages.
- Voice quality depends on the device: a language with no installed voice cannot be read aloud (Settings > Voice says so), and listening needs a network connection because the browser's speech service does the recognition.
- Undoing a delivery is refused once a payment is recorded against its invoice, and undoing a stage is refused when the stock it created has since been used.
- Excel import, receipt image upload, WhatsApp and SMS notifications, and bank feeds are not built.
- One business shape only: buy materials, produce, deliver, collect on credit.

## Decisions taken during the build

| PRD item | What was built | Why |
|---|---|---|
| Q1: where "+₹22.1L" came from | The old build computed its fix table in the browser (`frontend/src/data/fixes.ts`, a JavaScript re-simulation), not in the engine | Removed; every fix value now comes from an engine run |
| E-1 execution log | Optional `execution_log` on `SimulationResult`, off by default. The Decisions view reads it; nothing is reconstructed | Additive and contract-compatible |
| E-5 run time | Engine hot path made allocation-free with identical results (all original engine tests unchanged): about 9 ms per run | Risk needed it |
| Risk drivers | A driver's share is the part of the expected shortfall that disappears when only that customer pays on terms, on the same random draws | With the first shortfall on day 34, a "30-day chance" was too coarse to rank drivers |
| Early-payment discount, extension, invoice finance | Evaluated by the engine on a copy of the snapshot with the stated edit (discount, moved due date, fee), recorded as an assumption | The five transformations cannot change an amount or move a supplier payment |
| Overdue receivables | Timed at the date the customer promised (if the owner recorded one), else the due date, else today | PRD 10.1 plus the owner's promise date |
| SQLModel | Standard library `sqlite3` with a thin helper | Fewer moving parts on Python 3.14 |
| Flow layout | Deterministic lane and row packing on the server instead of ELK | Positions are fixed by data, so no general layout engine is needed |
| Charts | Hand-drawn SVG instead of visx | Full control of marks, one dependency fewer |

## AI tools disclosed

- In the product: Groq-hosted LLMs for intake extraction and for Munim (tool calling). They never compute money or dates.
- In development: the team used AI coding assistants (including Claude Code) to write and review code and documents.

## Third-party resources and synthetic data

Libraries are listed in `requirements.txt` and `frontend/package.json`. Fonts: Anek (Ek Type, OFL) and IBM Plex Mono
(OFL), self-hosted. Mahalakshmi Fabrics, its parties, phone numbers, GSTINs, Udyam numbers and payment history are
fictional.
