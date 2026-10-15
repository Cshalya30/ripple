"""Regression tests for the defects John's audit found (BUG ids are from his report) that were present in this codebase too."""
from __future__ import annotations

import codecs
import csv
import io
import json
import sys
import unittest
from pathlib import Path

from support import client, sandbox, signed_in


def anand_invoice(c):
    anand = next(p for p in c.get("/api/parties?kind=CUSTOMER").json()["parties"] if p["name"] == "Anand Silk Emporium")
    return anand, c.get(f"/api/parties/{anand['id']}").json()["open_items"][0]


def pay(c, party, invoice, amount, medium="CHEQUE"):
    return c.post("/api/transactions", json={"party_id": party["id"], "direction": "IN", "amount_paise": amount, "date": "2026-10-14",
                                             "medium": medium, "reference": "900001", "invoice_id": invoice["id"]})


class BUG004_PendingChequesCannotPayTheSameBillTwice(unittest.TestCase):
    def test_second_cheque_for_the_same_money_is_refused(self):
        c = sandbox()
        party, invoice = anand_invoice(c)
        full = invoice["amount_paise"]
        self.assertEqual(pay(c, party, invoice, full).status_code, 200)
        second = pay(c, party, invoice, full)
        self.assertEqual(second.status_code, 422)
        body = second.json()["error"]
        self.assertEqual(body["code"], "AMOUNT_EXCEEDS_OUTSTANDING")
        self.assertEqual(body["details"]["outstanding_paise"], 0)
        self.assertEqual(body["details"]["pending_cheques_paise"], full)

    def test_part_cheques_can_share_a_bill_up_to_its_amount(self):
        c = sandbox()
        party, invoice = anand_invoice(c)
        half = invoice["amount_paise"] // 2
        self.assertEqual(pay(c, party, invoice, half).status_code, 200)
        self.assertEqual(pay(c, party, invoice, invoice["amount_paise"] - half).status_code, 200)
        self.assertEqual(pay(c, party, invoice, 1).status_code, 422)

    def test_a_bounced_cheque_frees_the_money_again(self):
        c = sandbox()
        party, invoice = anand_invoice(c)
        first = pay(c, party, invoice, invoice["amount_paise"]).json()["transaction"]
        self.assertEqual(c.patch(f"/api/transactions/{first['id']}", json={"status": "BOUNCED"}).status_code, 200)
        self.assertEqual(pay(c, party, invoice, invoice["amount_paise"]).status_code, 200)

    def test_nothing_is_ever_received_beyond_the_bill(self):
        c = sandbox()
        party, invoice = anand_invoice(c)
        pay(c, party, invoice, invoice["amount_paise"])
        pay(c, party, invoice, invoice["amount_paise"])
        for row in c.get("/api/transactions").json()["rows"]:
            if row["invoice_number"] == invoice["number"]:
                self.assertLessEqual(row["amount_paise"], invoice["amount_paise"])
        received = sum(r["amount_paise"] for r in c.get("/api/transactions").json()["rows"] if r["invoice_number"] == invoice["number"] and r["status"] != "BOUNCED")
        self.assertLessEqual(received, invoice["amount_paise"])


class BUG002_CsvPartyNameCannotBeAFormula(unittest.TestCase):
    def test_a_party_name_that_starts_with_an_equals_sign_is_defanged(self):
        c = sandbox()
        party = c.post("/api/parties", json={"kind": "CUSTOMER", "name": "=HYPERLINK(\"http://x\",\"y\")"}).json()
        pid = party.get("id") or party["party"]["id"]
        self.assertEqual(c.post("/api/transactions", json={"party_id": pid, "direction": "IN", "amount_paise": 500, "date": "2026-10-14", "medium": "UPI"}).status_code, 200)
        text = c.get("/api/export/transactions.csv").text
        names = [row[1] for row in csv.reader(io.StringIO(text))][1:]
        self.assertTrue(any(n.startswith("'=HYPERLINK") for n in names), names)
        self.assertFalse(any(n.startswith("=") for n in names))


