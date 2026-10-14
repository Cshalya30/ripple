from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .financing import DebtState, payable_interest_for_day
from .schemas import (
    BlockingReason,
    BlockingRecord,
    BusinessSnapshot,
    DailyBalance,
    ENGINE_VERSION,
    Event,
    EventResult,
    EventStatus,
    EventType,
    FinancingFacilitySummary,
    FinancingSummary,
    InventoryQuantity,
    Order,
    OrderResult,
    SCHEMA_VERSION,
    Scenario,
    SchedulingPolicy,
    SimulationMetrics,
    SimulationResult,
)
from .transformations import apply_scenario


RESOURCE_ADDING_TYPES = {EventType.CASH_RECEIPT, EventType.INVENTORY_ARRIVAL, EventType.CREDIT_DRAWDOWN}
NEUTRAL_TYPES = {EventType.PRODUCTION_COMPLETE, EventType.DELIVERY}
CONSUMING_TYPES = {EventType.SUPPLIER_PAYMENT, EventType.OTHER_EXPENSE, EventType.PRODUCTION_START, EventType.CREDIT_REPAYMENT}


@dataclass
class RuntimeState:
    cash_paise: int
    inventory: dict[str, int]
    pending_event_ids: set[str]
    actual_days: dict[str, int] = field(default_factory=dict)
    blocking_history: dict[str, list[BlockingRecord]] = field(default_factory=dict)
    debt_by_facility: dict[str, DebtState] = field(default_factory=dict)
    transaction_totals: dict[str, int] = field(default_factory=lambda: {
        "cash_receipts_paise": 0,
        "gross_drawdowns_paise": 0,
        "ordinary_payments_paise": 0,
        "production_start_costs_paise": 0,
        "drawdown_fees_paise": 0,
        "principal_repayments_paise": 0,
        "paid_interest_paise": 0,
        "inventory_arrivals_quantity": 0,
        "production_consumption_quantity": 0,
    })


def simulate(
    snapshot: BusinessSnapshot,
    scenario: Scenario | None = None,
    policy: SchedulingPolicy | None = None,
) -> SimulationResult:
    scheduling_policy = policy or SchedulingPolicy()
    scenario_id = scenario.scenario_id if scenario is not None else "baseline"
    original_due_dates = {event.id: event.due_date for event in snapshot.events}
    transformed, scenario_assumptions = apply_scenario(snapshot, scenario)

    events = {event.id: event for event in transformed.events}
    orders = {order.id: order for order in transformed.orders}
    state = RuntimeState(
        cash_paise=transformed.opening_cash_paise,
        inventory=_inventory_to_dict(transformed.opening_inventory),
        pending_event_ids={event.id for event in transformed.events},
        debt_by_facility={facility.id: DebtState(facility=facility) for facility in transformed.approved_credit_facilities},
    )

    daily_balances: list[DailyBalance] = []
    min_cash = state.cash_paise
    for day in range(transformed.horizon_days):
        while True:
            executable = _select_next_executable(day, transformed.start_date, events, orders, state)
            if executable is None:
                _record_blockers_for_day(day, transformed.start_date, events, orders, state)
                break
            _apply_event(executable, day, events, orders, state)
            min_cash = min(min_cash, state.cash_paise)

        min_cash = min(min_cash, state.cash_paise)
        daily_balances.append(
            DailyBalance(
                day=day,
                date=transformed.start_date + timedelta(days=day),
                cash_paise=state.cash_paise,
                inventory=_dict_to_inventory(state.inventory),
                outstanding_debt_paise=sum(debt.principal_paise for debt in state.debt_by_facility.values()),
                pending_event_count=len(state.pending_event_ids),
            )
        )

    event_results = _build_event_results(transformed, events, orders, state, original_due_dates)
    order_results = _build_order_results(transformed, events, state)
    financing_summary = _build_financing_summary(transformed, state)
    unresolved_events = [event_result for event_result in event_results if event_result.status != EventStatus.EXECUTED]
    missed_commitments = [
        event_result
        for event_result in event_results
        if event_result.status != EventStatus.EXECUTED or (event_result.lateness_days is not None and event_result.lateness_days > 0)
    ]
    metrics = SimulationMetrics(
        missed_commitment_count=len(missed_commitments),
        unresolved_order_count=sum(1 for order_result in order_results if order_result.status != "DELIVERED"),
        minimum_executable_cash_paise=min_cash,
        closing_cash_paise=state.cash_paise,
        outstanding_debt_paise=financing_summary.total_outstanding_principal_paise,
        accrued_financing_cost_paise=financing_summary.total_paid_interest_paise + financing_summary.total_accrued_interest_paise,
        overdue_financing_obligation_count=len(financing_summary.overdue_financing_obligations),
    )

    assumptions = [
        "Integer paise and integer inventory quantities are used throughout.",
        "Lower priority number means higher scheduling priority.",
        "Stock is allocated only when production starts; advance reservation is outside scope.",
        "The daily scheduler is greedy and does not claim global optimisation.",
        "Production material, cost, and duration are authoritative on the order record.",
        "Credit interest uses simple daily interest, 365-day denominator, drawdown day excluded, repayment day included, cumulative interest rounded up to paise.",
    ]
    assumptions.extend(scenario_assumptions)
    assumptions.extend(assumption for event in transformed.events for assumption in event.assumptions)
    assumptions.extend(assumption for facility in transformed.approved_credit_facilities for assumption in facility.assumptions)

    return SimulationResult(
        schema_version=SCHEMA_VERSION,
        engine_version=ENGINE_VERSION,
        scenario_id=scenario_id,
        scheduling_policy=scheduling_policy,
        assumptions=_unique_preserving_order(assumptions),
        daily_balances=daily_balances,
        event_results=event_results,
        order_results=order_results,
        missed_commitments=missed_commitments,
        unresolved_events=unresolved_events,
        financing_summary=financing_summary,
        metrics=metrics,
        comparison_metrics=None,
        transaction_totals=state.transaction_totals,
    )


