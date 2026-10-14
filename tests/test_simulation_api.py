from __future__ import annotations

import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app


FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "simulation" / "mandatory-fixtures.json"


def load_fixtures() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class SimulationApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.fixtures = load_fixtures()

    def test_health(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_run_endpoint_returns_baseline(self) -> None:
        response = self.client.post("/simulation/run", json={"snapshot": self.fixtures["baseline_snapshot"]})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["scenario_id"], "baseline")
        self.assertEqual(body["metrics"]["closing_cash_paise"], 6_000_000)
        self.assertEqual(body["schema_version"], "simulation.contract.v1")
        self.assertTrue(body["engine_version"].startswith("simulation-engine."))

    def test_run_endpoint_applies_scenario(self) -> None:
        payload = {
            "snapshot": self.fixtures["baseline_snapshot"],
            "scenario": self.fixtures["scenarios"]["fixture_b_delayed_old_receipt"],
        }
        response = self.client.post("/simulation/run", json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["scenario_id"], "fixture-b-delayed-old-receipt")
        delivery = next(event for event in body["event_results"] if event["id"] == "delivery")
        self.assertEqual(delivery["actual_execution_date"], "2026-01-11")

    def test_compare_endpoint(self) -> None:
        payload = {
            "snapshot": self.fixtures["baseline_snapshot"],
            "scenario": self.fixtures["scenarios"]["fixture_b_delayed_old_receipt"],
        }
        response = self.client.post("/simulation/compare", json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["comparison_metrics"]["delivery_date_change_by_order"]["order-new"], 4)
        self.assertIn("baseline", body)
        self.assertIn("scenario", body)

    def test_validation_error_is_machine_readable(self) -> None:
        snapshot = json.loads(json.dumps(self.fixtures["baseline_snapshot"]))
        snapshot["events"][2]["dependencies"] = [{"predecessor_event_id": "does-not-exist", "lag_days": 0}]
        response = self.client.post("/simulation/run", json={"snapshot": snapshot})
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["error"]["code"], "MISSING_EVENT_REFERENCE")
        self.assertIn("predecessor_event_id", body["error"]["details"])

    def test_fractional_money_is_rejected(self) -> None:
        snapshot = json.loads(json.dumps(self.fixtures["baseline_snapshot"]))
        snapshot["opening_cash_paise"] = 19999.5
        response = self.client.post("/simulation/run", json={"snapshot": snapshot})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")


if __name__ == "__main__":
    unittest.main()
