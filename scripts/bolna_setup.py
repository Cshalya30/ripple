"""Create or update the Ripple Voice Bolna agent and its dispositions from the files committed in bolna/.

Idempotent: run it again any time the prompt or dispositions change. Reads BOLNA_API_KEY, BOLNA_AUTH_SCHEME,
PUBLIC_BASE_URL and BOLNA_WEBHOOK_SECRET from the environment (.env). Prints the agent_id to put in .env as
BOLNA_AGENT_ID.

    python -m scripts.bolna_setup

TODO (PLAN_VOICE.md "Verify against first real call"): the exact /agent create/update request shape and the
webhook field name inside agent_config are assumed from the Bolna docs brief, not run against a real account
yet. If the request below is refused, read the error body, fix the shape here, and update PLAN_VOICE.md.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://api.bolna.ai"


def _headers() -> dict[str, str]:
    key = os.getenv("BOLNA_API_KEY", "")
    if not key:
        print("BOLNA_API_KEY is not set. Nothing to do.", file=sys.stderr)
        sys.exit(1)
    scheme = os.getenv("BOLNA_AUTH_SCHEME", "bearer").strip().lower()
    value = f"Bearer {key}" if scheme == "bearer" else key
    return {"Authorization": value, "Content-Type": "application/json"}


def _webhook_url() -> str:
    base = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
    secret = os.getenv("BOLNA_WEBHOOK_SECRET", "")
    if not base or not secret:
        print("Set PUBLIC_BASE_URL and BOLNA_WEBHOOK_SECRET before running this (needed for the webhook URL).", file=sys.stderr)
        sys.exit(1)
    return f"{base}/webhooks/bolna?token={secret}"


def upsert_agent(client: httpx.Client, existing_agent_id: str | None) -> str:
    prompt = (ROOT / "bolna" / "agent_prompt_hi.md").read_text(encoding="utf-8")
    payload = {
        "agent_name": "ripple-voice-hi",
        "agent_config": {
            "webhook_url": _webhook_url(),
            "agent_welcome_message": "Namaste",
        },
        "agent_prompts": {"task_1": {"system_prompt": prompt}},
        "tasks": [{"task_type": "conversation", "voice": {"language": "hi-IN"}}],
    }
    if existing_agent_id:
        response = client.put(f"/agent/{existing_agent_id}", json=payload)
    else:
        response = client.post("/agent", json=payload)
    if response.status_code >= 400:
        print(f"Agent upsert failed ({response.status_code}): {response.text}", file=sys.stderr)
        print("See bolna/DASHBOARD_SETUP.md for the manual fallback.", file=sys.stderr)
        sys.exit(1)
    body = response.json()
    agent_id = body.get("agent_id") or body.get("id") or existing_agent_id
    if not agent_id:
        print(f"Could not find an agent id in the response: {body}", file=sys.stderr)
        sys.exit(1)
    return str(agent_id)


def upsert_dispositions(client: httpx.Client, agent_id: str) -> None:
    config = json.loads((ROOT / "bolna" / "extractions.json").read_text(encoding="utf-8"))
    dispositions = config["dispositions"]
    for item in dispositions:
        item.setdefault("agent_id", agent_id)
    response = client.post("/dispositions/bulk", json={"agent_id": agent_id, "dispositions": dispositions})
    if response.status_code >= 400:
        print(f"Dispositions upsert failed ({response.status_code}): {response.text}", file=sys.stderr)
        print("See bolna/DASHBOARD_SETUP.md for the manual fallback.", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=30.0) as client:
        agent_id = upsert_agent(client, os.getenv("BOLNA_AGENT_ID") or None)
        upsert_dispositions(client, agent_id)
    print(f"Done. Put this in .env:\nBOLNA_AGENT_ID={agent_id}")


if __name__ == "__main__":
    main()
