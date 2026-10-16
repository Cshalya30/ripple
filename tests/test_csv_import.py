from __future__ import annotations

import unittest

from support import sandbox

from backend.app.core.db import query
from backend.app.records.csv_importer import parse_csv
from backend.app.core.db import today


class CsvParserTests(unittest.TestCase):
    def test_legacy_csv_is_previewed_without_writing(self):
        preview = parse_csv(
            "ledger.csv",
            b"Party name,Type,Bill amount,Received / Paid,Due date\nKaveri,Customer,10000,2500,2026-11-01\n",
            today(),
        )
        self.assertEqual(preview.format, "ledger")
        self.assertEqual(len(preview.facts.existing_receivables), 1)
        self.assertEqual(preview.facts.existing_receivables[0].amount.amount, "7500")

    def test_structured_csv_reports_bad_rows(self):
        preview = parse_csv(
            "ripple.csv",
            b"record_type,business_name,opening_cash,party_name,party_type,amount,due_date\n"
            b"business,Acme,50000,,,,\n"
            b"receivable,,,Kaveri,Customer,not-money,2026-11-01\n",
            today(),
        )
        self.assertEqual(preview.format, "structured")
        self.assertEqual(preview.errors[0]["row"], "3")


class CsvApiTests(unittest.TestCase):
    def test_csv_requires_approval_and_supports_merge(self):
        client = sandbox()
        user_id = client.get("/api/me").json()["user"]["id"]
        business_id = query("SELECT business_id FROM user WHERE id = ?", (user_id,))[0]["business_id"]
        csv = b"Party name,Type,Bill amount,Received / Paid,Due date\nImported,Customer,10000,0,2026-11-01\n"
        before = len(query("SELECT id FROM invoice WHERE business_id = ?", (business_id,)))
        preview = client.post("/api/setup/csv/preview", content=csv, headers={"x-filename": "ledger.csv"})
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(len(query("SELECT id FROM invoice WHERE business_id = ?", (business_id,))), before)
        approved = client.post("/api/setup/csv/approve", json={
            "draft_id": preview.json()["draft_id"], "draft_version": 1, "mode": "merge", "approval": "APPROVE",
        })
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertTrue(query("SELECT id FROM party WHERE business_id = ? AND name = ?", (business_id, "Imported")))


if __name__ == "__main__":
    unittest.main()
