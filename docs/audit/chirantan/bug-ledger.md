# Bug ledger: Track A (Chirantan)

Branch: `fix/ch-trackA`, cut from `main` at `4a8d820b`. Nothing is committed or pushed; the diff is in `trackA.patch`.
Severity scale: Critical / High / Medium / Low (the plan's P0 to P3 map to these in the same order). Test names refer to files in `tests/`,
`e2e/regression-trackA.mjs` (Playwright, "R" checks) and `postman/collections/ripple-api.json`.

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

---

## A-001 Munim's template answers gave the runway message to almost every question

- **Severity:** Medium (it is the default behaviour whenever no AI key is set or the AI service fails).
- **Category:** AI / chatbot, functional.
- **Endpoint / file:** `POST /api/assistant/chat`; `backend/app/services/munim.py`, function `fallback`.
- **Steps:** run without `GROQ_API_KEY`. Open Munim. Ask "Who owes me the most?", "How much can I safely spend?", "Is there anything suspicious in my books?", "hello", "What is the weather in Chennai?".
- **Expected:** an answer to the question asked, or a clear "I can't answer that" for out-of-scope questions.
- **Actual:** every one of them returned "Cash runs short on Tue 17 Nov (D34): Pay Sharma Yarn Mills cannot be paid...". The last branch of `fallback` answered anything it did not recognise with the runway text, and nothing answered receivables, safe-to-spend or flags.
- **Evidence:** `tools/munim_probe.py` output before the fix (13 questions, 10 identical replies). Postman folder "06 Munim".
- **Root cause:** the final `elif` was a catch-all that called `get_runway`; there were no intents for receivables or for the Risk and Finance engine.
- **Fix:** two new read-only tools, `top_owed` (customers by amount owed, with the overdue part) and `get_guard` (safe-to-spend ladder, suspicious entries, books check). The template router now has explicit intents (safe/spend/afford/invest, suspicious/flag/duplicate/reconcile, owe/owed/outstanding), a greeting and help reply, a runway reply only for dip/short/run out/runway/why/when, and otherwise the existing "I can only answer from your books" decline. Both tools are finance-only, so a supervisor still gets no money data. The AI path gets the same tools.
- **Regression tests:** `test_trackA_fixes.A001_*` (6 tests); Postman requests "ask who owes the most", "ask how much is safe to spend", "out-of-scope question is declined"; Playwright R2a and R2b.
- **Verified:** yes, 2026-10-15 (Newman run 2, regression run).
- **Limits:** the Tamil and Hindi help text is the English text (no reviewed translation). The AI mode was not run (no key).

## A-002 Munim accepted a blank question at the API

- **Severity:** Low. **Endpoint:** `POST /api/assistant/chat`, `ChatBody` in `app_routes.py`.
- **Steps:** send `{"message": "   "}`.
- **Expected:** 422. **Actual:** 200 with the runway message (the UI already refused it; only the API accepted it).
- **Root cause:** `min_length=1` counts spaces.
- **Fix:** validator trims the message and rejects an empty result; the trimmed text is what is processed.
- **Tests:** `test_trackA_fixes.A002_*`; Postman "blank question"; Playwright R3a (UI sends nothing).

## A-003 Rate limits could be bypassed with a forged `X-Forwarded-For` header

- **Severity:** High (unlimited password guessing; unlimited demo businesses). **Category:** authentication / abuse.
- **Endpoint / file:** `POST /api/auth/login`, `POST /api/auth/demo`, `POST /api/assistant/chat`; `client_ip` in `backend/app/core/auth.py`.
- **Steps:** send 15 wrong-password logins, each with a different `X-Forwarded-For` value; send 8 demo requests the same way.
- **Expected:** `429` after 10 logins and after 6 demo requests in a minute. **Actual:** all 15 logins returned 401 (no limit), all 8 demo requests returned 200.
- **Evidence:** `tools/xff_probe.py` before and after.
- **Root cause:** `client_ip` trusted the LEFTMOST `X-Forwarded-For` entry, which the client writes. A proxy appends the address it saw on the right.
- **Fix:** use the Nth entry from the right (`TRUSTED_PROXY_HOPS`, default 1), which is the one a trusted proxy recorded. Added a second, slower limit per account (30 attempts per 15 minutes per email) so a guesser is bounded even from many addresses.
- **Tests:** `test_trackA_fixes.A003_*` (4 tests: forged prefix, demo creation, many addresses on one account, two hops).
- **Remaining (for Track C / deployment):** (1) with no proxy in front, a client can still send a single forged header; run with `TRUST_PROXY=0` when not behind a proxy. (2) `Dockerfile` starts uvicorn with `--proxy-headers --forwarded-allow-ips='*'`, which makes uvicorn itself trust any forwarded address; check on the deployed site what `X-Forwarded-For` really contains and set the hop count and the allowed proxy list to match. (3) A per-account limit means someone could lock the shared demo logins for 15 minutes by failing 30 times; the private "Open demo business" button is unaffected.

## A-004 One screen's render error blanked the whole app

- **Severity:** Medium. **Category:** resilience / error handling. **File:** `frontend/src/App.tsx`.
- **Steps:** make `GET /api/today` return a 200 with an unexpected shape (what a half-finished deploy or a proxy error page can do). Open Today.
- **Expected:** a message on that screen, the navigation still usable. **Actual:** a completely blank page, no navigation, no way out except typing a URL.
- **Evidence:** `evidence/regression-trackA-BEFORE.json`: R1a and R1b FAIL on the build without the fix. (That file comes from an earlier draft of the script: its other failures were script timing and selector mistakes fixed before the final run. Only R1a and R1b are application failures.)
- **Root cause:** no React error boundary anywhere in the app.
- **Fix:** `components/ErrorBoundary.tsx` around the routed screen (inside the shell, so navigation stays) and around the whole app. It says nothing was changed, offers Try again, Reload and Go to Today, logs the error to the console, and clears itself when the route changes.
- **Tests:** Playwright R1a, R1b, R1c (pass after the fix).

## A-005 Money in server-written text lost paise, rounded losses wrongly and printed `₹-`

- **Severity:** Low (display). **Files:** `services/fixes.py` (`_rupees`), `services/guard.py` (`rs`).
- **Steps:** a recommendation with a negative lowest point read "lowest ₹-,55,950"; `_rupees(-123456)` returned `₹-1,235` for −₹1,234.56; `_rupees(5)` returned `₹0` for ₹0.05.
- **Root cause:** a private formatter that floors, drops paise and puts the sign after the rupee sign.
- **Fix:** both now call the shared `messages.rupees` (exact paise, Indian grouping, a real minus sign in front).
- **Tests:** `test_trackA_fixes.A005_*`.

## A-006 Branch `multilingual-speech-to-text` commits `node_modules`, `dist` and a database

- **Severity:** High (repository hygiene; a committed SQLite file may hold test or real data). **Status:** open, not on `main`.
- **Evidence:** `git diff --name-only origin/main...origin/multilingual-speech-to-text` lists 11,483 files under `frontend/node_modules`, 117 under `e2e/node_modules`, 51 under `frontend/dist`, and `data/ripple.db`, `data/ripple.db-shm`, `data/ripple.db-wal`, plus `app2.py` and a second assistant package. The branch is 2 commits ahead of `main` (`9ea8001f`, `c9cb03c4`).
- **Recommendation:** do not merge the branch. Take the source files only (speech-to-text service, tests) by cherry-picking paths. Check what the database holds and delete it from the branch history if it holds anything real. The other branches (`fix`, `frontend`, `simulation-engine`, `feature/frontend`) are strict ancestors of `main`; `main`, `bugbounty` and `redundant` are identical at `4a8d820b`.

## A-007 Backend code that is never mounted

- **Severity:** Medium (dead code with a `/demo/reset` and an upload route that would be dangerous if ever mounted). **Status:** open, Track C to decide.
- **Evidence:** `backend/app/main.py` includes only `auth_routes` and `app_routes`. `backend/app/api/routes.py` (13 route decorators), `store.py`, `forecast.py`, `importer.py`, `models.py`, `config.py`, `assistant/chat.py`, `assistant/speech.py` and `frontend/src/services/api.ts` are not imported by the running application. `endpoint-inventory.json` marks 10 of those routes `mounted: false`.
- **Recommendation:** delete, or integrate properly. Do not leave half-live.

## A-008 A 401 mid-session lost the page

- **Severity:** Low. **Files:** `frontend/src/App.tsx`, `frontend/src/pages/Login.tsx`.
- **Steps:** while on Book, let the session end (here: the next request returns 401).
- **Expected:** sign in, then land back on Book. **Actual:** the app went to sign-in and, after signing in, to Today.
- **Fix:** the redirect carries the current path in router state; after sign-in the person goes back to it, but only if it is an internal `/app/...` path (so it cannot be used as an open redirect).
- **Tests:** Playwright R4a (redirect) and R4b (lands back on `/app/book`).

## A-009 Demo creation limits

- **Severity:** Low (design risk). `POST /api/auth/demo` allows 6 a minute per address and 120 an hour in total. People behind one Wi-Fi address (a hackathon venue) share the 6. During this audit the limit was hit by the test scripts themselves, which is why the Playwright regression reuses one sign-in. With A-003 fixed the address is taken from the right of `X-Forwarded-For`; if the host's proxy chain has more than one hop and `TRUSTED_PROXY_HOPS` is not set to match, everyone could share one address and the 6 a minute becomes a site-wide cap. Check on the deployed site.

## A-010 Mounted routes with no frontend caller

- **Severity:** Info. **Evidence:** `endpoint-inventory.json` (static scan) plus a manual search of `frontend/src` for each path.
- **Routes:** `POST /api/fixes/evaluate`, `PATCH /api/transactions/{id}`, `PATCH /api/parties/{id}`, `POST /api/invoices`, `PATCH /api/invoices/{id}`, `GET /api/inventory/summary`, `GET /api/recipes/{product_id}`, `POST /api/snapshot/draft`, `POST /api/snapshot/approve`, `POST /api/simulation/run`, `POST /api/simulation/compare`.
- **Verdict:** the last four are the documented engine and snapshot contract (`docs/SIMULATION_*.md`, `docs/SNAPSHOT_INTAKE.md`) and are intentional. The other seven are documented nowhere and nothing calls them: decide to keep and document, or remove. (The static scan also lists 9 routes that the frontend does call through template strings or helpers, such as logout, the datasheet downloads and the settings deletes; those were confirmed by search and are not in this list.)
- **Frontend calls without a backend route:** none.

## A-011 Reachable server error codes showed as raw identifiers

- **Severity:** Medium (an internal identifier shown to the owner as the whole explanation; hits real flows such as the deposit message and the payment check).
- **Category:** error handling / untranslated identifiers. **File:** `frontend/src/lib/api.ts`, `errorText`.
- **Steps:** Khata, Kaveri Boutique, Remind, change the kind to "Ask for a deposit" while the customer has no open order (`POST /api/messages/draft` returns `422 NO_OPEN_ORDER`); or ask the engine for a day outside the forecast (`DAY_OUT_OF_RANGE`).
- **Expected:** a sentence. **Actual:** `Could not complete that (NO_OPEN_ORDER).`
- **Evidence:** of 60 error codes in the backend, only 39 had a friendly message. 19 of the 25 without one are reachable from the mounted routes; the other 6 (`KHATA_FULL`, `BAD_UPLOAD`, `NO_VALID_ROWS`, `VOICE_UNAVAILABLE`, `ASSISTANT_UNAVAILABLE`, `BAD_AUDIO`) exist only in the unmounted code (A-007). `tools/message_probe.py` found the deposit case: 30 message drafts across 5 intents, 2 tones and 3 languages, 24 clean, 6 returning `NO_OPEN_ORDER` (a correct refusal, shown badly).
- **Fix:** a sentence for each of the 19 reachable codes. The generic fallback stays for codes added later and still carries the code, so support can find it.
- **Tests:** `frontend/src/lib/errorCodes.test.ts` (27 tests, one per reachable code plus the two fallbacks).

## A-012 Statute notes without a "check with your CA"

- **Severity:** Low (legal wording; plan item X22). **File:** `backend/app/services/guard.py`.
- **Evidence:** the s.269ST receipt note said "Ask your CA", but the s.40A(3) cash-payment note and the two MSMED 45-day notes cited a section of an Act with no pointer to a professional.
- **Fix:** each now ends with "check with your CA".
- **Test:** `test_trackA_fixes.A012_*` scans the source and fails if any guard text citing s.269ST, s.40A or the MSMED Act lacks the CA pointer.

---

## Things the control sweep flagged that were not bugs

- `book-risk` controls 37 to 39 (the "Which check should have caught it" select, the "What it missed" input and the "Log a miss" button) sit inside a collapsed `<details>` block, so the first sweep could not click them. The sweep now opens `<details>` first, and Playwright R8 exercises the whole flow (PASS).
- `book-ledger` "Export CSV" showed `requestfailed` because a link that starts a download aborts the page navigation. Playwright R9 downloads the file and checks it (`ripple-transactions.csv`, 195 lines, PASS).
- A false match on the word "nan" in "Finance" in the first version of the error-text pattern; the pattern now matches `NaN` as a whole word.

## Checks that passed and found nothing (so they are not forgotten)

- Playwright: 8 route states at 1440 px wide, 406 controls: 394 PASS, 4 FAIL (the 4 above, all explained), 8 NOT APPLICABLE (disabled or hidden), 0 BLOCKED. No console error, page error, failed asset request or HTTP error on any route load.
- The engine's answers agree with arithmetic done outside the engine in 8 scenario checks (`test_trackA_recompute.py`), and two sandboxes with the same books produce identical runs and the same risk figures for the same run.
- Postman (Newman) collection: 61 requests, 110 assertions, 0 failed (owner), plus 9 requests and 14 assertions for the supervisor role, 0 failed.
