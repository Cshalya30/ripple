"""The Risk and Finance engine (Guard): safe amounts, payment checks, flags, verification, back-test."""
from __future__ import annotations

import unittest

import time

from support import sandbox, signed_in

from backend.app.core.db import query_one


def business_of(c) -> str:
    return query_one("SELECT business_id FROM user WHERE id = ?", (c.get("/api/me").json()["user"]["id"],))["business_id"]


def wait_for_risk(c, timeout=180):  # generous: the risk run shares the CPU with whatever else is running
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = c.get("/api/risk/forecast").json()
        if body.get("status") in ("READY", "INSUFFICIENT_HISTORY", "UNAVAILABLE"):
            return body
        time.sleep(0.2)
    raise AssertionError("risk did not finish")


def guard(c, **params):
    response = c.get("/api/guard", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def party(c, name):
    return next(p for p in c.get("/api/parties").json()["parties"] if p["name"] == name)


def pay(c, party_id, amount, date="2026-10-13", reference=None, medium="NEFT", direction="OUT", invoice_id=None):
    body = {"party_id": party_id, "direction": direction, "amount_paise": amount, "date": date, "medium": medium}
    if reference:
        body["reference"] = reference
    if invoice_id:
        body["invoice_id"] = invoice_id
    response = c.post("/api/transactions", json=body)
    assert response.status_code in (200, 201), response.text
    return response.json()


class GuardShapeTests(unittest.TestCase):
    def test_payload_has_both_halves_and_a_verdict(self):
        g = guard(sandbox())
        self.assertIn(g["verdict"]["level"], {"ok", "watch", "act"})
        self.assertTrue(g["verdict"]["reasons"])
        for key in ("ladder", "payments", "signals", "series"):
            self.assertIn(key, g["risk"])
        for key in ("flags", "checks", "activity", "opportunities"):
            self.assertIn(key, g["finance"])
        self.assertEqual(g["finance"]["checks_passed"], sum(1 for c in g["finance"]["checks"] if c["ok"]))

    def test_demo_books_reconcile(self):
        g = guard(sandbox())
        failed = [c["id"] for c in g["finance"]["checks"] if not c["ok"]]
        self.assertEqual(failed, [])

    def test_safe_amounts_never_grow_with_the_window_and_stay_whole_thousands(self):
        ladder = guard(sandbox())["risk"]["ladder"]
        plans = [row["plan_paise"] for row in ladder]
        self.assertEqual(plans, sorted(plans, reverse=True))
        for row in ladder:
            self.assertEqual(row["plan_paise"] % 100_000, 0)
            self.assertGreaterEqual(row["plan_paise"], 0)

    def test_cautious_amount_is_never_above_the_plan_when_risk_is_ready(self):
        c = sandbox()
        wait_for_risk(c)
        g = guard(c)
        self.assertEqual(g["risk"]["status"], "READY")
        for row in g["risk"]["ladder"]:
            if row["cautious_paise"] is not None:
                self.assertLessEqual(row["cautious_paise"], row["plan_paise"])

    def test_risk_paths_are_a_spread_of_futures(self):
        c = sandbox()
        forecast = wait_for_risk(c)
        self.assertEqual(forecast["status"], "READY")
        self.assertLessEqual(len(forecast["paths"]), 36)
        self.assertTrue(all(len(p["net"]) == len(forecast["path_days"]) for p in forecast["paths"]))
        lows = [min(p["net"]) for p in forecast["paths"]]
        self.assertEqual(lows, sorted(lows))

    def test_today_carries_the_brief(self):
        brief = sandbox().get("/api/today").json()["guard"]
        self.assertIn(brief["verdict"]["level"], {"ok", "watch", "act"})
        self.assertEqual(brief["checks_total"], 8)

    def test_supervisor_cannot_open_it(self):
        self.assertEqual(signed_in("supervisor@ripple.demo").get("/api/guard").status_code, 403)

    def test_back_test_reports_a_coverage_share(self):
        calibration = guard(sandbox())["calibration"]
        self.assertEqual(calibration["status"], "READY")
        self.assertTrue(0 <= calibration["coverage"] <= 1)
        self.assertEqual(calibration["target"], 0.8)


class PaymentCheckTests(unittest.TestCase):
    def test_existing_bill_gets_four_options_and_a_recommendation(self):
        c = sandbox()
        event_id = guard(c)["risk"]["payments"][0]["event_id"]
        result = c.post("/api/guard/payment-check", json={"event_id": event_id}).json()
        self.assertEqual([o["id"] for o in result["options"]][0], "due")
        self.assertIn(result["best"], [o["id"] for o in result["options"]])
        self.assertTrue(result["recommendation"])
        for option in result["options"]:
            self.assertIn(option["verdict"], {"SAFE", "TIGHT", "SHORTFALL"})

    def test_new_spend_is_never_recommended_as_skipping_it(self):
        c = sandbox()
        result = c.post("/api/guard/payment-check", json={"amount_paise": 15_000_000, "date": "2026-11-10", "label": "New loom"}).json()
        self.assertNotEqual(result["best"], "skip")
        on = next(o for o in result["options"] if o["id"] == "on")
        self.assertLess(on["lowest_change_paise"], 0)  # a real payment deepens the forecast's lowest point
        self.assertIn("deepens", result["recommendation"]) if result["best"] == "on" else None

    def test_every_option_can_be_opened_in_the_engine(self):
        c = sandbox()
        result = c.post("/api/guard/payment-check", json={"amount_paise": 3_000_000, "date": "2026-10-20", "label": "Repair"}).json()
        for option in result["options"]:
            if option["request"]:
                response = c.post("/api/engine/scenario", json=option["request"])
                self.assertEqual(response.status_code, 200, response.text)
                added = [e for e in response.json()["run"]["events"] if e["id"].startswith("adhoc-")]
                self.assertEqual(len(added), 1)

    def test_rejects_missing_input_and_dates_outside_the_forecast(self):
        c = sandbox()
        self.assertEqual(c.post("/api/guard/payment-check", json={}).status_code, 422)
        self.assertEqual(c.post("/api/guard/payment-check", json={"amount_paise": 100_000, "date": "2027-12-01"}).status_code, 422)
        self.assertEqual(c.post("/api/guard/payment-check", json={"event_id": "nope"}).status_code, 422)
        self.assertEqual(c.post("/api/guard/payment-check", json={"amount_paise": -5, "date": "2026-10-20"}).status_code, 422)

    def test_pay_early_and_add_payment_are_validated_scenarios(self):
        c = sandbox()
        bill = next(p for p in guard(c)["risk"]["payments"] if p["due_date"] > "2026-10-16")
        ok = c.post("/api/engine/scenario", json={"kind": "PAY_EARLY", "event_id": bill["event_id"], "date": "2026-10-14"})
        self.assertEqual(ok.status_code, 200, ok.text)
        later = c.post("/api/engine/scenario", json={"kind": "PAY_EARLY", "event_id": bill["event_id"], "date": "2026-12-30"})
        self.assertEqual(later.status_code, 422)
        self.assertEqual(c.post("/api/engine/scenario", json={"kind": "ADD_PAYMENT", "date": "2026-10-20"}).status_code, 422)


class FlagTests(unittest.TestCase):
    def test_a_repeated_payment_is_flagged_and_dismissing_it_hides_it(self):
        c = sandbox()
        supplier = party(c, "Gopal Cotton Spinners")
        pay(c, supplier["id"], 2_345_000, reference="UTR9911")
        pay(c, supplier["id"], 2_345_000, reference="UTR9911")
        flags = guard(c)["finance"]["flags"]
        dup = next(f for f in flags["open"] if f["rule"] == "DUPLICATE")
        self.assertEqual(dup["severity"], "high")
        self.assertEqual(dup["party_name"], "Gopal Cotton Spinners")
        self.assertEqual(c.post("/api/guard/flags/review", json={"flag_key": dup["key"], "verdict": "DISMISSED"}).status_code, 200)
        after = guard(c)["finance"]["flags"]
        self.assertFalse([f for f in after["open"] if f["key"] == dup["key"]])
        self.assertEqual(next(r for r in after["rules"] if r["rule"] == "DUPLICATE")["dismissed"], 1)

    def test_confirming_keeps_it_visible_and_counts_toward_precision(self):
        c = sandbox()
        supplier = party(c, "Gopal Cotton Spinners")
        pay(c, supplier["id"], 1_234_000, reference="R1")
        pay(c, supplier["id"], 1_234_000, reference="R1")
        dup = next(f for f in guard(c)["finance"]["flags"]["open"] if f["rule"] == "DUPLICATE")
        c.post("/api/guard/flags/review", json={"flag_key": dup["key"], "verdict": "CONFIRMED"})
        flags = guard(c)["finance"]["flags"]
        self.assertTrue([f for f in flags["confirmed"] if f["key"] == dup["key"]])
        rule = next(r for r in flags["rules"] if r["rule"] == "DUPLICATE")
        self.assertEqual((rule["confirmed"], rule["precision"]), (1, 1.0))
        c.post("/api/guard/flags/review", json={"flag_key": dup["key"], "verdict": "OPEN"})
        self.assertTrue([f for f in guard(c)["finance"]["flags"]["open"] if f["key"] == dup["key"]])

    def test_two_different_bills_of_the_same_amount_are_not_a_duplicate(self):
        c = sandbox()
        supplier = party(c, "Gopal Cotton Spinners")
        bills = c.get(f"/api/parties/{supplier['id']}").json()["open_items"][:2]
        if len(bills) < 2:
            self.skipTest("demo has fewer than two open bills for this supplier")
        pay(c, supplier["id"], 500_000, invoice_id=bills[0]["id"])
        pay(c, supplier["id"], 500_000, invoice_id=bills[1]["id"])
        self.assertFalse([f for f in guard(c)["finance"]["flags"]["open"] if f["rule"] == "DUPLICATE"])

    def test_a_cash_receipt_over_two_lakh_is_flagged(self):
        c = sandbox()
        customer = party(c, "Fashion Junction")
        pay(c, customer["id"], 22_000_000, direction="IN", medium="CASH")
        flag = next(f for f in guard(c)["finance"]["flags"]["open"] if f["rule"] == "CASH")
        self.assertEqual(flag["severity"], "high")

    def test_missed_reports_are_counted_and_unknown_rules_refused(self):
        c = sandbox()
        self.assertEqual(c.post("/api/guard/missed", json={"rule": "DUPLICATE", "note": "Paid the same bill twice in cash"}).status_code, 200)
        rules = guard(c)["finance"]["flags"]["rules"]
        self.assertEqual(next(r for r in rules if r["rule"] == "DUPLICATE")["missed"], 1)
        self.assertEqual(c.post("/api/guard/missed", json={"rule": "MADEUP", "note": "nope nope"}).status_code, 422)
        self.assertEqual(c.post("/api/guard/flags/review", json={"flag_key": "MADEUP:1", "verdict": "DISMISSED"}).status_code, 422)

    def test_outlier_sensitivity_rises_after_repeated_fine_verdicts(self):
        from backend.app.services.guard import _outlier_multiplier
        self.assertEqual(_outlier_multiplier({"confirmed": 0, "dismissed": 0, "missed": 0}), 3.0)
        self.assertEqual(_outlier_multiplier({"confirmed": 0, "dismissed": 4, "missed": 0}), 4.0)
        self.assertEqual(_outlier_multiplier({"confirmed": 1, "dismissed": 3, "missed": 0}), 3.5)
        self.assertEqual(_outlier_multiplier({"confirmed": 0, "dismissed": 99, "missed": 0}), 5.0)
        self.assertEqual(_outlier_multiplier({"confirmed": 5, "dismissed": 0, "missed": 0}), 3.0)

    def test_reviews_belong_to_one_business(self):
        a, b = sandbox(), sandbox()
        a.post("/api/guard/missed", json={"rule": "CASH", "note": "A cash payment I did not see flagged"})
        rules = guard(b)["finance"]["flags"]["rules"]
        self.assertEqual(next(r for r in rules if r["rule"] == "CASH")["missed"], 0)


class OpportunityTests(unittest.TestCase):
    def test_offers_use_the_cautious_amount_and_move_with_the_assumed_return(self):
        from backend.app.services import guard as g, runs
        c = sandbox()
        business_id = business_of(c)
        run = runs.baseline(business_id)
        ladder = [{"days": 30, "plan_paise": 5_000_000, "cautious_paise": 4_000_000, "binding_day": 9, "binding_date": "2026-10-23"}]
        low = next(i for i in g.opportunities(business_id, run, ladder, 300)["items"] if i["id"] == "idle-cash")
        high = next(i for i in g.opportunities(business_id, run, ladder, 900)["items"] if i["id"] == "idle-cash")
        self.assertEqual(low["amount_paise"], 4_000_000)  # the cautious figure, not the plan's
        self.assertEqual(high["amount_paise"], 4_000_000)
        self.assertEqual((low["gain_paise"], high["gain_paise"]), (round(4_000_000 * 0.03 * 30 / 365), round(4_000_000 * 0.09 * 30 / 365)))

    def test_a_cautious_zero_withdraws_the_cash_offer_even_if_the_plan_is_positive(self):
        from backend.app.services import guard as g, runs
        c = sandbox()
        business_id = business_of(c)
        ladder = [{"days": 30, "plan_paise": 5_000_000, "cautious_paise": 0, "binding_day": 9, "binding_date": "2026-10-23"}]
        ids = [i["id"] for i in g.opportunities(business_id, runs.baseline(business_id), ladder, 650)["items"]]
        self.assertNotIn("idle-cash", ids)

    def test_no_cash_offer_when_nothing_is_safe(self):
        from backend.app.services import guard as g, runs
        c = sandbox()
        business_id = business_of(c)
        offers = g.opportunities(business_id, runs.baseline(business_id),
                                 [{"days": 7, "plan_paise": 0, "cautious_paise": 0, "binding_day": 2, "binding_date": "2026-10-16"}], 650)
        ids = [i["id"] for i in offers["items"]]
        self.assertNotIn("idle-cash", ids)
        self.assertFalse([i for i in ids if i.startswith("early-")])

    def test_the_reason_is_given_when_the_list_is_empty(self):
        from backend.app.services import guard as g, runs
        c = sandbox()
        business_id = business_of(c)
        run = runs.baseline(business_id)
        original = g.inventory_rows
        g.inventory_rows = lambda *_a, **_k: {"materials": []}
        try:
            offers = g.opportunities(business_id, run, [{"days": 7, "plan_paise": 0, "cautious_paise": 0, "binding_day": 2, "binding_date": "2026-10-16"}], 650)
        finally:
            g.inventory_rows = original
        self.assertEqual(offers["items"], [])
        self.assertIn("no cash is safe", offers["reason_none"])

    def test_yield_is_bounded(self):
        c = sandbox()
        self.assertEqual(c.get("/api/guard", params={"yield_bp": 99999}).status_code, 422)
        self.assertEqual(c.get("/api/guard", params={"yield_bp": -1}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
