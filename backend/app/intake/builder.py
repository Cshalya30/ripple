from __future__ import annotations

import hashlib
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from pydantic import ValidationError

from ..simulation.schemas import (
    BusinessSnapshot,
    CreditFacility,
    Dependency,
    Event,
    EventType,
    InventoryQuantity,
    Order,
)
from ..simulation.validation import SimulationValidationError, validate_snapshot
from .schemas import (
    BusinessFacts,
    CollectionTimingType,
    ExpenseFact,
    InventoryFact,
    Money,
    ReleaseCondition,
)
from .validation import unresolved_questions, validate_intake_facts


class SnapshotBuildError(ValueError):
    def __init__(self, issues: list[str]):
        self.issues = issues
        super().__init__("Snapshot cannot be built: " + "; ".join(issues))


def money_to_paise(value: Money) -> int:
    if value.currency.upper() != "INR" or value.unit.lower() not in {"rupees", "inr", "paise"}:
        raise SnapshotBuildError([f"Unsupported money unit/currency: {value.currency} {value.unit}."])
    try:
        amount = Decimal(value.amount.replace(",", "").strip())
    except InvalidOperation as exc:
        raise SnapshotBuildError([f"Invalid decimal amount: {value.amount}."]) from exc
    if amount < 0 or amount.as_tuple().exponent < -2:
        raise SnapshotBuildError([f"Amount must be non-negative INR with at most two decimals: {value.amount}."])
    if value.unit.lower() == "paise":
        return int(amount)
    return int(amount * 100)


def build_snapshot(confirmed_facts: BusinessFacts, request_metadata: dict) -> BusinessSnapshot:
    source_text = request_metadata.get("source_text", "")
    issues = unresolved_questions(confirmed_facts) + validate_intake_facts(confirmed_facts, source_text)
    if issues:
        raise SnapshotBuildError(list(dict.fromkeys(issues)))
    try:
        snapshot = _build(confirmed_facts, request_metadata)
        validate_snapshot(snapshot)
        return snapshot
    except (ValidationError, SimulationValidationError, SnapshotBuildError) as exc:
        if isinstance(exc, SnapshotBuildError):
            raise
        details = getattr(exc, "details", None)
        raise SnapshotBuildError([str(details or exc)]) from exc


