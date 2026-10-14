from __future__ import annotations

import io
import unittest
from datetime import timedelta
from unittest import mock

from fastapi.testclient import TestClient

from backend.app.api import config, routes
from backend.app.api.forecast import compute_baseline, planned_events
from backend.app.api.store import PartyStore, set_store
from backend.app.assistant import chat
from backend.app.main import app

WS = {"X-Workspace-Id": "unit-test-workspace-0001"}
OTHER_WS = {"X-Workspace-Id": "unit-test-workspace-0002"}


def new_party(**overrides) -> dict:
    today = config.today()
    body = {
        "kind": "customer",
        "name": "Test Shop",
        "phone": "+91 98765 43210",
        "details": "Shop, Pune",
        "products": ["Silk"],
        "quantity": 10,
        "totalAmount": 50000,
        "paidAmount": 10000,
        "transactionDate": (today - timedelta(days=5)).isoformat(),
        "dueDate": (today + timedelta(days=20)).isoformat(),
    }
    body.update(overrides)
    return body


class RippleApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = PartyStore(":memory:")
        set_store(self.store)
        routes._hits.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.store.close()

    # ── parties ──────────────────────────────────────────────────────────

    def test_seed_matches_frontend_sample(self) -> None:
        parties = self.client.get("/api/parties", headers=WS).json()
        self.assertEqual(len(parties), 14)
        flagged = {p["name"] for p in parties if p.get("causesShortfall")}
        self.assertEqual(flagged, {"Sharma Yarn Mills", "Kaveri Boutique"})
        sharma = next(p for p in parties if p["id"] == "sup-sharma")
        self.assertEqual(sharma["owedAmount"], 352000)
        self.assertEqual(sharma["dueDate"], (config.today() + timedelta(days=34)).isoformat())

    def test_create_party_and_validation(self) -> None:
        r = self.client.post("/api/parties", json=new_party(), headers=WS)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["owedAmount"], 40000)
        self.assertEqual(r.json()["phone"], "+91 98765 43210")
        for bad in (
            new_party(paidAmount=60000),
            new_party(phone="12345"),
            new_party(name="  "),
            new_party(name="bad\x00name"),
            new_party(totalAmount=-5),
            new_party(quantity=0),
            new_party(dueDate="2001-01-01"),
            new_party(products=[]),
            {**new_party(), "isAdmin": True},
        ):
            r = self.client.post("/api/parties", json=bad, headers=WS)
            self.assertEqual(r.status_code, 422, bad)
            self.assertEqual(r.json()["error"]["code"], "VALIDATION_ERROR")

    def test_workspaces_are_isolated(self) -> None:
        self.client.post("/api/parties", json=new_party(name="Only Mine"), headers=WS)
        mine = [p["name"] for p in self.client.get("/api/parties", headers=WS).json()]
        theirs = [p["name"] for p in self.client.get("/api/parties", headers=OTHER_WS).json()]
        self.assertIn("Only Mine", mine)
        self.assertNotIn("Only Mine", theirs)
        party_id = self.client.get("/api/parties", headers=WS).json()[0]["id"]
        self.assertEqual(self.client.delete(f"/api/parties/{party_id}", headers=OTHER_WS).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/parties/{party_id}", headers=WS).status_code, 204)

    def test_reset_restores_seed(self) -> None:
        self.client.post("/api/parties", json=new_party(), headers=WS)
        self.client.post("/api/demo/reset", headers=WS)
        self.assertEqual(len(self.client.get("/api/parties", headers=WS).json()), 14)

    # ── import ───────────────────────────────────────────────────────────

    def test_upload_csv_with_template_headers(self) -> None:
        csv_text = (
            "Party name,Type,Phone,Item,Qty,Bill amount,Received / Paid,Bill date,Due date\n"
            "Kaveri Two,Customer,+91 98000 00201,Silk sarees,140 m,\"₹3,25,000\",180000,2026-09-01,2026-10-20\n"
            "Broken Row,Somebody,+91 98000 00101,Yarn,10,1000,0,2026-09-23,2026-11-17\n"
            "Sharma Two,Supplier,9800000101,Cotton yarn,1850,640000,288000,23/09/2026,17/11/2026\n"
        )
        r = self.client.post("/api/parties/upload", files={"file": ("ledger.csv", csv_text.encode(), "text/csv")}, headers=WS)
        self.assertEqual(r.status_code, 201)
        body = r.json()
        self.assertEqual([p["name"] for p in body["added"]], ["Kaveri Two", "Sharma Two"])
        self.assertEqual(body["added"][0]["totalAmount"], 325000)
        self.assertEqual(body["added"][0]["quantity"], 140)
        self.assertEqual(body["skipped"][0]["row"], 3)

    def test_upload_xlsx(self) -> None:
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.append(["name", "type", "phone", "products", "quantity", "total_amount", "amount_paid", "transaction_date", "due_date"])
        ws.append(["Excel Traders", "Supplier", "919000000401", "Polyester yarn", 800, 128000, 64000, "2026-10-01", "2026-11-05"])
        buf = io.BytesIO()
        wb.save(buf)
        r = self.client.post("/api/parties/upload", files={"file": ("ledger.xlsx", buf.getvalue(), "application/octet-stream")}, headers=WS)
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["added"][0]["owedAmount"], 64000)

    def test_upload_rejects_bad_files(self) -> None:
        r = self.client.post("/api/parties/upload", files={"file": ("evil.exe", b"MZ", "application/octet-stream")}, headers=WS)
        self.assertEqual(r.status_code, 422)
        r = self.client.post("/api/parties/upload", files={"file": ("x.csv", b"foo,bar\n1,2\n", "text/csv")}, headers=WS)
        self.assertEqual(r.json()["error"]["code"], "BAD_UPLOAD")
        r = self.client.post("/api/parties/upload", files={"file": ("big.csv", b"a" * (config.MAX_UPLOAD_BYTES + 10), "text/csv")}, headers=WS)
        self.assertEqual(r.status_code, 422)

    def test_export_csv_has_every_party_and_round_trips(self) -> None:
        self.client.post("/api/parties", json=new_party(name="=HYPERLINK(\"http://evil\")", products=["Silk", "Cotton"]), headers=WS)
        r = self.client.get("/api/parties/export.csv", headers=WS)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["content-type"].startswith("text/csv"))
        self.assertIn("attachment", r.headers["content-disposition"])
        text = r.content.decode("utf-8-sig")
        lines = text.strip().splitlines()
        self.assertEqual(lines[0], "Party name,Type,Phone,Details,Item,Qty,Bill amount,Received / Paid,Still owed,Bill date,Due date")
        self.assertEqual(len(lines), 1 + 15)  # 14 demo parties + the one just added
        self.assertIn("Sharma Yarn Mills,Supplier,98000 00101,", text)
        self.assertIn("'=HYPERLINK", text)  # formula neutralised
        self.assertNotIn(",=HYPERLINK", text)
        # Re-upload the exported file into a fresh workspace: same parties come back.
        fresh = {"X-Workspace-Id": "unit-test-workspace-0003"}
        self.client.post("/api/demo/reset", headers=fresh)
        for p in self.client.get("/api/parties", headers=fresh).json():
            self.client.delete(f"/api/parties/{p['id']}", headers=fresh)
        r = self.client.post("/api/parties/upload", files={"file": ("export.csv", r.content, "text/csv")}, headers=fresh)
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(len(r.json()["added"]), 15)
        self.assertEqual(r.json()["skipped"], [])
        back = {p["name"]: p for p in r.json()["added"]}
        self.assertEqual(back["Sharma Yarn Mills"]["owedAmount"], 352000)
        self.assertEqual(back["Sharma Yarn Mills"]["products"], ["Cotton yarn 40s", "Polyester blend yarn"])

    def test_export_isolated_per_workspace(self) -> None:
        self.client.post("/api/parties", json=new_party(name="Secret Customer"), headers=WS)
        other = self.client.get("/api/parties/export.csv", headers=OTHER_WS).content.decode("utf-8-sig")
        self.assertNotIn("Secret Customer", other)

    def test_party_cap(self) -> None:
        payload = {"parties": [new_party(name=f"Shop {i}") for i in range(200)]}
        self.assertEqual(self.client.post("/api/parties/import", json=payload, headers=WS).status_code, 201)
        r = self.client.post("/api/parties/import", json={"parties": [new_party(name=f"More {i}") for i in range(100)]}, headers=WS)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "KHATA_FULL")

    # ── forecast & fixes ─────────────────────────────────────────────────

    def test_forecast_matches_frontend_numbers(self) -> None:
        body = self.client.get("/api/forecast", headers=WS).json()
        s = body["summary"]
        self.assertEqual((s["cashToday"], s["inflows"], s["outflows"], s["net"]), (230000, 876000, 829000, 47000))
        self.assertEqual((s["lowest"]["day"], s["lowest"]["balance"]), (34, -120000))
        self.assertEqual(s["firstDipDay"], 34)
        self.assertEqual(len(body["series"]), config.HORIZON_DAYS + 1)
        self.assertEqual(body["engine"]["lateCommitments"][0]["label"], "Sharma Yarn Mills")
        self.assertEqual([c["id"] for c in body["causes"]], ["c-supplier", "c-customer", "c-other"])

    def test_committed_series_equals_plain_cash_ledger(self) -> None:
        parties = self.store.list("unit-test-workspace-0001")
        baseline = compute_baseline(parties)
        events = planned_events(parties, config.today())
        balance, plain = config.BUSINESS.cash_today, []
        for day in range(config.HORIZON_DAYS + 1):
            balance += sum(e.amount for e in events if e.day == day and e.kind == "inflow")
            balance -= sum(e.amount for e in events if e.day == day and e.kind == "outflow")
            plain.append(balance)
        self.assertEqual([p["balance"] for p in baseline.run.series], plain)
        # The engine itself never lets cash go negative; it pays Sharma late instead.
        self.assertGreaterEqual(baseline.run.result.metrics.minimum_executable_cash_paise, 0)

    def test_fixes_close_the_dip(self) -> None:
        fixes = self.client.get("/api/fixes", headers=WS).json()
        self.assertEqual([f["id"] for f in fixes], ["early-payment", "split-payment", "extension", "invoice-financing"])
        for f in fixes:
            self.assertGreater(f["newLowest"], -120000, f["id"])
            self.assertGreaterEqual(f["newLowest"], 0, f["id"])
            self.assertEqual(len(f["afterSeries"]), config.HORIZON_DAYS + 1)
            self.assertIn(f["tag"], {"Easiest", "Cheapest", "Quickest", "Last resort"})
        self.assertIn("Kaveri Boutique", fixes[0]["title"])
        self.assertGreater(fixes[3]["engine"]["financingCost"], 0)

    def test_no_dip_means_no_fixes(self) -> None:
        for p in self.store.list("unit-test-workspace-0001"):
            if p.kind == "supplier":
                self.store.delete("unit-test-workspace-0001", p.id)
        self.assertEqual(self.client.get("/api/fixes", headers=WS).json(), [])
        self.assertEqual(self.client.get("/api/forecast", headers=WS).json()["causes"], [])

    # ── assistant ────────────────────────────────────────────────────────

    def test_chat_without_key_is_503(self) -> None:
        with mock.patch.dict("os.environ", {"GOOGLE_API_KEY": ""}):
            r = self.client.post("/api/assistant/chat", json={"message": "why the dip?"}, headers=WS)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"]["code"], "ASSISTANT_UNAVAILABLE")

    def test_chat_with_model_parses_json_and_limits_routes(self) -> None:
        class FakeModel:
            def __init__(self, content: str):
                self.content = content
                self.seen = None

            def invoke(self, messages):
                self.seen = messages
                return type("R", (), {"content": self.content})()

        fake = FakeModel('```json\n{"en": "Sharma is due on Day 34.", "hi": "शर्मा का भुगतान Day 34 को है।", "route": "/forecast"}\n```')
        with mock.patch.dict("os.environ", {"GOOGLE_API_KEY": "test"}), mock.patch.object(chat, "_chat_model", return_value=fake):
            r = self.client.post("/api/assistant/chat", json={"message": "why the dip?", "history": [{"role": "user", "content": "hi"}]}, headers=WS)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"en": "Sharma is due on Day 34.", "hi": "शर्मा का भुगतान Day 34 को है।", "route": "/forecast"})
        system_prompt = fake.seen[0].content
        self.assertIn("Lowest point: −₹1,20,000 on Day 34", system_prompt)
        self.assertIn("Kaveri Boutique", system_prompt)

        evil = FakeModel('{"en": "ok", "hi": "", "route": "javascript:alert(1)"}')
        with mock.patch.dict("os.environ", {"GOOGLE_API_KEY": "test"}), mock.patch.object(chat, "_chat_model", return_value=evil):
            r = self.client.post("/api/assistant/chat", json={"message": "go"}, headers=WS)
        self.assertEqual(r.json()["route"], None)
        self.assertEqual(r.json()["hi"], "ok")

    def test_chat_rejects_oversized_input(self) -> None:
        r = self.client.post("/api/assistant/chat", json={"message": "x" * 1001}, headers=WS)
        self.assertEqual(r.status_code, 422)

    def test_transcribe_rejects_bad_audio(self) -> None:
        r = self.client.post("/api/assistant/transcribe", files={"file": ("a.exe", b"123", "application/octet-stream")})
        self.assertIn(r.status_code, (422, 503))

    def test_rate_limit(self) -> None:
        codes = [self.client.post("/api/parties", json=new_party(name=f"S{i}"), headers=WS).status_code for i in range(61)]
        self.assertEqual(codes[-1], 429)

    def test_unknown_api_route_is_json_404(self) -> None:
        r = self.client.get("/api/does-not-exist")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"]["code"], "NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
