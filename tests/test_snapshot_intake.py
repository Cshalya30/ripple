from datetime import date
import unittest

from backend.app.intake.builder import SnapshotBuildError, build_snapshot, money_to_paise
from backend.app.intake.schemas import (
    BusinessFacts,
    CollectionStatus,
    CollectionTimingType,
    CustomerOrderFact,
    Evidence,
    FactStatus,
    InventoryFact,
    Money,
)
from backend.app.simulation.engine import simulate
from backend.app.simulation.validation import validate_snapshot
from fastapi.testclient import TestClient


def complete_facts() -> BusinessFacts:
    return BusinessFacts(
        business_name="Meera Knitwear",
        opening_cash=Money(amount="50000"),
        opening_inventory=[InventoryFact(material_reference="cotton", material_name="Cotton", quantity=10, unit="kg")],
        inventory_status=CollectionStatus.CONFIRMED_COMPLETE,
        supplier_purchases_status=CollectionStatus.CONFIRMED_COMPLETE,
        customer_orders_status=CollectionStatus.CONFIRMED_COMPLETE,
        facilities_status=CollectionStatus.CONFIRMED_COMPLETE,
        customer_orders=[CustomerOrderFact(
            order_reference="ORD-1",
            customer="Customer A",
            materials=[InventoryFact(material_reference="cotton", quantity=5, unit="kg")],
            production_start_cost=Money(amount="10000"),
            production_duration_days=3,
            earliest_production_start_date=date(2026, 1, 1),
            promised_delivery_date=date(2026, 1, 10),
            outstanding_collection=Money(amount="60000"),
            collection_timing_type=CollectionTimingType.DAYS_AFTER_DELIVERY,
            collection_days_after_delivery=30,
        )],
        evidence=[Evidence(
            fact_reference="cash-1",
            field_path="opening_cash",
            source_excerpt="Cash in hand is INR 50,000",
            status=FactStatus.EXTRACTED,
        )],
    )


class SnapshotIntakeTests(unittest.TestCase):
    def test_complete_facts_build_and_run(self):
        snapshot = build_snapshot(complete_facts(), {
            "business_id": "meera",
            "start_date": date(2026, 1, 1),
            "horizon_days": 90,
            "source_text": "Cash in hand is INR 50,000",
        })
        validate_snapshot(snapshot)
        result = simulate(snapshot)
        self.assertEqual(result.transaction_totals["production_consumption_quantity"], 5)
        receipt = next(event for event in snapshot.events if event.id.startswith("customer-receipt-"))
        self.assertEqual(receipt.dependencies[0].lag_days, 30)

    def test_missing_cash_is_not_zero(self):
        facts = complete_facts()
        facts.opening_cash = None
        with self.assertRaises(SnapshotBuildError) as raised:
            build_snapshot(facts, {
                "business_id": "meera",
                "start_date": date(2026, 1, 1),
                "horizon_days": 90,
                "source_text": "Cash in hand is INR 50,000",
            })
        self.assertIn("cash", str(raised.exception))

    def test_money_conversion_preserves_paise(self):
        self.assertEqual(money_to_paise(Money(amount="12.50")), 1250)
        self.assertEqual(money_to_paise(Money(amount="1250", unit="paise")), 1250)
        with self.assertRaises(SnapshotBuildError):
            money_to_paise(Money(amount="1.001"))

    def test_draft_approval_is_versioned(self):
        from unittest.mock import patch
        from backend.app.main import app

        class FakeExtractor:
            def extract(self, _: str) -> BusinessFacts:
                return complete_facts()

        with patch("backend.app.main.extractor", FakeExtractor()):
            client = TestClient(app)
            response = client.post("/snapshot/draft", json={
                "business_id": "meera",
                "start_date": "2026-01-01",
                "horizon_days": 90,
                "source_text": "Cash in hand is INR 50,000",
            })
            self.assertEqual(response.status_code, 200)
            draft = response.json()
            approved = client.post("/snapshot/approve", json={
                "draft_id": draft["draft_id"],
                "draft_version": draft["draft_version"],
                "approval": "APPROVE",
            })
            self.assertEqual(approved.status_code, 200)
            self.assertEqual(approved.json()["snapshot"]["business_id"], "meera")

    def test_draft_accepts_reviewed_facts_without_provider(self):
        from backend.app.main import app

        client = TestClient(app)
        response = client.post("/snapshot/draft", json={
            "business_id": "meera",
            "start_date": "2026-01-01",
            "horizon_days": 90,
            "source_text": "Cash in hand is INR 50,000",
            "reviewed_facts": complete_facts().model_dump(mode="json"),
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "READY_FOR_REVIEW")


if __name__ == "__main__":
    unittest.main()
