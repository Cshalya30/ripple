from __future__ import annotations

from datetime import date

from .schemas import BusinessFacts, CollectionStatus, CustomerOrderFact


def unresolved_questions(facts: BusinessFacts) -> list[str]:
    questions = list(facts.unresolved_questions)
    if facts.business_name is None:
        questions.append("What is the business name?")
    if facts.opening_cash is None:
        questions.append("What cash was available on the requested start date, and in which currency/unit?")
    if facts.inventory_status != CollectionStatus.CONFIRMED_COMPLETE:
        questions.append("Is the opening inventory list complete? Provide quantity and unit for each material.")
    if facts.supplier_purchases_status != CollectionStatus.CONFIRMED_COMPLETE:
        questions.append("Are supplier purchases and outstanding payments complete for this snapshot?")
    if facts.customer_orders_status != CollectionStatus.CONFIRMED_COMPLETE:
        questions.append("Are customer orders complete for this snapshot?")
    if facts.facilities_status != CollectionStatus.CONFIRMED_COMPLETE:
        questions.append("Are approved credit facilities complete, or are there none?")
    for index, order in enumerate(facts.customer_orders):
        _order_questions(order, index, questions)
    return list(dict.fromkeys(questions))


def _order_questions(order: CustomerOrderFact, index: int, questions: list[str]) -> None:
    prefix = f"Customer order {index + 1}"
    required = {
        "customer": order.customer,
        "order reference": order.order_reference or order.source_reference,
        "production cost": order.production_start_cost,
        "production duration": order.production_duration_days,
        "earliest production date": order.earliest_production_start_date,
        "promised delivery date": order.promised_delivery_date,
        "outstanding collection": order.outstanding_collection,
        "collection timing": order.collection_timing_type,
    }
    for label, value in required.items():
        if value is None:
            questions.append(f"{prefix}: provide {label}.")
    if order.collection_timing_type == "FIXED_DATE" and order.collection_date is None:
        questions.append(f"{prefix}: provide the fixed collection date.")
    if order.collection_timing_type == "DAYS_AFTER_DELIVERY" and order.collection_days_after_delivery is None:
        questions.append(f"{prefix}: provide collection days after delivery.")
    if not order.materials:
        questions.append(f"{prefix}: provide required materials, quantities, and units.")
    for material_index, material in enumerate(order.materials):
        if material.quantity is None or material.unit is None:
            questions.append(f"{prefix} material {material_index + 1}: provide quantity and unit.")


def source_evidence_issues(facts: BusinessFacts, source_text: str) -> list[str]:
    return [
        f"Evidence {item.fact_reference} excerpt is not present in source text."
        for item in facts.evidence
        if item.status != "UNKNOWN" and item.source_excerpt not in source_text
    ]


def validate_intake_facts(facts: BusinessFacts, source_text: str) -> list[str]:
    issues = source_evidence_issues(facts, source_text)
    for index, item in enumerate(facts.opening_inventory):
        if item.quantity is None or item.unit is None:
            issues.append(f"Opening inventory item {index + 1} needs quantity and unit.")
    for index, purchase in enumerate(facts.supplier_purchases):
        if not purchase.already_paid and purchase.outstanding_payment is None:
            issues.append(f"Supplier purchase {index + 1} needs an outstanding payment amount or already_paid=true.")
    for index, facility in enumerate(facts.approved_facilities):
        if facility.approved and (
            facility.approved_limit is None
            or facility.available_from_date is None
            or facility.annual_interest_rate_bps is None
            or facility.contractual_repayment_date is None
        ):
            issues.append(f"Approved facility {index + 1} is missing documented terms.")
    return list(dict.fromkeys(issues))
