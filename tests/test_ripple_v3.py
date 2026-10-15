"""Order reversal, settings validation and the CSV datasheets."""
from __future__ import annotations

import csv
import io
import unittest

from support import sandbox, signed_in

from backend.app.core.db import query


def books(c):
    """Everything an order step can touch, so a forward step followed by its undo can be compared."""
    inv = c.get("/api/inventory").json()
    materials = {m["sku"]: m["on_hand"] for m in inv["materials"]}
    finished = {p["sku"]: p["on_hand"] for p in inv["finished"]}
    txns = c.get("/api/transactions").json()
    parties = c.get("/api/parties?kind=CUSTOMER").json()["parties"]
    return {"materials": materials, "finished": finished, "txn_count": txns["count"], "outstanding": sum(p["outstanding_paise"] for p in parties)}


def order(c, number):
    return next(o for o in c.get("/api/sales-orders").json()["orders"] if o["number"] == number)


class OrderReversalTests(unittest.TestCase):
    def test_every_forward_step_can_be_undone_exactly(self):
        c = sandbox()
        so = order(c, "SO-0113")
        start = books(c)
        for stage in ("IN_PRODUCTION", "READY", "DELIVERED"):
            self.assertEqual(c.patch(f"/api/sales-orders/{so['id']}", json={"stage": stage}).status_code, 200)
        self.assertNotEqual(books(c), start)
        for stage in ("READY", "IN_PRODUCTION", "MATERIALS_READY"):
            response = c.patch(f"/api/sales-orders/{so['id']}", json={"stage": stage})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(books(c), start)
        self.assertEqual(order(c, "SO-0113")["stage"], "MATERIALS_READY")

    def test_multi_step_undo_in_one_call(self):
        c = sandbox()
        so = order(c, "SO-0113")
        start = books(c)
        for stage in ("IN_PRODUCTION", "READY", "DELIVERED"):
            c.patch(f"/api/sales-orders/{so['id']}", json={"stage": stage})
        self.assertEqual(c.patch(f"/api/sales-orders/{so['id']}", json={"stage": "PLANNED"}).status_code, 200)
        self.assertEqual(books(c), start)
        self.assertEqual(order(c, "SO-0113")["stage"], "PLANNED")

    def test_undo_restores_forecast_and_start_date(self):
        c = sandbox()
        before = order(c, "SO-0113")
        original_start = query("SELECT earliest_start_date FROM sales_order WHERE id = ?", (before["id"],))[0]["earliest_start_date"]
        c.patch(f"/api/sales-orders/{before['id']}", json={"stage": "IN_PRODUCTION"})
        moved = query("SELECT earliest_start_date FROM sales_order WHERE id = ?", (before["id"],))[0]["earliest_start_date"]
        c.patch(f"/api/sales-orders/{before['id']}", json={"stage": "PLANNED"})
        after = order(c, "SO-0113")
        restored = query("SELECT earliest_start_date FROM sales_order WHERE id = ?", (before["id"],))[0]["earliest_start_date"]
        self.assertEqual(restored, original_start)
        self.assertEqual(moved, "2026-10-14")
        self.assertEqual(after["forecast_delivery"], before["forecast_delivery"])
        self.assertEqual(after["last_change"]["direction"], "BACK")

    def test_undo_blocked_when_invoice_has_payments(self):
        c = sandbox()
        so = order(c, "SO-0113")
        for stage in ("IN_PRODUCTION", "READY", "DELIVERED"):
            c.patch(f"/api/sales-orders/{so['id']}", json={"stage": stage})
        invoice = next(i for i in c.get(f"/api/parties/{so['customer_id']}").json()["open_items"] if i["number"] == "SO-0113-INV")
        paid = c.post("/api/transactions", json={"party_id": so["customer_id"], "direction": "IN", "amount_paise": 1000, "date": "2026-10-14",
                                                 "medium": "UPI", "invoice_id": invoice["id"]})
        self.assertEqual(paid.status_code, 200, paid.text)
        response = c.patch(f"/api/sales-orders/{so['id']}", json={"stage": "READY"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "INVOICE_HAS_PAYMENTS")
        self.assertEqual(order(c, "SO-0113")["stage"], "DELIVERED")  # nothing half-undone

    def test_paid_order_cannot_be_reversed(self):
        c = sandbox()
        so = order(c, "SO-0113")
        for stage in ("IN_PRODUCTION", "READY", "DELIVERED"):
            c.patch(f"/api/sales-orders/{so['id']}", json={"stage": stage})
        invoice = next(i for i in c.get(f"/api/parties/{so['customer_id']}").json()["open_items"] if i["number"] == "SO-0113-INV")
        c.post("/api/transactions", json={"party_id": so["customer_id"], "direction": "IN", "amount_paise": invoice["amount_paise"], "date": "2026-10-14",
                                          "medium": "UPI", "invoice_id": invoice["id"]})
        self.assertEqual(order(c, "SO-0113")["stage"], "PAID")
        response = c.patch(f"/api/sales-orders/{so['id']}", json={"stage": "DELIVERED"})
        self.assertEqual(response.json()["error"]["code"], "ORDER_ALREADY_PAID")

    def test_cannot_take_back_finished_goods_already_used(self):
        c = sandbox()
        so = order(c, "SO-0113")
        for stage in ("IN_PRODUCTION", "READY"):
            c.patch(f"/api/sales-orders/{so['id']}", json={"stage": stage})
        product = next(p for p in c.get("/api/inventory").json()["finished"] if p["sku"] == "FG-DH-004")
        c.post("/api/stock-movements", json={"item_type": "PRODUCT", "item_id": product["id"], "qty_delta": -product["on_hand"], "note": "sold at the shop"})
        response = c.patch(f"/api/sales-orders/{so['id']}", json={"stage": "IN_PRODUCTION"})
        self.assertEqual(response.json()["error"]["code"], "NOT_ENOUGH_FINISHED_STOCK")
        self.assertEqual(order(c, "SO-0113")["stage"], "READY")

    def test_supervisor_can_undo_floor_steps_but_not_a_delivery(self):
        sup = signed_in("supervisor@ripple.demo")
        demo = order(sup, "SO-0113")
        self.assertEqual(sup.patch(f"/api/sales-orders/{demo['id']}", json={"stage": "IN_PRODUCTION"}).status_code, 200)
        self.assertEqual(sup.patch(f"/api/sales-orders/{demo['id']}", json={"stage": "READY"}).status_code, 200)
        self.assertEqual(sup.patch(f"/api/sales-orders/{demo['id']}", json={"stage": "IN_PRODUCTION"}).status_code, 200)
        self.assertEqual(sup.patch(f"/api/sales-orders/{demo['id']}", json={"stage": "READY"}).status_code, 200)
        self.assertEqual(sup.patch(f"/api/sales-orders/{demo['id']}", json={"stage": "DELIVERED"}).status_code, 200)
        self.assertEqual(sup.patch(f"/api/sales-orders/{demo['id']}", json={"stage": "READY"}).status_code, 403)
        owner = signed_in()
        # put the shared demo order back for the other tests
        self.assertEqual(owner.patch(f"/api/sales-orders/{demo['id']}", json={"stage": "PLANNED"}).status_code, 200)

    def test_same_stage_and_paid_target_are_refused(self):
        c = sandbox()
        so = order(c, "SO-0113")
        self.assertEqual(c.patch(f"/api/sales-orders/{so['id']}", json={"stage": "PLANNED"}).status_code, 422)
        self.assertEqual(c.patch(f"/api/sales-orders/{so['id']}", json={"stage": "PAID"}).status_code, 422)


class PurchaseUndoTests(unittest.TestCase):
    def po(self, c, number):
        return next(o for o in c.get("/api/purchase-orders").json()["orders"] if o["number"] == number)

    def test_undo_received_removes_stock_and_bill(self):
        c = sandbox()
        po = self.po(c, "PO-0118")
        start = books(c)
        c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "ARRIVED"})
        self.assertNotEqual(books(c)["materials"], start["materials"])
        self.assertEqual(c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"}).status_code, 200)
        self.assertEqual(books(c), start)
        self.assertEqual(self.po(c, "PO-0118")["status"], "ORDERED")

    def test_undo_received_after_advance_goes_back_to_paid(self):
        c = sandbox()
        po = self.po(c, "PO-0119")  # silk thread, paid in advance
        start = books(c)
        c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "PAID"})
        c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "ARRIVED"})
        c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"})
        self.assertEqual(self.po(c, "PO-0119")["status"], "PAID")
        c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"})
        self.assertEqual(self.po(c, "PO-0119")["status"], "ORDERED")
        self.assertEqual(books(c), start)

    def test_undo_refused_when_material_already_used(self):
        c = sandbox()
        po = self.po(c, "PO-0118")
        c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "ARRIVED"})
        material = next(m for m in c.get("/api/inventory").json()["materials"] if m["sku"] == "RM-YRN-C40")
        c.post("/api/stock-movements", json={"item_type": "MATERIAL", "item_id": material["id"], "qty_delta": -material["on_hand"], "note": "used"})
        response = c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"})
        self.assertEqual(response.json()["error"]["code"], "NOT_ENOUGH_MATERIAL_TO_REVERSE")
        self.assertEqual(self.po(c, "PO-0118")["status"], "ARRIVED")

    def test_cancelled_can_be_reopened_and_ordered_cannot_be_undone(self):
        c = sandbox()
        po = self.po(c, "PO-0118")
        self.assertEqual(c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"}).status_code, 422)
        c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "CANCELLED"})
        self.assertEqual(c.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"}).status_code, 200)
        self.assertEqual(self.po(c, "PO-0118")["status"], "ORDERED")


class PurchaseRoleTests(unittest.TestCase):
    def test_cancelling_and_reopening_are_finance_decisions(self):
        owner = signed_in()
        po = next(o for o in owner.get("/api/purchase-orders").json()["orders"] if o["number"] == "PO-0120")
        sup = signed_in("supervisor@ripple.demo")
        self.assertEqual(sup.patch(f"/api/purchase-orders/{po['id']}", json={"status": "CANCELLED"}).status_code, 403)
        self.assertEqual(owner.patch(f"/api/purchase-orders/{po['id']}", json={"status": "CANCELLED"}).status_code, 200)
        try:
            self.assertEqual(sup.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"}).status_code, 403)
        finally:
            self.assertEqual(owner.patch(f"/api/purchase-orders/{po['id']}", json={"status": "UNDO"}).status_code, 200)  # leave the shared demo as found


class ScenarioChanceTests(unittest.TestCase):
    def test_chance_status_is_available_without_re_running_the_fix(self):
        c = sandbox()
        r = c.post("/api/engine/scenario/chance", json={"fix_id": "split-supplier"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn(r.json()["chance_after"]["status"], ("COMPUTING", "MISSING", "READY", "UNAVAILABLE", "INSUFFICIENT_HISTORY"))
        self.assertEqual(c.post("/api/engine/scenario/chance", json={"fix_id": "no-such-fix"}).status_code, 404)
        self.assertEqual(signed_in("supervisor@ripple.demo").post("/api/engine/scenario/chance", json={"fix_id": "split-supplier"}).status_code, 403)


class SettingsTests(unittest.TestCase):
    def test_save_profile_and_clear_a_field(self):
        c = sandbox()
        r = c.put("/api/settings/business", json={"name": "  Test   Looms ", "owner_name": "Asha", "gstin": "33aajfm4721k1z9",
                                                  "udyam_number": "udyam-tn-08-0012345", "msme_category": "SMALL", "address": ""})
        self.assertEqual(r.status_code, 200, r.text)
        b = r.json()["business"]
        self.assertEqual((b["name"], b["gstin"], b["udyam_number"], b["address"]), ("Test Looms", "33AAJFM4721K1Z9", "UDYAM-TN-08-0012345", None))
        r = c.put("/api/settings/business", json={"gstin": None, "msme_category": None})
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["business"]["gstin"], r.json()["business"]["msme_category"]), (None, None))
        self.assertEqual(c.get("/api/me").json()["business"]["name"], "Test Looms")

    def test_bad_values_are_refused_with_a_reason(self):
        c = sandbox()
        for body in ({"gstin": "12345"}, {"gstin": "00AAJFM4721K1Z9"}, {"gstin": "33AAJFM4721K1X9"}, {"udyam_number": "UDYAM-TN-8-1"},
                     {"name": "   "}, {"name": None}, {"fy_start": "02-30"}, {"fy_start": "13-01"}):
            r = c.put("/api/settings/business", json=body)
            self.assertEqual(r.status_code, 422, body)
            self.assertEqual(r.json()["error"]["code"], "VALIDATION_ERROR", body)

    def test_horizon_change_reaches_the_engine_and_me(self):
        c = sandbox()
        for days in (30, 180, 90):
            r = c.put("/api/settings/money", json={"horizon_days": days})
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.json()["money"]["horizon_days"], days)
            self.assertEqual(c.get("/api/engine/run").json()["horizon_days"], days)
            self.assertEqual(c.get("/api/me").json()["business"]["horizon_days"], days)
        self.assertEqual(c.put("/api/settings/money", json={"horizon_days": 45}).status_code, 422)

    def test_money_rules_validate(self):
        c = sandbox()
        self.assertEqual(c.put("/api/settings/money", json={"safety_buffer_paise": 7500000}).status_code, 200)
        self.assertEqual(c.put("/api/settings/money", json={"safety_buffer_paise": -1}).status_code, 422)
        self.assertEqual(c.put("/api/settings/money", json={"default_customer_terms_days": 400}).status_code, 422)
        self.assertEqual(c.post("/api/settings/recurring", json={"label": "  ", "amount_paise": 100, "day_of_month": 5}).status_code, 422)
        self.assertEqual(c.post("/api/settings/recurring", json={"label": "Water", "amount_paise": 0, "day_of_month": 5}).status_code, 422)
        self.assertEqual(c.post("/api/settings/recurring", json={"label": "Water", "amount_paise": 500000, "day_of_month": 32}).status_code, 422)
        self.assertEqual(c.post("/api/settings/recurring", json={"label": "Water", "amount_paise": 500000, "day_of_month": 31}).status_code, 200)
        bad = {"label": "OD", "approved_limit_paise": 100000, "annual_rate_bps": 1200, "drawdown_fee_paise": 0,
               "available_from": "2026-11-01", "repayment_date": "2026-10-01"}
        self.assertEqual(c.post("/api/settings/facilities", json=bad).status_code, 422)

    def test_only_the_owner_edits_the_profile(self):
        c = signed_in("accountant@ripple.demo")
        self.assertEqual(c.put("/api/settings/business", json={"name": "Hijack"}).status_code, 403)


class MigrationTests(unittest.TestCase):
    def test_an_older_database_gains_the_stage_history_column(self):
        import sqlite3
        from backend.app.core import db
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        old = db.SCHEMA.replace("  stage_history_json TEXT NOT NULL DEFAULT '[]',\n", "")
        self.assertNotIn("stage_history_json", old)
        conn.executescript(old)
        db._migrate(conn)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(sales_order)").fetchall()}
        self.assertIn("stage_history_json", columns)
        db._migrate(conn)  # running it again is harmless


class MaterialTests(unittest.TestCase):
    def supplier(self, c):
        return next(p for p in c.get("/api/parties?kind=SUPPLIER").json()["parties"] if p["name"] == "Sharma Yarn Mills")

    def test_new_material_shows_up_everywhere_it_matters(self):
        c = sandbox()
        sup = self.supplier(c)
        r = c.post("/api/materials", json={"name": "Indigo dye", "unit": "kg", "cost_paise": 120000, "opening_qty": 2.5,
                                           "supplier_id": sup["id"], "reorder_safety_days": 10})
        self.assertEqual(r.status_code, 200, r.text)
        material = r.json()["material"]
        self.assertEqual((material["sku"], material["unit"], material["base_unit"], material["unit_factor"]), ("RM-IND", "kg", "g", 1000))
        row = next(m for m in c.get("/api/inventory").json()["materials"] if m["id"] == material["id"])
        self.assertEqual(row["on_hand"], 2500)
        self.assertEqual(row["stock_value_paise"], 300000)  # 2.5 kg x Rs 1,200
        self.assertEqual(row["main_supplier"]["name"], "Sharma Yarn Mills")
        self.assertIn(material["id"], [m["id"] for m in c.get("/api/catalogue").json()["materials"]])
        moves = c.get("/api/stock-movements").json()["movements"]
        self.assertTrue(any(m["item_id"] == material["id"] and m["note"] == "Opening stock" for m in moves))
        self.assertIn("Indigo dye", c.get(f"/api/parties/{sup['id']}").json()["party"]["tags"])
        self.assertIn("Indigo dye", c.get("/api/export/company/datasheet.csv").content.decode("utf-8"))
        self.assertTrue(any(s["material_id"] == material["id"] for s in c.get("/api/engine/run").json()["stock"]))

    def test_new_material_without_stock_is_not_a_reorder_alarm(self):
        c = sandbox()
        before = c.get("/api/inventory").json()["summary"]["reorder_count"]
        material = c.post("/api/materials", json={"name": "Hook", "unit": "pc"}).json()["material"]
        inv = c.get("/api/inventory").json()
        self.assertEqual(next(m for m in inv["materials"] if m["id"] == material["id"])["status"], "UNUSED")
        self.assertEqual(inv["summary"]["reorder_count"], before)
        stocked = c.post("/api/materials", json={"name": "Buttons", "unit": "pc", "opening_qty": 300}).json()["material"]
        row = next(m for m in c.get("/api/inventory").json()["materials"] if m["id"] == stocked["id"])
        self.assertEqual(row["status"], "UNUSED")  # stocked but not used yet is "not used yet", not "slow"

    def test_duplicate_and_bad_input(self):
        c = sandbox()
        self.assertEqual(c.post("/api/materials", json={"name": "cotton YARN 40s combed", "unit": "kg"}).json()["error"]["code"], "MATERIAL_EXISTS")
        self.assertEqual(c.post("/api/materials", json={"name": "Lace", "sku": "rm-yrn-c40", "unit": "m"}).json()["error"]["code"], "SKU_EXISTS")
        self.assertEqual(c.post("/api/materials", json={"name": "Lace", "unit": "yards"}).status_code, 422)
        self.assertEqual(c.post("/api/materials", json={"name": "Lace", "unit": "m", "opening_qty": -1}).status_code, 422)
        self.assertEqual(c.post("/api/materials", json={"name": "Lace", "unit": "pc", "opening_qty": 2.5}).json()["error"]["code"], "QUANTITY_TOO_PRECISE")
        self.assertEqual(c.post("/api/materials", json={"name": "   ", "unit": "pc"}).status_code, 422)
        owner_party = c.get("/api/parties?kind=CUSTOMER").json()["parties"][0]
        self.assertEqual(c.post("/api/materials", json={"name": "Lace", "unit": "pc", "supplier_id": owner_party["id"]}).json()["error"]["code"], "NOT_A_SUPPLIER")
        self.assertEqual(signed_in("supervisor@ripple.demo").post("/api/materials", json={"name": "Lace", "unit": "pc"}).status_code, 403)

    def test_edit_and_delete_rules(self):
        c = sandbox()
        material = c.post("/api/materials", json={"name": "Lace", "unit": "m", "opening_qty": 4, "cost_paise": 5000}).json()["material"]
        self.assertEqual(c.patch(f"/api/materials/{material['id']}", json={"name": "   "}).status_code, 422)
        r = c.patch(f"/api/materials/{material['id']}", json={"name": "Cotton lace", "cost_paise": 6000})
        self.assertEqual(r.json()["material"]["name"], "Cotton lace")
        self.assertEqual(c.patch(f"/api/materials/{material['id']}", json={"unit": "kg"}).status_code, 422)
        used = next(m for m in c.get("/api/inventory").json()["materials"] if m["sku"] == "RM-YRN-C40")
        self.assertEqual(c.delete(f"/api/materials/{used['id']}").json()["error"]["code"], "MATERIAL_IN_USE")
        self.assertEqual(c.delete(f"/api/materials/{material['id']}").status_code, 200)  # only its opening stock hung on it
        self.assertNotIn(material["id"], [m["id"] for m in c.get("/api/inventory").json()["materials"]])

    def test_material_can_join_a_recipe_and_is_then_protected(self):
        c = sandbox()
        material = c.post("/api/materials", json={"name": "Hook", "unit": "pc", "opening_qty": 500}).json()["material"]
        recipe = next(r for r in c.get("/api/inventory").json()["recipes"] if r["sku"] == "FG-CS-001")
        lines = [{"material_id": l["material_id"], "qty_per_piece": l["qty_per_piece"], "wastage_bp": l["wastage_bp"]} for l in recipe["lines"]]
        r = c.put(f"/api/recipes/{recipe['product_id']}", json={"lines": lines + [{"material_id": material["id"], "qty_per_piece": 2, "wastage_bp": 0}]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(c.delete(f"/api/materials/{material['id']}").json()["error"]["code"], "MATERIAL_IN_USE")
        row = next(m for m in c.get("/api/inventory").json()["materials"] if m["id"] == material["id"])
        self.assertGreater(row["needed"], 0)  # open cotton-saree orders now need hooks
        dup = c.put(f"/api/recipes/{recipe['product_id']}", json={"lines": lines + [lines[0]]})
        self.assertEqual(dup.json()["error"]["code"], "DUPLICATE_MATERIAL")


def rows_of(response):
    return list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))


def value_of(rows, key):
    return next(row[1] for row in rows if len(row) > 1 and row[0] == key)


class DatasheetTests(unittest.TestCase):
    def setUp(self):
        self.c = signed_in()
        parties = self.c.get("/api/parties").json()["parties"]
        self.customer = next(p for p in parties if p["name"] == "Kaveri Boutique")
        self.supplier = next(p for p in parties if p["name"] == "Sharma Yarn Mills")

    def test_customer_sheet_is_a_clean_utf8_csv_for_one_party(self):
        r = self.c.get(f"/api/export/party/{self.customer['id']}/datasheet.csv")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content.startswith(b"\xef\xbb\xbf"))
        self.assertIn("attachment", r.headers["content-disposition"])
        self.assertIn("kaveri-boutique", r.headers["content-disposition"])
        rows = rows_of(r)
        flat = [cell for row in rows for cell in row]
        self.assertIn("Kaveri Boutique", flat)
        self.assertNotIn("Sharma Yarn Mills", flat)
        sections = [row[0] for row in rows if len(row) == 1 and row[0].isupper()]
        for name in ("PROFILE", "SUMMARY", "OPEN INVOICES", "ALL INVOICES", "PAYMENTS", "IN THE FORECAST", "NOTES"):
            self.assertIn(name, sections)
        outstanding = value_of(rows, "Outstanding")
        self.assertEqual(outstanding, f"{self.customer['outstanding_paise'] // 100}.{self.customer['outstanding_paise'] % 100:02d}")

    def test_supplier_sheet_lists_purchase_orders(self):
        rows = rows_of(self.c.get(f"/api/export/party/{self.supplier['id']}/datasheet.csv"))
        sections = [row[0] for row in rows if len(row) == 1 and row[0].isupper()]
        self.assertIn("PURCHASE ORDERS", sections)
        self.assertNotIn("SALES ORDERS", sections)
        self.assertEqual(value_of(rows, "Type"), "Supplier")

    def test_company_sheet_totals_match_the_book(self):
        rows = rows_of(self.c.get("/api/export/company/datasheet.csv"))
        book = self.c.get("/api/book/summary").json()["position"]
        cash = value_of(rows, "Cash now")
        self.assertEqual(cash, f"{book['cash_now_paise'] // 100}.{book['cash_now_paise'] % 100:02d}")
        sections = [row[0] for row in rows if len(row) == 1 and row[0].isupper()]
        for name in ("BUSINESS PROFILE", "POSITION TODAY", "FORECAST", "CUSTOMERS", "SUPPLIERS", "RAW MATERIAL STOCK"):
            self.assertIn(name, sections)

    def test_negative_numbers_stay_numbers_and_text_is_defused(self):
        company = rows_of(self.c.get("/api/export/company/datasheet.csv"))
        lowest = value_of(company, "Lowest net position")
        self.assertTrue(lowest.startswith("-") and lowest[1].isdigit(), lowest)
        sandboxed = sandbox()
        customer = sandboxed.get("/api/parties?kind=CUSTOMER").json()["parties"][0]
        sandboxed.post(f"/api/parties/{customer['id']}/notes", json={"text": "=HYPERLINK(\"http://evil\")"})
        cells = [cell for row in rows_of(sandboxed.get(f"/api/export/party/{customer['id']}/datasheet.csv")) for cell in row]
        self.assertIn("'=HYPERLINK(\"http://evil\")", cells)

    def test_access_rules(self):
        self.assertEqual(self.c.get("/api/export/party/not-a-party/datasheet.csv").status_code, 404)
        other = sandbox()
        self.assertEqual(other.get(f"/api/export/party/{self.customer['id']}/datasheet.csv").status_code, 404)
        sup = signed_in("supervisor@ripple.demo")
        self.assertEqual(sup.get("/api/export/company/datasheet.csv").status_code, 403)
        self.assertEqual(sup.get(f"/api/export/party/{self.customer['id']}/datasheet.csv").status_code, 403)


if __name__ == "__main__":
    unittest.main()