class BUG003_ChunkedUploadsAreCappedToo(unittest.TestCase):
    def test_a_body_sent_in_chunks_is_refused_past_the_limit(self):
        c = signed_in()

        def chunks():
            for _ in range(32):
                yield b"x" * 16384  # 512 KB, no Content-Length

        response = c.post("/api/assistant/chat", content=chunks(), headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"]["code"], "BODY_TOO_LARGE")

    def test_normal_requests_still_pass(self):
        c = signed_in()
        self.assertEqual(c.put("/api/me/prefs", json={"theme": "day"}).status_code, 200)
        c.put("/api/me/prefs", json={"theme": "night"})

    def test_a_small_chunked_body_is_fine(self):
        c = signed_in()

        def chunks():
            yield json.dumps({"theme": "night"}).encode()

        self.assertEqual(c.put("/api/me/prefs", content=chunks(), headers={"Content-Type": "application/json"}).status_code, 200)


class BUG001_SharedDemoTeamAndDataAreProtected(unittest.TestCase):
    def test_the_shared_demo_owner_cannot_remove_the_other_demo_accounts(self):
        c = signed_in()
        response = c.delete("/api/team/u-accountant")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "SHARED_DEMO_PROTECTED")
        self.assertEqual(signed_in("accountant@ripple.demo").get("/api/me").status_code, 200)

    def test_nor_invite_nor_reset_the_shared_demo(self):
        c = signed_in()
        self.assertEqual(c.post("/api/team", json={"email": "x@y.co", "name": "X", "role": "OWNER"}).json()["error"]["code"], "SHARED_DEMO_PROTECTED")
        self.assertEqual(c.post("/api/data/reset", json={"confirm": "Mahalakshmi Textiles"}).status_code, 403)

    def test_a_private_sandbox_owner_still_manages_the_team(self):
        c = sandbox()
        invited = c.post("/api/team", json={"email": "new.member@example.com", "name": "New", "role": "ACCOUNTANT"})
        self.assertEqual(invited.status_code, 200, invited.text)
        team = c.get("/api/settings").json()["team"]
        member = next(u for u in team if u["email"] == "new.member@example.com")
        self.assertEqual(c.delete(f"/api/team/{member['id']}").status_code, 200)


class BUG009_InviteDoesNotRevealWhoHasAnAccount(unittest.TestCase):
    def test_taken_email_in_my_team_and_in_another_business_look_the_same(self):
        c = sandbox()
        c.post("/api/team", json={"email": "mine@example.com", "name": "Mine", "role": "ACCOUNTANT"})
        mine = c.post("/api/team", json={"email": "mine@example.com", "name": "Again", "role": "ACCOUNTANT"})
        elsewhere = c.post("/api/team", json={"email": "owner@ripple.demo", "name": "Elsewhere", "role": "ACCOUNTANT"})
        self.assertEqual(mine.status_code, 409)
        self.assertEqual(mine.status_code, elsewhere.status_code)
        self.assertEqual(mine.json(), elsewhere.json())
        self.assertEqual(mine.json()["error"]["code"], "CANNOT_INVITE")


class BUG008_DuplicateInvoiceNumbers(unittest.TestCase):
    def test_same_party_cannot_have_two_bills_with_one_number(self):
        c = sandbox()
        party, invoice = anand_invoice(c)
        body = {"party_id": party["id"], "number": invoice["number"].lower(), "amount_paise": 10000, "invoice_date": "2026-10-10"}
        response = c.post("/api/invoices", json=body)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "DUPLICATE_INVOICE_NUMBER")

    def test_a_new_number_and_the_same_number_for_another_party_are_fine(self):
        c = sandbox()
        party, invoice = anand_invoice(c)
        other = next(p for p in c.get("/api/parties?kind=CUSTOMER").json()["parties"] if p["id"] != party["id"])
        self.assertEqual(c.post("/api/invoices", json={"party_id": party["id"], "number": "NEW-1", "amount_paise": 10000, "invoice_date": "2026-10-10"}).status_code, 200)
        self.assertEqual(c.post("/api/invoices", json={"party_id": other["id"], "number": "NEW-1", "amount_paise": 10000, "invoice_date": "2026-10-10"}).status_code, 200)
        # The same text on two parties used to save the second bill and then make every forecast screen fail (duplicate event id).
        for path in ("/api/today", "/api/book/summary", "/api/engine/run", "/api/guard"):
            self.assertEqual(c.get(path).status_code, 200, path)


class BUG007_EngineExamplesMatchTheEngine(unittest.TestCase):
    def test_checked_in_examples_are_what_the_generator_writes_now(self):
        root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(root))
        from backend.app.simulation.comparison import compare_scenarios
        from backend.app.simulation.engine import simulate
        from backend.app.simulation.schemas import BusinessSnapshot, Scenario
        fixtures = json.loads((root / "fixtures" / "simulation" / "mandatory-fixtures.json").read_text(encoding="utf-8"))
        snapshot = BusinessSnapshot.model_validate_json(json.dumps(fixtures["baseline_snapshot"]))
        delayed = Scenario.model_validate_json(json.dumps(fixtures["scenarios"]["fixture_b_delayed_old_receipt"]))
        examples = root / "fixtures" / "simulation" / "examples"
        for name, produced in (("example-output-baseline.json", simulate(snapshot)), ("example-output-delayed-receipt.json", simulate(snapshot, delayed)),
                               ("example-output-compare.json", compare_scenarios(snapshot, delayed))):
            committed = json.loads((examples / name).read_text(encoding="utf-8"))
            self.assertEqual(committed, produced.model_dump(mode="json"), f"{name} is stale: run python fixtures/simulation/generate_examples.py")


