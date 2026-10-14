from __future__ import annotations

from .engine import simulate
from .schemas import BusinessSnapshot, ComparisonResult, ENGINE_VERSION, SCHEMA_VERSION, Scenario, SchedulingPolicy


def compare_scenarios(snapshot: BusinessSnapshot, scenario: Scenario, policy: SchedulingPolicy | None = None) -> ComparisonResult:
    baseline = simulate(snapshot, None, policy)
    scenario_result = simulate(snapshot, scenario, policy)
    comparison_metrics = _comparison_metrics(baseline, scenario_result)
    scenario_result.comparison_metrics = comparison_metrics
    return ComparisonResult(
        schema_version=SCHEMA_VERSION,
        engine_version=ENGINE_VERSION,
        baseline=baseline,
        scenario=scenario_result,
        comparison_metrics=comparison_metrics,
    )


def _comparison_metrics(baseline, scenario_result) -> dict[str, object]:
    baseline_orders = {order.order_id: order for order in baseline.order_results}
    scenario_orders = {order.order_id: order for order in scenario_result.order_results}
    delivery_date_change_by_order: dict[str, int | None] = {}
    delivery_status_by_order: dict[str, dict[str, object]] = {}
    for order_id, scenario_order in sorted(scenario_orders.items()):
        baseline_order = baseline_orders.get(order_id)
        if baseline_order is None or baseline_order.delivery_date is None or scenario_order.delivery_date is None:
            delivery_date_change_by_order[order_id] = None
        else:
            delivery_date_change_by_order[order_id] = (scenario_order.delivery_date - baseline_order.delivery_date).days
        delivery_status_by_order[order_id] = {
            "baseline_delivery_date": baseline_order.delivery_date.isoformat() if baseline_order and baseline_order.delivery_date else None,
            "scenario_delivery_date": scenario_order.delivery_date.isoformat() if scenario_order.delivery_date else None,
            "baseline_status": baseline_order.status if baseline_order else None,
            "scenario_status": scenario_order.status,
        }
    return {
        "delivery_date_change_by_order": delivery_date_change_by_order,
        "delivery_status_by_order": delivery_status_by_order,
        "closing_cash_delta_paise": scenario_result.metrics.closing_cash_paise - baseline.metrics.closing_cash_paise,
        "missed_commitment_count_delta": scenario_result.metrics.missed_commitment_count - baseline.metrics.missed_commitment_count,
        "unresolved_order_count_delta": scenario_result.metrics.unresolved_order_count - baseline.metrics.unresolved_order_count,
        "outstanding_debt_delta_paise": scenario_result.metrics.outstanding_debt_paise - baseline.metrics.outstanding_debt_paise,
        "accrued_financing_cost_delta_paise": scenario_result.metrics.accrued_financing_cost_paise - baseline.metrics.accrued_financing_cost_paise,
        "attribution_note": "Delivery changes are baseline-vs-scenario differences under the documented greedy scheduling policy; dependency graph paths alone are not treated as causation.",
    }
