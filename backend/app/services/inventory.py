"""Inventory measures (PRD 8.8). Standard deterministic formulas, not AI:
needed-for-orders (recipe x qty incl. wastage, identical to what the snapshot builder sends),
days of cover, reorder point, ABC class. "Short" names the order the engine actually blocks."""
from __future__ import annotations

import json
import math
from datetime import date, timedelta
from typing import Any

from ..core.db import query, today
from ..snapshot.builder import OPEN_ORDER_STAGES, on_hand, order_requirements
from .views import cached_views


def _fmt(qty: float, material: dict[str, Any]) -> str:
    factor = material["unit_factor"] or 1
    if factor == 1:
        return f"{int(qty):,} {material['unit']}"
    value = qty / factor
    text = f"{value:,.1f}"
    return f"{text[:-2] if text.endswith('.0') else text} {material['unit']}"


def inventory_rows(business_id: str, run=None) -> dict[str, Any]:
    as_of = today()
    materials = query("SELECT * FROM material WHERE business_id = ? ORDER BY sku", (business_id,))
    products = query("SELECT * FROM product WHERE business_id = ? ORDER BY sku", (business_id,))
    recipes: dict[str, list[dict]] = {}
    for line in query("SELECT * FROM recipe_line WHERE business_id = ?", (business_id,)):
        recipes.setdefault(line["product_id"], []).append(line)
    movements = query("SELECT * FROM stock_movement WHERE business_id = ? ORDER BY date", (business_id,))
    stock = on_hand(movements, as_of)
    orders = query("SELECT * FROM sales_order WHERE business_id = ? ORDER BY number", (business_id,))
    open_orders = [o for o in orders if o["stage"] in OPEN_ORDER_STAGES]
    pos = query("SELECT * FROM purchase_order WHERE business_id = ? AND status IN ('ORDERED','PAID')", (business_id,))
    suppliers = {p["id"]: p for p in query("SELECT * FROM party WHERE business_id = ? AND kind = 'SUPPLIER'", (business_id,))}
    horizon = run.built.snapshot.horizon_days if run else 90

    needed: dict[str, int] = {}
    needed_by_order: dict[str, list[tuple[str, int]]] = {}
    for order in open_orders:
        if order["stage"] in ("IN_PRODUCTION", "READY"):
            continue
        for material_id, qty in order_requirements(order, recipes):
            needed[material_id] = needed.get(material_id, 0) + qty
            needed_by_order.setdefault(material_id, []).append((order["number"], qty))

    blocked_orders: dict[str, list[dict[str, Any]]] = {}
    if run is not None:
        for event in cached_views(run):
            if event["type"] != "PRODUCTION_START":
                continue
            for wait in event["waits"]:
                if wait["code"] == "INSUFFICIENT_INVENTORY":
                    mid = wait["first_details"]["material_id"]
                    blocked_orders.setdefault(mid, []).append({"order_id": event["order_id"], "event_id": event["id"],
                                                               "from_day": wait["from_day"], "to_day": wait["to_day"],
                                                               "shortfall_quantity": wait["first_details"]["shortfall_quantity"]})

    since = (as_of - timedelta(days=30)).isoformat()
    rows = []
    for m in materials:
        used_30 = -sum(mv["qty_delta"] for mv in movements if mv["item_id"] == m["id"] and mv["reason"] == "PRODUCTION_USE" and mv["date"] > since and mv["date"] <= as_of.isoformat())
        if used_30 > 0:
            avg_use, basis = used_30 / 30, "LAST_30_DAYS"
        else:
            avg_use, basis = needed.get(m["id"], 0) / horizon, "PLANNED"
        have = stock.get(m["id"], 0)
        need = needed.get(m["id"], 0)
        free = have - need
        incoming = [po for po in pos if po["material_id"] == m["id"]]
        on_way = sum(po["qty"] for po in incoming)
        supplier = suppliers.get(m["primary_supplier_id"])
        lead = supplier["lead_time_days"] if supplier else 7
        rop = math.ceil(avg_use * lead + avg_use * m["reorder_safety_days"])
        cover = None if avg_use <= 0 else round((free + on_way) / avg_use, 1)
        last_move = max((mv["date"] for mv in movements if mv["item_id"] == m["id"] and mv["qty_delta"] < 0), default=None)
        if free < 0 or blocked_orders.get(m["id"]):
            status = "SHORT"
        elif free + on_way <= rop:
            status = "REORDER"
        elif last_move is None or last_move < (as_of - timedelta(days=60)).isoformat():
            status = "SLOW"
        else:
            status = "OK"
        value = have * m["avg_cost_paise"] // (m["unit_factor"] or 1)
        short_orders = [b["order_id"] for b in blocked_orders.get(m["id"], [])]
        if free < 0 and not short_orders:
            running = have
            for number, qty in needed_by_order.get(m["id"], []):
                running -= qty
                if running < 0:
                    short_orders.append(number)
        rows.append({
            "id": m["id"], "sku": m["sku"], "name": m["name"], "unit": m["unit"], "unit_factor": m["unit_factor"],
            "on_hand": have, "needed": need, "free": free, "on_the_way": on_way,
            "on_hand_label": _fmt(have, m), "needed_label": _fmt(need, m), "free_label": _fmt(free, m) if free >= 0 else "−" + _fmt(-free, m),
            "on_the_way_label": _fmt(on_way, m),
            "next_arrival": min((po["expected_arrival"] for po in incoming if po["expected_arrival"]), default=None),
            "incoming": [{"po_number": po["number"], "qty_label": _fmt(po["qty"], m), "expected_arrival": po["expected_arrival"],
                          "held": bool(po["release_after_invoice_id"])} for po in incoming],
            "avg_daily_use_label": _fmt(avg_use, m), "avg_use_basis": basis, "days_of_cover": cover,
            "reorder_point_label": _fmt(rop, m), "safety_days": m["reorder_safety_days"], "lead_time_days": lead,
            "status": status, "stock_value_paise": value, "avg_cost_paise": m["avg_cost_paise"],
            "main_supplier": supplier and {"id": supplier["id"], "name": supplier["name"]},
            "short_orders": sorted(set(short_orders)), "blocked": blocked_orders.get(m["id"], []),
            "needed_by_order": [{"order": n, "qty_label": _fmt(q, m)} for n, q in needed_by_order.get(m["id"], [])],
        })

    # ABC: A = items making up the top 80% of stock value, B the next 15%, C the rest.
    total_value = sum(r["stock_value_paise"] for r in rows) or 1
    running = 0
    for row in sorted(rows, key=lambda r: -r["stock_value_paise"]):
        share_before = running / total_value
        running += row["stock_value_paise"]
        row["abc"] = "A" if share_before < 0.80 else ("B" if share_before < 0.95 else "C")

    forecast = {}
    if run is not None:
        for order in run.result.order_results:
            forecast[order.order_id] = order.delivery_date.isoformat() if order.delivery_date else None
    finished = []
    for p in products:
        qty_stage = lambda stages: sum(o["qty"] for o in open_orders if o["product_id"] == p["id"] and o["stage"] in stages)  # noqa: E731
        have = stock.get(p["id"], 0)
        next_delivery = min((forecast.get(o["number"]) for o in open_orders if o["product_id"] == p["id"] and forecast.get(o["number"])), default=None)
        finished.append({
            "id": p["id"], "sku": p["sku"], "name": p["name"], "variant": json.loads(p["variant_json"] or "{}"),
            "on_hand": have, "committed": qty_stage({"READY"}), "in_production": qty_stage({"IN_PRODUCTION"}),
            "planned": qty_stage({"PLANNED", "MATERIALS_READY"}), "free": have - qty_stage({"READY"}),
            "next_delivery": next_delivery, "value_paise": have * p["production_cost_paise"],
            "unit_price_paise": p["unit_price_paise"],
        })

    recipe_view = []
    mats = {m["id"]: m for m in materials}
    for p in products:
        lines = []
        for line in recipes.get(p["id"], []):
            m = mats[line["material_id"]]
            with_waste = line["qty_per_piece"] * (10_000 + line["wastage_bp"]) / 10_000
            lines.append({"id": line["id"], "material_id": m["id"], "material": m["name"], "qty_per_piece": line["qty_per_piece"],
                          "per_piece_label": _fmt(line["qty_per_piece"], m), "wastage_bp": line["wastage_bp"],
                          "with_wastage_label": _fmt(with_waste, m), "base_unit": m["base_unit"], "unit": m["unit"], "unit_factor": m["unit_factor"]})
        recipe_view.append({"product_id": p["id"], "sku": p["sku"], "name": p["name"], "lines": lines,
                            "production_cost_paise": p["production_cost_paise"], "production_days": p["production_days"],
                            "used_in_open_orders": sum(1 for o in open_orders if o["product_id"] == p["id"])})

    summary = {
        "stock_value_paise": sum(r["stock_value_paise"] for r in rows),
        "short_count": sum(1 for r in rows if r["status"] == "SHORT"),
        "reorder_count": sum(1 for r in rows if r["status"] == "REORDER"),
        "slow_value_paise": sum(r["stock_value_paise"] for r in rows if r["status"] == "SLOW"),
    }
    return {"summary": summary, "materials": rows, "finished": finished, "recipes": recipe_view}


