# Production readiness audit: Track B (Nandini), with the fixes for John's findings

Date: 15 Oct 2026. Branch `fix/ch-trackA` in `C:\ripple` (cut from `main` `4a8d820b`). Nothing committed or pushed.
Scope: Login, Setup, Khata (party drawer, reminders, composer, datasheets), Orders (sales stages and Undo, purchase orders, "Can I take this order?"), Inventory (materials, recipes, movements, filters), Settings (every section), the payment dialog; form validation, exports, languages and formats, mobile and tablet layouts, colour contrast, keyboard and screen-reader use, and the website basics from the notebook. Also the endpoint fuzz for the routes those screens call, and the defects in John's report that this codebase shared.
Not in this audit (Track A or C): Today, Engine, Book (except the Ledger buttons), Munim, authentication internals, dependency audit, git-history secret scan, Docker build, the deployed site.

## 1. How it was tested

| Tool | Status |
|---|---|
| Playwright (`playwright-core`, installed Chrome) | Used. 65 user-journey checks, a control sweep of every control, axe-core, keyboard, speed. |
| Microsoft Edge | The 65 journeys were rerun in Edge: 65 of 65 pass. |
| Firefox, Safari (WebKit), a real phone | **Not available** in this environment. Not tested. |
| Newman (Postman's runner) | Used, locally. The Postman MCP server and the Postman CLI were not available, so nothing was published to a Postman workspace. |
| axe-core 4.10.2 | Used for WCAG 2.0/2.1 A and AA, including colour contrast. |
| Lighthouse | Not installed. The same metrics (first and largest paint, layout shift) were read from the browser on a phone profile. |
| Screen readers (NVDA, VoiceOver) | **Not tested.** Only automated checks and a keyboard walk. |
| Backend `unittest`, frontend `tsc`, `vitest`, `vite build` | Used. |

Environment: the app served from `C:\ripple` with an in-memory database and `RIPPLE_TODAY=2026-10-14` (testing only), no AI key. All data synthetic, in private sandbox businesses. Nothing was sent to a real service.

## 2. Results

| Check | Before | After |
|---|---|---|
| Backend `unittest` | 158 passed, 1 skipped (end of Track A) | **188 passed, 1 skipped** (new: 26 regression tests, 4 fuzz tests); one earlier run failed once with a risk-job timeout while browsers and Newman shared the CPU, and passed alone and in the clean run |
| Schema-driven fuzz (`test_trackB_fuzz.py`) | not run | 71 routes, over 2,000 hostile bodies, ids and query values: no 500, no stack trace, no path in any answer. (The first run found B-002.) |
| `tsc -b`, `vitest`, production build | 85 vitest | 0 type errors, 92 vitest, build OK |
| Track B journeys (Chrome) | first draft: 4 failures, all explained (a test that expected a disabled button where the form validates on submit, two clashes of test data with the shared in-memory database, a wrong ledger row) | **65 of 65 pass**, no console or page error |
| Same journeys in Edge | not run | **65 of 65 pass** |
| axe-core, 16 pages and states x 5 theme settings (80 scans) | 55 violation groups (45 colour contrast, 5 scrollable region, 5 ARIA) | **0** |
| Layout at 360, 390, 768 px; reflow at 320 px and at 720x450 (200% zoom) | no horizontal scroll | no horizontal scroll |
| Tap targets | many under 44 px at phone widths | 44 px for every control; text links inside sentences and native checkboxes inside a label are exempt |
| Keyboard walk, 14 pages, 376 tab stops | focusable network lines with no focus mark | every stop visible, named and marked (the two date fields report no mark in the script; checked directly, they have a 1 px outline) |
| Page speed, phone profile, cold cache | layout shift 0.16 / 0.22 / 0.65 | 0.10 / 0.002 / 0.0002; largest paint 2.5 to 3.3 s |
| Postman collection with Newman | n/a | **273 requests, 413 assertions, 0 failed** (Track A and Track B folders, supervisor folders included) |
| Control sweep, 1440 px and 390 px | not run | 683 observations, **0 FAIL** (PASS 573, PASS explained 25, NOT APPLICABLE 73, BLOCKED 12) |

## 3. Findings

All 34 items are in `bug-ledger.md` with cause, fix and test. By severity: High 4 (J-001, J-004, B-001, B-002, all fixed), Medium 14 (J-005 is fixed in code with its deployment check open), Low 14, Info 2. Nothing Critical. 31 are fixed or added, 3 stay open (J-005 deployment half, B-023, B-024).

The ones that mattered most:
- **B-001 / B-002** could take a business's forecast down for good with one ordinary-looking entry (a bill number used twice, or a far-future date), and there is no screen to undo either.
- **J-004** let more money be recorded as received than was owed.
- **J-001** let a stranger lock the shared demo accounts out of the demo during an event.

## 4. Notebook checklist items (Track B)

| ID | Result | Evidence |
|---|---|---|
| N1 Privacy page | Done: `/privacy`, linked from sign-in. Wording is a summary and says the team should check it against the DPDP Act | `Legal.tsx` |
| N2 Terms | Done: `/terms` | |
| N5 Cookie notice | Done: one strictly necessary cookie, no analytics; dismissable | journey 8 |
| N6 Titles and descriptions | Done: one title per screen, a description per public page | `audit-a11y.mjs` basics (all pass) |
| N7 Social preview | Done: Open Graph and Twitter tags, a 1200x630 image of 52 KB. Set `PUBLIC_BASE_URL` in production so the image address is absolute | |
| N8 Favicon | Done: absolute path, SVG, 32 px PNG, Apple touch icon; loads on every route | basics |
| N9, N10 Sitemap, robots | Done: dynamic, public pages only; `/app/`, `/api/`, `/setup` disallowed | `test_audit_round2.py` |
| N11 Load speed | Measured, not Lighthouse. Gzip added, fonts split, layout shift fixed. Largest paint is 2.5 to 3.3 s on a slow phone profile, above the 2.5 s target on three screens | `page-speed.json` |
| N12 Alt text | No `<img>` exists in the app. SVG icons are `aria-hidden`; charts have names. axe passes `svg-img-alt`, `image-alt`, `role-img-alt`. The runway and futures charts have table views | axe |
| N13 Image size | The only image is the 52 KB share image | |
| N15 404 | Done, inside and outside the app, real 404 status; the API still answers JSON | journey 8 |
| N16 Contrast | Done: 0 axe violations in Night, Day, Lamp and high contrast | axe |
| N17 Mobile | Done: no overflow at 320, 360, 390, 768 and 720x450; 44 px targets | |
| N18 Broken links | Every `href` and `navigate` target on the pages swept resolves (the control sweep follows each link). External links carry `rel="noopener noreferrer"` | sweep |
| N19 Form validation | 14 forms checked (sign in, payment, add party, what-if order, new purchase order, material, stock adjustment, profile, buffer, credit days, recurring expense, credit facility, invite, set-up text); client and server rules agree; fixes B-004 to B-006 | journeys 1 to 7, 11 |
| X7 Order undo and stock | Forward then back, purchase undo, no negative stock (B-003), books checks pass after undo | journey 4, 11 |
| X10 CSV and export safety | Formula guard on every export, byte-order mark, role limits (supervisor 403) | Postman, tests |
| X11 Languages | Hindi and Tamil: no raw keys, no overflow at 390 px. **Only navigation, Today and Book are translated** (B-023) | journey 9 |
| X12 Accessibility | Keyboard use, focus return and trap in dialogs, labels, reflow checked. Reduced motion and screen readers not tested | audits |
| X13 Browser matrix | Chrome and Edge pass. Firefox, Safari and a real phone not available | |
| X20 Dead and noisy UI | An unused API client was removed; no filler text found | B-022 |
| X21 Message drafts and links | WhatsApp numbers fixed (B-008); no placeholders in the drafts in English, Tamil, Hindi, polite and firm | tests |
| X26 Duplicate safety | Double click on Record payment saves once; stage and purchase buttons are disabled while a request runs | journeys 1, 4 |

## 5. Blocked or untested

Firefox, Safari, a real phone; screen readers; reduced-motion behaviour; load with many rows; the deployed site (HTTPS, cookie `Secure`, the proxy chain); the Docker build; the AI-backed set-up path (no key, so only the no-key message was exercised); the voice controls on Set up (headless Chrome has no microphone); Hindi and Tamil text beyond the translated screens; a Lighthouse run.

## 6. Release-readiness recommendation (Track B scope)

**Fit for the demo and for peer testing.** Before a public deployment: set `TRUSTED_PROXY_HOPS` (A-003), set `PUBLIC_BASE_URL`, have the legal pages checked, supply reviewed Hindi and Tamil text or say clearly that only part of the app is translated, and run a screen reader and a real phone over Khata, Orders and the payment dialog. No Critical finding is open; the High findings are fixed except the deployment half of J-005.
This is evidence of what was tested, not proof that no defect remains.
