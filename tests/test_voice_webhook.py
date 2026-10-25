"""Bolna webhook: token check, idempotency across repeated POSTs, every outcome path, malformed or
missing extracted_data, past dates rejected, and the fallback poller sharing the same processing path."""
from __future__ import annotations

import os
import unittest
import uuid
from unittest import mock

from support import sandbox

from backend.app.core.db import query, query_one
from backend.app.voice import bolna_client, service as voice_service

WEBHOOK_SECRET = "test-secret"


class VoiceWebhookBase(unittest.TestCase):
    def setUp(self):
        os.environ["BOLNA_WEBHOOK_SECRET"] = WEBHOOK_SECRET
        os.environ["BOLNA_IP_ALLOWLIST"] = "false"
        os.environ["CALL_WINDOW_START"], os.environ["CALL_WINDOW_END"] = "0", "24"
        self.c = sandbox()
        email = self.c.get("/api/me").json()["user"]["email"]
        self.business_id = query("SELECT business_id FROM user WHERE email = ?", (email,))[0]["business_id"]
        party = self.c.post("/api/parties", json={"kind": "CUSTOMER", "name": "Kaveri Boutique", "phone": "9876543210"}).json()["party"]
        self.party_id = party["id"]
        invoice = self.c.post("/api/invoices", json={
            "party_id": self.party_id, "number": "INV-WEBHOOK-1", "amount_paise": 50_000_00,
            "invoice_date": "2026-08-01", "due_date": "2026-08-15",
        }).json()["invoice"]
        self.invoice_id = invoice["id"]
        # execution_id is UNIQUE across the whole table (real Bolna ids are globally unique); tests share one
        # in-memory DB for the whole run, so each test needs its own id rather than a repeated literal.
        self.execution_id = f"exec-{uuid.uuid4().hex[:10]}"
        with mock.patch.object(bolna_client, "place_call", return_value={"execution_id": self.execution_id}):
            created = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True})
        self.assertEqual(created.status_code, 200, created.text)
        self.call_id = created.json()["voice_call"]["id"]

    def post(self, payload, token=WEBHOOK_SECRET):
        # No X-Ripple header: Bolna cannot send it, and the webhook route must not require it.
        return self.c.post(f"/webhooks/bolna?token={token}", json=payload, headers={})


class TokenTests(VoiceWebhookBase):
    def test_wrong_token_is_rejected(self):
        response = self.post({"execution_id": self.execution_id, "status": "completed"}, token="nope")
        self.assertEqual(response.status_code, 403)

    def test_missing_secret_configured_rejects_everything(self):
        os.environ.pop("BOLNA_WEBHOOK_SECRET", None)
        response = self.post({"execution_id": self.execution_id, "status": "completed"}, token="")
        self.assertEqual(response.status_code, 403)

    def test_correct_token_is_accepted(self):
        response = self.post({"execution_id": self.execution_id, "status": "in-progress"})
        self.assertEqual(response.status_code, 200)


