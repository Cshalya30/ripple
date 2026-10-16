# Bug ledger: Track B (Nandini) and the findings from John's audit that were also present in this codebase

Branch `fix/ch-trackA` in `C:\ripple` (cut from `main` `4a8d820b`). Nothing is committed or pushed. IDs: **J-** = John's report (his BUG-00n), **B-** = found in this round by the Track B work.
Severity: Critical, High, Medium, Low. Every fixed item has a regression test that fails on the old code (named below).

## Summary

| ID | Severity | Status | Title |
|---|---|---|---|
| J-001 | High | Fixed | Anyone on the shared demo accounts could remove the other demo accounts, invite owners or reset the shared business |
| J-002 | Medium | Fixed | `transactions.csv` did not guard the party name: a name starting with `=` became a live spreadsheet formula |
| J-003 | Medium | Fixed | A body sent in chunks was never size-checked (only the `Content-Length` header was) |
| J-004 | High | Fixed | Two pending cheques could each pay the same bill: Rs 2,000 received against a Rs 1,000 bill |
| J-005 | Medium | Fixed in code (Track A A-003); deployment check open | Login rate limit bypassed with a forged `X-Forwarded-For` |
| J-006 | Medium | Fixed | Nothing on screen could clear or bounce a pending cheque, so it never counted as cash |
| J-007 | Low | Fixed | The committed engine example files no longer matched the engine |
| J-008 | Low | Fixed (and a worse bug found, B-001) | Duplicate invoice numbers were accepted |
| J-009 | Low | Fixed (residual below) | Inviting a teammate revealed whether an email has an account |
| J-010 | Info | Fixed | The container made `/data` world-writable (`chmod 777`); it still runs as root on purpose |
| B-001 | High | Fixed | A bill number used by two parties was saved, then every forecast screen failed (duplicate event id) |
| B-002 | High | Fixed | Dates such as 9999-12-31 were accepted: a 500 on some routes, a poisoned forecast on others |
| B-003 | Medium | Fixed | A stock adjustment could take stock below zero through the API |
| B-004 | Medium | Fixed | The payment amount accepted `1e5` and `0x10`, and silently rounded three decimals |
| B-005 | Medium | Fixed | Add customer or supplier: server errors were unhandled, old values stayed in the form, credit days were not checked |
| B-006 | Low | Fixed | "Can I take this order?" sent `NaN` as the price when the price was text |
| B-007 | Medium | Fixed | Set-up "Load the demo business" and "Approve" replaced every record with no confirmation |
| B-008 | Medium | Fixed | WhatsApp links had no country code for a 10-digit number and linked landline numbers |
| B-009 | Low | Fixed | `transactions.csv` had no byte-order mark, so Excel showed Tamil and Hindi names as garbage |
| B-010 | Medium | Fixed | The favicon link was relative and broke on every `/app/...` page; no PNG or Apple icon |
| B-011 | Medium | Fixed | No 404 page; unknown addresses answered 200 with the app; a missing file such as `/.env` returned the app |
| B-012 | Medium | Added | No privacy page, terms, cookie notice, per-screen titles, share tags, `robots.txt` or `sitemap.xml` |
| B-013 | Medium | Fixed | Colour contrast failed WCAG AA on 45 page and theme combinations (grey text in all three themes, amber in Day) |
| B-014 | Low | Fixed | ARIA and focus: unlabelled stage bar, a scrollable table nobody could reach by keyboard, focusable network lines with no visible focus mark |
| B-015 | Low | Fixed | Touch targets under 44 px on phone and tablet widths |
| B-016 | Low | Fixed | Purchase order "Mark paid" and "Received" flashed an error on a double click |
| B-017 | Low | Fixed | The password show/hide button was skipped by the keyboard and 26 px wide |
| B-018 | Low | Fixed | Dialog descriptions were not linked to the dialog for screen readers |
| B-019 | Low | Fixed | Money and quantity fields accepted numeric strings such as `"100"` (coerced) |
| B-020 | Low | Fixed | Layout shift on slow connections: Khata 0.22, Settings 0.65, Today 0.16 (target 0.1) |
| B-021 | Medium | Fixed | App scripts and styles were sent uncompressed (about 580 KB of script) |
| B-022 | Info | Removed | `frontend/src/services/api.ts`: an unused older API client that stored a workspace id in the browser |
| B-023 | Low | Open | Hindi and Tamil: only navigation, Today and Book are translated |
| B-024 | Low | Open | Three API-only features have no screen (edit a party, create an invoice, set a promised date) |

