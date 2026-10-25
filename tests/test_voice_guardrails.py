"""Ripple Voice guardrails: approval, call window, do-not-call, disputed, overdue, phone, daily limit,
demo override. All server-side (PLAN_VOICE.md); none of this can be bypassed from the browser."""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from support import client  # noqa: F401  (import side effect: sets env for db.today() etc.)

from backend.app.voice import guardrails

IST = timezone(timedelta(hours=5, minutes=30))


class CallWindowTests(unittest.TestCase):
    def setUp(self):
        self._start = os.environ.get("CALL_WINDOW_START")
        self._end = os.environ.get("CALL_WINDOW_END")

    def tearDown(self):
        for key, value in (("CALL_WINDOW_START", self._start), ("CALL_WINDOW_END", self._end)):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_inside_window_passes(self):
        with mock.patch.object(guardrails, "_now", return_value=datetime(2026, 10, 14, 12, 0, tzinfo=IST)):
            guardrails.check_time_window()  # does not raise

    def test_before_window_blocks(self):
        with mock.patch.object(guardrails, "_now", return_value=datetime(2026, 10, 14, 7, 0, tzinfo=IST)):
            with self.assertRaises(guardrails.GuardrailError) as ctx:
                guardrails.check_time_window()
            self.assertEqual(ctx.exception.code, "OUTSIDE_CALL_WINDOW")

    def test_after_window_blocks(self):
        with mock.patch.object(guardrails, "_now", return_value=datetime(2026, 10, 14, 20, 0, tzinfo=IST)):
            with self.assertRaises(guardrails.GuardrailError) as ctx:
                guardrails.check_time_window()
            self.assertEqual(ctx.exception.code, "OUTSIDE_CALL_WINDOW")

    def test_window_is_configurable(self):
        os.environ["CALL_WINDOW_START"], os.environ["CALL_WINDOW_END"] = "20", "22"
        with mock.patch.object(guardrails, "_now", return_value=datetime(2026, 10, 14, 21, 0, tzinfo=IST)):
            guardrails.check_time_window()  # does not raise with the widened window


class InvoiceGuardrailTests(unittest.TestCase):
    def _invoice(self, **over):
        base = {"due_date": "2026-09-01", "disputed": 0}
        base.update(over)
        return base

    def _party(self, **over):
        base = {"name": "Kaveri Boutique", "do_not_call": 0, "phone": "9876543210"}
        base.update(over)
        return base

    def test_do_not_call_blocks(self):
        with self.assertRaises(guardrails.GuardrailError) as ctx:
            guardrails.check_invoice_callable(self._invoice(), self._party(do_not_call=1))
        self.assertEqual(ctx.exception.code, "DO_NOT_CALL")

    def test_disputed_blocks(self):
        with self.assertRaises(guardrails.GuardrailError) as ctx:
            guardrails.check_invoice_callable(self._invoice(disputed=1), self._party())
        self.assertEqual(ctx.exception.code, "DISPUTED")

    def test_not_overdue_blocks(self):
        with self.assertRaises(guardrails.GuardrailError) as ctx:
            guardrails.check_invoice_callable(self._invoice(due_date="2026-11-01"), self._party())
        self.assertEqual(ctx.exception.code, "NOT_OVERDUE")

    def test_no_phone_blocks(self):
        with self.assertRaises(guardrails.GuardrailError) as ctx:
            guardrails.check_invoice_callable(self._invoice(), self._party(phone=None))
        self.assertEqual(ctx.exception.code, "NO_PHONE")

    def test_overdue_with_phone_passes(self):
        guardrails.check_invoice_callable(self._invoice(), self._party())  # does not raise

    def test_daily_limit_blocks_same_day(self):
        from backend.app.core.db import today
        invoice = {"last_called_at": today().isoformat()}
        with self.assertRaises(guardrails.GuardrailError) as ctx:
            guardrails.check_daily_limit(invoice)
        self.assertEqual(ctx.exception.code, "ALREADY_CALLED_TODAY")

    def test_daily_limit_allows_a_new_day(self):
        guardrails.check_daily_limit({"last_called_at": "2000-01-01"})  # does not raise
        guardrails.check_daily_limit({"last_called_at": None})  # does not raise


class DemoOverrideTests(unittest.TestCase):
    def setUp(self):
        self._override = os.environ.pop("DEMO_PHONE_OVERRIDE", None)

    def tearDown(self):
        if self._override is not None:
            os.environ["DEMO_PHONE_OVERRIDE"] = self._override
        else:
            os.environ.pop("DEMO_PHONE_OVERRIDE", None)

    def test_without_override_dials_the_customer(self):
        self.assertEqual(guardrails.resolve_phone({"phone": "9876543210"}), "9876543210")
        self.assertFalse(guardrails.demo_mode())

    def test_override_replaces_the_dialled_number_only(self):
        os.environ["DEMO_PHONE_OVERRIDE"] = "9999999999"
        self.assertEqual(guardrails.resolve_phone({"phone": "9876543210"}), "9999999999")
        self.assertTrue(guardrails.demo_mode())
        # Guardrails that look at the real customer record are unaffected by the override.
        with self.assertRaises(guardrails.GuardrailError):
            guardrails.check_invoice_callable({"due_date": "2026-09-01", "disputed": 0}, {"name": "X", "do_not_call": 1, "phone": "9876543210"})


if __name__ == "__main__":
    unittest.main()
