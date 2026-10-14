from __future__ import annotations

from collections import defaultdict

from .schemas import BusinessSnapshot, Event, EventType, MAX_EVENTS, MAX_SAFE_INTEGER


class SimulationValidationError(ValueError):
    def __init__(self, code: str, details: dict[str, object]):
        self.code = code
        self.details = details
        super().__init__(f"{code}: {details}")


def validate_snapshot(snapshot: BusinessSnapshot) -> None:
    if len(snapshot.events) > MAX_EVENTS:
        raise SimulationValidationError("TOO_MANY_EVENTS", {"max_events": MAX_EVENTS})
    _reject_duplicate_ids("orders", [order.id for order in snapshot.orders])
    _reject_duplicate_ids("events", [event.id for event in snapshot.events])
    _reject_duplicate_ids("approved_credit_facilities", [facility.id for facility in snapshot.approved_credit_facilities])
    _reject_duplicate_ids("opening_inventory.material_id", [item.material_id for item in snapshot.opening_inventory])
    for order in snapshot.orders:
        _reject_duplicate_ids(f"orders.{order.id}.material_requirements", [item.material_id for item in order.material_requirements])
    for event in snapshot.events:
        if event.inventory_quantities:
            _reject_duplicate_ids(f"events.{event.id}.inventory_quantities", [item.material_id for item in event.inventory_quantities])

    order_ids = {order.id for order in snapshot.orders}
    event_by_id = {event.id: event for event in snapshot.events}
    facility_ids = {facility.id for facility in snapshot.approved_credit_facilities}

    for event in snapshot.events:
        if event.order_id is not None and event.order_id not in order_ids:
            raise SimulationValidationError("MISSING_ORDER_REFERENCE", {"event_id": event.id, "order_id": event.order_id})
        if event.facility_id is not None and event.facility_id not in facility_ids:
            raise SimulationValidationError("MISSING_FACILITY_REFERENCE", {"event_id": event.id, "facility_id": event.facility_id})
        for dependency in event.dependencies:
            if dependency.predecessor_event_id == event.id:
                raise SimulationValidationError("SELF_DEPENDENCY", {"event_id": event.id})
            if dependency.predecessor_event_id not in event_by_id:
                raise SimulationValidationError(
                    "MISSING_EVENT_REFERENCE",
                    {"event_id": event.id, "predecessor_event_id": dependency.predecessor_event_id},
                )

    _reject_dependency_cycles(snapshot.events)
    _validate_operational_dependencies(snapshot.events, {order.id: order for order in snapshot.orders})
    _validate_credit_configuration(
        snapshot.events,
        event_by_id,
        {facility.id: facility for facility in snapshot.approved_credit_facilities},
    )
    _validate_numeric_totals(snapshot)


def _reject_duplicate_ids(label: str, ids: list[str]) -> None:
    seen: set[str] = set()
    duplicates: list[str] = []
    for item_id in ids:
        if item_id in seen:
            duplicates.append(item_id)
        seen.add(item_id)
    if duplicates:
        raise SimulationValidationError("DUPLICATE_ID", {"field": label, "ids": sorted(set(duplicates))})


def _reject_dependency_cycles(events: list[Event]) -> None:
    graph = {event.id: [dependency.predecessor_event_id for dependency in event.dependencies] for event in events}
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(event_id: str) -> None:
        if event_id in visiting:
            raise SimulationValidationError("DEPENDENCY_CYCLE", {"event_id": event_id})
        if event_id in visited:
            return
        visiting.add(event_id)
        for predecessor in graph[event_id]:
            visit(predecessor)
        visiting.remove(event_id)
        visited.add(event_id)

    for event_id in graph:
        visit(event_id)


