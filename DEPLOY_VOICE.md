# Deploying Ripple Voice

## Which branch, which repo

- GitHub remote: `origin` → `https://github.com/Manipal-Hackathon-2026/HitNRun.git`.
- This work is on branch `feature/ripple-voice` (branched from `feature/ripple-v2`).
- **Not independently confirmed from this machine**: whether the Railway service actually builds from this
  GitHub repo/branch, or from a different fork or branch. Check the Railway dashboard → your service →
  Settings → Source, and merge `feature/ripple-voice` into whichever branch Railway deploys before relying
  on a live demo.

## Railway environment variables to set

In the Railway service's Variables tab, in addition to whatever is already set for the base app
(`DEMO_PASSWORD`, `GROQ_API_KEY`, etc. — see `README.md` → Environment variables), add:

| Variable | Value |
|---|---|
| `PUBLIC_BASE_URL` | the service's own public URL, e.g. `https://hitnrun-production.up.railway.app` (no trailing slash) |
| `BOLNA_API_KEY` | from your Bolna account |
| `BOLNA_AUTH_SCHEME` | `bearer` (default) or `raw` — try `bearer` first |
| `BOLNA_AGENT_ID` | printed by `scripts/bolna_setup.py`, or from the dashboard fallback |
| `BOLNA_WEBHOOK_SECRET` | a random string you generate, e.g. `openssl rand -hex 16` |
| `DEMO_PHONE_OVERRIDE` | the team's phone number, E.164 format (`+91XXXXXXXXXX`), for the live demo |
| `CALL_WINDOW_START` / `CALL_WINDOW_END` | `9` / `19` normally; widen temporarily if rehearsing outside that window |
| `BOLNA_IP_ALLOWLIST` | `false` while testing; consider `true` once the webhook is confirmed working |

After setting these, redeploy (Railway redeploys automatically on a variable change, or trigger one
manually).

## Confirm the webhook is reachable

```bash
# Should be 403 (bad token) — proves the route exists and the token check runs:
curl -i -X POST "https://<your-app>.up.railway.app/webhooks/bolna?token=wrong" \
  -H "Content-Type: application/json" -d '{"execution_id": "smoke-test", "status": "completed"}'

# Should be 200 (accepted) with the real secret:
curl -i -X POST "https://<your-app>.up.railway.app/webhooks/bolna?token=$BOLNA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" -d '{"execution_id": "does-not-exist", "status": "completed"}'
```

The second call returns 200 even though `execution_id` doesn't match a real call (unknown executions are
ignored, not errors) — that's expected and just confirms the route accepts traffic.

## Run `bolna_setup.py` against production

```bash
cd HitNRun
set -a; source .env; set +a   # or export the Railway variables locally some other way
python -m scripts.bolna_setup
```

This needs `BOLNA_API_KEY`, `PUBLIC_BASE_URL` (the Railway URL) and `BOLNA_WEBHOOK_SECRET` set locally to
the same values as on Railway, so the webhook URL it registers with Bolna points at the live server. It
prints `BOLNA_AGENT_ID` — put that in Railway's variables too if you didn't already have one.

If the script fails because the real Bolna API shape differs from what it assumes, use
`bolna/DASHBOARD_SETUP.md` instead and set `BOLNA_AGENT_ID` manually.

## One-call smoke test checklist

1. Open the live app, sign in as owner, go to Today or Book.
2. Confirm the "Demo mode" badge is visible on the Call customer dialog (proves `DEMO_PHONE_OVERRIDE` is
   read from the live environment).
3. Approve a call on the seeded overdue invoice (Kaveri Boutique). The team phone should ring within a few
   seconds.
4. Answer in Hindi, give a payment date, hang up.
5. Within about 3 minutes, refresh the call status in the dialog (it polls automatically): outcome,
   promised date, transcript and recording link should appear.
6. Reopen Today/Book and confirm the shortfall date/amount changed (or disappeared) — this is the real
   engine re-run, not a guess.
7. If nothing arrives after ~3 minutes, the fallback poller should have already run — `main.py`'s startup
   calls `voice_service.start_background_poller()`, which runs `poll_pending()` every 60s in a daemon
   thread whenever `BOLNA_API_KEY` is set (it never starts in tests, which don't set that key). As a last
   resort, use `scripts/replay_webhook.py` against a *saved* payload from a working call to rehearse the
   UI, clearly logged as a replay.
8. Record the demo per `SUBMISSION.md`'s shot list.
