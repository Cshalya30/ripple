"""[REPLAY — not a live call] Re-send a saved Bolna webhook payload to a running Ripple server, for
offline rehearsal of the result screen when no real call can be placed.

Every log line and the request itself are clearly a replay, never presented as a live call:

    python -m scripts.replay_webhook fixtures/voice/sample_completed.json --base-url http://127.0.0.1:8000

The target server's BOLNA_WEBHOOK_SECRET must be known (same .env the server is running with); pass it
with --token, or set BOLNA_WEBHOOK_SECRET in the environment this script runs in.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("payload", help="Path to a saved Bolna webhook JSON payload.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--token", default=os.getenv("BOLNA_WEBHOOK_SECRET", ""))
    args = parser.parse_args()

    if not args.token:
        print("[REPLAY] No webhook token given (--token or BOLNA_WEBHOOK_SECRET). The server will reject this.", file=sys.stderr)

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    payload["replay"] = True  # so the server (and the UI, via GET /voice/calls/{id}) can label this, never as a live call
    execution_id = payload.get("execution_id", "unknown")
    url = f"{args.base_url.rstrip('/')}/webhooks/bolna?token={args.token}"

    print(f"[REPLAY] Not a live call. Replaying saved payload for execution_id={execution_id} to {url}")
    response = httpx.post(url, json=payload, timeout=20.0)
    print(f"[REPLAY] Response: {response.status_code} {response.text}")


if __name__ == "__main__":
    main()
