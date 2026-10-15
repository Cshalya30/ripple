# Production readiness audit: Track A (Chirantan)

Date: 15 Oct 2026. Branch `fix/ch-trackA` cut from `main` at `4a8d820b` (`main`, `bugbounty` and `redundant` were identical at that commit). Nothing committed or pushed.
Scope: the owner-facing intelligence screens (Today, Engine, Book including Risk & Finance), Munim chat and voice, the Today/Engine/Book/Munim API, the hardcoded-versus-real analysis,
and the Track A items of the shared checklist. Not covered here (Track B and C): Login, Setup, Khata, Orders, Inventory, Settings, deployment, dependency audit, git-history secret scan, full authorisation matrix.

## 1. How it was tested (and what was not available)

| Tool | Status |
|---|---|
| Postman MCP server | **Not available** in this session: no Postman tools were exposed, so no remote workspace or collection was inspected. |
| Postman CLI | **Not installed** (`postman` not found). Not installed here because the environment gave no reason to add it. |
| Newman (Postman's open-source collection runner) | Installed outside the repository (`npm i newman` in a temp folder) and used to run the same collection file the Postman CLI or app would run. This is a local run, not a Postman CLI run, and is reported as such. |
| Playwright | `playwright-core` with the installed Chrome, headless. Two scripts: `e2e/audit-controls.mjs` (click every control) and `e2e/regression-trackA.mjs` (user journeys). |
| Backend tests | `python -m unittest` (Python 3.14). |
| Frontend tests | `npx tsc -b`, `npx vitest run`, `npm run build`, from a clean path (`C:\ripple`) because Vite breaks in a path containing `#`. |
| AI provider | No key: AI mode was tested only with a stub provider (`tests/test_trackA_munim_provider.py`), never with a live model. |
| Microphone and speakers | Headless Chrome cannot record or play audio. Only the permission-denied path was exercised (R13). |

Environment: the app served from `C:\ripple` with an in-memory database, `RIPPLE_TODAY=2026-10-14` (testing only), no `GROQ_API_KEY`. All data was synthetic (private sandbox businesses).

## 2. Results

| Check | Before changes | After changes |
|---|---|---|
| Backend unit and API tests (`unittest`) | 127 passed, 1 skipped | **158 passed, 1 skipped** (31 new: 15 fixes, 8 recomputation, 8 provider-failure) |
| TypeScript (`tsc -b`) | 0 errors | 0 errors |
| Frontend unit tests (`vitest`) | 58 passed | **85 passed** (27 new: error-code messages) |
| Production build (`vite build`) | built | built |
| Playwright control sweep, 1440 px | not run | 8 route states, 405 controls: **396 PASS, 1 PASS (explained), 8 NOT APPLICABLE, 0 FAIL, 0 BLOCKED**. No console error, page error, failed request or HTTP error on any route load |
| Playwright control sweep, 390 px (phone) | not run | Today, Book (3 tabs): 122 controls: **101 PASS, 1 PASS (explained), 20 NOT APPLICABLE, 0 FAIL**. Engine at 390 px was started and stopped (too slow); not covered |
| Playwright user journeys | the first draft showed the blank-app crash (A-004) | **34 of 34 PASS** (`e2e/regression-trackA.mjs`: crash recovery, Munim ask/fail/retry, blank question, 401 and return, payment check to Engine, command line and shortcuts, alerts, missed-entry log, CSV download, timeline keys, Mark paid with a double click, flag review, microphone denied, what-if validation) |
| Postman collection run with Newman | first run: 62 requests, 1 failed (the collection's own supervisor skip logic) | **61 requests executed, 110 assertions, 0 failed** (7 supervisor requests skipped without a password); supervisor folder run separately: **9 requests, 14 assertions, 0 failed** |
| Independent recomputation | not run | 8 of 8 agree with the engine (`test_trackA_recompute.py`) |
| Endpoint inventory | not run | 86 route definitions found; 76 mounted, 10 not mounted; 24 mounted routes are exercised by the Track A collection; no frontend call without a backend route |

Known test flake: the existing risk-run waits (`wait_for_risk`, 60 s) failed once while the machine was saturated by browser sweeps (one run of 158 tests). The timeouts are now 180 s. It passed on the next two runs.
The engine screens at 1440 px were swept before the error-boundary build; the later changes only added the boundary and message text, and the journeys were rerun on the final build.

## 3. Findings

Full detail, reproduction steps, root causes, fixes and tests are in `bug-ledger.md`.

| ID | Severity | Status | Title |
|---|---|---|---|
| A-001 | Medium | Fixed | Munim's template answers gave the runway message to almost every question |
| A-002 | Low | Fixed | Munim accepted a blank (whitespace-only) question at the API |
| A-003 | High | Fixed in code, deployment check open | Login, demo-creation and AI rate limits could be bypassed with a forged `X-Forwarded-For` header |
| A-004 | Medium | Fixed | One screen's render error blanked the whole app (no error boundary) |
| A-005 | Low | Fixed | Money in server-written text lost paise, rounded losses the wrong way and printed `₹-` |
| A-006 | High | Open (not on `main`) | Branch `multilingual-speech-to-text` commits `node_modules`, `dist` and a SQLite database |
| A-007 | Medium | Open (Track C to decide) | About 1,700 lines of backend code are never mounted, including a `/demo/reset` route |
| A-008 | Low | Fixed | A 401 in the middle of a session sent the user to sign-in without remembering the page |
| A-009 | Low | Open (design risk) | Demo creation is limited to 6 a minute per address and 120 an hour in total |
| A-010 | Info | Open | 11 mounted API routes have no frontend caller |
| A-011 | Medium | Fixed | 19 reachable server error codes showed as `Could not complete that (NO_OPEN_ORDER).` |
| A-012 | Low | Fixed | Two statute notes and one MSME note did not tell the owner to check with a CA |

Nothing Critical was found. The one High that affects production exposure is A-003 (rate limits bypassable with a forged header): fixed in code, but the deployed proxy chain must be checked (see the ledger).

## 4. Track A checklist items

| ID | Result | Evidence |
|---|---|---|
| Q1, Q2, Q3 (hardcoded versus real) | Done | `hardcoded-vs-real.md` |
| Q4 (endpoints) | Done for the static inventory | `endpoint-inventory.json`: 86 route definitions, 76 mounted (29 GET, 32 POST, 4 PUT, 7 PATCH, 4 DELETE, counting the 3 in `main.py`), 10 unmounted; 11 mounted routes have no frontend caller (A-010) |
| N21 analytics | **Decision: no analytics.** The app sets one strictly necessary cookie (the session). Adding analytics would need consent and a privacy-page entry first (Track B, N1 and N5). | this file |
| N22 one clear call to action | Reviewed. Login: "Open demo business". Today: the first ranked action; the Risk & Finance line is one link. Book: Risk & Finance opens with the verdict and "Check it" for a payment. Engine: Play and "Try a what-if". No screen has competing primary buttons. | screenshots in `evidence/` |
| X2 branch drift | Done | `bug-ledger.md` A-006: `main` = `bugbounty` = `redundant`; four other branches are ancestors of `main`; `multilingual-speech-to-text` has 2 unmerged commits and commits `node_modules`, `dist` and a database |
| X4 AI safety | Partly | stub-provider tests (8 pass): provider exception, empty reply, invented number, retry limit, tools cannot be pointed at another business, supervisor blocked, system prompt says tool text is data. **Not tested:** a live model, real prompt-injection against it. |
| X5 money and dates | Done for the screens above | A-005; independent recomputation (X27); formats checked for 0, 5, 99, 100, 123456, negatives, 1,00,00,00,000, 99,99,99,99,999.99 |
| X6 determinism | Pass | two sandboxes with identical books give identical series; the risk run repeats its figures for the same run (`test_trackA_recompute.py`) |
| X14 error boundary and offline | Fixed | A-004, A-008; R1, R3, R4. API down on a screen shows the existing "Couldn't reach the engine" note with Retry. |
| X19 documentation truth | Updated | README (Environment variables, rate-limit note), `.env.example` |
| X20 dead and noisy UI | Reviewed | removed in the previous round: Today's three count boxes, Book's duplicate strips. No filler text, console logs or TODO text found on the screens above. |
| X22 legal wording | Fixed | A-012 |
| X24 machine-readable coverage files | Done | `endpoint-inventory.json`, `ui-control-coverage.json` |
| X27 independent recomputation | Pass | `tests/test_trackA_recompute.py`: 8 checks (new payment, extension, receipt later, split payment, safe-to-spend, payment-check low point, determinism x2) |
| X30 voice and speech-to-text | Partly | permission denied: clear message with Dismiss (R13). **Blocked:** recording, transcript editing, unsupported browser, service errors, because headless Chrome has no audio. the language table, voice choice and text chunking are covered by the existing unit tests in `lib/voice.test.ts`. |

Also checked and found fine: security headers (nosniff, `X-Frame-Options: DENY`, a CSP on pages, `Cache-Control: no-store` on the API); path traversal against the static route (five encodings all return the app shell, never a file); unknown paths including `/.env` return the app shell with status 200 (a soft 404, not a leak; Track B owns the 404 page); `/api/health` returns only `{"status":"ok"}`; Munim input limits (history role, history length, content length, context length, malformed JSON, claimed huge body) all refused correctly.

## 5. Blocked or untested

- Postman MCP and Postman CLI (not available); a live AI model; real microphone and speaker; Safari and Firefox (Chromium only); the deployed site; HTTPS-only behaviour (cookie `Secure` flag, HSTS); Docker build; tablet widths between 390 and 1440; the other tracks' screens.
- Engine states at 390 px other than Flow (Network, Decisions, Table) were not swept.
- AI-mode answers in the 7 languages that have no template fallback.

## 6. Release-readiness recommendation (Track A scope)

**The Track A screens are fit for the demo and for peer testing, with three conditions before a public deployment:**
1. Verify A-003 on the real deployment: set `TRUSTED_PROXY_HOPS` to the real number of proxies, and revisit the `--forwarded-allow-ips='*'` flag in the `Dockerfile`.
2. Resolve A-006 (do not merge `multilingual-speech-to-text` as it is) and A-007 (delete or properly integrate the unmounted backend).
3. Track C's authorisation matrix and secret scan must be clean.

No Critical or High finding remains open on the Track A screens themselves. This is evidence of what was tested, not proof that no defect remains.