---

## J-001 (High) Shared demo accounts could lock out other people

- **What:** `owner@ripple.demo` is a shared sign-in documented on the login page. Its owner could `DELETE /api/team/u-accountant`, invite new owners, or reset the shared business, for everyone.
- **Root cause:** the team and reset routes only checked the role, not whether the business is the shared one.
- **Fix:** `_not_shared_demo()` in `app_routes.py` returns `403 SHARED_DEMO_PROTECTED` for team invite, team remove and data reset on the shared demo business. "Load demo data" stays, because it restores the demo. A private "Open demo business" copy keeps full control.
- **Test:** `test_audit_round2.py::BUG001_*` (3 tests), Postman folder 14, journeys "supervisor cannot reach the shared demo team or data actions".

## J-002 (Medium) CSV formula in the party name
- **Root cause:** `export_transactions` guarded `details` and `reference` but wrote `party_name` raw. The datasheets were already guarded.
- **Fix:** one call to the shared guard for the party column. **Test:** `BUG002_CsvPartyNameCannotBeAFormula`, Postman "transactions CSV: formula guard".

## J-003 (Medium) Chunked body skipped the size limit
- **Root cause:** the limit read the `Content-Length` header. A chunked request has none.
- **Fix:** `BodyLimit` (pure ASGI middleware in `main.py`) counts bytes as they arrive, answers `413 BODY_TOO_LARGE` at once and tells the app the client is gone, so the handler never runs on a half-read body. **Test:** `BUG003_ChunkedUploadsAreCappedToo` (a 512 KB chunked body is refused, a small chunked body passes).

## J-004 (High) Two pending cheques paid one bill
- **Root cause:** the over-payment check compared the amount with what was *cleared*, so every pending cheque looked allowed.
- **Fix:** `repo.invoice_unallocated()` counts cleared plus pending money. A second cheque for the same money gets `AMOUNT_EXCEEDS_OUTSTANDING` with `pending_cheques_paise` in the details, and the screen says "a pending cheque already covers part of it". A bounce frees the money. Clearing a cheque re-checks the bill. **Test:** `BUG004_*` (4 tests), journeys 2, Postman folder 09.

## J-005 (Medium) Rate limit bypass
Already fixed in code as Track A A-003 (`client_ip` uses the Nth entry from the right, plus a per-account login limit). **Still open:** how many proxies Railway puts in front. Set `TRUSTED_PROXY_HOPS` to that number; until then one forged header per client can still choose its own limit bucket.

## J-006 (Medium) No way to clear or bounce a cheque
- **Fix:** Book > Ledger shows **Cleared** and **Bounced** on every pending row (named per party for screen readers). Errors from the server show above the table. **Test:** journeys 2 (buttons present; Bounced removes them and leaves cash unchanged; the bill can be paid again).

## J-007 (Low) Example files stale
- The six files under `fixtures/simulation/examples/` were regenerated with `generate_examples.py`. The real change: the delayed old receipt now also counts as a missed commitment (2 to 3), and `execution_log` is a new null field. **Test:** `BUG007_EngineExamplesMatchTheEngine` compares the checked-in outputs with a fresh run, so they cannot drift again.

