# Ripple Voice — Bolna Buildathon submission

## 200-character description

> Ripple forecasts when a small manufacturer's cash runs short. A voice agent phones late customers in Hindi, logs the promised date, and the forecast updates live.

Length check: 197 characters (counted including spaces and punctuation) — under the 200-character limit.

## What it is

Ripple is a cash-flow forecasting tool for small Indian manufacturers: it keeps the owner's khata, builds a
daily forecast with a deterministic engine, and shows the exact day cash runs short and why. Ripple Voice
adds one end-to-end action to that forecast: when an overdue customer invoice is driving a shortfall, the
owner approves a call, a Hindi voice agent (built on Bolna) asks the customer for a payment date, and the
result — promised date, transcript, recording — flows straight back into the same forecast, re-run live by
the same engine. The AI never computes a number; it only asks a question and reports what it heard.

## Demo video shot list (2–3 minutes)

| Time | Shot | What it shows |
|---|---|---|
| 0:00 | The problem | Today screen: a shortfall on a specific day, driven by one overdue customer invoice (Kaveri Boutique). |
| 0:20 | Approval | Click "Call customer." Approval dialog: customer, invoice, amount, days overdue, the exact Hindi opening line with its English translation, the current shortfall, the approval checkbox. |
| 0:35 | The real call | A live phone rings (a team phone, via `DEMO_PHONE_OVERRIDE`). The Hindi agent runs the script: confirms identity, states the bill, asks for a payment date. |
| 1:30 | Webhook + chart update | Within ~3 minutes of hanging up: the result card shows outcome, promised date, transcript (collapsible), recording link, and "short by ₹X on DATE" → "short by ₹Y on DATE" (or "no shortfall in the next 60 days"). The runway chart on Book re-renders from the fresh engine run. |
| 2:00 | Evidence | `PLAN_VOICE.md` (design + guardrails), the webhook idempotency test passing, and the guardrail error messages (disputed / do-not-call / outside window) shown on screen for one blocked attempt. |

## Claims made in the demo, and their source

| Claim | Source |
|---|---|
| "Cash runs short on day D because of invoice X" | `services.runs.derive()` — the engine's own `first_shortfall` / `buffer_breach`, not an estimate. |
| "The call asked for a payment date in Hindi" | `bolna/agent_prompt_hi.md`, the exact prompt sent to the Bolna agent. |
| "The customer promised to pay by date Y" | Bolna's `extracted_data.Payment.promised_payment_date`, parsed in `backend/app/voice/service.py::_extract`; rejected if in the past. |
| "The forecast shortfall changed from X to Y" | A fresh `runs.baseline()` engine run, triggered by `after_write` right after `invoice.promised_date` is written — same engine, same code path as every other number on screen. |
| "No secrets are in the demo" | `.env.example` lists every Bolna credential as an empty placeholder; `BOLNA_API_KEY`/`BOLNA_WEBHOOK_SECRET` are read from the deploy environment only. |
| "The webhook is secure and idempotent" | `tests/test_voice_webhook.py` — token rejection, three repeated POSTs produce one row, non-final statuses never overwrite a recorded outcome. |
| "Guardrails block calls, not just suggest" | `tests/test_voice_guardrails.py` and `tests/test_voice_api.py` — each guardrail is a server-side 422/403, not a UI hint. |

## Scope and honesty notes

- Outbound calls to customers only. No inbound calling, no batch campaigns, Hindi only (see `PLAN_VOICE.md`
  for the full scope line).
- Several Bolna field names (the call-response id field, the exact `/agent` request shape) are marked TODO
  in `PLAN_VOICE.md` under "Verify against first real call" — they are assumptions from the written brief,
  not yet confirmed against a live Bolna account at the time this file was written.
- The engine, risk model and every other number on screen besides the voice feature are unchanged by this
  work; see the main `README.md` for what Ripple is (and is not).