def _validate_operational_dependencies(events: list[Event], orders) -> None:
    by_order_type: dict[tuple[str, EventType], list[Event]] = defaultdict(list)
    by_id = {event.id: event for event in events}
    for event in events:
        if event.order_id is not None:
            by_order_type[(event.order_id, event.type)].append(event)

    for event in events:
        if event.type == EventType.PRODUCTION_COMPLETE:
            starts = by_order_type[(event.order_id or "", EventType.PRODUCTION_START)]
            dependency_ids = {dependency.predecessor_event_id for dependency in event.dependencies}
            if not any(start.id in dependency_ids for start in starts):
                raise SimulationValidationError("MISSING_PRODUCTION_START_DEPENDENCY", {"event_id": event.id})
            order = orders[event.order_id or ""]
            if not any(
                by_id[dependency.predecessor_event_id].type == EventType.PRODUCTION_START
                and by_id[dependency.predecessor_event_id].order_id == event.order_id
                and dependency.lag_days == order.production_duration_days
                for dependency in event.dependencies
            ):
                raise SimulationValidationError(
                    "PRODUCTION_DURATION_DEPENDENCY_MISMATCH",
                    {"event_id": event.id, "required_lag_days": order.production_duration_days},
                )
        if event.type == EventType.DELIVERY:
            completes = by_order_type[(event.order_id or "", EventType.PRODUCTION_COMPLETE)]
            dependency_ids = {dependency.predecessor_event_id for dependency in event.dependencies}
            if not any(complete.id in dependency_ids for complete in completes):
                raise SimulationValidationError("MISSING_PRODUCTION_COMPLETE_DEPENDENCY", {"event_id": event.id})
        if event.type == EventType.PRODUCTION_START:
            for dependency in event.dependencies:
                predecessor = by_id[dependency.predecessor_event_id]
                if predecessor.type == EventType.INVENTORY_ARRIVAL:
                    continue


def _validate_credit_configuration(events: list[Event], event_by_id: dict[str, Event], facilities) -> None:
    drawdowns_by_facility: dict[str, list[Event]] = defaultdict(list)
    repayments_by_facility: dict[str, list[Event]] = defaultdict(list)
    for event in events:
        if event.type == EventType.CREDIT_DRAWDOWN:
            drawdowns_by_facility[event.facility_id or ""].append(event)
        elif event.type == EventType.CREDIT_REPAYMENT:
            repayments_by_facility[event.facility_id or ""].append(event)

    for facility_id, facility in facilities.items():
        if len(drawdowns_by_facility[facility_id]) > 1:
            raise SimulationValidationError("UNSUPPORTED_MULTIPLE_DRAWDOWNS", {"facility_id": facility_id})
        if len(repayments_by_facility[facility_id]) > 1:
            raise SimulationValidationError("UNSUPPORTED_MULTIPLE_REPAYMENTS", {"facility_id": facility_id})
        if repayments_by_facility[facility_id] and not drawdowns_by_facility[facility_id]:
            raise SimulationValidationError("REPAYMENT_WITHOUT_DRAWDOWN", {"facility_id": facility_id})
        if repayments_by_facility[facility_id]:
            repayment = repayments_by_facility[facility_id][0]
            drawdown = drawdowns_by_facility[facility_id][0]
            dependency_ids = {dependency.predecessor_event_id for dependency in repayment.dependencies}
            if drawdown.id not in dependency_ids:
                raise SimulationValidationError(
                    "MISSING_DRAWDOWN_DEPENDENCY",
                    {"repayment_event_id": repayment.id, "drawdown_event_id": drawdown.id},
                )
        if drawdowns_by_facility[facility_id]:
            drawdown = drawdowns_by_facility[facility_id][0]
            if drawdown.principal_paise and drawdown.principal_paise > facility.approved_limit_paise:
                raise SimulationValidationError("DRAWDOWN_EXCEEDS_APPROVED_LIMIT", {"facility_id": facility_id})
            if drawdown.earliest_date < facility.available_from_date:
                raise SimulationValidationError("DRAWDOWN_BEFORE_FACILITY_AVAILABLE", {"facility_id": facility_id})
            if drawdown.principal_paise and facility.drawdown_fee_paise > drawdown.principal_paise:
                raise SimulationValidationError("DRAWDOWN_FEE_EXCEEDS_PRINCIPAL", {"facility_id": facility_id})

    for event in events:
        if event.type == EventType.CREDIT_REPAYMENT:
            for dependency in event.dependencies:
                predecessor = event_by_id[dependency.predecessor_event_id]
                if predecessor.type == EventType.CREDIT_DRAWDOWN and predecessor.facility_id != event.facility_id:
                    raise SimulationValidationError("CONTRADICTORY_CREDIT_DEPENDENCY", {"event_id": event.id})


def _validate_numeric_totals(snapshot: BusinessSnapshot) -> None:
    values = [snapshot.opening_cash_paise]
    values.extend(event.amount_paise or 0 for event in snapshot.events)
    values.extend(event.principal_paise or 0 for event in snapshot.events)
    values.extend(order.production_start_cost_paise for order in snapshot.orders)
    values.extend(facility.approved_limit_paise for facility in snapshot.approved_credit_facilities)
    if sum(values) > MAX_SAFE_INTEGER * 10:
        raise SimulationValidationError("NUMERIC_TOTAL_TOO_LARGE", {"max_safe_integer": MAX_SAFE_INTEGER})