def movement_rows(business_id: str, limit: int = 300) -> list[dict[str, Any]]:
    items = {m["id"]: (m["name"], m) for m in query("SELECT * FROM material WHERE business_id = ?", (business_id,))}
    items.update({p["id"]: (p["name"], {"unit": "pc", "unit_factor": 1}) for p in query("SELECT * FROM product WHERE business_id = ?", (business_id,))})
    users = {u["id"]: u["name"] for u in query("SELECT id, name FROM user WHERE business_id = ?", (business_id,))}
    out = []
    for mv in query("SELECT * FROM stock_movement WHERE business_id = ? ORDER BY date DESC, id DESC LIMIT ?", (business_id, limit)):
        name, info = items.get(mv["item_id"], (mv["item_id"], {"unit": "", "unit_factor": 1}))
        sign = "+" if mv["qty_delta"] > 0 else "−"
        out.append({"id": mv["id"], "date": mv["date"], "item": name, "item_id": mv["item_id"], "item_type": mv["item_type"],
                    "qty_label": sign + _fmt(abs(mv["qty_delta"]), info), "qty_delta": mv["qty_delta"], "reason": mv["reason"],
                    "ref": mv["ref"], "note": mv["note"], "by": users.get(mv["user_id"]) or ("Seed data" if mv["user_id"] is None else "")})
    return out


def as_date(value: str) -> date:
    return date.fromisoformat(value)