def _select_next_executable(
    day: int,
    start_date: date,
    events: dict[str, Event],
    orders: dict[str, Order],
    state: RuntimeState,
) -> Event | None:
    feasible: list[Event] = []
    for event_id in sorted(state.pending_event_ids):
        event = events[event_id]
        if _timing_blockers(event, day, start_date, state):
            continue
        if _resource_blockers(event, day, orders, state):
            continue
        feasible.append(event)
    if not feasible:
        return None
    feasible.sort(key=lambda event: _event_sort_key(event, orders))
    return feasible[0]


def _event_sort_key(event: Event, orders: dict[str, Order]) -> tuple[int, int, int, date, str]:
    if event.type in RESOURCE_ADDING_TYPES:
        group = 0
    elif event.type in NEUTRAL_TYPES:
        group = 1
    else:
        group = 2
    owner_priority = orders[event.order_id].priority if event.order_id in orders else event.priority
    due = event.due_date or date.max
    return group, owner_priority, event.priority, due, event.id


def _timing_blockers(event: Event, day: int, start_date: date, state: RuntimeState) -> list[BlockingReason]:
    reasons: list[BlockingReason] = []
    earliest_day = (event.earliest_date - start_date).days
    if day < earliest_day:
        reasons.append(
            BlockingReason(
                code="NOT_YET_ELIGIBLE",
                details={"eligible_date": event.earliest_date.isoformat()},
            )
        )
    pending_dependencies: list[str] = []
    lag_dates: list[str] = []
    for dependency in event.dependencies:
        predecessor_day = state.actual_days.get(dependency.predecessor_event_id)
        if predecessor_day is None:
            pending_dependencies.append(dependency.predecessor_event_id)
        elif day < predecessor_day + dependency.lag_days:
            lag_dates.append((start_date + timedelta(days=predecessor_day + dependency.lag_days)).isoformat())
    if pending_dependencies:
        reasons.append(BlockingReason(code="DEPENDENCY_PENDING", details={"predecessor_event_ids": pending_dependencies}))
    if lag_dates:
        reasons.append(BlockingReason(code="LAG_NOT_ELAPSED", details={"eligible_date": max(lag_dates)}))
    return reasons


