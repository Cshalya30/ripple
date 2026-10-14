from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.simulation.comparison import compare_scenarios
from backend.app.simulation.schemas import BusinessSnapshot, ComparisonRequest, Scenario, SimulationRequest
from backend.app.simulation.engine import simulate


FIXTURE_DIR = Path(__file__).resolve().parent
EXAMPLES_DIR = FIXTURE_DIR / "examples"


def load_fixtures() -> dict:
    return json.loads((FIXTURE_DIR / "mandatory-fixtures.json").read_text(encoding="utf-8"))


def dump(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def main() -> None:
    EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    fixtures = load_fixtures()
    snapshot = BusinessSnapshot.model_validate_json(json.dumps(fixtures["baseline_snapshot"]))
    delayed = Scenario.model_validate_json(json.dumps(fixtures["scenarios"]["fixture_b_delayed_old_receipt"]))

    baseline_request = SimulationRequest(snapshot=snapshot)
    delayed_request = SimulationRequest(snapshot=snapshot, scenario=delayed)
    compare_request = ComparisonRequest(snapshot=snapshot, scenario=delayed)

    dump(EXAMPLES_DIR / "example-input-baseline.json", baseline_request.model_dump(mode="json"))
    dump(EXAMPLES_DIR / "example-input-delayed-receipt.json", delayed_request.model_dump(mode="json"))
    dump(EXAMPLES_DIR / "example-input-compare.json", compare_request.model_dump(mode="json"))

    baseline_result = simulate(snapshot)
    delayed_result = simulate(snapshot, delayed)
    comparison = compare_scenarios(snapshot, delayed)

    dump(EXAMPLES_DIR / "example-output-baseline.json", baseline_result.model_dump(mode="json"))
    dump(EXAMPLES_DIR / "example-output-delayed-receipt.json", delayed_result.model_dump(mode="json"))
    dump(EXAMPLES_DIR / "example-output-compare.json", comparison.model_dump(mode="json"))

    print("Wrote example input/output JSON to", EXAMPLES_DIR)


if __name__ == "__main__":
    main()
