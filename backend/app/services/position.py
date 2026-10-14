"""Record-level aggregates: position strip, exposure, and payment-delay statistics.

These are sums over the owner's records (what is owed today), not forecasts.
Forecast numbers come from the engine via services.runs.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any

from ..core.db import query, query_one, today
from ..snapshot.builder import cleared_paid_by_invoice, opening_cash

SHRINKAGE_K = 5
MIN_POOL = 20


def open_invoices(business_id: str, kind: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM invoice WHERE business_id = ? AND status != 'PAID'"
    params: list[Any] = [business_id]
    if kind:
        sql += " AND kind = ?"
        params.append(kind)
    invoices = query(sql + " ORDER BY due_date, number", params)
    paid = cleared_paid_by_invoice(query("SELECT invoice_id, amount_paise, status FROM txn WHERE business_id = ? AND invoice_id IS NOT NULL", (business_id,)))
    for inv in invoices:
        inv["paid_paise"] = paid.get(inv["id"], 0)
        inv["outstanding_paise"] = max(0, inv["amount_paise"] - inv["paid_paise"])
        inv["days_overdue"] = max(0, (today() - date.fromisoformat(inv["due_date"])).days)
    return [inv for inv in invoices if inv["outstanding_paise"] > 0]


def position(business_id: str) -> dict[str, Any]:
    business = query_one("SELECT * FROM business WHERE id = ?", (business_id,))
    txns = query("SELECT * FROM txn WHERE business_id = ?", (business_id,))
    cash = max(0, opening_cash(business, txns, today()))
    receivables = open_invoices(business_id, "RECEIVABLE")
    payables = open_invoices(business_id, "PAYABLE")
    to_receive = sum(inv["outstanding_paise"] for inv in receivables)
    to_pay = sum(inv["outstanding_paise"] for inv in payables)
    pos = query("SELECT * FROM purchase_order WHERE business_id = ? AND status IN ('ORDERED', 'PAID')", (business_id,))
    sos = query("SELECT * FROM sales_order WHERE business_id = ? AND stage IN ('PLANNED','MATERIALS_READY','IN_PRODUCTION','READY')", (business_id,))
    pending_cheques = query("SELECT * FROM txn WHERE business_id = ? AND status = 'PENDING'", (business_id,))
    return {
        "cash_now_paise": cash,
        "to_receive_paise": to_receive,
        "to_pay_paise": to_pay,
        "net_paise": cash + to_receive - to_pay,
        "customers_owing": len({inv["party_id"] for inv in receivables}),
        "suppliers_owed": len({inv["party_id"] for inv in payables}),
        "materials_on_the_way": {"count": len(pos), "value_paise": sum(po["amount_paise"] for po in pos)},
        "goods_to_deliver": {"count": len(sos), "value_paise": sum(so["qty"] * so["unit_price_paise"] - so["deposit_paise"] for so in sos)},
        "pending_cheques": {"count": len(pending_cheques), "value_paise": sum(t["amount_paise"] for t in pending_cheques)},
    }


def exposures(business_id: str) -> dict[str, dict[str, Any]]:
    """Share of total payables (suppliers) or receivables (customers) held by each party."""
    result: dict[str, dict[str, Any]] = {}
    for kind in ("RECEIVABLE", "PAYABLE"):
        invoices = open_invoices(business_id, kind)
        total = sum(inv["outstanding_paise"] for inv in invoices) or 1
        for inv in invoices:
            entry = result.setdefault(inv["party_id"], {"outstanding_paise": 0, "oldest_due": None, "open_items": 0, "max_days_overdue": 0})
            entry["outstanding_paise"] += inv["outstanding_paise"]
            entry["open_items"] += 1
            entry["max_days_overdue"] = max(entry["max_days_overdue"], inv["days_overdue"])
            if entry["oldest_due"] is None or inv["due_date"] < entry["oldest_due"]:
                entry["oldest_due"] = inv["due_date"]
        for party_id, entry in result.items():
            if any(inv["party_id"] == party_id for inv in invoices):
                entry["exposure_bp"] = round(entry["outstanding_paise"] * 10_000 / total)
    return result


# ---------------------------------------------------------------- payment delays

def delay_history(business_id: str) -> dict[str, list[int]]:
    """Days late per paid customer invoice (paid date minus due date; negative = early)."""
    rows = query(
        "SELECT party_id, due_date, paid_date FROM invoice WHERE business_id = ? AND kind = 'RECEIVABLE' AND status = 'PAID' AND paid_date IS NOT NULL ORDER BY due_date",
        (business_id,),
    )
    history: dict[str, list[int]] = {}
    for row in rows:
        history.setdefault(row["party_id"], []).append((date.fromisoformat(row["paid_date"]) - date.fromisoformat(row["due_date"])).days)
    return history


def weighted_quantile(values: list[tuple[int, float]], q: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    total = sum(weight for _, weight in ordered)
    running = 0.0
    for value, weight in ordered:
        running += weight
        if running >= q * total - 1e-9:
            return value
    return ordered[-1][0]


def delay_model(business_id: str) -> dict[str, Any]:
    """Empirical-Bayes shrinkage: own history with weight n/(n+k), pooled history otherwise (PRD 11.2)."""
    history = delay_history(business_id)
    pool = [delay for delays in history.values() for delay in delays]
    customers = query("SELECT id, name FROM party WHERE business_id = ? AND kind = 'CUSTOMER' ORDER BY name", (business_id,))
    per_customer: dict[str, dict[str, Any]] = {}
    for customer in customers:
        own = history.get(customer["id"], [])
        n = len(own)
        w = n / (n + SHRINKAGE_K)
        mixture = [(d, w / n) for d in own] if n else []
        mixture += [(d, (1 - w) / len(pool)) for d in pool] if pool else []
        per_customer[customer["id"]] = {
            "name": customer["name"],
            "n": n,
            "own_weight": round(w, 4),
            "no_history": n == 0,
            "on_time_share": round(sum(1 for d in own if d <= 0) / n, 4) if n else None,
            "avg_delay_days": round(sum(own) / n, 1) if n else None,
            "p50_days": weighted_quantile(mixture, 0.5),
            "p90_days": weighted_quantile(mixture, 0.9),
            "last6": [d for d in own[-6:]],
        }
    return {
        "k": SHRINKAGE_K,
        "pool": pool,
        "pool_size": len(pool),
        "customers_with_history": sum(1 for d in history.values() if d),
        "history": history,
        "customers": per_customer,
        "sufficient": len(pool) >= MIN_POOL,
    }


def ceil_div(a: int, b: int) -> int:
    return -(-a // b) if b else 0


def round_up(value: int, step: int) -> int:
    return int(math.ceil(value / step) * step)