class N_ExportsAndMessagesForTheScreens(unittest.TestCase):
    """Track B (Nandini): things found on the Khata, Book and Settings screens."""

    def test_transactions_csv_opens_in_excel_with_non_english_names(self):
        c = sandbox()
        raw = c.get("/api/export/transactions.csv").content
        self.assertTrue(raw.startswith(codecs.BOM_UTF8), "no byte-order mark: Excel shows Tamil and Hindi names as garbage")
        self.assertIn("charset=utf-8", c.get("/api/export/transactions.csv").headers["content-type"])

    def test_whatsapp_numbers_carry_the_country_code(self):
        from backend.app.services.messages import wa_link, whatsapp_number
        self.assertEqual(whatsapp_number("98765 43210"), "919876543210")
        self.assertEqual(whatsapp_number("098765-43210"), "919876543210")
        self.assertEqual(whatsapp_number("+91 98765-43210"), "919876543210")
        self.assertEqual(whatsapp_number("+1 202 555 0100"), "12025550100")
        for unplaceable in ("12", "", None, "(044) 2345 678", "12345678901234567890"):
            self.assertIsNone(whatsapp_number(unplaceable), unplaceable)
        self.assertIsNone(wa_link("12", "hello"))
        self.assertTrue(wa_link("98765 43210", "hello there").startswith("https://wa.me/919876543210?text=hello%20there"))


class N_DatesCannotPoisonTheForecast(unittest.TestCase):
    """Dates such as 9999-12-31 used to be accepted, crash date arithmetic with a 500, or be saved and break every screen afterwards."""

    ROUTES = {
        "invoice date": lambda c, d, i: c.post("/api/invoices", json={"party_id": i[0]["id"], "number": "Z1", "amount_paise": 1000, "invoice_date": d}),
        "invoice due": lambda c, d, i: c.post("/api/invoices", json={"party_id": i[0]["id"], "number": "Z2", "amount_paise": 1000, "invoice_date": "2026-10-10", "due_date": d}),
        "promised date": lambda c, d, i: c.patch(f"/api/invoices/{i[4]['id']}", json={"promised_date": d}),
        "order promised": lambda c, d, i: c.post("/api/sales-orders", json={"customer_id": i[0]["id"], "product_id": i[2]["id"], "qty": 5, "promised_date": d}),
        "order start": lambda c, d, i: c.post("/api/sales-orders", json={"customer_id": i[0]["id"], "product_id": i[2]["id"], "qty": 5, "promised_date": "2026-12-01", "earliest_start_date": d}),
        "po arrival": lambda c, d, i: c.post("/api/purchase-orders", json={"supplier_id": i[1]["id"], "material_id": i[3]["id"], "qty": 5, "expected_arrival": d}),
        "payment date": lambda c, d, i: c.post("/api/transactions", json={"party_id": i[0]["id"], "direction": "IN", "amount_paise": 100, "date": d, "medium": "UPI"}),
        "facility from": lambda c, d, i: c.post("/api/settings/facilities", json={"label": "CC", "approved_limit_paise": 100000, "annual_rate_bps": 1100, "drawdown_fee_paise": 0, "available_from": d, "repayment_date": "2100-12-31"}),
        "what-if": lambda c, d, i: c.post("/api/orders/what-if", json={"customer_id": i[0]["id"], "product_id": i[2]["id"], "qty": 5, "promised_date": d}),
        "payment check": lambda c, d, i: c.post("/api/guard/payment-check", json={"amount_paise": 100000, "date": d}),
    }

    def ids(self, c):
        customer = next(p for p in c.get("/api/parties?kind=CUSTOMER").json()["parties"] if p["name"] == "Kaveri Boutique")
        supplier = c.get("/api/parties?kind=SUPPLIER").json()["parties"][0]
        catalogue = c.get("/api/catalogue").json()
        return customer, supplier, catalogue["products"][0], catalogue["materials"][0], c.get(f"/api/parties/{customer['id']}").json()["open_items"][0]

    def test_out_of_range_dates_are_refused_with_a_clean_422(self):
        for d in ("9999-12-31", "0001-01-01", "1999-12-31", "2101-01-01"):
            for name, call in self.ROUTES.items():
                c = sandbox()
                response = call(c, d, self.ids(c))
                self.assertEqual(response.status_code, 422, f"{name} {d} -> {response.status_code}")

    def test_the_extreme_dates_that_are_allowed_leave_every_screen_working(self):
        for d in ("2000-01-01", "2100-12-31"):
            for name, call in self.ROUTES.items():
                c = sandbox()
                response = call(c, d, self.ids(c))
                self.assertLess(response.status_code, 500, f"{name} {d}")
                for path in ("/api/today", "/api/book/summary", "/api/engine/run", "/api/guard", "/api/parties"):
                    self.assertEqual(c.get(path).status_code, 200, f"{path} after {name} {d}")


