"""Track A (X27, X6): the engine's answers checked against arithmetic done outside the engine.

Each scenario changes one thing, so the expected change in net position can be written down from first principles:
  - a new payment of X on day d lowers net position by exactly X from day d on;
  - moving a bill's due date out by n days raises net position by the bill's amount between the old and new due day;
  - a receipt that arrives n days later lowers net position by its amount in between;
  - paying a bill in two halves keeps half of it unpaid (so net is higher by half) until the second half is due.
These hold while cash is plentiful, so the checks stay inside the first weeks of the demo forecast.
"""
from __future__ import annotations

import time
import unittest

from support import sandbox

AMOUNT = 1_000_000  # Rs 10,000 in paise


def series(c, scenario=None):
    return {p["day"]: p for p in (scenario or c.get("/api/engine/run").json())["series"]}


def scenario(c, body):
    response = c.post("/api/engine/scenario", json=body)
    assert response.status_code == 200, response.text
    return {p["day"]: p for p in response.json()["evaluation"]["series"]}


def deltas(base, other, days):
    return {d: other[d]["net_paise"] - base[d]["net_paise"] for d in days}


class ScenarioArithmeticTests(unittest.TestCase):
    def test_a_new_payment_lowers_net_by_exactly_its_amount_from_its_day(self):
        c = sandbox()
        base = series(c)
        other = scenario(c, {"kind": "ADD_PAYMENT", "amount_paise": AMOUNT, "date": "2026-10-20", "label": "recompute"})  # day 6
        change = deltas(base, other, range(0, 31))
        self.assertTrue(all(v == 0 for d, v in change.items() if d < 6), change)
        self.assertTrue(all(v == -AMOUNT for d, v in change.items() if d >= 6), change)

    def test_extending_a_bill_raises_net_by_its_amount_until_the_new_due_day(self):
        c = sandbox()
        run = c.get("/api/engine/run").json()
        bill = next(e for e in sorted(run["events"], key=lambda e: e["due_day"] if e.get("due_day") is not None else 999)
                    if e["type"] == "SUPPLIER_PAYMENT" and e.get("due_day") is not None and e["executed_day"] == e["due_day"])
        base = series(c, run)
        other = scenario(c, {"kind": "EXTENSION", "event_id": bill["id"], "days": 10})
        change = deltas(base, other, range(0, 30))
        start = bill["due_day"]
        self.assertTrue(all(v == 0 for d, v in change.items() if d < start), change)
        self.assertTrue(all(v == bill["amount_paise"] for d, v in change.items() if start <= d < start + 10), change)
        self.assertTrue(all(v == 0 for d, v in change.items() if d >= start + 10), change)

    def test_a_receipt_arriving_later_lowers_net_by_its_amount_in_between(self):
        c = sandbox()
        run = c.get("/api/engine/run").json()
        receipt = next(e for e in run["events"] if e["type"] == "CASH_RECEIPT" and e["executed_day"] is not None and 5 <= e["executed_day"] <= 20)
        base = series(c, run)
        later = (c.get("/api/me").json()["today"])
        from datetime import date, timedelta
        new_date = (date.fromisoformat(receipt["executed_date"]) + timedelta(days=5)).isoformat()
        other = scenario(c, {"kind": "MOVE_RECEIPT_DATE", "event_id": receipt["id"], "date": new_date})
        change = deltas(base, other, range(0, 30))
        start = receipt["executed_day"]
        self.assertTrue(all(v == 0 for d, v in change.items() if d < start), change)
        self.assertTrue(all(v == -receipt["amount_paise"] for d, v in change.items() if start <= d < start + 5), change)
        self.assertIsNotNone(later)

    def test_paying_a_bill_in_two_halves_leaves_half_unpaid_until_the_second_is_due(self):
        c = sandbox()
        run = c.get("/api/engine/run").json()
        bill = next(e for e in sorted(run["events"], key=lambda e: e["due_day"] if e.get("due_day") is not None else 999)
                    if e["type"] == "SUPPLIER_PAYMENT" and e.get("due_day") is not None and e["executed_day"] == e["due_day"] and e["amount_paise"] >= 2_000_000)
        half = bill["amount_paise"] // 2 // 100 * 100
        base = series(c, run)
        other = scenario(c, {"kind": "SPLIT_SUPPLIER_PAYMENT", "event_id": bill["id"], "amount_paise": half, "days": 14})
        change = deltas(base, other, range(0, 30))
        start = bill["due_day"]
        self.assertTrue(all(v == 0 for d, v in change.items() if d < start), change)
        self.assertTrue(all(v == bill["amount_paise"] - half for d, v in change.items() if start <= d < start + 14), change)
        self.assertTrue(all(v == 0 for d, v in change.items() if d >= start + 14), change)


class GuardAgainstTheBaselineTests(unittest.TestCase):
    def test_safe_to_spend_is_the_lowest_net_minus_the_buffer_in_whole_thousands(self):
        c = sandbox()
        run = c.get("/api/engine/run").json()
        guard = c.get("/api/guard").json()
        buffer = guard["buffer_paise"]
        base = series(c, run)
        for row in guard["risk"]["ladder"]:
            lowest = min(base[d]["net_paise"] for d in range(0, min(row["days"], len(base) - 1) + 1))
            expected = max(0, lowest - buffer) // 100_000 * 100_000
            self.assertEqual(row["plan_paise"], expected, row)

    def test_a_payment_check_option_matches_the_baseline_minus_the_payment(self):
        c = sandbox()
        run = c.get("/api/engine/run").json()
        base = series(c, run)
        result = c.post("/api/guard/payment-check", json={"amount_paise": AMOUNT * 3, "date": "2026-10-20", "label": "recompute"}).json()
        on = next(o for o in result["options"] if o["id"] == "on")
        expected = min(base[d]["net_paise"] - (AMOUNT * 3 if d >= 6 else 0) for d in range(0, 31))
        self.assertEqual(on["near_low_paise"], expected)


class DeterminismTests(unittest.TestCase):
    def test_the_same_books_give_the_same_engine_run(self):
        a, b = sandbox(), sandbox()
        sa, sb = series(a), series(b)
        self.assertEqual([(p["day"], p["cash_paise"], p["net_paise"]) for p in sa.values()], [(p["day"], p["cash_paise"], p["net_paise"]) for p in sb.values()])

    def test_the_risk_figures_repeat_for_the_same_run(self):
        c = sandbox()
        deadline = time.time() + 180  # generous: the risk run shares the CPU with whatever else is running
        first = c.get("/api/risk/forecast").json()
        while first.get("status") != "READY" and time.time() < deadline:
            time.sleep(0.2)
            first = c.get("/api/risk/forecast").json()
        second = c.get("/api/risk/forecast").json()
        self.assertEqual(first.get("status"), "READY", "the risk run did not finish in time")
        self.assertEqual(first["shortfall_chance"], second["shortfall_chance"])
        self.assertEqual(first["seed"], second["seed"])


if __name__ == "__main__":
    unittest.main()
