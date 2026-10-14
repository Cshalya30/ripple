from __future__ import annotations

import copy
import json
import unittest
from datetime import date, timedelta
from pathlib import Path

from pydantic import ValidationError

from backend.app.simulation.comparison import compare_scenarios
from backend.app.simulation.engine import simulate
from backend.app.simulation.schemas import BusinessSnapshot, EventType, Scenario
from backend.app.simulation.transformations import apply_scenario
from backend.app.simulation.validation import SimulationValidationError


FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "simulation" / "mandatory-fixtures.json"


def parse_model(model_cls, data):
    return model_cls.model_validate_json(json.dumps(data))


def load_fixtures():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def fixture_snapshot() -> BusinessSnapshot:
    return parse_model(BusinessSnapshot, load_fixtures()["baseline_snapshot"])


def fixture_scenario(name: str) -> Scenario:
    return parse_model(Scenario, load_fixtures()["scenarios"][name])


def day(start: date, offset: int) -> date:
    return start + timedelta(days=offset)


def event_result(result, event_id: str):
    return next(event for event in result.event_results if event.id == event_id)


def order_result(result, order_id: str):
    return next(order for order in result.order_results if order.order_id == order_id)


class MandatoryFixtureTests(unittest.TestCase):
    def test_fixture_a_baseline(self):
        snapshot = fixture_snapshot()
        result = simulate(snapshot)
        self.assertEqual(event_result(result, "supplier-payment").actual_execution_date, day(snapshot.start_date, 3))
        self.assertEqual(event_result(result, "production-start").actual_execution_date, day(snapshot.start_date, 4))
        self.assertEqual(event_result(result, "delivery").actual_execution_date, day(snapshot.start_date, 6))
        self.assertEqual(event_result(result, "new-customer-receipt").actual_execution_date, day(snapshot.start_date, 10))
        self.assertEqual(result.metrics.closing_cash_paise, 6_000_000)
        self.assert_conservation(snapshot, result)

    def test_fixture_b_delayed_old_receipt(self):
        snapshot = fixture_snapshot()
        result = simulate(snapshot, fixture_scenario("fixture_b_delayed_old_receipt"))
        old_receipt = event_result(result, "old-customer-receipt")
        self.assertEqual(old_receipt.original_due_date, date(2026, 1, 3))
        self.assertEqual(old_receipt.lateness_days, 5)
        self.assertEqual(event_result(result, "supplier-payment").actual_execution_date, day(snapshot.start_date, 7))
        self.assertEqual(event_result(result, "material-arrival").actual_execution_date, day(snapshot.start_date, 8))
        self.assertEqual(event_result(result, "production-start").actual_execution_date, day(snapshot.start_date, 8))
        self.assertEqual(event_result(result, "delivery").actual_execution_date, day(snapshot.start_date, 10))
        self.assertEqual(event_result(result, "new-customer-receipt").actual_execution_date, day(snapshot.start_date, 14))
        self.assertEqual(result.metrics.closing_cash_paise, 6_000_000)
        self.assertEqual(order_result(result, "order-new").delivery_lateness_days, 4)
        supplier_blocks = event_result(result, "supplier-payment").blocking_history
        self.assertTrue(any(record.day == 3 and record.reasons[0].code == "INSUFFICIENT_CASH" for record in supplier_blocks))
        self.assert_conservation(snapshot, result)

    def test_fixture_c_deposit_restores_delivery(self):
        snapshot = fixture_snapshot()
        result = simulate(snapshot, fixture_scenario("fixture_c_deposit"))
        self.assertEqual(event_result(result, "new-customer-deposit").actual_execution_date, day(snapshot.start_date, 2))
        self.assertEqual(event_result(result, "delivery").actual_execution_date, day(snapshot.start_date, 6))
        self.assertEqual(event_result(result, "new-customer-receipt").actual_execution_date, day(snapshot.start_date, 10))
        self.assertEqual(result.metrics.closing_cash_paise, 6_000_000)
        self.assertEqual(result.transaction_totals["cash_receipts_paise"], 9_000_000)
        self.assertTrue(any("agrees" in assumption for assumption in result.assumptions))
        self.assert_conservation(snapshot, result)

    def test_fixture_d_credit_bridge_restores_delivery_and_repay(self):
        snapshot = fixture_snapshot()
        result = simulate(snapshot, fixture_scenario("fixture_d_credit_bridge"))
        expected_interest = -(-(3_000_000 * 1200 * 7) // (365 * 10_000))
        self.assertEqual(expected_interest, 6_905)
        self.assertEqual(event_result(result, "credit-drawdown").actual_execution_date, day(snapshot.start_date, 3))
        self.assertEqual(event_result(result, "delivery").actual_execution_date, day(snapshot.start_date, 6))
        self.assertEqual(event_result(result, "new-customer-receipt").actual_execution_date, day(snapshot.start_date, 10))
        self.assertEqual(event_result(result, "credit-repayment").actual_execution_date, day(snapshot.start_date, 10))
        self.assertEqual(result.financing_summary.total_paid_interest_paise, expected_interest)
        self.assertEqual(result.metrics.closing_cash_paise, 6_000_000 - expected_interest)
        self.assertEqual(result.metrics.outstanding_debt_paise, 0)
        self.assertEqual(result.transaction_totals["cash_receipts_paise"], 9_000_000)
        self.assertEqual(result.transaction_totals["gross_drawdowns_paise"], 3_000_000)
        self.assert_conservation(snapshot, result)

    def test_fixture_e_credit_repayment_stress(self):
        snapshot = fixture_snapshot()
        result = simulate(snapshot, fixture_scenario("fixture_e_credit_repayment_stress"))
        expected_accrued_at_horizon = -(-(3_000_000 * 1200 * 11) // (365 * 10_000))
        self.assertEqual(event_result(result, "credit-repayment").status, "RESOURCE_BLOCKED_AT_HORIZON")
        self.assertIsNone(event_result(result, "credit-repayment").actual_execution_date)
        self.assertEqual(result.metrics.outstanding_debt_paise, 3_000_000)
        self.assertEqual(result.financing_summary.total_accrued_interest_paise, expected_accrued_at_horizon)
        self.assertEqual(len(result.financing_summary.overdue_financing_obligations), 1)
        self.assertTrue(event_result(result, "credit-repayment").blocking_history)
        self.assert_conservation(snapshot, result)

    def assert_conservation(self, snapshot: BusinessSnapshot, result):
        totals = result.transaction_totals
        expected_cash = (
            snapshot.opening_cash_paise
            + totals["cash_receipts_paise"]
            + totals["gross_drawdowns_paise"]
            - totals["ordinary_payments_paise"]
            - totals["production_start_costs_paise"]
            - totals["drawdown_fees_paise"]
            - totals["principal_repayments_paise"]
            - totals["paid_interest_paise"]
        )
        self.assertEqual(result.metrics.closing_cash_paise, expected_cash)
        opening_quantity = sum(item.quantity for item in snapshot.opening_inventory)
        closing_quantity = sum(item.quantity for item in result.daily_balances[-1].inventory)
        self.assertEqual(
            closing_quantity,
            opening_quantity + totals["inventory_arrivals_quantity"] - totals["production_consumption_quantity"],
        )
        self.assertEqual(
            result.metrics.outstanding_debt_paise,
            totals["gross_drawdowns_paise"] - totals["principal_repayments_paise"],
        )


class AdditionalBehaviorTests(unittest.TestCase):
    def test_existing_cash_absorbs_collection_delay(self):
        raw = load_fixtures()["baseline_snapshot"]
        raw["opening_cash_paise"] = 5_000_000
        snapshot = parse_model(BusinessSnapshot, raw)
        result = simulate(snapshot, fixture_scenario("fixture_b_delayed_old_receipt"))
        self.assertEqual(event_result(result, "delivery").actual_execution_date, day(snapshot.start_date, 6))

    def test_opening_inventory_absorbs_supplier_delay_without_forced_shipment_dependency(self):
        raw = load_fixtures()["baseline_snapshot"]
        raw["opening_inventory"] = [{"material_id": "material-a", "quantity": 1, "unit": "unit"}]
        for event in raw["events"]:
            if event["id"] == "production-start":
                event["dependencies"] = []
            if event["id"] == "supplier-payment":
                event["earliest_date"] = "2026-01-11"
                event["due_date"] = "2026-01-11"
        snapshot = parse_model(BusinessSnapshot, raw)
        result = simulate(snapshot)
        self.assertEqual(event_result(result, "production-start").actual_execution_date, day(snapshot.start_date, 4))
        self.assertEqual(event_result(result, "delivery").actual_execution_date, day(snapshot.start_date, 6))

    def test_two_orders_compete_for_same_stock(self):
        snapshot = self.two_order_snapshot(opening_cash=0, opening_stock=1)
        result = simulate(snapshot)
        self.assertEqual(event_result(result, "start-a").actual_execution_date, snapshot.start_date)
        self.assertEqual(event_result(result, "start-b").status, "RESOURCE_BLOCKED_AT_HORIZON")
        self.assertEqual(event_result(result, "start-b").blocking_history[-1].reasons[0].code, "INSUFFICIENT_INVENTORY")

    def test_two_payments_compete_for_cash(self):
        raw = {
            "schema_version": "simulation.contract.v1",
            "business_id": "cash-race",
            "start_date": "2026-01-01",
            "horizon_days": 1,
            "opening_cash_paise": 4000,
            "opening_inventory": [],
            "orders": [],
            "events": [
                {"id": "pay-a", "type": "OTHER_EXPENSE", "earliest_date": "2026-01-01", "due_date": "2026-01-01", "dependencies": [], "priority": 1, "amount_paise": 4000},
                {"id": "pay-b", "type": "OTHER_EXPENSE", "earliest_date": "2026-01-01", "due_date": "2026-01-01", "dependencies": [], "priority": 2, "amount_paise": 4000}
            ],
            "approved_credit_facilities": []
        }
        result = simulate(parse_model(BusinessSnapshot, raw))
        self.assertEqual(event_result(result, "pay-a").status, "EXECUTED")
        self.assertEqual(event_result(result, "pay-b").status, "RESOURCE_BLOCKED_AT_HORIZON")

    def test_production_start_is_atomic_for_cash_and_materials(self):
        no_stock = self.two_order_snapshot(opening_cash=10_000, opening_stock=0)
        result = simulate(no_stock)
        self.assertIsNone(event_result(result, "start-a").actual_execution_date)
        no_cash = self.two_order_snapshot(opening_cash=0, opening_stock=1, production_cost=10_000)
        result = simulate(no_cash)
        self.assertIsNone(event_result(result, "start-a").actual_execution_date)
        self.assertEqual(sum(item.quantity for item in result.daily_balances[-1].inventory), 1)

    def test_blocked_payment_executes_later_when_receipt_arrives(self):
        raw = {
            "schema_version": "simulation.contract.v1",
            "business_id": "blocked-later",
            "start_date": "2026-01-01",
            "horizon_days": 4,
            "opening_cash_paise": 0,
            "opening_inventory": [],
            "orders": [],
            "events": [
                {"id": "pay", "type": "OTHER_EXPENSE", "earliest_date": "2026-01-01", "due_date": "2026-01-01", "dependencies": [], "priority": 1, "amount_paise": 1000},
                {"id": "receipt", "type": "CASH_RECEIPT", "earliest_date": "2026-01-03", "due_date": "2026-01-03", "dependencies": [], "priority": 1, "amount_paise": 1000}
            ],
            "approved_credit_facilities": []
        }
        snapshot = parse_model(BusinessSnapshot, raw)
        result = simulate(snapshot)
        self.assertEqual(event_result(result, "pay").actual_execution_date, day(snapshot.start_date, 2))

    def test_dependency_relative_receipts_move_correctly(self):
        snapshot = fixture_snapshot()
        result = simulate(snapshot, fixture_scenario("fixture_b_delayed_old_receipt"))
        self.assertEqual(event_result(result, "delivery").actual_execution_date, day(snapshot.start_date, 10))
        self.assertEqual(event_result(result, "new-customer-receipt").actual_execution_date, day(snapshot.start_date, 14))

    def test_validation_failures_are_clear(self):
        duplicate = load_fixtures()["baseline_snapshot"]
        duplicate["events"][1]["id"] = duplicate["events"][0]["id"]
        with self.assertRaisesRegex(SimulationValidationError, "DUPLICATE_ID"):
            simulate(parse_model(BusinessSnapshot, duplicate))

        missing = load_fixtures()["baseline_snapshot"]
        missing["events"][2]["dependencies"] = [{"predecessor_event_id": "missing", "lag_days": 0}]
        with self.assertRaisesRegex(SimulationValidationError, "MISSING_EVENT_REFERENCE"):
            simulate(parse_model(BusinessSnapshot, missing))

        cycle = load_fixtures()["baseline_snapshot"]
        cycle["events"][0]["dependencies"] = [{"predecessor_event_id": "supplier-payment", "lag_days": 0}]
        cycle["events"][1]["dependencies"] = [{"predecessor_event_id": "old-customer-receipt", "lag_days": 0}]
        with self.assertRaisesRegex(SimulationValidationError, "DEPENDENCY_CYCLE"):
            simulate(parse_model(BusinessSnapshot, cycle))

        malformed = load_fixtures()["baseline_snapshot"]
        malformed["events"][0]["amount_paise"] = 1.5
        with self.assertRaises(ValidationError):
            parse_model(BusinessSnapshot, malformed)

    def test_transformations_leave_baseline_unchanged_and_conserve_amounts(self):
        snapshot = fixture_snapshot()
        original = snapshot.model_dump(mode="json")
        transformed, _ = apply_scenario(snapshot, fixture_scenario("fixture_c_deposit"))
        self.assertEqual(snapshot.model_dump(mode="json"), original)
        new_receipts = [event.amount_paise for event in transformed.events if event.id in {"new-customer-receipt", "new-customer-deposit"}]
        self.assertEqual(sum(new_receipts), 6_000_000)

        raw_scenario = {
            "scenario_id": "instalments",
            "changes": [
                {
                    "type": "SPLIT_SUPPLIER_PAYMENT",
                    "event_id": "supplier-payment",
                    "instalments": [
                        {"id": "supplier-pay-1", "amount_paise": 1_000_000, "earliest_date": "2026-01-04"},
                        {"id": "supplier-pay-2", "amount_paise": 3_000_000, "earliest_date": "2026-01-05"}
                    ],
                    "release_policy": "FULL_PAYMENT",
                    "supplier_agreement_assumption": "Supplier accepts two instalments but releases after full payment."
                }
            ]
        }
        transformed, _ = apply_scenario(snapshot, parse_model(Scenario, raw_scenario))
        instalment_sum = sum(event.amount_paise or 0 for event in transformed.events if event.id.startswith("supplier-pay-"))
        self.assertEqual(instalment_sum, 4_000_000)
        arrival = next(event for event in transformed.events if event.id == "material-arrival")
        self.assertEqual({dependency.predecessor_event_id for dependency in arrival.dependencies}, {"supplier-pay-1", "supplier-pay-2"})

    def test_drawdown_fee_unavailable_and_excessive_credit(self):
        raw = self.credit_only_snapshot(draw_date="2026-01-01", fee=100)
        result = simulate(parse_model(BusinessSnapshot, raw))
        self.assertEqual(result.metrics.closing_cash_paise, 900)
        self.assertEqual(result.metrics.outstanding_debt_paise, 1000)

        unavailable = self.credit_only_snapshot(draw_date="2025-12-31")
        with self.assertRaisesRegex(SimulationValidationError, "DRAWDOWN_BEFORE_FACILITY_AVAILABLE"):
            simulate(parse_model(BusinessSnapshot, unavailable))

        excessive = self.credit_only_snapshot(draw_date="2026-01-01", principal=2000, limit=1000)
        with self.assertRaisesRegex(SimulationValidationError, "DRAWDOWN_EXCEEDS_APPROVED_LIMIT"):
            simulate(parse_model(BusinessSnapshot, excessive))

    def test_repeated_runs_are_deterministic(self):
        snapshot = fixture_snapshot()
        scenario = fixture_scenario("fixture_d_credit_bridge")
        first = simulate(snapshot, scenario).model_dump(mode="json")
        second = simulate(snapshot, scenario).model_dump(mode="json")
        self.assertEqual(first, second)

    def test_compare_scenarios_reports_delivery_delta(self):
        snapshot = fixture_snapshot()
        comparison = compare_scenarios(snapshot, fixture_scenario("fixture_b_delayed_old_receipt"))
        self.assertEqual(comparison.comparison_metrics["delivery_date_change_by_order"]["order-new"], 4)

    def two_order_snapshot(self, opening_cash: int, opening_stock: int, production_cost: int = 0) -> BusinessSnapshot:
        raw = {
            "schema_version": "simulation.contract.v1",
            "business_id": "two-orders",
            "start_date": "2026-01-01",
            "horizon_days": 1,
            "opening_cash_paise": opening_cash,
            "opening_inventory": [{"material_id": "m", "quantity": opening_stock, "unit": "unit"}] if opening_stock else [],
            "orders": [
                {"id": "a", "customer_id": "c-a", "promised_delivery_date": "2026-01-01", "material_requirements": [{"material_id": "m", "quantity": 1, "unit": "unit"}], "production_start_cost_paise": production_cost, "production_duration_days": 0, "priority": 1},
                {"id": "b", "customer_id": "c-b", "promised_delivery_date": "2026-01-01", "material_requirements": [{"material_id": "m", "quantity": 1, "unit": "unit"}], "production_start_cost_paise": production_cost, "production_duration_days": 0, "priority": 2}
            ],
            "events": [
                {"id": "start-a", "type": "PRODUCTION_START", "order_id": "a", "earliest_date": "2026-01-01", "dependencies": [], "priority": 1},
                {"id": "start-b", "type": "PRODUCTION_START", "order_id": "b", "earliest_date": "2026-01-01", "dependencies": [], "priority": 1}
            ],
            "approved_credit_facilities": []
        }
        return parse_model(BusinessSnapshot, raw)

    def credit_only_snapshot(self, draw_date: str, fee: int = 0, principal: int = 1000, limit: int = 1000):
        return {
            "schema_version": "simulation.contract.v1",
            "business_id": "credit-only",
            "start_date": "2026-01-01",
            "horizon_days": 1,
            "opening_cash_paise": 0,
            "opening_inventory": [],
            "orders": [],
            "events": [
                {"id": "draw", "type": "CREDIT_DRAWDOWN", "earliest_date": draw_date, "due_date": draw_date, "dependencies": [], "priority": 1, "facility_id": "facility", "principal_paise": principal}
            ],
            "approved_credit_facilities": [
                {"id": "facility", "approved_limit_paise": limit, "available_from_date": "2026-01-01", "annual_interest_rate_bps": 1200, "drawdown_fee_paise": fee, "contractual_repayment_date": "2026-01-10", "assumptions": []}
            ]
        }


if __name__ == "__main__":
    unittest.main()