class N_StockCannotGoNegative(unittest.TestCase):
    def test_an_adjustment_that_would_take_more_than_is_there_is_refused(self):
        c = sandbox()
        material = c.get("/api/inventory").json()["materials"][0]
        too_much = c.post("/api/stock-movements", json={"item_type": "MATERIAL", "item_id": material["id"], "qty_delta": -(material["on_hand"] + 1), "note": "recount"})
        self.assertEqual(too_much.status_code, 422)
        self.assertEqual(too_much.json()["error"]["code"], "NOT_ENOUGH_STOCK")
        after = next(m for m in c.get("/api/inventory").json()["materials"] if m["id"] == material["id"])
        self.assertEqual(after["on_hand"], material["on_hand"])

    def test_taking_out_exactly_what_is_there_is_allowed_and_leaves_zero(self):
        c = sandbox()
        material = c.get("/api/inventory").json()["materials"][0]
        ok = c.post("/api/stock-movements", json={"item_type": "MATERIAL", "item_id": material["id"], "qty_delta": -material["on_hand"], "note": "write off"})
        self.assertEqual(ok.status_code, 200)
        after = next(m for m in c.get("/api/inventory").json()["materials"] if m["id"] == material["id"])
        self.assertEqual(after["on_hand"], 0)

    def test_finished_goods_follow_the_same_rule(self):
        c = sandbox()
        product = c.get("/api/inventory").json()["finished"][0]
        response = c.post("/api/stock-movements", json={"item_type": "PRODUCT", "item_id": product["id"], "qty_delta": -(product["on_hand"] + 5), "note": "recount"})
        self.assertEqual(response.status_code, 422)


class N_TransportAndPageHeaders(unittest.TestCase):
    def test_hsts_only_over_https(self):
        c = sandbox()
        self.assertNotIn("strict-transport-security", c.get("/api/health").headers)
        secure = c.get("/api/health", headers={"X-Forwarded-Proto": "https"})
        self.assertIn("max-age=31536000", secure.headers["strict-transport-security"])

    def test_unknown_pages_are_a_real_404_and_known_pages_are_200(self):
        import tempfile
        from pathlib import Path
        from unittest import mock
        with tempfile.TemporaryDirectory() as folder:  # a stand-in for the built frontend, so the test does not need a build
            (Path(folder) / "index.html").write_text("<html><meta content='%PUBLIC_URL%/og-image.png'></html>", encoding="utf-8")
            (Path(folder) / "favicon.svg").write_text("<svg/>", encoding="utf-8")
            with mock.patch("backend.app.main.DIST", Path(folder)):
                c = client()
                for path, status in (("/login", 200), ("/privacy", 200), ("/terms", 200), ("/app/today", 200), ("/", 200), ("/nope", 404), ("/app/zzz", 404),
                                     ("/.env", 404), ("/assets/missing.js", 404), ("/favicon.svg", 200), ("/robots.txt", 200), ("/sitemap.xml", 200)):
                    self.assertEqual(c.get(path).status_code, status, path)
                self.assertEqual(c.get("/api/nope").json()["error"]["code"], "NOT_FOUND")
                self.assertIn("content='/og-image.png'", c.get("/login").text)  # no PUBLIC_BASE_URL: the share image address stays relative
                with mock.patch.dict("os.environ", {"PUBLIC_BASE_URL": "https://ripple.example"}):
                    self.assertIn("content='https://ripple.example/og-image.png'", c.get("/login").text)
                    self.assertIn("https://ripple.example/privacy", c.get("/sitemap.xml").text)

    def test_robots_and_sitemap_list_only_public_pages(self):
        c = client()
        robots = c.get("/robots.txt").text
        self.assertIn("Disallow: /app/", robots)
        self.assertIn("Disallow: /api/", robots)
        sitemap = c.get("/sitemap.xml")
        self.assertIn("application/xml", sitemap.headers["content-type"])
        for page in ("/login", "/privacy", "/terms"):
            self.assertIn(page, sitemap.text)
        self.assertNotIn("/app/", sitemap.text)

    def test_pages_and_scripts_are_compressed_when_the_browser_asks(self):
        c = client()
        response = c.get("/sitemap.xml", headers={"Accept-Encoding": "gzip"})
        self.assertIn("<urlset", response.text)  # decodes cleanly whether or not it was compressed
        big = c.get("/api/health", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(big.json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