def _build(facts: BusinessFacts, metadata: dict) -> BusinessSnapshot:
    start_date = metadata["start_date"]
    refs = [
        item.source_reference
        for item in [
            *facts.supplier_purchases,
            *facts.customer_orders,
            *facts.existing_receivables,
            *facts.expenses,
        ]
        if item.source_reference
    ]
    if len(refs) != len(set(refs)):
        raise SnapshotBuildError(["Duplicate source references represent repeated obligations."])
    materials = _materials(facts.opening_inventory, facts.customer_orders, facts.supplier_purchases)
    opening_inventory = [_inventory(item, materials) for item in facts.opening_inventory]
    events: list[Event] = []
    orders: list[Order] = []

    for index, purchase in enumerate(facts.supplier_purchases):
        if purchase.already_paid:
            continue
        ref = purchase.source_reference or f"supplier-{index + 1}"
        payment_id = _id("supplier-payment", ref)
        payment_date = purchase.earliest_payment_date or start_date
        events.append(Event(
            id=payment_id,
            type=EventType.SUPPLIER_PAYMENT,
            counterparty_id=_id("supplier", purchase.supplier or ref),
            earliest_date=payment_date,
            due_date=purchase.contractual_due_date,
            amount_paise=money_to_paise(purchase.outstanding_payment),
        ))
        if purchase.materials and (purchase.arrival_date or purchase.lead_time_days is not None):
            arrival_date = purchase.arrival_date or payment_date + timedelta(days=purchase.lead_time_days or 0)
            dependencies = (
                [Dependency(predecessor_event_id=payment_id, lag_days=0)]
                if purchase.release_condition == ReleaseCondition.FULL_PAYMENT else []
            )
            events.append(Event(
                id=_id("inventory-arrival", ref),
                type=EventType.INVENTORY_ARRIVAL,
                earliest_date=arrival_date,
                dependencies=dependencies,
                inventory_quantities=[_inventory(item, materials) for item in purchase.materials],
            ))

    for index, raw_order in enumerate(facts.customer_orders):
        ref = raw_order.order_reference or raw_order.source_reference or f"order-{index + 1}"
        order_id = _id("order", ref)
        orders.append(Order(
            id=order_id,
            customer_id=_id("customer", raw_order.customer),
            promised_delivery_date=raw_order.promised_delivery_date,
            material_requirements=[_inventory(item, materials) for item in raw_order.materials],
            production_start_cost_paise=money_to_paise(raw_order.production_start_cost),
            production_duration_days=raw_order.production_duration_days,
            priority=raw_order.priority,
        ))
        start_id = _id("production-start", ref)
        complete_id = _id("production-complete", ref)
        delivery_id = _id("delivery", ref)
        earliest = raw_order.earliest_production_start_date
        events.extend([
            Event(id=start_id, type=EventType.PRODUCTION_START, order_id=order_id, earliest_date=earliest),
            Event(
                id=complete_id,
                type=EventType.PRODUCTION_COMPLETE,
                order_id=order_id,
                earliest_date=earliest,
                dependencies=[Dependency(predecessor_event_id=start_id, lag_days=raw_order.production_duration_days)],
            ),
            Event(
                id=delivery_id,
                type=EventType.DELIVERY,
                order_id=order_id,
                earliest_date=earliest,
                due_date=raw_order.promised_delivery_date,
                dependencies=[Dependency(predecessor_event_id=complete_id, lag_days=0)],
            ),
        ])
        if not raw_order.already_collected:
            receipt_date = raw_order.collection_date
            dependencies = []
            if raw_order.collection_timing_type == CollectionTimingType.DAYS_AFTER_DELIVERY:
                receipt_date = start_date
                dependencies = [Dependency(predecessor_event_id=delivery_id, lag_days=raw_order.collection_days_after_delivery)]
            events.append(Event(
                id=_id("customer-receipt", ref),
                type=EventType.CASH_RECEIPT,
                counterparty_id=_id("customer", raw_order.customer),
                earliest_date=receipt_date,
                dependencies=dependencies,
                amount_paise=money_to_paise(raw_order.outstanding_collection),
            ))

    for index, receivable in enumerate(facts.existing_receivables):
        if not receivable.already_collected:
            ref = receivable.source_reference or f"receivable-{index + 1}"
            events.append(Event(
                id=_id("existing-receipt", ref),
                type=EventType.CASH_RECEIPT,
                counterparty_id=_id("customer", receivable.customer or ref),
                earliest_date=receivable.expected_collection_date,
                amount_paise=money_to_paise(receivable.amount),
            ))
    for index, expense in enumerate(facts.expenses):
        ref = expense.source_reference or f"expense-{index + 1}"
        events.append(Event(
            id=_id("expense", ref),
            type=EventType.OTHER_EXPENSE,
            earliest_date=expense.due_date or start_date,
            due_date=expense.due_date,
            amount_paise=money_to_paise(expense.amount),
        ))
    facilities = [_facility(item) for item in facts.approved_facilities if item.approved]
    return BusinessSnapshot(
        business_id=metadata["business_id"],
        start_date=start_date,
        horizon_days=metadata["horizon_days"],
        opening_cash_paise=money_to_paise(facts.opening_cash),
        opening_inventory=opening_inventory,
        orders=orders,
        events=events,
        approved_credit_facilities=facilities,
    )


def _materials(opening, orders, purchases) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in [*opening, *(x for order in orders for x in order.materials), *(x for purchase in purchases for x in purchase.materials)]:
        key = item.material_reference or item.material_name
        if key is None or item.unit is None:
            continue
        if key in result and result[key] != item.unit:
            raise SnapshotBuildError([f"Material {key} uses inconsistent units."])
        result[key] = item.unit
    return result


def _inventory(item: InventoryFact, materials: dict[str, str]) -> InventoryQuantity:
    key = item.material_reference or item.material_name
    return InventoryQuantity(material_id=_id("material", key), quantity=item.quantity, unit=materials[key])


def _facility(item) -> CreditFacility:
    return CreditFacility(
        id=item.facility_id or _id("facility", item.source_reference),
        approved_limit_paise=money_to_paise(item.approved_limit),
        available_from_date=item.available_from_date,
        annual_interest_rate_bps=item.annual_interest_rate_bps,
        drawdown_fee_paise=money_to_paise(item.drawdown_fee or Money(amount="0")),
        contractual_repayment_date=item.contractual_repayment_date,
    )


def _id(prefix: str, value: str | None) -> str:
    if not value:
        raise SnapshotBuildError([f"Missing stable reference for {prefix}."])
    digest = hashlib.sha256(value.strip().encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{digest}"