def _resource_blockers(event: Event, day: int, orders: dict[str, Order], state: RuntimeState) -> list[BlockingReason]:
    reasons: list[BlockingReason] = []
    if event.type in {EventType.SUPPLIER_PAYMENT, EventType.OTHER_EXPENSE}:
        required = event.amount_paise or 0
        if state.cash_paise < required:
            reasons.append(_cash_reason(required, state.cash_paise))
    elif event.type == EventType.PRODUCTION_START:
        order = orders[event.order_id or ""]
        if state.cash_paise < order.production_start_cost_paise:
            reasons.append(_cash_reason(order.production_start_cost_paise, state.cash_paise))
        for requirement in order.material_requirements:
            available = state.inventory.get(requirement.material_id, 0)
            if available < requirement.quantity:
                reasons.append(
                    BlockingReason(
                        code="INSUFFICIENT_INVENTORY",
                        details={
                            "material_id": requirement.material_id,
                            "required_quantity": requirement.quantity,
                            "available_quantity": available,
                            "shortfall_quantity": requirement.quantity - available,
                        },
                    )
                )
    elif event.type == EventType.CREDIT_DRAWDOWN:
        debt = state.debt_by_facility[event.facility_id or ""]
        if debt.principal_paise > 0 or debt.draw_day is not None:
            reasons.append(BlockingReason(code="UNSUPPORTED_MULTIPLE_DRAWDOWNS", details={"facility_id": event.facility_id}))
    elif event.type == EventType.CREDIT_REPAYMENT:
        debt = state.debt_by_facility[event.facility_id or ""]
        required = debt.principal_paise + payable_interest_for_day(debt, day)
        if state.cash_paise < required:
            reasons.append(_cash_reason(required, state.cash_paise))
    return reasons


def _cash_reason(required: int, available: int) -> BlockingReason:
    return BlockingReason(
        code="INSUFFICIENT_CASH",
        details={"required_paise": required, "available_paise": available, "shortfall_paise": required - available},
    )


def _apply_event(event: Event, day: int, events: dict[str, Event], orders: dict[str, Order], state: RuntimeState) -> None:
    if event.type == EventType.CASH_RECEIPT:
        state.cash_paise += event.amount_paise or 0
        state.transaction_totals["cash_receipts_paise"] += event.amount_paise or 0
    elif event.type in {EventType.SUPPLIER_PAYMENT, EventType.OTHER_EXPENSE}:
        amount = event.amount_paise or 0
        state.cash_paise -= amount
        state.transaction_totals["ordinary_payments_paise"] += amount
    elif event.type == EventType.INVENTORY_ARRIVAL:
        for item in event.inventory_quantities or []:
            state.inventory[item.material_id] = state.inventory.get(item.material_id, 0) + item.quantity
            state.transaction_totals["inventory_arrivals_quantity"] += item.quantity
    elif event.type == EventType.PRODUCTION_START:
        order = orders[event.order_id or ""]
        state.cash_paise -= order.production_start_cost_paise
        state.transaction_totals["production_start_costs_paise"] += order.production_start_cost_paise
        for requirement in order.material_requirements:
            state.inventory[requirement.material_id] = state.inventory.get(requirement.material_id, 0) - requirement.quantity
            state.transaction_totals["production_consumption_quantity"] += requirement.quantity
    elif event.type == EventType.CREDIT_DRAWDOWN:
        debt = state.debt_by_facility[event.facility_id or ""]
        principal = event.principal_paise or 0
        fee = debt.facility.drawdown_fee_paise
        state.cash_paise += principal - fee
        debt.principal_paise = principal
        debt.draw_day = day
        state.transaction_totals["gross_drawdowns_paise"] += principal
        state.transaction_totals["drawdown_fees_paise"] += fee
    elif event.type == EventType.CREDIT_REPAYMENT:
        debt = state.debt_by_facility[event.facility_id or ""]
        interest = payable_interest_for_day(debt, day)
        principal = debt.principal_paise
        state.cash_paise -= principal + interest
        debt.principal_paise = 0
        debt.repayment_day = day
        debt.paid_interest_paise += interest
        state.transaction_totals["principal_repayments_paise"] += principal
        state.transaction_totals["paid_interest_paise"] += interest

    state.actual_days[event.id] = day
    state.pending_event_ids.remove(event.id)
    if state.cash_paise < 0:
        raise RuntimeError(f"simulation invariant violated: negative cash after {event.id}")
    if any(quantity < 0 for quantity in state.inventory.values()):
        raise RuntimeError(f"simulation invariant violated: negative inventory after {event.id}")
    _assert_dependency_lag_consistency_for_completion(event, events, orders)


