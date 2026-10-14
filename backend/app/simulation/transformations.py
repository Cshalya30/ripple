from __future__ import annotations

from datetime import timedelta

from .schemas import (
    AddCreditBridge,
    BusinessSnapshot,
    CreditFacility,
    DelayArrival,
    Dependency,
    Event,
    EventType,
    Scenario,
    SplitCustomerCollection,
    SplitSupplierPayment,
)
from .validation import SimulationValidationError, validate_snapshot


def apply_scenario(snapshot: BusinessSnapshot, scenario: Scenario | None) -> tuple[BusinessSnapshot, list[str]]:
    transformed = snapshot.model_copy(deep=True)
    assumptions: list[str] = []
    if scenario is None:
        validate_snapshot(transformed)
        return transformed, assumptions

    assumptions.extend(scenario.assumptions)
    for change in scenario.changes:
        if change.type == "MOVE_RECEIPT_DATE":
            _move_receipt(transformed, change)
            if change.assumption:
                assumptions.append(change.assumption)
        elif change.type == "DELAY_ARRIVAL":
            _delay_arrival(transformed, change)
            if change.assumption:
                assumptions.append(change.assumption)
        elif change.type == "SPLIT_CUSTOMER_COLLECTION":
            _split_customer_collection(transformed, change)
            assumptions.append(change.customer_agreement_assumption)
        elif change.type == "SPLIT_SUPPLIER_PAYMENT":
            _split_supplier_payment(transformed, change)
            assumptions.append(change.supplier_agreement_assumption)
        elif change.type == "ADD_CREDIT_BRIDGE":
            _add_credit_bridge(transformed, change)
            assumptions.append(change.assumption)
        else:
            raise SimulationValidationError("UNSUPPORTED_SCENARIO_CHANGE", {"type": getattr(change, "type", None)})

    validate_snapshot(transformed)
    return transformed, assumptions


def _find_event(snapshot: BusinessSnapshot, event_id: str) -> Event:
    for event in snapshot.events:
        if event.id == event_id:
            return event
    raise SimulationValidationError("MISSING_EVENT_REFERENCE", {"event_id": event_id})


def _move_receipt(snapshot: BusinessSnapshot, change) -> None:
    event = _find_event(snapshot, change.event_id)
    if event.type != EventType.CASH_RECEIPT:
        raise SimulationValidationError("SCENARIO_TYPE_MISMATCH", {"event_id": event.id, "expected": EventType.CASH_RECEIPT.value})
    event.earliest_date = change.new_earliest_date
    event.due_date = change.new_due_date or change.new_earliest_date


def _delay_arrival(snapshot: BusinessSnapshot, change: DelayArrival) -> None:
    event = _find_event(snapshot, change.event_id)
    if event.type != EventType.INVENTORY_ARRIVAL:
        raise SimulationValidationError("SCENARIO_TYPE_MISMATCH", {"event_id": event.id, "expected": EventType.INVENTORY_ARRIVAL.value})
    delta = timedelta(days=change.delay_days)
    event.earliest_date = event.earliest_date + delta
    if event.due_date is not None:
        event.due_date = event.due_date + delta


def _split_customer_collection(snapshot: BusinessSnapshot, change: SplitCustomerCollection) -> None:
    event = _find_event(snapshot, change.event_id)
    if event.type != EventType.CASH_RECEIPT:
        raise SimulationValidationError("SCENARIO_TYPE_MISMATCH", {"event_id": event.id, "expected": EventType.CASH_RECEIPT.value})
    original_amount = event.amount_paise or 0
    if change.deposit_amount_paise > original_amount:
        raise SimulationValidationError("DEPOSIT_EXCEEDS_COLLECTION", {"event_id": event.id})
    if any(existing.id == change.deposit_event_id for existing in snapshot.events):
        raise SimulationValidationError("DUPLICATE_ID", {"field": "events", "ids": [change.deposit_event_id]})

    deposit = Event(
        id=change.deposit_event_id,
        type=EventType.CASH_RECEIPT,
        order_id=event.order_id,
        counterparty_id=event.counterparty_id,
        earliest_date=change.deposit_date,
        due_date=change.deposit_date,
        priority=event.priority,
        amount_paise=change.deposit_amount_paise,
        assumptions=[change.customer_agreement_assumption],
    )
    if change.deposit_amount_paise == original_amount:
        snapshot.events = [existing for existing in snapshot.events if existing.id != event.id]
    else:
        event.amount_paise = original_amount - change.deposit_amount_paise
    snapshot.events.append(deposit)


