"""Approved intake facts -> the owner's records (PRD 8.2 step 3).

Replaces the business's records with what the owner approved. Amounts come from the
validated facts via the intake's own money parser; nothing is invented here.
"""
from __future__ import annotations

import hashlib
import json
from datetime import timedelta

from ..core.db import bump_data_version, delete_business_data, insert, now_iso, today, tx
from ..intake.builder import money_to_paise
from ..intake.schemas import BusinessFacts, CollectionTimingType, ReleaseCondition


def _key(*parts: str | None) -> str:
    return hashlib.sha256("|".join(p or "" for p in parts).encode()).hexdigest()[:10]


def import_facts(business_id: str, facts: BusinessFacts, *, replace: bool = True) -> dict[str, int]:
    as_of = today()
    counts = {"parties": 0, "orders": 0, "invoices": 0, "purchases": 0, "materials": 0, "expenses": 0, "facilities": 0}
    with tx() as conn:
        if replace:
            delete_business_data(conn, business_id)
            changes = {"opening_balance_paise": money_to_paise(facts.opening_cash), "opening_balance_date": (as_of - timedelta(days=1)).isoformat()}
            if facts.business_name:
                changes["name"] = facts.business_name[:120]
            conn.execute(
                "UPDATE business SET opening_balance_paise = ?, opening_balance_date = ?, name = COALESCE(?, name) WHERE id = ?",
                (changes["opening_balance_paise"], changes["opening_balance_date"], changes.get("name"), business_id))
        elif facts.business_name:
            conn.execute("UPDATE business SET name = ? WHERE id = ?", (facts.business_name[:120], business_id))

        def put(conn, table, row):
            if replace:
                insert(conn, table, row)
            else:
                values = {**row}
                stamp = now_iso()
                values.setdefault("created_at", stamp)
                values.setdefault("updated_at", stamp)
                cols = ", ".join(values)
                marks = ", ".join("?" for _ in values)
                conn.execute(f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({marks})",
                             [json.dumps(value) if isinstance(value, (list, dict)) else value for value in values.values()])

        parties: dict[tuple[str, str], str] = {}

        def party(kind: str, name: str | None) -> str:
            label = (name or ("Supplier" if kind == "SUPPLIER" else "Customer")).strip()[:120]
            key = (kind, label.lower())
            if key not in parties:
                parties[key] = f"{business_id}:p:{_key(kind, label)}"
                put(conn, "party", {"id": parties[key], "business_id": business_id, "kind": kind, "name": label, "terms_type": "CREDIT",
                                       "terms_days": 30, "lead_time_days": 0, "tags_json": [], "notes_json": [], "since": as_of.isoformat()})
                counts["parties"] += 1
            return parties[key]

        materials: dict[str, str] = {}

        def material(item) -> str:
            name = (item.material_name or item.material_reference or "Material").strip()[:120]
            ref = (item.material_reference or name).lower()
            if ref not in materials:
                materials[ref] = f"{business_id}:m:{_key(ref)}"
                put(conn, "material", {"id": materials[ref], "business_id": business_id, "sku": f"RM-{_key(ref)[:6].upper()}", "name": name,
                                          "unit": item.unit or "unit", "base_unit": item.unit or "unit", "unit_factor": 1,
                                          "reorder_safety_days": 7, "primary_supplier_id": None, "avg_cost_paise": 0})
                counts["materials"] += 1
            return materials[ref]

        for index, item in enumerate(facts.opening_inventory):
            mid = material(item)
            put(conn, "stock_movement", {"id": f"{business_id}:mv:open{index}", "business_id": business_id, "item_type": "MATERIAL", "item_id": mid,
                                            "qty_delta": item.quantity or 0, "reason": "ADJUSTMENT", "ref": None, "note": "Opening stock from intake",
                                            "user_id": None, "date": (as_of - timedelta(days=1)).isoformat()})

        for index, purchase in enumerate(facts.supplier_purchases):
            supplier = party("SUPPLIER", purchase.supplier)
            ref = purchase.source_reference or f"P{index + 1}"
            if purchase.lead_time_days is not None:
                conn.execute("UPDATE party SET lead_time_days = ? WHERE id = ?", (purchase.lead_time_days, supplier))
            unpaid = not purchase.already_paid and purchase.outstanding_payment is not None
            amount = money_to_paise(purchase.outstanding_payment) if unpaid else 0
            pay_date = purchase.contractual_due_date or purchase.earliest_payment_date or as_of
            arrival = purchase.arrival_date or ((purchase.earliest_payment_date or as_of) + timedelta(days=purchase.lead_time_days or 0))
            has_goods = bool(purchase.materials) and (purchase.arrival_date is not None or purchase.lead_time_days is not None)
            if has_goods and unpaid and purchase.release_condition == ReleaseCondition.FULL_PAYMENT:
                conn.execute("UPDATE party SET terms_type = 'ADVANCE' WHERE id = ?", (supplier,))
                for m_index, item in enumerate(purchase.materials):
                    put(conn, "purchase_order", {"id": f"{business_id}:po:{_key(ref, str(m_index))}", "business_id": business_id,
                                                    "number": f"{ref}-{m_index + 1}"[:40], "supplier_id": supplier, "material_id": material(item),
                                                    "qty": item.quantity or 0, "amount_paise": amount if m_index == 0 else 0, "ordered_date": as_of.isoformat(),
                                                    "expected_arrival": None, "payment_due": (purchase.earliest_payment_date or as_of).isoformat(),
                                                    "terms_type": "ADVANCE", "status": "ORDERED"})
                    counts["purchases"] += 1
                continue
            if unpaid:
                put(conn, "invoice", {"id": f"{business_id}:inv:{_key('pay', ref)}", "business_id": business_id, "kind": "PAYABLE", "party_id": supplier,
                                         "number": ref[:40], "description": "From intake", "amount_paise": amount,
                                         "invoice_date": min(as_of, pay_date).isoformat(), "due_date": pay_date.isoformat(), "status": "OPEN"})
                counts["invoices"] += 1
            if has_goods:
                for m_index, item in enumerate(purchase.materials):
                    put(conn, "purchase_order", {"id": f"{business_id}:po:{_key(ref, str(m_index))}", "business_id": business_id,
                                                    "number": f"{ref}-{m_index + 1}"[:40], "supplier_id": supplier, "material_id": material(item),
                                                    "qty": item.quantity or 0, "amount_paise": 0, "ordered_date": as_of.isoformat(),
                                                    "expected_arrival": arrival.isoformat(), "payment_due": None, "terms_type": "ADVANCE",
                                                    "status": "PAID"})
                    counts["purchases"] += 1

        for index, order in enumerate(facts.customer_orders):
            customer = party("CUSTOMER", order.customer)
            ref = order.order_reference or order.source_reference or f"ORDER-{index + 1}"
            value = money_to_paise(order.outstanding_collection) if order.outstanding_collection and not order.already_collected else 0
            fixed = order.collection_timing_type == CollectionTimingType.FIXED_DATE
            so_id = f"{business_id}:so:{_key(ref)}"
            put(conn, "sales_order", {
                "id": so_id, "business_id": business_id, "number": ref[:40], "customer_id": customer, "product_id": None, "qty": 1,
                "unit_price_paise": value, "order_date": as_of.isoformat(),
                "earliest_start_date": (order.earliest_production_start_date or as_of).isoformat(),
                "promised_date": (order.promised_delivery_date or as_of).isoformat(), "priority": min(order.priority, 1000), "stage": "PLANNED",
                "deposit_paise": value if fixed else 0,
                "materials_json": json.dumps([{"material_id": material(item), "quantity": item.quantity or 0} for item in order.materials if item.quantity]),
                "production_cost_paise": money_to_paise(order.production_start_cost) if order.production_start_cost else 0,
                "production_days": order.production_duration_days or 0,
                "collection_terms_days": order.collection_days_after_delivery if not fixed else None,
            })
            counts["orders"] += 1
            if fixed and value and order.collection_date:
                put(conn, "invoice", {"id": f"{business_id}:inv:{_key('so', ref)}", "business_id": business_id, "kind": "RECEIVABLE", "party_id": customer,
                                         "order_id": so_id, "number": f"{ref}-COLL"[:40], "description": "Agreed collection date",
                                         "amount_paise": value, "invoice_date": as_of.isoformat(), "due_date": order.collection_date.isoformat(), "status": "OPEN"})
                counts["invoices"] += 1

        for index, receivable in enumerate(facts.existing_receivables):
            if receivable.already_collected or receivable.amount is None:
                continue
            customer = party("CUSTOMER", receivable.customer)
            due = receivable.expected_collection_date or as_of
            ref = receivable.source_reference or f"R{index + 1}"
            put(conn, "invoice", {"id": f"{business_id}:inv:{_key('rec', ref)}", "business_id": business_id, "kind": "RECEIVABLE", "party_id": customer,
                                     "number": ref[:40], "description": "From intake", "amount_paise": money_to_paise(receivable.amount),
                                     "invoice_date": min(as_of, due).isoformat(), "due_date": due.isoformat(), "status": "OPEN"})
            counts["invoices"] += 1

        for index, expense in enumerate(facts.expenses):
            if expense.amount is None:
                continue
            put(conn, "scheduled_expense", {"id": f"{business_id}:sx:{index}", "business_id": business_id,
                                               "label": (expense.description or "Expense")[:120], "amount_paise": money_to_paise(expense.amount),
                                               "due_date": (expense.due_date or as_of).isoformat(), "paid": 0})
            counts["expenses"] += 1

        for index, facility in enumerate(facts.approved_facilities):
            if not facility.approved or facility.approved_limit is None:
                continue
            put(conn, "credit_facility", {"id": f"{business_id}:cf:{index}", "business_id": business_id,
                                             "label": facility.facility_id or f"Approved facility {index + 1}",
                                             "approved_limit_paise": money_to_paise(facility.approved_limit),
                                             "annual_rate_bps": facility.annual_interest_rate_bps or 0,
                                             "drawdown_fee_paise": money_to_paise(facility.drawdown_fee) if facility.drawdown_fee else 0,
                                             "available_from": (facility.available_from_date or as_of).isoformat(),
                                             "repayment_date": (facility.contractual_repayment_date or as_of + timedelta(days=90)).isoformat()})
            counts["facilities"] += 1
        bump_data_version(conn, business_id)
    return counts