class OutcomeTests(VoiceWebhookBase):
    def _completed(self, **extracted_payment):
        return {
            "execution_id": self.execution_id, "status": "completed", "transcript": "hello",
            "telephony_data": {"recording_url": "https://example.com/r.mp3"}, "duration": 30, "cost": 2,
            "extracted_data": {"Payment": extracted_payment},
        }

    def test_promised_outcome_writes_promised_date(self):
        self.post(self._completed(call_outcome={"objective": "promised"}, promised_payment_date={"subjective": "2026-12-25"}))
        invoice = query_one("SELECT promised_date FROM invoice WHERE id = ?", (self.invoice_id,))
        self.assertEqual(invoice["promised_date"], "2026-12-25")

    def test_partial_outcome_records_amount_and_date(self):
        self.post(self._completed(call_outcome={"objective": "partial"}, partial_amount={"subjective": 1500},
                                   partial_payment_date={"subjective": "2026-12-10"}))
        call = query_one("SELECT partial_amount_paise, partial_date FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(call["partial_amount_paise"], 150_000)
        self.assertEqual(call["partial_date"], "2026-12-10")

    def test_disputed_outcome_flags_the_invoice(self):
        self.post(self._completed(call_outcome={"objective": "disputed"}))
        invoice = query_one("SELECT disputed FROM invoice WHERE id = ?", (self.invoice_id,))
        self.assertEqual(invoice["disputed"], 1)

    def test_refused_with_do_not_call_flags_the_party(self):
        self.post(self._completed(call_outcome={"objective": "refused"}, do_not_call={"objective": "yes"}))
        party = query_one("SELECT do_not_call FROM party WHERE id = ?", (self.party_id,))
        self.assertEqual(party["do_not_call"], 1)

    def test_wrong_person_outcome_stores_but_changes_nothing_else(self):
        self.post(self._completed(call_outcome={"objective": "wrong_person"}))
        call = query_one("SELECT outcome FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(call["outcome"], "wrong_person")
        invoice = query_one("SELECT promised_date, disputed FROM invoice WHERE id = ?", (self.invoice_id,))
        self.assertIsNone(invoice["promised_date"])
        self.assertEqual(invoice["disputed"], 0)

    def test_past_promised_date_is_rejected(self):
        self.post(self._completed(call_outcome={"objective": "promised"}, promised_payment_date={"subjective": "2020-01-01"}))
        invoice = query_one("SELECT promised_date FROM invoice WHERE id = ?", (self.invoice_id,))
        self.assertIsNone(invoice["promised_date"])
        call = query_one("SELECT outcome FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(call["outcome"], "promised")  # outcome is still recorded; only the bad date is dropped

    def test_missing_extracted_data_does_not_crash(self):
        response = self.post({"execution_id": self.execution_id, "status": "completed", "transcript": "x"})
        self.assertEqual(response.status_code, 200)
        call = query_one("SELECT status, outcome FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(call["status"], "completed")
        self.assertIsNone(call["outcome"])

    def test_malformed_extracted_data_does_not_crash(self):
        response = self.post({"execution_id": self.execution_id, "status": "completed", "extracted_data": "not-a-dict"})
        self.assertEqual(response.status_code, 200)
        call = query_one("SELECT status FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(call["status"], "completed")


class IdempotencyTests(VoiceWebhookBase):
    def test_repeated_completed_posts_do_not_reprocess(self):
        payload = {
            "execution_id": self.execution_id, "status": "completed", "transcript": "hello",
            "extracted_data": {"Payment": {"call_outcome": {"objective": "promised"}, "promised_payment_date": {"subjective": "2026-12-25"}}},
        }
        for _ in range(3):
            response = self.c.post(f"/webhooks/bolna?token={WEBHOOK_SECRET}", json=payload, headers={})
            self.assertEqual(response.status_code, 200)
        calls = query("SELECT * FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(len(calls), 1)  # one row, not duplicated
        self.assertEqual(calls[0]["outcome"], "promised")

    def test_non_final_status_updates_without_touching_outcome(self):
        self.c.post(f"/webhooks/bolna?token={WEBHOOK_SECRET}", json={"execution_id": self.execution_id, "status": "ringing"}, headers={})
        call = query_one("SELECT status, outcome FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(call["status"], "in_progress")
        self.assertIsNone(call["outcome"])

    def test_unknown_execution_id_is_ignored_not_an_error(self):
        response = self.c.post(f"/webhooks/bolna?token={WEBHOOK_SECRET}", json={"execution_id": "does-not-exist", "status": "completed"}, headers={})
        self.assertEqual(response.status_code, 200)


class PollerFallbackTests(VoiceWebhookBase):
    def test_poller_reuses_process_result_and_is_idempotent_with_the_webhook(self):
        with mock.patch.object(bolna_client, "get_execution", return_value={
            "execution_id": self.execution_id, "status": "completed",
            "extracted_data": {"Payment": {"call_outcome": {"objective": "promised"}, "promised_payment_date": {"subjective": "2026-12-25"}}},
        }):
            # Force the row to look old enough for the poller to pick it up.
            from backend.app.core.db import execute
            execute("UPDATE voice_call SET created_at = ? WHERE id = ?", ("2000-01-01T00:00:00+00:00", self.call_id))
            processed = voice_service.poll_pending()
        self.assertEqual(processed, 1)
        invoice = query_one("SELECT promised_date FROM invoice WHERE id = ?", (self.invoice_id,))
        self.assertEqual(invoice["promised_date"], "2026-12-25")
        # The webhook arriving afterwards for the same execution must not double-process it.
        response = self.post({"execution_id": self.execution_id, "status": "completed",
                               "extracted_data": {"Payment": {"call_outcome": {"objective": "promised"}, "promised_payment_date": {"subjective": "2026-12-25"}}}})
        self.assertEqual(response.status_code, 200)
        calls = query("SELECT * FROM voice_call WHERE id = ?", (self.call_id,))
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
