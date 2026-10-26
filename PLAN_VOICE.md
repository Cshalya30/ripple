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
- `frontend/src/lib/store.ts` — `voiceCallInvoiceId: string | null`, `openVoiceCall(invoiceId)`.
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
+ party row), call window (09:00–19:00 Asia/Kolkata, env-configurable), and `invoice.last_called_at`
(a date, not a timestamp, stamped with `today()` at call time) for "already called this invoice today" —
simpler and immune to timezone/wall-clock drift than querying `voice_call` by `created_at`.
`DEMO_PHONE_OVERRIDE` substitutes the dialled number only; guardrails still run against the real customer/invoice.

## Background poller
`main.py`'s `lifespan` calls `voice_service.start_background_poller()` on startup and `stop_background_poller()`
on shutdown: a daemon thread calling `poll_pending()` every 60s. Gated on `BOLNA_API_KEY` being set, so it
never starts in tests (which don't set that key) and is a safe no-op without a real account.

## Engine invariant
The voice flow never computes a date or amount. A call only ever writes `invoice.promised_date` (via the
existing `repo.set_promised_date`) and triggers the existing `after_write` → engine re-run. Before/after
shortfall on the `voice_call` row are copied from `run.derived["summary"]` on each side of that write.

## Verify against first real call (every guessed Bolna field name)

Everything below is an assumption taken from the written Bolna brief, not yet exercised against a real
account. Fix these in the listed file the moment a real call or a real `/agent` response disagrees:

- `backend/app/voice/bolna_client.py::execution_id_from_call_response` — tries `execution_id`, `id`,
  `call_id` on the `POST /call` response; the real key name is unconfirmed.
- `backend/app/voice/service.py::STATUS_MAP` — assumes Bolna sends `completed` / `no-answer` / `busy` /
  `failed` as the terminal `status` values, and treats anything else (`ringing`, `in-progress`,
  `call-disconnected`, …) as non-final. Not verified against the real set of status strings.
- `backend/app/voice/service.py::process_result` — assumes `telephony_data.recording_url`, top-level
  `duration` (seconds) and `cost` (rupees, converted to paise) on a `completed` payload. Field names and
  units are assumed, not confirmed.
- `backend/app/voice/service.py::_extract` — assumes `extracted_data.Payment.<field>.subjective` /
  `.objective` per the dispositions brief; real responses may nest differently.
- `BOLNA_AUTH_SCHEME` (`bearer` vs raw key) — implemented as a config switch (`bolna_client._headers`),
  untested against the real API; try `bearer` first.
- `scripts/bolna_setup.py::upsert_agent` — the `POST /agent` / `PUT /agent/{id}` request body
  (`agent_config`, `agent_prompts`, `tasks`) is a guess at the real agent-creation shape. If it's refused,
  read the error body and fix the shape here, or fall back to `bolna/DASHBOARD_SETUP.md`.
- `scripts/bolna_setup.py::upsert_dispositions` — assumes `POST /dispositions/bulk` takes
  `{agent_id, dispositions: [...]}` with each disposition shaped like `bolna/extractions.json`.
- Webhook IP allowlist (`13.203.39.153`, `13.126.9.249`, `13.202.133.53`) — taken from the brief, not
  independently verified; `BOLNA_IP_ALLOWLIST` defaults to `false` (token-only) until confirmed.
- Railway `PUBLIC_BASE_URL` / webhook reachability — needs a live deploy; see `DEPLOY_VOICE.md`.
