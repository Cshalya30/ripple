# PLAN_VOICE.md — Ripple Voice (Bolna Buildathon)

## Deviations from the brief (repo reality)
- The repo is **one shared SQLite DB**, every row scoped by `business_id` (not one file per tenant). So the
  "execution_id -> tenant_id shared registry" collapses to one column on a new table in the existing DB; no
  separate store needed. `user_data.business_id` is still sent to Bolna and echoed back as a cheap cross-check,
  but the DB row is the source of truth.
- No credentials yet (Bolna key, phone, Railway HTTPS). Everything is built behind `voice/bolna_client.py`;
  real HTTP calls are mocked in tests. `bolna_setup.py` is written but not run for real.
- "Customer or invoice flags": `disputed` and `last_called_at` live on **invoice** (per-bill); `do_not_call`
  lives on **party** (don't call this customer again at all). Max-1-call-per-invoice-per-day is enforced by
  querying `voice_call`, not a counter column (avoids races).

## Files
- `backend/app/core/db.py` — `voice_call` table, `invoice.disputed`, `party.do_not_call`, `invoice.last_called_at`.
- `backend/app/voice/bolna_client.py` — thin HTTP wrapper (`place_call`, `get_execution`, agent/disposition setup).
- `backend/app/voice/guardrails.py` — approval, time window, 1/day, do-not-call, disputed, overdue, phone checks.
- `backend/app/voice/service.py` — `preview`, `create_call`, `process_result` (shared by webhook + poller),
  `poll_pending` (fallback).
- `backend/app/api/voice_routes.py` — `/api/voice/calls/preview`, `/api/voice/calls` (POST/GET), `/api/voice/calls/{id}`.
  Webhook `/webhooks/bolna` is **outside `/api`** (mounted directly in `main.py`) because the CSRF/body-limit
  middleware only guards `/api/*`, and Bolna cannot send `X-Ripple`.
- `scripts/bolna_setup.py`, `bolna/agent_prompt_hi.md`, `bolna/extractions.json`, `bolna/DASHBOARD_SETUP.md`.
- `scripts/replay_webhook.py` — replays a saved payload against `process_result` directly (not a live call).
- `frontend/src/lib/store.ts` — `voiceCall: { invoiceId } | null`, `openVoiceCall`.
- `frontend/src/components/VoiceCallDialog.tsx` — modeled on `Composer.tsx`: preview, approve checkbox, then
  polls `GET /voice/calls/{id}` for status/result (outcome, transcript, recording, before/after shortfall).
- `frontend/src/pages/Today.tsx` (`DoToday`, kind `CHASE`) and `Book.tsx` (`why_the_dip`, kind `LATE_RECEIPT`):
  add a "Call customer" button that opens the dialog, next to the existing Remind button.
- `backend/app/services/views.py` — `why_the_dip`'s `LATE_RECEIPT` item gains `invoice_id` (from
  `meta["events"][event_id]["record_id"]`) so the frontend has something to call.
- Tests: `tests/test_voice_api.py`, `tests/test_voice_guardrails.py`, `tests/test_voice_webhook.py`.
- `requirements.txt`: no new dependency — `httpx` is already present.

## Guardrail source of truth
`invoice.disputed`, `party.do_not_call`, overdue (`days_overdue > 0`), valid phone (`position.open_invoices`
+ party row), call window (09:00–19:00 Asia/Kolkata, env-configurable), and a `voice_call` query for "already
called this invoice today". `DEMO_PHONE_OVERRIDE` substitutes the dialled number only; guardrails still run
against the real customer/invoice.

## Engine invariant
The voice flow never computes a date or amount. A call only ever writes `invoice.promised_date` (via the
existing `repo.set_promised_date`) and triggers the existing `after_write` → engine re-run. Before/after
shortfall on the `voice_call` row are copied from `run.derived["summary"]` on each side of that write.

## Open issues (stub until real credentials exist)
- TODO: exact Bolna `POST /call` / `POST /dispositions` response shapes are assumed per the brief; verify once
  `BOLNA_API_KEY` exists and adjust `bolna_client.py` parsing.
- TODO: `BOLNA_AUTH_SCHEME` (`bearer` vs raw key) — implemented as a config switch, untested against the real API.
- TODO: real webhook IP allowlist values trusted from the brief, not independently verified.
- TODO: Railway `PUBLIC_BASE_URL` / webhook reachability — needs a live deploy before `bolna_setup.py` can run.