def _assert_dependency_lag_consistency_for_completion(event: Event, events: dict[str, Event], orders: dict[str, Order]) -> None:
    if event.type != EventType.PRODUCTION_COMPLETE or event.order_id is None:
        return
    order = orders[event.order_id]
    for dependency in event.dependencies:
        predecessor = events[dependency.predecessor_event_id]
        if predecessor.type == EventType.PRODUCTION_START and predecessor.order_id == event.order_id:
            if dependency.lag_days != order.production_duration_days:
                raise RuntimeError(f"production duration dependency mismatch for {event.id}")


def _record_blockers_for_day(day: int, start_date: date, events: dict[str, Event], orders: dict[str, Order], state: RuntimeState) -> None:
    current_date = start_date + timedelta(days=day)
    for event_id in sorted(state.pending_event_ids):
        event = events[event_id]
        timing_reasons = _timing_blockers(event, day, start_date, state)
        earliest_day = (event.earliest_date - start_date).days
        if timing_reasons and day >= min(earliest_day, day):
            recordable = [reason for reason in timing_reasons if reason.code != "NOT_YET_ELIGIBLE"]
            if recordable:
                state.blocking_history.setdefault(event.id, []).append(BlockingRecord(day=day, date=current_date, reasons=recordable))
            continue
        if timing_reasons:
            continue
        resource_reasons = _resource_blockers(event, day, orders, state)
        if resource_reasons:
            state.blocking_history.setdefault(event.id, []).append(BlockingRecord(day=day, date=current_date, reasons=resource_reasons))


def _build_event_results(
    snapshot: BusinessSnapshot,
    events: dict[str, Event],
    orders: dict[str, Order],
    state: RuntimeState,
    original_due_dates: dict[str, date | None],
) -> list[EventResult]:
    results: list[EventResult] = []
    horizon_last_day = snapshot.horizon_days - 1
    for event in sorted(events.values(), key=lambda item: item.id):
        actual_day = state.actual_days.get(event.id)
        actual_date = snapshot.start_date + timedelta(days=actual_day) if actual_day is not None else None
        due_date = _commitment_due_date(event, orders, original_due_dates)
        lateness = None
        if actual_date is not None and due_date is not None:
            lateness = max(0, (actual_date - due_date).days)
        status = EventStatus.EXECUTED if actual_day is not None else _unresolved_status(event, horizon_last_day, snapshot.start_date, state)
        results.append(
            EventResult(
                id=event.id,
                type=event.type,
                order_id=event.order_id,
                original_due_date=due_date,
                actual_execution_date=actual_date,
                status=status,
                lateness_days=lateness,
                blocking_history=state.blocking_history.get(event.id, []),
                dependency_event_ids=[dependency.predecessor_event_id for dependency in event.dependencies],
            )
        )
    return results


def _unresolved_status(event: Event, horizon_last_day: int, start_date: date, state: RuntimeState) -> EventStatus:
    timing_reasons = _timing_blockers(event, horizon_last_day, start_date, state)
    reason_codes = {reason.code for reason in timing_reasons}
    if "DEPENDENCY_PENDING" in reason_codes:
        return EventStatus.DEPENDENCY_BLOCKED_AT_HORIZON
    if timing_reasons:
        return EventStatus.NOT_YET_ELIGIBLE_WITHIN_HORIZON
    return EventStatus.RESOURCE_BLOCKED_AT_HORIZON


