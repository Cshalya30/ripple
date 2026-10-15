"""Write paths for the owner's records. Each write bumps the business data version,
which invalidates the cached run (the recompute pipeline, PRD 13.3)."""
from __future__ import annotations

import json
import uuid
from datetime import date, timedelta
from typing import Any

from ..core.db import bump_data_version, insert, now_iso, query, query_one, today, tx, update
from ..snapshot.builder import cleared_paid_by_invoice, order_requirements


class RecordError(ValueError):
    def __init__(self, code: str, details: dict[str, Any] | None = None, status: int = 422):
        self.code = code
        self.details = details or {}
        self.status = status
        super().__init__(code)


def new_id(business_id: str, kind: str) -> str:
    return f"{business_id}:{kind}:{uuid.uuid4().hex[:10]}"


def owned(table: str, row_id: str, business_id: str) -> dict[str, Any]:
    row = query_one(f"SELECT * FROM {table} WHERE id = ? AND business_id = ?", (row_id, business_id))
    if row is None:
        raise RecordError("NOT_FOUND", {"id": row_id}, status=404)
    return row


def invoice_outstanding(invoice: dict[str, Any]) -> int:
    txns = query("SELECT invoice_id, amount_paise, status FROM txn WHERE invoice_id = ? AND business_id = ?", (invoice["id"], invoice["business_id"]))
    return invoice["amount_paise"] - cleared_paid_by_invoice(txns).get(invoice["id"], 0)


def _refresh_invoice(conn, invoice_id: str, business_id: str) -> None:
    invoice = query_one("SELECT * FROM invoice WHERE id = ? AND business_id = ?", (invoice_id, business_id))
    if invoice is None:
        return
    outstanding = invoice_outstanding(invoice)
    if outstanding <= 0:
        last = query_one("SELECT MAX(date) AS d FROM txn WHERE invoice_id = ? AND status = 'CLEARED'", (invoice_id,))
        update(conn, "invoice", invoice_id, business_id, {"status": "PAID", "paid_date": last["d"] if last else today().isoformat()})
        if invoice["order_id"]:
            update(conn, "sales_order", invoice["order_id"], business_id, {"stage": "PAID"})
    else:
        paid_any = outstanding < invoice["amount_paise"]
        update(conn, "invoice", invoice_id, business_id, {"status": "PART_PAID" if paid_any else "OPEN", "paid_date": None})


