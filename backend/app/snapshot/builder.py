"""Records -> BusinessSnapshot (PRD section 10).

A pure function of the records at a date: same records, same snapshot, same hash.
Alongside the snapshot it returns `meta`, the human labels the screens need
(who an event belongs to, which record it came from, which lane it sits in).
Meta never contains computed results; those come only from the engine.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from ..core.db import query, query_one
from ..simulation.schemas import BusinessSnapshot, CreditFacility, Dependency, Event, EventType, InventoryQuantity, Order
from ..simulation.validation import SimulationValidationError, validate_snapshot

OPEN_ORDER_STAGES = {"PLANNED", "MATERIALS_READY", "IN_PRODUCTION", "READY"}


class SnapshotBuilderError(ValueError):
    def __init__(self, code: str, details: dict[str, Any]):
        self.code = code
        self.details = details
        super().__init__(f"{code}: {details}")


@dataclass
class BuiltSnapshot:
    snapshot: BusinessSnapshot
    meta: dict[str, Any]
    snapshot_hash: str
    warnings: list[str] = field(default_factory=list)


def stable(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()


def snapshot_hash(snapshot: BusinessSnapshot) -> str:
    payload = json.dumps(snapshot.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def load_records(business_id: str) -> dict[str, Any]:
    q = lambda table, extra="": query(f"SELECT * FROM {table} WHERE business_id = ? {extra}", (business_id,))  # noqa: E731
    return {
        "business": query_one("SELECT * FROM business WHERE id = ?", (business_id,)),
        "parties": q("party", "ORDER BY id"),
        "materials": q("material", "ORDER BY sku"),
        "products": q("product", "ORDER BY sku"),
        "recipe_lines": q("recipe_line", "ORDER BY id"),
        "movements": q("stock_movement", "ORDER BY date, id"),
        "sales_orders": q("sales_order", "ORDER BY number"),
        "purchase_orders": q("purchase_order", "ORDER BY number"),
        "invoices": q("invoice", "AND status != 'PAID' ORDER BY number"),
        "txns": q("txn", "ORDER BY date, id"),
        "recurring": q("recurring_expense", "AND active = 1 ORDER BY id"),
        "scheduled": q("scheduled_expense", "AND paid = 0 ORDER BY due_date"),
        "facilities": q("credit_facility", "ORDER BY id"),
    }


def cleared_paid_by_invoice(txns: list[dict]) -> dict[str, int]:
    paid: dict[str, int] = {}
    for txn in txns:
        if txn["invoice_id"] and txn["status"] == "CLEARED":
            paid[txn["invoice_id"]] = paid.get(txn["invoice_id"], 0) + txn["amount_paise"]
    return paid


def opening_cash(business: dict, txns: list[dict], as_of: date) -> int:
    cash = business["opening_balance_paise"]
    for txn in txns:
        if txn["status"] == "CLEARED" and txn["date"] <= as_of.isoformat():
            cash += txn["amount_paise"] if txn["direction"] == "IN" else -txn["amount_paise"]
    return cash


def on_hand(movements: list[dict], as_of: date) -> dict[str, int]:
    stock: dict[str, int] = {}
    for move in movements:
        if move["date"] <= as_of.isoformat():
            stock[move["item_id"]] = stock.get(move["item_id"], 0) + move["qty_delta"]
    return stock


def order_requirements(order: dict, recipes: dict[str, list[dict]]) -> list[tuple[str, int]]:
    """Quantity x recipe per piece including wastage, rounded up per material (base units)."""
    if order.get("materials_json"):
        return [(item["material_id"], int(item["quantity"])) for item in json.loads(order["materials_json"])]
    needs: list[tuple[str, int]] = []
    for line in recipes.get(order["product_id"] or "", []):
        per_piece = line["qty_per_piece"] * (10_000 + line["wastage_bp"])
        needs.append((line["material_id"], math.ceil(order["qty"] * per_piece / 10_000)))
    return needs


def build_from_records(records: dict[str, Any], as_of: date, horizon_days: int | None = None) -> BuiltSnapshot:
    business = records["business"]
    if business is None:
        raise SnapshotBuilderError("UNKNOWN_BUSINESS", {})
    horizon = horizon_days or business["horizon_days"]
    end = as_of + timedelta(days=horizon)
    warnings: list[str] = []
    parties = {party["id"]: party for party in records["parties"]}
    products = {product["id"]: product for product in records["products"]}
    materials = {material["id"]: material for material in records["materials"]}
    recipes: dict[str, list[dict]] = {}
    for line in records["recipe_lines"]:
        recipes.setdefault(line["product_id"], []).append(line)
    paid = cleared_paid_by_invoice(records["txns"])

    events: list[Event] = []
    orders: list[Order] = []
    meta_events: dict[str, dict[str, Any]] = {}
    lanes: list[dict[str, str]] = []

    def add(event: Event, **info: Any) -> None:
        events.append(event)
        meta_events[event.id] = info

    def party_name(party_id: str | None) -> str | None:
        return parties[party_id]["name"] if party_id in parties else None

    # Opening position
    cash = opening_cash(business, records["txns"], as_of)
    if cash < 0:
        warnings.append(f"Recorded transactions give negative cash ({cash} paise); opening cash set to 0. Check the opening balance in Settings.")
        cash = 0
    stock = on_hand(records["movements"], as_of)
    opening_inventory = [
        InventoryQuantity(material_id=material_id, quantity=stock[material_id], unit=materials[material_id]["base_unit"])
        for material_id in sorted(materials)
        if stock.get(material_id, 0) > 0
    ]

    # Sales orders: start -> complete -> deliver -> receipt
    for so in records["sales_orders"]:
        if so["stage"] not in OPEN_ORDER_STAGES:
            continue
        customer = parties.get(so["customer_id"])
        if customer is None:
            raise SnapshotBuilderError("MISSING_PARTY", {"record": so["number"], "party_id": so["customer_id"]})
        product = products.get(so["product_id"]) if so["product_id"] else None
        duration = so["production_days"] if so["production_days"] is not None else (product["production_days"] if product else 0)
        cost = so["production_cost_paise"] if so["production_cost_paise"] is not None else so["qty"] * (product["production_cost_paise"] if product else 0)
        needs = order_requirements(so, recipes)
        earliest = max(as_of, date.fromisoformat(so["earliest_start_date"] or as_of.isoformat()))
        if so["stage"] in {"IN_PRODUCTION", "READY"}:
            # Materials and production cost were spent when production started.
            started = date.fromisoformat(so["earliest_start_date"] or as_of.isoformat())
            duration = 0 if so["stage"] == "READY" else max(0, (started + timedelta(days=duration) - as_of).days)
            cost, needs, earliest = 0, [], as_of
        order_id = so["number"]
        base = stable(so["number"])
        promised = date.fromisoformat(so["promised_date"])
        orders.append(Order(
            id=order_id,
            customer_id=so["customer_id"],
            promised_delivery_date=promised,
            material_requirements=[
                InventoryQuantity(material_id=mid, quantity=qty, unit=materials[mid]["base_unit"]) for mid, qty in needs if qty > 0
            ],
            production_start_cost_paise=cost,
            production_duration_days=duration,
            priority=so["priority"],
        ))
        lane = f"order:{order_id}"
        lanes.append({"id": lane, "label": f"{order_id} · {customer['name']}", "kind": "ORDER"})
        start_id, complete_id, deliver_id = f"{base}-start", f"{base}-complete", f"{base}-deliver"
        product_label = product["name"] if product else "Custom order"
        common = {"order_id": order_id, "record_type": "sales_order", "record_id": so["id"], "lane": lane,
                  "party_id": so["customer_id"], "party_name": customer["name"]}
        add(Event(id=start_id, type=EventType.PRODUCTION_START, order_id=order_id, earliest_date=earliest,
                  due_date=max(as_of, promised - timedelta(days=duration)),
                  assumptions=[f"{order_id}: materials from recipe x {so['qty']} pieces including wastage."]),
            label=f"Start {order_id}", detail=f"{so['qty']} x {product_label}", amount_paise=cost, direction="OUT",
            materials=[{"material_id": mid, "quantity": qty} for mid, qty in needs], **common)
        add(Event(id=complete_id, type=EventType.PRODUCTION_COMPLETE, order_id=order_id, earliest_date=earliest,
                  dependencies=[Dependency(predecessor_event_id=start_id, lag_days=duration)]),
            label=f"Complete {order_id}", detail=f"{duration} days in production", **common)
        add(Event(id=deliver_id, type=EventType.DELIVERY, order_id=order_id, earliest_date=earliest, due_date=promised,
                  dependencies=[Dependency(predecessor_event_id=complete_id, lag_days=0)]),
            label=f"Deliver {order_id}", detail=f"to {customer['name']}", **common)
        value = so["qty"] * so["unit_price_paise"] - so["deposit_paise"]
        terms = so["collection_terms_days"] if so["collection_terms_days"] is not None else customer["terms_days"]
        if value > 0:
            add(Event(id=f"{base}-receipt", type=EventType.CASH_RECEIPT, order_id=order_id, counterparty_id=so["customer_id"],
                      earliest_date=as_of, dependencies=[Dependency(predecessor_event_id=deliver_id, lag_days=terms)],
                      amount_paise=value,
                      assumptions=[f"{order_id}: receipt timed at customer terms ({terms} days after delivery)."]),
                label=f"{customer['name']} pays {order_id}", detail=f"{terms} days after delivery", amount_paise=value,
                direction="IN", receipt_kind="DELIVERY_RELATIVE", terms_days=terms, **common)

    # Open receivables (delivered, unpaid)
    old_lane = {"id": "old-receivables", "label": "Old receivables", "kind": "RECEIVABLES"}
    payables_lane = {"id": "payables", "label": "Supplier bills", "kind": "PAYABLES"}
    for inv in records["invoices"]:
        outstanding = inv["amount_paise"] - paid.get(inv["id"], 0)
        if outstanding <= 0:
            continue
        party = parties.get(inv["party_id"])
        if party is None:
            raise SnapshotBuilderError("MISSING_PARTY", {"record": inv["number"], "party_id": inv["party_id"]})
        due = date.fromisoformat(inv["due_date"])
        promised = date.fromisoformat(inv["promised_date"]) if inv["promised_date"] else None
        if inv["kind"] == "RECEIVABLE":
            if promised is not None and promised >= as_of:
                expected, why = promised, f"{inv['number']}: timed at the date {party['name']} promised."
            elif due >= as_of:
                expected, why = due, f"{inv['number']}: timed at the due date."
            else:
                expected, why = as_of, f"{inv['number']}: already overdue; assumed collectable from today."
            add(Event(id=f"receipt-{stable(inv['number'])}", type=EventType.CASH_RECEIPT, counterparty_id=inv["party_id"],
                      earliest_date=expected, due_date=due, amount_paise=outstanding, assumptions=[why]),
                label=f"{party['name']} pays {inv['number']}", detail=inv["description"] or "", amount_paise=outstanding,
                direction="IN", record_type="invoice", record_id=inv["id"], lane=old_lane["id"], party_id=inv["party_id"],
                party_name=party["name"], receipt_kind="FIXED_DATE", due_date=inv["due_date"],
                anchor_date=(promised or due).isoformat())
        else:
            earliest = max(as_of, due)
            add(Event(id=f"pay-{stable(inv['number'])}", type=EventType.SUPPLIER_PAYMENT, counterparty_id=inv["party_id"],
                      earliest_date=earliest, due_date=due, amount_paise=outstanding,
                      assumptions=[f"{inv['number']}: paid on its due date when cash allows."]),
                label=f"Pay {party['name']}", detail=f"{inv['number']} · {inv['description'] or ''}".strip(" ·"),
                amount_paise=outstanding, direction="OUT", record_type="invoice", record_id=inv["id"], lane=payables_lane["id"],
                party_id=inv["party_id"], party_name=party["name"])

    invoice_event = {meta["record_id"]: event_id for event_id, meta in meta_events.items() if meta.get("record_type") == "invoice"}

    # Purchase orders
    for po in records["purchase_orders"]:
        if po["status"] in {"ARRIVED", "CLOSED", "CANCELLED"}:
            continue
        supplier = parties.get(po["supplier_id"])
        if supplier is None:
            raise SnapshotBuilderError("MISSING_PARTY", {"record": po["number"], "party_id": po["supplier_id"]})
        material = materials.get(po["material_id"]) if po["material_id"] else None
        base = stable(po["number"])
        lane = f"po:{po['number']}"
        lanes.append({"id": lane, "label": f"{po['number']} · {supplier['name']}", "kind": "PURCHASE"})
        common = {"record_type": "purchase_order", "record_id": po["id"], "lane": lane, "party_id": po["supplier_id"],
                  "party_name": supplier["name"], "po_number": po["number"]}
        arrival_id, pay_id = f"{base}-arrive", f"{base}-pay"
        lead = supplier["lead_time_days"]
        qty_label = _qty_label(po["qty"], material) if material else ""
        arrival_deps: list[Dependency] = []
        if po["terms_type"] in {"ADVANCE", "ON_DELIVERY"} and po["status"] != "PAID" and po["amount_paise"] > 0:
            pay_date = max(as_of, date.fromisoformat(po["payment_due"] or as_of.isoformat()))
            add(Event(id=pay_id, type=EventType.SUPPLIER_PAYMENT, counterparty_id=po["supplier_id"], earliest_date=pay_date,
                      due_date=pay_date, amount_paise=po["amount_paise"],
                      assumptions=[f"{po['number']}: {supplier['name']} ships {lead} days after payment."]),
                label=f"Pay {supplier['name']} for {po['number']}", detail="Advance payment", amount_paise=po["amount_paise"],
                direction="OUT", **common)
            arrival_deps.append(Dependency(predecessor_event_id=pay_id, lag_days=lead))
            arrival_earliest = as_of
        else:
            arrival_earliest = max(as_of, date.fromisoformat(po["expected_arrival"] or as_of.isoformat()))
            if po["release_after_invoice_id"] and po["release_after_invoice_id"] in invoice_event:
                arrival_deps.append(Dependency(predecessor_event_id=invoice_event[po["release_after_invoice_id"]], lag_days=lead))
        if material is not None and po["qty"] > 0:
            hold = " after the previous bill is cleared" if po["release_after_invoice_id"] else ""
            add(Event(id=arrival_id, type=EventType.INVENTORY_ARRIVAL, earliest_date=arrival_earliest,
                      dependencies=arrival_deps,
                      inventory_quantities=[InventoryQuantity(material_id=material["id"], quantity=po["qty"], unit=material["base_unit"])],
                      assumptions=[f"{po['number']}: {supplier['name']} dispatches{hold}; lead time {lead} days."]),
                label=f"{material['name']} arrives", detail=f"{qty_label} from {supplier['name']}", quantity=po["qty"],
                material_id=material["id"], direction="NONE", **common)
            if po["terms_type"] == "CREDIT" and po["amount_paise"] > 0:
                add(Event(id=pay_id, type=EventType.SUPPLIER_PAYMENT, counterparty_id=po["supplier_id"], earliest_date=as_of,
                          dependencies=[Dependency(predecessor_event_id=arrival_id, lag_days=supplier["terms_days"])],
                          amount_paise=po["amount_paise"],
                          assumptions=[f"{po['number']}: paid {supplier['terms_days']} days after arrival (credit terms)."]),
                    label=f"Pay {supplier['name']} for {po['number']}", detail=f"{supplier['terms_days']} days after arrival",
                    amount_paise=po["amount_paise"], direction="OUT", **common)

    # Overheads
    overhead_lane = {"id": "overheads", "label": "Overheads", "kind": "OVERHEADS"}
    for rx in records["recurring"]:
        for occurrence in _monthly(rx["day_of_month"], as_of, end):
            add(Event(id=f"exp-{stable(rx['label'])}-{occurrence.isoformat()}", type=EventType.OTHER_EXPENSE,
                      earliest_date=occurrence, due_date=occurrence, amount_paise=rx["amount_paise"],
                      assumptions=[f"{rx['label']}: recurring on day {rx['day_of_month']} of each month."]),
                label=rx["label"], detail="Monthly", amount_paise=rx["amount_paise"], direction="OUT",
                record_type="recurring_expense", record_id=rx["id"], lane=overhead_lane["id"])
    for sx in records["scheduled"]:
        due = date.fromisoformat(sx["due_date"])
        if due >= end:
            continue
        add(Event(id=f"exp-{stable(sx['id'].split(':')[-1])}", type=EventType.OTHER_EXPENSE, earliest_date=max(as_of, due),
                  due_date=due, amount_paise=sx["amount_paise"]),
            label=sx["label"], detail="One-off expense", amount_paise=sx["amount_paise"], direction="OUT",
            record_type="scheduled_expense", record_id=sx["id"], lane=overhead_lane["id"])

    facilities = [
        CreditFacility(
            id=stable(f["id"].split(":")[-1]), approved_limit_paise=f["approved_limit_paise"],
            available_from_date=max(as_of, date.fromisoformat(f["available_from"])),
            annual_interest_rate_bps=f["annual_rate_bps"], drawdown_fee_paise=f["drawdown_fee_paise"],
            contractual_repayment_date=date.fromisoformat(f["repayment_date"]),
            assumptions=[f"{f['label']}: approved limit, simple daily interest."],
        )
        for f in records["facilities"]
        if date.fromisoformat(f["repayment_date"]) > as_of
    ]

    snapshot = BusinessSnapshot(
        business_id=business["id"],
        start_date=as_of,
        horizon_days=horizon,
        opening_cash_paise=cash,
        opening_inventory=opening_inventory,
        orders=orders,
        events=events,
        approved_credit_facilities=facilities,
    )
    try:
        validate_snapshot(snapshot)
    except SimulationValidationError as exc:
        record = meta_events.get(str(exc.details.get("event_id", "")), {})
        raise SnapshotBuilderError(exc.code, {**exc.details, "record_type": record.get("record_type"), "record_id": record.get("record_id")}) from exc

    lanes = [lane for lane in lanes if any(m["lane"] == lane["id"] for m in meta_events.values())]
    fixed_lanes = [old_lane, payables_lane, overhead_lane]
    lanes = sorted(lanes, key=lambda lane: (lane["kind"] != "ORDER", lane["id"])) + [
        lane for lane in fixed_lanes if any(m["lane"] == lane["id"] for m in meta_events.values())
    ]
    meta = {
        "events": meta_events,
        "lanes": lanes,
        "parties": {pid: {"name": p["name"], "kind": p["kind"], "city": p["city"]} for pid, p in parties.items()},
        "materials": {mid: {"name": m["name"], "unit": m["unit"], "base_unit": m["base_unit"], "unit_factor": m["unit_factor"], "sku": m["sku"]}
                      for mid, m in materials.items()},
        "facilities": {stable(f["id"].split(":")[-1]): {"label": f["label"]} for f in records["facilities"]},
        "safety_buffer_paise": business["safety_buffer_paise"],
        "business_name": business["name"],
    }
    return BuiltSnapshot(snapshot=snapshot, meta=meta, snapshot_hash=snapshot_hash(snapshot), warnings=warnings)


def _monthly(day_of_month: int, start: date, end: date) -> list[date]:
    dates: list[date] = []
    year, month = start.year, start.month
    while True:
        last = calendar.monthrange(year, month)[1]
        occurrence = date(year, month, min(day_of_month, last))
        if occurrence >= end:
            break
        if occurrence >= start:
            dates.append(occurrence)
        month += 1
        if month > 12:
            year, month = year + 1, 1
    return dates


def _qty_label(qty: int, material: dict | None) -> str:
    if material is None:
        return str(qty)
    factor = material["unit_factor"] or 1
    value = qty / factor
    text = f"{value:,.1f}".rstrip("0").rstrip(".") if factor != 1 else f"{qty:,}"
    return f"{text} {material['unit']}"