## J-008 (Low) Duplicate invoice numbers, and B-001 (High) the crash behind it
- **J-008 fix:** a party cannot have two bills with the same number (compared ignoring case, spaces and punctuation: `INV 1`, `inv-1`, `INV/1`). `DUPLICATE_INVOICE_NUMBER`.
- **B-001 (found while fixing it):** the same number on two *different* parties was saved, and the forecast then failed with `DUPLICATE_ID` (the engine event id is built from the number), so Today, Book, Engine and the Guard all returned an error for that business until the bill was removed. There is no screen to remove a bill.
- **Fix:** the snapshot builder gives every event a unique id (`free_id`, a numeric suffix on a clash), and the fix text uses the real bill number instead of the id. **Test:** `BUG008_*` checks that four screens still load after the same number is used on two parties.

## J-009 (Low) Invite reveals who has an account
- **Fix:** both "already in your team" and "has an account in another business" now answer `409 CANNOT_INVITE` with an identical body. The invite limit is also 5 an hour per person. **Test:** `BUG009_*`, Postman "same email again says only that it cannot be done".
- **Residual:** an owner can still learn "this address is taken" by trying, at 5 tries an hour. Removing that needs invitations by email (a link, not a typed password), which is a feature, not a fix.

## J-010 (Info) Container permissions
- `chmod 777 /data` removed from the start command. The container still runs as root, on purpose: a Railway volume is mounted root-owned and a non-root user cannot write to it (the reason for the commit that added the `chmod`). Documented in the Dockerfile. Not tested here: Docker is not installed.

## B-002 (High) Extreme dates
- **What:** `invoice_date = 9999-12-31` raised `OverflowError` (HTTP 500); other dates were saved and broke the forecast afterwards (found by the schema-driven fuzz).
- **Fix:** one `Date` type for every date a user can type: 2000-01-01 to 2100-12-31, else `422 VALIDATION_ERROR` ("Date must be between 2000 and 2100"). **Test:** `N_DatesCannotPoisonTheForecast` (10 routes x 4 refused dates, and 10 routes x 2 allowed extremes with five screens checked after each).

## B-003 (Medium) Negative stock
- **Fix:** `stock_adjustment` refuses a removal larger than what is on hand (`NOT_ENOUGH_STOCK`, with the on-hand figure). Removing exactly what is there is allowed. Applies to materials and finished goods. **Test:** `N_StockCannotGoNegative` (3), journey "negative stock cannot be created", Postman.

## B-004 (Medium) Payment amount parsing
- The dialog used `Number(text) * 100`. `1e5` became Rs 1,00,000, `0x10` became Rs 16, `12.345` rounded silently. Now `parseMoney` (the parser the other forms use) with the reason under the field, and a ref guard so a fast double click records once. **Test:** journeys 1 (8 values refused, double click saves once).

## B-005 / B-006 Forms
- Add customer or supplier: a server error escaped as an unhandled promise; the form kept the last values after Cancel; credit days used `Number(x) || 0` ("abc" became 0). Fixed with `parseWhole`, try/catch, reset on close. "Can I take this order?": quantity and price use the shared parsers, with messages. **Tests:** journeys 3 and 4.

## B-007 Set-up replaced records without asking
- "Load the demo business" and "Approve and build my forecast" both delete the business's records. A confirmation dialog now says so ("Keep my records" is the safe default). **Test:** journey 7.

## B-008 WhatsApp numbers
- `wa.me` needs a country code. `98765 43210` produced `wa.me/9876543210`, which opens nothing. `whatsapp_number()` adds 91 to a 10-digit mobile (6 to 9), drops a trunk zero, keeps `+` numbers, and returns None for landlines and short numbers, in both the message draft and the party drawer (`whatsappNumber`). **Tests:** Python and vitest.

## B-009 CSV encoding
- `transactions.csv` now starts with a byte-order mark and declares UTF-8, like the datasheets. **Test:** `N_ExportsAndMessagesForTheScreens`, Postman.