def _split_supplier_payment(snapshot: BusinessSnapshot, change: SplitSupplierPayment) -> None:
    event = _find_event(snapshot, change.event_id)
    if event.type != EventType.SUPPLIER_PAYMENT:
        raise SimulationValidationError("SCENARIO_TYPE_MISMATCH", {"event_id": event.id, "expected": EventType.SUPPLIER_PAYMENT.value})
    original_amount = event.amount_paise or 0
    if sum(instalment.amount_paise for instalment in change.instalments) != original_amount:
        raise SimulationValidationError("INSTALMENTS_DO_NOT_CONSERVE_AMOUNT", {"event_id": event.id})
    existing_ids = {existing.id for existing in snapshot.events}
    duplicate_instalment_ids = sorted({instalment.id for instalment in change.instalments if instalment.id in existing_ids})
    if duplicate_instalment_ids:
        raise SimulationValidationError("DUPLICATE_ID", {"field": "events", "ids": duplicate_instalment_ids})

    original_dependencies = list(event.dependencies)
    instalment_events = [
        Event(
            id=instalment.id,
            type=EventType.SUPPLIER_PAYMENT,
            order_id=event.order_id,
            counterparty_id=event.counterparty_id,
            earliest_date=instalment.earliest_date,
            due_date=instalment.due_date or instalment.earliest_date,
            dependencies=original_dependencies,
            priority=event.priority,
            amount_paise=instalment.amount_paise,
            assumptions=[change.supplier_agreement_assumption],
        )
        for instalment in change.instalments
    ]
    snapshot.events = [existing for existing in snapshot.events if existing.id != event.id]
    snapshot.events.extend(instalment_events)

    replacement_ids = [instalment.id for instalment in change.instalments]
    release_dependency_ids = replacement_ids if change.release_policy == "FULL_PAYMENT" else [replacement_ids[0]]
    for existing in snapshot.events:
        new_dependencies: list[Dependency] = []
        for dependency in existing.dependencies:
            if dependency.predecessor_event_id == event.id:
                new_dependencies.extend(
                    Dependency(predecessor_event_id=replacement_id, lag_days=dependency.lag_days)
                    for replacement_id in release_dependency_ids
                )
            else:
                new_dependencies.append(dependency)
        existing.dependencies = new_dependencies


def _add_credit_bridge(snapshot: BusinessSnapshot, change: AddCreditBridge) -> None:
    facilities = {facility.id: facility for facility in snapshot.approved_credit_facilities}
    if change.facility is not None:
        if change.facility.id != change.facility_id:
            raise SimulationValidationError("FACILITY_ID_MISMATCH", {"facility_id": change.facility_id, "facility.id": change.facility.id})
        if change.facility_id in facilities:
            raise SimulationValidationError("DUPLICATE_ID", {"field": "approved_credit_facilities", "ids": [change.facility_id]})
        snapshot.approved_credit_facilities.append(change.facility)
        facility: CreditFacility = change.facility
    elif change.facility_id in facilities:
        facility = facilities[change.facility_id]
    else:
        raise SimulationValidationError("MISSING_FACILITY_REFERENCE", {"facility_id": change.facility_id})

    if change.principal_paise > facility.approved_limit_paise:
        raise SimulationValidationError("DRAWDOWN_EXCEEDS_APPROVED_LIMIT", {"facility_id": facility.id})
    if change.drawdown_date < facility.available_from_date:
        raise SimulationValidationError("DRAWDOWN_BEFORE_FACILITY_AVAILABLE", {"facility_id": facility.id})
    if facility.drawdown_fee_paise > change.principal_paise:
        raise SimulationValidationError("DRAWDOWN_FEE_EXCEEDS_PRINCIPAL", {"facility_id": facility.id})
    if any(event.id in {change.drawdown_event_id, change.repayment_event_id} for event in snapshot.events):
        raise SimulationValidationError("DUPLICATE_ID", {"field": "events", "ids": [change.drawdown_event_id, change.repayment_event_id]})

    drawdown = Event(
        id=change.drawdown_event_id,
        type=EventType.CREDIT_DRAWDOWN,
        earliest_date=change.drawdown_date,
        due_date=change.drawdown_date,
        facility_id=facility.id,
        principal_paise=change.principal_paise,
        priority=0,
        assumptions=[change.assumption],
    )
    repayment = Event(
        id=change.repayment_event_id,
        type=EventType.CREDIT_REPAYMENT,
        earliest_date=facility.contractual_repayment_date,
        due_date=facility.contractual_repayment_date,
        dependencies=[Dependency(predecessor_event_id=drawdown.id, lag_days=0)],
        facility_id=facility.id,
        priority=0,
        assumptions=["Full repayment uses contractual repayment date; it does not move with customer receipts."],
    )
    snapshot.events.extend([drawdown, repayment])