def record_payment(business_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    party = owned("party", data["party_id"], business_id)
    direction = data["direction"]
    if (party["kind"] == "CUSTOMER") != (direction == "IN"):
        raise RecordError("DIRECTION_MISMATCH", {"party_kind": party["kind"], "direction": direction})
    pay_date = date.fromisoformat(data["date"])
    if pay_date > today():
        raise RecordError("FUTURE_DATE", {"date": data["date"]})
    invoice = None
    if data.get("invoice_id"):
        invoice = owned("invoice", data["invoice_id"], business_id)
        if invoice["party_id"] != party["id"] or (invoice["kind"] == "RECEIVABLE") != (direction == "IN"):
            raise RecordError("INVOICE_MISMATCH", {"invoice_id": invoice["id"]})
        outstanding = invoice_outstanding(invoice)
        if data["amount_paise"] > outstanding:
            raise RecordError("AMOUNT_EXCEEDS_OUTSTANDING", {"outstanding_paise": outstanding})
    status = data.get("status") or ("PENDING" if data["medium"] == "CHEQUE" else "CLEARED")
    txn_id = new_id(business_id, "t")
    with tx() as conn:
        insert(conn, "txn", {
            "id": txn_id, "business_id": business_id, "party_id": party["id"], "direction": direction,
            "amount_paise": data["amount_paise"], "date": pay_date.isoformat(), "medium": data["medium"],
            "reference": data.get("reference") or None, "invoice_id": invoice["id"] if invoice else None,
            "details": data.get("details") or (invoice["number"] if invoice else None), "status": status,
        })
        if invoice:
            _refresh_invoice(conn, invoice["id"], business_id)
        bump_data_version(conn, business_id)
    return owned("txn", txn_id, business_id)


def set_txn_status(business_id: str, txn_id: str, status: str) -> dict[str, Any]:
    txn = owned("txn", txn_id, business_id)
    if txn["status"] != "PENDING":
        raise RecordError("NOT_PENDING", {"status": txn["status"]})
    with tx() as conn:
        update(conn, "txn", txn_id, business_id, {"status": status})
        if txn["invoice_id"]:
            _refresh_invoice(conn, txn["invoice_id"], business_id)
        bump_data_version(conn, business_id)
    return owned("txn", txn_id, business_id)


def _stock_of(business_id: str, item_id: str) -> int:
    from ..snapshot.builder import on_hand
    return on_hand(query("SELECT * FROM stock_movement WHERE business_id = ? AND item_id = ?", (business_id, item_id)), today()).get(item_id, 0)


def _invoice_payments(invoice_id: str) -> int:
    return query_one("SELECT COUNT(*) AS c FROM txn WHERE invoice_id = ?", (invoice_id,))["c"]


def _remove_one_movement(conn, business_id: str, item_id: str, reason: str, ref: str, note: str | None = None) -> dict[str, Any] | None:
    """Delete the newest stock movement that a forward step created; the books end up exactly as they were."""
    sql = "SELECT * FROM stock_movement WHERE business_id = ? AND item_id = ? AND reason = ? AND ref = ?"
    params: list[Any] = [business_id, item_id, reason, ref]
    if note is not None:
        sql += " AND note = ?"
        params.append(note)
    row = query_one(sql + " ORDER BY created_at DESC, id DESC LIMIT 1", params)
    if row:
        conn.execute("DELETE FROM stock_movement WHERE id = ?", (row["id"],))
    return row


def mark_po(business_id: str, user_id: str, po_id: str, status: str, role: str = "OWNER") -> dict[str, Any]:
    """PAID, ARRIVED and CANCELLED move a purchase order forward. UNDO steps it back exactly one step and
    takes out the records that step created (stock arrival, supplier bill, advance payment)."""
    po = owned("purchase_order", po_id, business_id)
    supplier = owned("party", po["supplier_id"], business_id)
    with tx() as conn:
        if status == "UNDO":
            new_status = _undo_po(conn, business_id, po, supplier, role)
            update(conn, "purchase_order", po_id, business_id, {"status": new_status})
            bump_data_version(conn, business_id)
            return owned("purchase_order", po_id, business_id)
        if status == "PAID":
            if po["status"] != "ORDERED" or po["terms_type"] == "CREDIT":
                raise RecordError("INVALID_TRANSITION", {"from": po["status"], "to": status})
            insert(conn, "txn", {"id": new_id(business_id, "t"), "business_id": business_id, "party_id": supplier["id"], "direction": "OUT",
                                 "amount_paise": po["amount_paise"], "date": today().isoformat(), "medium": "NEFT", "reference": None,
                                 "invoice_id": None, "details": f"{po['number']} advance", "status": "CLEARED"})
        elif status == "ARRIVED":
            if po["status"] not in ("ORDERED", "PAID"):
                raise RecordError("INVALID_TRANSITION", {"from": po["status"], "to": status})
            if po["material_id"]:
                insert(conn, "stock_movement", {"id": new_id(business_id, "mv"), "business_id": business_id, "item_type": "MATERIAL",
                                                "item_id": po["material_id"], "qty_delta": po["qty"], "reason": "PURCHASE_ARRIVAL",
                                                "ref": po["number"], "note": None, "user_id": user_id, "date": today().isoformat()})
            if po["terms_type"] == "CREDIT" or (po["status"] == "ORDERED" and po["terms_type"] == "ON_DELIVERY"):
                insert(conn, "invoice", {"id": new_id(business_id, "inv"), "business_id": business_id, "kind": "PAYABLE", "party_id": supplier["id"],
                                         "order_id": None, "number": f"{po['number']}-BILL", "description": f"Goods on {po['number']}",
                                         "amount_paise": po["amount_paise"], "invoice_date": today().isoformat(),
                                         "due_date": (today() + timedelta(days=supplier["terms_days"])).isoformat(), "status": "OPEN"})
        elif status == "CANCELLED":
            if po["status"] not in ("ORDERED",):
                raise RecordError("INVALID_TRANSITION", {"from": po["status"], "to": status})
        else:
            raise RecordError("INVALID_STATUS", {"status": status})
        update(conn, "purchase_order", po_id, business_id, {"status": status})
        bump_data_version(conn, business_id)
    return owned("purchase_order", po_id, business_id)


def _undo_po(conn, business_id: str, po: dict[str, Any], supplier: dict[str, Any], role: str) -> str:
    advance_note = f"{po['number']} advance"
    advance = query_one("SELECT id FROM txn WHERE business_id = ? AND party_id = ? AND details = ? AND direction = 'OUT' ORDER BY created_at DESC LIMIT 1",
                        (business_id, supplier["id"], advance_note))
    if po["status"] == "ARRIVED":
        bill = query_one("SELECT * FROM invoice WHERE business_id = ? AND party_id = ? AND kind = 'PAYABLE' AND number = ?",
                         (business_id, supplier["id"], f"{po['number']}-BILL"))
        if bill and role == "SUPERVISOR":
            raise RecordError("FORBIDDEN_FOR_ROLE", {}, status=403)
        if bill and _invoice_payments(bill["id"]):
            raise RecordError("INVOICE_HAS_PAYMENTS", {"invoice": bill["number"]})
        if po["material_id"]:
            on_hand_now = _stock_of(business_id, po["material_id"])
            if on_hand_now < po["qty"]:
                raise RecordError("NOT_ENOUGH_MATERIAL_TO_REVERSE", {"material_id": po["material_id"], "needed": po["qty"], "on_hand": on_hand_now})
            _remove_one_movement(conn, business_id, po["material_id"], "PURCHASE_ARRIVAL", po["number"])
        if bill:
            conn.execute("DELETE FROM invoice WHERE id = ?", (bill["id"],))
        return "PAID" if advance else "ORDERED"
    if po["status"] == "PAID":
        if role == "SUPERVISOR":
            raise RecordError("FORBIDDEN_FOR_ROLE", {}, status=403)
        if advance:
            conn.execute("DELETE FROM txn WHERE id = ?", (advance["id"],))
        return "ORDERED"
    if po["status"] == "CANCELLED":
        if role == "SUPERVISOR":
            raise RecordError("FORBIDDEN_FOR_ROLE", {}, status=403)  # reopening puts a commitment back in the forecast
        return "ORDERED"
    raise RecordError("INVALID_TRANSITION", {"from": po["status"], "to": "UNDO"})


STAGES = ["PLANNED", "MATERIALS_READY", "IN_PRODUCTION", "READY", "DELIVERED", "PAID"]
PRODUCTION_NOTE = "Production complete"


def _history(so: dict[str, Any], entry: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    try:
        log = json.loads(so.get("stage_history_json") or "[]")
    except ValueError:
        log = []
    return (log + [entry] if entry else log)[-60:]


def advance_stage(business_id: str, user_id: str, so_id: str, stage: str, role: str = "OWNER") -> dict[str, Any]:
    """Move a sales order to another stage, forward or back. Each forward step writes records (stock, cost,
    invoice); stepping back removes exactly those records so stock, cash and the forecast return to where they were."""
    so = owned("sales_order", so_id, business_id)
    if stage not in STAGES[:5] or stage == so["stage"]:
        raise RecordError("INVALID_TRANSITION", {"from": so["stage"], "to": stage})
    if STAGES.index(stage) < STAGES.index(so["stage"]):
        return _reverse_stage(business_id, user_id, so, stage, role)
    customer = owned("party", so["customer_id"], business_id)
    product = query_one("SELECT * FROM product WHERE id = ?", (so["product_id"],)) if so["product_id"] else None
    recipes: dict[str, list[dict]] = {}
    for line in query("SELECT * FROM recipe_line WHERE business_id = ?", (business_id,)):
        recipes.setdefault(line["product_id"], []).append(line)
    from ..snapshot.builder import on_hand
    stock = on_hand(query("SELECT * FROM stock_movement WHERE business_id = ?", (business_id,)), today())
    current = STAGES.index(so["stage"])
    target = STAGES.index(stage)
    with tx() as conn:
        changes: dict[str, Any] = {"stage": stage}
        entry: dict[str, Any] = {"at": now_iso(), "by": user_id, "from": so["stage"], "to": stage, "direction": "FORWARD"}
        if current < 2 <= target:
            for material_id, qty in order_requirements(so, recipes):
                if stock.get(material_id, 0) < qty:
                    raise RecordError("NOT_ENOUGH_MATERIAL", {"material_id": material_id, "needed": qty, "on_hand": stock.get(material_id, 0)})
                insert(conn, "stock_movement", {"id": new_id(business_id, "mv"), "business_id": business_id, "item_type": "MATERIAL",
                                                "item_id": material_id, "qty_delta": -qty, "reason": "PRODUCTION_USE", "ref": so["number"],
                                                "note": None, "user_id": user_id, "date": today().isoformat()})
            cost = so["production_cost_paise"] if so["production_cost_paise"] is not None else so["qty"] * (product["production_cost_paise"] if product else 0)
            if cost:
                insert(conn, "txn", {"id": new_id(business_id, "t"), "business_id": business_id, "party_id": None, "direction": "OUT",
                                     "amount_paise": cost, "date": today().isoformat(), "medium": "CASH", "reference": None, "invoice_id": None,
                                     "details": f"Production cost {so['number']}", "status": "CLEARED"})
            entry["prev_earliest_start_date"] = so["earliest_start_date"]
            changes["earliest_start_date"] = today().isoformat()
        if current < 3 <= target and so["product_id"]:
            insert(conn, "stock_movement", {"id": new_id(business_id, "mv"), "business_id": business_id, "item_type": "PRODUCT",
                                            "item_id": so["product_id"], "qty_delta": so["qty"], "reason": "ADJUSTMENT", "ref": so["number"],
                                            "note": PRODUCTION_NOTE, "user_id": user_id, "date": today().isoformat()})
        if target == 4:
            if so["product_id"]:
                insert(conn, "stock_movement", {"id": new_id(business_id, "mv"), "business_id": business_id, "item_type": "PRODUCT",
                                                "item_id": so["product_id"], "qty_delta": -so["qty"], "reason": "DISPATCH", "ref": so["number"],
                                                "note": None, "user_id": user_id, "date": today().isoformat()})
            value = so["qty"] * so["unit_price_paise"] - so["deposit_paise"]
            terms = so["collection_terms_days"] if so["collection_terms_days"] is not None else customer["terms_days"]
            if value > 0:
                insert(conn, "invoice", {"id": new_id(business_id, "inv"), "business_id": business_id, "kind": "RECEIVABLE", "party_id": customer["id"],
                                         "order_id": so["id"], "number": f"{so['number']}-INV", "description": f"{so['qty']} x {product['name'] if product else 'goods'}",
                                         "amount_paise": value, "invoice_date": today().isoformat(),
                                         "due_date": (today() + timedelta(days=terms)).isoformat(), "status": "OPEN"})
        changes["stage_history_json"] = _history(so, entry)
        update(conn, "sales_order", so_id, business_id, changes)
        bump_data_version(conn, business_id)
    return owned("sales_order", so_id, business_id)


def _reverse_stage(business_id: str, user_id: str, so: dict[str, Any], stage: str, role: str) -> dict[str, Any]:
    current, target = STAGES.index(so["stage"]), STAGES.index(stage)
    if so["stage"] == "PAID":
        invoice = query_one("SELECT number FROM invoice WHERE business_id = ? AND order_id = ? AND kind = 'RECEIVABLE'", (business_id, so["id"]))
        raise RecordError("ORDER_ALREADY_PAID", {"invoice": invoice["number"] if invoice else None})
    if current >= 4 > target and role == "SUPERVISOR":
        raise RecordError("FORBIDDEN_FOR_ROLE", {}, status=403)  # undoing a delivery removes an invoice
    with tx() as conn:
        entry: dict[str, Any] = {"at": now_iso(), "by": user_id, "from": so["stage"], "to": stage, "direction": "BACK"}
        changes: dict[str, Any] = {"stage": stage}
        if current >= 4 > target:
            invoice = query_one("SELECT * FROM invoice WHERE business_id = ? AND order_id = ? AND kind = 'RECEIVABLE'", (business_id, so["id"]))
            if invoice and _invoice_payments(invoice["id"]):
                raise RecordError("INVOICE_HAS_PAYMENTS", {"invoice": invoice["number"]})
            if so["product_id"]:
                _remove_one_movement(conn, business_id, so["product_id"], "DISPATCH", so["number"])
            if invoice:
                conn.execute("DELETE FROM invoice WHERE id = ?", (invoice["id"],))
        if current >= 3 > target and so["product_id"]:
            on_hand_now = _stock_of(business_id, so["product_id"])
            if on_hand_now < so["qty"]:
                raise RecordError("NOT_ENOUGH_FINISHED_STOCK", {"item_id": so["product_id"], "needed": so["qty"], "on_hand": on_hand_now})
            _remove_one_movement(conn, business_id, so["product_id"], "ADJUSTMENT", so["number"], PRODUCTION_NOTE)
        if current >= 2 > target:
            conn.execute("DELETE FROM stock_movement WHERE business_id = ? AND item_type = 'MATERIAL' AND reason = 'PRODUCTION_USE' AND ref = ?", (business_id, so["number"]))
            conn.execute("DELETE FROM txn WHERE business_id = ? AND party_id IS NULL AND direction = 'OUT' AND details = ?", (business_id, f"Production cost {so['number']}"))
            started = next((e for e in reversed(_history(so)) if e.get("direction") == "FORWARD" and "prev_earliest_start_date" in e), None)
            if started:
                changes["earliest_start_date"] = started["prev_earliest_start_date"]
        changes["stage_history_json"] = _history(so, entry)
        update(conn, "sales_order", so["id"], business_id, changes)
        bump_data_version(conn, business_id)
    return owned("sales_order", so["id"], business_id)


def create_party(business_id: str, data: dict[str, Any]) -> dict[str, Any]:
    party_id = new_id(business_id, "p")
    with tx() as conn:
        insert(conn, "party", {
            "id": party_id, "business_id": business_id, "kind": data["kind"], "name": data["name"].strip(), "city": data.get("city"),
            "description": data.get("description"), "phone": data.get("phone"), "gstin": data.get("gstin"),
            "udyam_number": data.get("udyam_number"), "msme_category": data.get("msme_category"),
            "terms_type": data.get("terms_type") or "CREDIT", "terms_days": data.get("terms_days", 30),
            "lead_time_days": data.get("lead_time_days", 0), "tags_json": data.get("tags") or [], "notes_json": [],
            "since": today().isoformat(),
        })
        bump_data_version(conn, business_id)
    return owned("party", party_id, business_id)


def update_party(business_id: str, party_id: str, data: dict[str, Any]) -> dict[str, Any]:
    owned("party", party_id, business_id)
    allowed = {"name", "city", "description", "phone", "gstin", "udyam_number", "msme_category", "terms_type", "terms_days", "lead_time_days"}
    changes = {k: v for k, v in data.items() if k in allowed and v is not None}
    if "tags" in data and data["tags"] is not None:
        changes["tags_json"] = data["tags"]
    with tx() as conn:
        update(conn, "party", party_id, business_id, changes)
        bump_data_version(conn, business_id)
    return owned("party", party_id, business_id)


def add_note(business_id: str, party_id: str, author: str, text: str) -> dict[str, Any]:
    party = owned("party", party_id, business_id)
    notes = json.loads(party["notes_json"] or "[]")
    notes.append({"text": text.strip(), "by": author, "date": today().isoformat()})
    with tx() as conn:
        update(conn, "party", party_id, business_id, {"notes_json": notes[-50:]})
    return owned("party", party_id, business_id)


def create_invoice(business_id: str, data: dict[str, Any]) -> dict[str, Any]:
    party = owned("party", data["party_id"], business_id)
    kind = "RECEIVABLE" if party["kind"] == "CUSTOMER" else "PAYABLE"
    invoice_id = new_id(business_id, "inv")
    invoice_date = date.fromisoformat(data["invoice_date"])
    due = date.fromisoformat(data.get("due_date") or (invoice_date + timedelta(days=party["terms_days"])).isoformat())
    if due < invoice_date:
        raise RecordError("DUE_BEFORE_INVOICE", {})
    with tx() as conn:
        insert(conn, "invoice", {"id": invoice_id, "business_id": business_id, "kind": kind, "party_id": party["id"], "order_id": None,
                                 "number": data["number"].strip(), "description": data.get("description"), "amount_paise": data["amount_paise"],
                                 "invoice_date": invoice_date.isoformat(), "due_date": due.isoformat(),
                                 "promised_date": data.get("promised_date"), "status": "OPEN"})
        bump_data_version(conn, business_id)
    return owned("invoice", invoice_id, business_id)


def set_promised_date(business_id: str, invoice_id: str, promised: str | None) -> dict[str, Any]:
    owned("invoice", invoice_id, business_id)
    with tx() as conn:
        update(conn, "invoice", invoice_id, business_id, {"promised_date": promised})
        bump_data_version(conn, business_id)
    return owned("invoice", invoice_id, business_id)


def create_sales_order(business_id: str, data: dict[str, Any]) -> dict[str, Any]:
    owned("party", data["customer_id"], business_id)
    product = owned("product", data["product_id"], business_id)
    count = query_one("SELECT COUNT(*) AS c FROM sales_order WHERE business_id = ?", (business_id,))["c"]
    so_id = new_id(business_id, "so")
    number = data.get("number") or f"SO-{200 + count:04d}"
    with tx() as conn:
        insert(conn, "sales_order", {
            "id": so_id, "business_id": business_id, "number": number, "customer_id": data["customer_id"], "product_id": product["id"],
            "qty": data["qty"], "unit_price_paise": data.get("unit_price_paise") or product["unit_price_paise"],
            "order_date": today().isoformat(), "earliest_start_date": data.get("earliest_start_date") or today().isoformat(),
            "promised_date": data["promised_date"], "priority": data.get("priority", 5), "stage": "PLANNED",
            "deposit_paise": data.get("deposit_paise", 0), "collection_terms_days": data.get("collection_terms_days"),
        })
        bump_data_version(conn, business_id)
    return owned("sales_order", so_id, business_id)


def create_purchase_order(business_id: str, data: dict[str, Any]) -> dict[str, Any]:
    supplier = owned("party", data["supplier_id"], business_id)
    if supplier["kind"] != "SUPPLIER":
        raise RecordError("NOT_A_SUPPLIER", {})
    material = owned("material", data["material_id"], business_id)
    count = query_one("SELECT COUNT(*) AS c FROM purchase_order WHERE business_id = ?", (business_id,))["c"]
    po_id = new_id(business_id, "po")
    terms = supplier["terms_type"]
    arrival = data.get("expected_arrival") or (today() + timedelta(days=supplier["lead_time_days"])).isoformat()
    amount = data.get("amount_paise") or data["qty"] * material["avg_cost_paise"] // (material["unit_factor"] or 1)
    with tx() as conn:
        insert(conn, "purchase_order", {
            "id": po_id, "business_id": business_id, "number": data.get("number") or f"PO-{200 + count:04d}", "supplier_id": supplier["id"],
            "material_id": material["id"], "qty": data["qty"], "amount_paise": amount, "ordered_date": today().isoformat(),
            "expected_arrival": arrival if terms == "CREDIT" else None,
            "payment_due": (data.get("payment_due") or today().isoformat()) if terms != "CREDIT" else None,
            "terms_type": terms, "release_after_invoice_id": None, "status": "ORDERED",
        })
        bump_data_version(conn, business_id)
    return owned("purchase_order", po_id, business_id)


def stock_adjustment(business_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    table = "material" if data["item_type"] == "MATERIAL" else "product"
    owned(table, data["item_id"], business_id)
    if not (data.get("note") or "").strip():
        raise RecordError("NOTE_REQUIRED", {})
    mv_id = new_id(business_id, "mv")
    with tx() as conn:
        insert(conn, "stock_movement", {"id": mv_id, "business_id": business_id, "item_type": data["item_type"], "item_id": data["item_id"],
                                        "qty_delta": data["qty_delta"], "reason": "ADJUSTMENT", "ref": data.get("ref"),
                                        "note": data["note"].strip(), "user_id": user_id, "date": today().isoformat()})
        bump_data_version(conn, business_id)
    return owned("stock_movement", mv_id, business_id)


def put_recipe(business_id: str, product_id: str, lines: list[dict[str, Any]], production_cost_paise: int | None, production_days: int | None) -> None:
    owned("product", product_id, business_id)
    if len({line["material_id"] for line in lines}) != len(lines):
        raise RecordError("DUPLICATE_MATERIAL", {})
    for line in lines:
        owned("material", line["material_id"], business_id)
    with tx() as conn:
        conn.execute("DELETE FROM recipe_line WHERE product_id = ? AND business_id = ?", (product_id, business_id))
        for index, line in enumerate(lines):
            insert(conn, "recipe_line", {"id": f"{product_id}:r{index}:{uuid.uuid4().hex[:4]}", "business_id": business_id, "product_id": product_id,
                                         "material_id": line["material_id"], "qty_per_piece": line["qty_per_piece"], "wastage_bp": line["wastage_bp"]})
        changes = {}
        if production_cost_paise is not None:
            changes["production_cost_paise"] = production_cost_paise
        if production_days is not None:
            changes["production_days"] = production_days
        if changes:
            update(conn, "product", product_id, business_id, changes)
        bump_data_version(conn, business_id)


# ---------------------------------------------------------------- raw materials

# key -> (display unit, base unit, base units per display unit). Quantities are stored in the base unit.
MATERIAL_UNITS: dict[str, tuple[str, str, int]] = {
    "kg": ("kg", "g", 1000), "g": ("g", "g", 1), "L": ("L", "ml", 1000), "ml": ("ml", "ml", 1),
    "m": ("m", "cm", 100), "pc": ("pc", "pc", 1), "box": ("box", "box", 1),
}
OPENING_NOTE = "Opening stock"


def _sku_for(business_id: str, name: str) -> str:
    letters = "".join(ch for ch in name.upper() if ch.isalnum())
    stem = f"RM-{letters[:3] or 'MAT'}"
    taken = {r["sku"] for r in query("SELECT sku FROM material WHERE business_id = ?", (business_id,))}
    sku, n = stem, 1
    while sku in taken:
        n += 1
        sku = f"{stem}-{n}"
    return sku


def _tag_supplier(conn, business_id: str, supplier_id: str, name: str) -> None:
    """The supplier's 'Supplies' list in Khata names what they supply."""
    supplier = query_one("SELECT tags_json FROM party WHERE id = ? AND business_id = ?", (supplier_id, business_id))
    tags = json.loads((supplier or {}).get("tags_json") or "[]")
    if name.lower() not in {t.lower() for t in tags} and len(tags) < 8:
        update(conn, "party", supplier_id, business_id, {"tags_json": tags + [name]})


def _check_material_fields(business_id: str, name: str, sku: str, supplier_id: str | None, own_id: str | None = None) -> None:
    if query_one("SELECT id FROM material WHERE business_id = ? AND lower(name) = lower(?) AND id != ?", (business_id, name, own_id or "")):
        raise RecordError("MATERIAL_EXISTS", {"field": "name", "name": name})
    if query_one("SELECT id FROM material WHERE business_id = ? AND upper(sku) = upper(?) AND id != ?", (business_id, sku, own_id or "")):
        raise RecordError("SKU_EXISTS", {"field": "sku", "sku": sku})
    if supplier_id:
        supplier = owned("party", supplier_id, business_id)
        if supplier["kind"] != "SUPPLIER":
            raise RecordError("NOT_A_SUPPLIER", {})


def create_material(business_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """A new raw material, with optional opening stock and a main supplier. Everything that reads stock
    (inventory, reorder alerts, purchase orders, recipes, the engine) picks it up from the same rows."""
    name = " ".join(data["name"].split())
    sku = (data.get("sku") or "").strip().upper() or _sku_for(business_id, name)
    unit, base, factor = MATERIAL_UNITS[data["unit"]]
    supplier_id = data.get("supplier_id") or None
    _check_material_fields(business_id, name, sku, supplier_id)
    scaled = (data.get("opening_qty") or 0) * factor
    if scaled != int(scaled):
        raise RecordError("QUANTITY_TOO_PRECISE", {"field": "opening_qty", "unit": unit})
    opening = int(scaled)
    material_id = new_id(business_id, "m")
    with tx() as conn:
        insert(conn, "material", {
            "id": material_id, "business_id": business_id, "sku": sku, "name": name, "unit": unit, "base_unit": base, "unit_factor": factor,
            "reorder_safety_days": data.get("reorder_safety_days", 7), "primary_supplier_id": supplier_id, "avg_cost_paise": data.get("cost_paise", 0),
        })
        if opening > 0:
            insert(conn, "stock_movement", {"id": new_id(business_id, "mv"), "business_id": business_id, "item_type": "MATERIAL", "item_id": material_id,
                                            "qty_delta": opening, "reason": "ADJUSTMENT", "ref": sku, "note": OPENING_NOTE, "user_id": user_id,
                                            "date": today().isoformat()})
        if supplier_id:
            _tag_supplier(conn, business_id, supplier_id, name)
        bump_data_version(conn, business_id)
    return owned("material", material_id, business_id)


def update_material(business_id: str, material_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Rename, re-price, change the main supplier or the safety days. The unit is fixed once created
    because every quantity on record is stored in it."""
    material = owned("material", material_id, business_id)
    name = " ".join(data["name"].split()) if data.get("name") else material["name"]
    sku = (data.get("sku") or "").strip().upper() if data.get("sku") else material["sku"]
    supplier_id = data["supplier_id"] if "supplier_id" in data else material["primary_supplier_id"]
    _check_material_fields(business_id, name, sku, supplier_id or None, material_id)
    changes: dict[str, Any] = {"name": name, "sku": sku, "primary_supplier_id": supplier_id or None}
    if data.get("cost_paise") is not None:
        changes["avg_cost_paise"] = data["cost_paise"]
    if data.get("reorder_safety_days") is not None:
        changes["reorder_safety_days"] = data["reorder_safety_days"]
    with tx() as conn:
        update(conn, "material", material_id, business_id, changes)
        if supplier_id:
            _tag_supplier(conn, business_id, supplier_id, name)
        bump_data_version(conn, business_id)
    return owned("material", material_id, business_id)


def delete_material(business_id: str, material_id: str) -> None:
    """Only a material nothing depends on can go. Its opening-stock entry goes with it; any other movement keeps it."""
    owned("material", material_id, business_id)
    uses = {
        "recipes": query_one("SELECT COUNT(*) AS c FROM recipe_line WHERE business_id = ? AND material_id = ?", (business_id, material_id))["c"],
        "purchase_orders": query_one("SELECT COUNT(*) AS c FROM purchase_order WHERE business_id = ? AND material_id = ?", (business_id, material_id))["c"],
        "stock_movements": query_one("SELECT COUNT(*) AS c FROM stock_movement WHERE business_id = ? AND item_id = ? AND NOT (reason = 'ADJUSTMENT' AND note = ?)",
                                     (business_id, material_id, OPENING_NOTE))["c"],
        "orders": query_one("SELECT COUNT(*) AS c FROM sales_order WHERE business_id = ? AND materials_json LIKE ?", (business_id, f'%"{material_id}"%'))["c"],
    }
    if any(uses.values()):
        raise RecordError("MATERIAL_IN_USE", {k: v for k, v in uses.items() if v})
    with tx() as conn:
        conn.execute("DELETE FROM stock_movement WHERE business_id = ? AND item_id = ?", (business_id, material_id))
        conn.execute("DELETE FROM material WHERE id = ? AND business_id = ?", (material_id, business_id))
        bump_data_version(conn, business_id)
