# Manual fallback: setting up the Ripple Voice agent on platform.bolna.ai

Use this if `python -m scripts.bolna_setup` fails because the real `/agent` or `/dispositions` request
shape differs from what's assumed in `scripts/bolna_setup.py` (see its TODO and PLAN_VOICE.md).

1. **Create the agent.** On platform.bolna.ai, create a new agent named `ripple-voice-hi`.
   - Voice: Hindi (hi-IN), female voice. Sarvam is the suggested Indian-voice provider (see Bolna's
     `/docs/sarvam-voice.md`, `/docs/sarvam-transcriber.md`).
   - System / task prompt: paste the full contents of `bolna/agent_prompt_hi.md`.
   - Variables used by the prompt: `business_name`, `owner_name`, `customer_name`, `invoice_no`, `amount`,
     `due_date`, `days_overdue`. These are injected per call via `user_data` on `POST /call`.

2. **Set the webhook.** In the agent's config, set the webhook URL to:

   ```
   {PUBLIC_BASE_URL}/webhooks/bolna?token={BOLNA_WEBHOOK_SECRET}
   ```

   Both values come from your `.env`. The webhook is fired several times per call — the backend handles
   this idempotently (see `backend/app/voice/service.py::process_result`).

3. **Copy the agent id.** Put it in `.env` as `BOLNA_AGENT_ID`.

4. **Add dispositions.** Under the agent's Dispositions / Extractions tab, add five fields in category
   `Payment`, matching `bolna/extractions.json`:
   - `promised_payment_date` — subjective, timestamp: "If the customer committed to a full payment date, extract it."
   - `call_outcome` — objective, options `promised | partial | disputed | callback | refused | wrong_person | NA`.
   - `partial_amount` — subjective, numeric: "If the customer agreed to pay part, how much in rupees?"
   - `partial_payment_date` — subjective, timestamp.
   - `do_not_call` — objective, options `yes | no`.

5. **Test extraction without a real call.** Use `POST /v2/agent/{agent_id}/dispositions/test` with a sample
   transcript, or the dashboard's equivalent "test extraction" tool, before placing the first live call.

6. **Record the agent id and anything that differed** from `scripts/bolna_setup.py`'s assumptions in
   `PLAN_VOICE.md` under "Verify against first real call", so the script can be fixed afterwards.
