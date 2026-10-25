"""Ripple Voice API: preview, approve-and-call, guardrail surfacing, and the engine integration that
every shortfall number must come from. All Bolna HTTP calls are mocked; no network, ever, in a test."""
from __future__ import annotations

import os
import unittest
from unittest import mock

from support import sandbox

from backend.app.core.db import execute, get_conn, query, query_one, update
from backend.app.voice import bolna_client


def _widen_call_window():
    os.environ["CALL_WINDOW_START"] = "0"
    os.environ["CALL_WINDOW_END"] = "24"


class VoiceApiBase(unittest.TestCase):
    def setUp(self):
        _widen_call_window()
        self.c = sandbox()
        email = self.c.get("/api/me").json()["user"]["email"]
        self.business_id = query("SELECT business_id FROM user WHERE email = ?", (email,))[0]["business_id"]
        party = self.c.post("/api/parties", json={"kind": "CUSTOMER", "name": "Kaveri Boutique", "phone": "9876543210"}).json()["party"]
        self.party_id = party["id"]
        invoice = self.c.post("/api/invoices", json={
            "party_id": self.party_id, "number": "INV-VOICE-1", "amount_paise": 50_000_00,
            "invoice_date": "2026-08-01", "due_date": "2026-08-15",
        }).json()["invoice"]
        self.invoice_id = invoice["id"]


class PreviewTests(VoiceApiBase):
    def test_preview_has_script_and_no_block(self):
        body = self.c.post("/api/voice/calls/preview", json={"invoice_id": self.invoice_id}).json()
        self.assertEqual(body["customer_name"], "Kaveri Boutique")
        self.assertIn("Namaste", body["opening_hi"])
        self.assertEqual(body["invoice_id"], self.invoice_id)
        self.assertIsNone(body["blocked_by"])
        self.assertIsNotNone(body["masked_phone"])
        self.assertFalse(body["demo_mode"])

    def test_preview_reports_the_blocking_guardrail(self):
        update(get_conn(), "party", self.party_id, self.business_id, {"do_not_call": 1})
        body = self.c.post("/api/voice/calls/preview", json={"invoice_id": self.invoice_id}).json()
        self.assertEqual(body["blocked_by"], "DO_NOT_CALL")

    def test_preview_unknown_invoice_404s(self):
        response = self.c.post("/api/voice/calls/preview", json={"invoice_id": "nope"})
        self.assertEqual(response.status_code, 404)


class CreateCallTests(VoiceApiBase):
    def test_requires_approval_flag(self):
        response = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": False})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "APPROVAL_REQUIRED")

    def test_blocked_guardrail_surfaces_as_422(self):
        update(get_conn(), "invoice", self.invoice_id, self.business_id, {"disputed": 1})
        response = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "DISPUTED")

    @mock.patch.object(bolna_client, "place_call", return_value={"execution_id": "exec-123"})
    def test_approved_call_places_and_records(self, place_call):
        response = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True})
        self.assertEqual(response.status_code, 200, response.text)
        call = response.json()["voice_call"]
        self.assertEqual(call["execution_id"], "exec-123")
        self.assertEqual(call["invoice_id"], self.invoice_id)
        self.assertIn(call["status"], ("queued", "in_progress"))
        place_call.assert_called_once()
        _, kwargs = place_call.call_args
        self.assertEqual(kwargs["user_data"]["invoice_no"], "INV-VOICE-1")
        invoice = query_one("SELECT last_called_at FROM invoice WHERE id = ?", (self.invoice_id,))
        self.assertIsNotNone(invoice["last_called_at"])

    @mock.patch.object(bolna_client, "place_call", return_value={"execution_id": "exec-again"})
    def test_second_call_same_day_is_blocked(self, place_call):
        first = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True})
        self.assertEqual(first.status_code, 200, first.text)
        second = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True})
        self.assertEqual(second.status_code, 422)
        self.assertEqual(second.json()["error"]["code"], "ALREADY_CALLED_TODAY")
        place_call.assert_called_once()

    @mock.patch.object(bolna_client, "place_call", side_effect=bolna_client.BolnaError(500, {"message": "down"}))
    def test_bolna_failure_is_recorded_not_silently_dropped(self, _place_call):
        response = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True})
        self.assertEqual(response.status_code, 502)
        row = query_one("SELECT status FROM voice_call WHERE invoice_id = ?", (self.invoice_id,))
        self.assertEqual(row["status"], "failed")

    def test_accountant_cannot_approve_a_call_but_can_still_preview(self):
        email = self.c.get("/api/me").json()["user"]["email"]
        execute("UPDATE user SET role = 'ACCOUNTANT' WHERE email = ?", (email,))
        response = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True})
        self.assertEqual(response.status_code, 403)
        preview = self.c.post("/api/voice/calls/preview", json={"invoice_id": self.invoice_id})
        self.assertEqual(preview.status_code, 200)


class ListAndGetTests(VoiceApiBase):
    @mock.patch.object(bolna_client, "place_call", return_value={"execution_id": "exec-list"})
    def test_list_and_get_round_trip(self, _place_call):
        created = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True}).json()["voice_call"]
        fetched = self.c.get(f"/api/voice/calls/{created['id']}").json()["voice_call"]
        self.assertEqual(fetched["id"], created["id"])
        listed = self.c.get(f"/api/voice/calls?invoice_id={self.invoice_id}").json()["voice_calls"]
        self.assertEqual([row["id"] for row in listed], [created["id"]])

    def test_get_unknown_call_404s(self):
        response = self.c.get("/api/voice/calls/does-not-exist")
        self.assertEqual(response.status_code, 404)


class EngineIntegrationTests(VoiceApiBase):
    """The promised date moves the engine's own shortfall; nothing here is estimated by the AI."""

    @mock.patch.object(bolna_client, "place_call", return_value={"execution_id": "exec-engine"})
    def test_promised_date_moves_the_runway_through_the_real_engine(self, _place_call):
        from backend.app.services import runs
        from backend.app.voice.service import process_result

        before = runs.baseline(self.business_id).derived["summary"]
        call = self.c.post("/api/voice/calls", json={"invoice_id": self.invoice_id, "approved": True}).json()["voice_call"]
        self.assertIn("shortfall_before_date", call)

        future_promise = "2026-12-01"
        payload = {
            "execution_id": "exec-engine", "status": "completed", "transcript": "...",
            "telephony_data": {"recording_url": "https://example.com/rec.mp3"}, "duration": 42, "cost": 3.5,
            "extracted_data": {"Payment": {
                "call_outcome": {"objective": "promised"},
                "promised_payment_date": {"subjective": future_promise},
            }},
        }
        updated = process_result(payload)
        self.assertEqual(updated["outcome"], "promised")
        self.assertEqual(updated["status"], "completed")
        self.assertEqual(updated["promised_date"], future_promise)

        invoice = query_one("SELECT promised_date FROM invoice WHERE id = ?", (self.invoice_id,))
        self.assertEqual(invoice["promised_date"], future_promise)

        after = runs.baseline(self.business_id).derived["summary"]
        self.assertNotEqual(before, after)  # the baseline actually recomputed on the new promised date
        row = query_one("SELECT shortfall_after_date, shortfall_after_paise FROM voice_call WHERE execution_id = ?", ("exec-engine",))
        # Both null (no shortfall left) or both set is correct; one set without the other would be a bug.
        self.assertEqual(row["shortfall_after_date"] is None, row["shortfall_after_paise"] is None)


if __name__ == "__main__":
    unittest.main()