def _commitment_due_date(
    event: Event,
    orders: dict[str, Order],
    original_due_dates: dict[str, date | None],
) -> date | None:
    if event.type == EventType.DELIVERY and event.order_id in orders:
        return orders[event.order_id].promised_delivery_date
    return original_due_dates.get(event.id, event.due_date)


def _build_order_results(snapshot: BusinessSnapshot, events: dict[str, Event], state: RuntimeState) -> list[OrderResult]:
    results: list[OrderResult] = []
    delivery_by_order: dict[str, Event] = {
        event.order_id or "": event for event in events.values() if event.type == EventType.DELIVERY and event.order_id is not None
    }
    for order in sorted(snapshot.orders, key=lambda item: item.id):
        delivery = delivery_by_order.get(order.id)
        delivery_day = state.actual_days.get(delivery.id) if delivery is not None else None
        delivery_date = snapshot.start_date + timedelta(days=delivery_day) if delivery_day is not None else None
        lateness = max(0, (delivery_date - order.promised_delivery_date).days) if delivery_date is not None else None
        results.append(
            OrderResult(
                order_id=order.id,
                promised_delivery_date=order.promised_delivery_date,
                delivery_event_id=delivery.id if delivery is not None else None,
                delivery_date=delivery_date,
                delivery_lateness_days=lateness,
                status="DELIVERED" if delivery_date is not None else "UNRESOLVED",
            )
        )
    return results


def _build_financing_summary(snapshot: BusinessSnapshot, state: RuntimeState) -> FinancingSummary:
    horizon_last_day = snapshot.horizon_days - 1
    facilities: list[FinancingFacilitySummary] = []
    for facility_id, debt in sorted(state.debt_by_facility.items()):
        accrued = payable_interest_for_day(debt, horizon_last_day)
        overdue = debt.principal_paise > 0 and snapshot.start_date + timedelta(days=horizon_last_day) >= debt.facility.contractual_repayment_date
        summary = FinancingFacilitySummary(
            facility_id=facility_id,
            drawdown_date=snapshot.start_date + timedelta(days=debt.draw_day) if debt.draw_day is not None else None,
            repayment_date=snapshot.start_date + timedelta(days=debt.repayment_day) if debt.repayment_day is not None else None,
            outstanding_principal_paise=debt.principal_paise,
            paid_interest_paise=debt.paid_interest_paise,
            accrued_interest_paise=accrued,
            overdue=overdue,
            contractual_repayment_date=debt.facility.contractual_repayment_date,
            unresolved_obligation_paise=debt.principal_paise + accrued,
        )
        if debt.draw_day is not None or debt.principal_paise > 0 or debt.paid_interest_paise > 0:
            facilities.append(summary)
    overdue_facilities = [facility for facility in facilities if facility.overdue]
    return FinancingSummary(
        total_outstanding_principal_paise=sum(facility.outstanding_principal_paise for facility in facilities),
        total_paid_interest_paise=sum(facility.paid_interest_paise for facility in facilities),
        total_accrued_interest_paise=sum(facility.accrued_interest_paise for facility in facilities),
        overdue_financing_obligations=overdue_facilities,
        facilities=facilities,
    )


def _inventory_to_dict(items: list[InventoryQuantity]) -> dict[str, int]:
    inventory: dict[str, int] = {}
    for item in items:
        inventory[item.material_id] = inventory.get(item.material_id, 0) + item.quantity
    return inventory


def _dict_to_inventory(inventory: dict[str, int]) -> list[InventoryQuantity]:
    return [
        InventoryQuantity(material_id=material_id, quantity=quantity, unit="unit")
        for material_id, quantity in sorted(inventory.items())
        if quantity > 0
    ]


def _unique_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if value not in seen:
            output.append(value)
            seen.add(value)
    return output