## B-010 to B-012 Site basics
- `index.html`: absolute icon paths, PNG and Apple icons, description, Open Graph and Twitter tags, theme colour. A 1200x630 share image (52 KB) and the PNG icons are generated by `e2e/make-share-images.mjs`.
- `/privacy`, `/terms` (public, linked from sign-in), a cookie notice (one strictly necessary cookie, no analytics: dismissable, remembered), a title per screen, a description per public page, `robots.txt` (disallows `/app/`, `/api/`, `/setup`), `sitemap.xml` (the three public pages only), a 404 page inside and outside the app, and status 404 for unknown addresses and missing files. `PUBLIC_BASE_URL` makes the share image and sitemap absolute.
- The legal wording is a plain-language summary. It says the team should have it checked against the DPDP Act, 2023.

## B-013 to B-018 Accessibility
- axe-core (WCAG 2.0/2.1 A and AA) over 16 pages and states x 5 theme settings = 80 scans: 55 violation groups before, **0 after**. The grey text token was 3.6 to 4.4:1; now at least 4.6:1 in all three themes. Day-theme amber raised to 4.8:1. Dimmed cards in the Risk and Finance map no longer use opacity.
- Stage bar gets `role="img"`; the scrollable ledger table is a focusable named region; network lines are not focusable (they have no action); the password button is in the tab order with a 44 px target; dialog descriptions are linked.
- **Tests:** `e2e/audit-a11y.mjs`, `e2e/audit-keyboard.mjs`.

## B-015 Touch targets
- Under 768 px or on a touch screen every button, tab, chip, select and input is at least 44 px. What remains under 44 px: text links inside sentences and native checkboxes inside their label (the label is the target).

## B-019 Strict numbers
- All integer request fields are strict: `"100"`, `1.0` and `true` get `422`. The screens already send numbers.

## B-020 / B-021 Speed
- Measured on a phone profile (4x CPU slowdown, 1.6 Mbps, 150 ms latency, cold cache; `e2e/audit-speed.mjs`): layout shift Khata 0.22 to 0.002, Settings 0.65 to 0.0002, Today 0.16 to 0.10. Causes: the text font arrived after first paint and the header re-wrapped; Settings put its data sections above the ones already shown. Fixes: preload the main font; show Settings below its data only once loaded.
- Gzip for text (`SelectiveGzip`): the app shell goes from about 580 KB to about 190 KB of script. Tamil and Devanagari fonts use the smaller one-axis build (726 KB to 258 KB, 198 KB to 51 KB).
- Largest paint on that profile: Login 2.5 s, Khata 2.6 s, Today 2.7 s, Orders 2.9 s, Settings 3.3 s (target 2.5 s). Preloading the font traded about half a second of largest paint for stable layout; a real phone on a normal connection is faster.

## Open

- **B-023 Translation:** `lib/i18n.ts` has a few dozen strings (navigation, Today, Book, common). Khata, Orders, Inventory, Settings and Munim's panel stay English in Hindi and Tamil. It needs reviewed translations, not generated ones.
- **B-024 API-only features:** `PATCH /api/parties/{id}`, `POST /api/invoices`, `PATCH /api/invoices/{id}` have no screen. Nothing is broken; a person cannot correct a phone number or enter a bill by hand. Decision for Chirantan: add the screens or leave the routes.
- Also unresolved from Track A: A-006 (John's branch commits `node_modules`), A-007 (unmounted backend, now 10 routes), A-009 (demo limits), and the five decisions in `final-report.md` of Track A.

## Things the sweeps flagged that were not defects

- Clicking the password field, the sign-in button with empty fields, and a link to the page you are already on show "no observable effect": correct behaviour.
- The 404 page loads with status 404 by design.
- In the order screens, a control index shifted after earlier clicks changed the state (buttons removed after a purchase order was received); the same actions pass in the journeys.
- A download link reports a failed request because the navigation becomes a download (same as Track A).
