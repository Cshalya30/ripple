"""The Risk and Finance engine ("Guard").

Two halves that check each other. Nothing here is a black box: every figure is a sum, a minimum or a count over the
owner's records, the deterministic engine run, or the risk engine's simulated futures.

RISK looks forward:
  predictive   the simulated futures: chance of a shortfall, the likely day, which customers drive it
  algorithmic  for each payment coming due, the exact cash headroom the engine leaves; how much is safe to spend
  dynamic      "if I make this payment": the same engine re-run with the payment added, moved or split
FINANCE looks at the books and at the cash:
  flags        rule-based checks for suspicious entries; the owner marks each Fine or Real, and that is counted
  verification reconciliation checks run on every load (records agree with each other and with the engine)
  opportunities  where spare cash could earn or save money, offered only inside the safe amount Risk computed

Guard never changes a record. It proposes; the owner decides.
"""
from __future__ import annotations

import json
import statistics
import uuid
from datetime import date, timedelta
from typing import Any

from ..core.db import get_conn, insert, query, today
from ..records.repo import STAGES
from ..snapshot.builder import cleared_paid_by_invoice, on_hand, opening_cash
from . import fixes as fixes_service
from .fixes import _human, _rupees
from .inventory import inventory_rows
from .position import delay_history, exposures, open_invoices, position
from .runs import Run, business_row
from .views import cached_views

NEAR_DAYS = 30                     # a payment decision is judged on the next 30 days; any later shortfall is reported separately
LADDER = (7, 14, 30, 45, 60)       # days a sum of cash must stay free for
THOUSAND = 100_000                 # paise in ₹1,000
DEFAULT_YIELD_BP = 650             # assumed yearly return on parked cash: an assumption the owner can change
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
RULES = {
    "DUPLICATE": "Possible duplicate payment",
    "OVERPAID": "Paid more than the bill",
    "UNMATCHED": "Payment not linked to its bill",
    "OUTLIER": "Unusual amount for this party",
    "CASH": "Cash rule",
    "BOUNCED": "Bounced cheque",
    "STALE": "Cheque pending too long",
}


def rs(paise: int) -> str:
    """Rupees with Indian grouping; a loss gets a proper minus sign instead of a stray hyphen."""
    value = int(paise)
    return ("−" if value < 0 else "") + _rupees(abs(value))


def _floor_k(paise: int) -> int:
    return max(0, int(paise)) // THOUSAND * THOUSAND


def _within(day: str, days: int) -> bool:
    return (today() - date.fromisoformat(day)).days <= days


# ---------------------------------------------------------------- risk: safe amounts

def _fan_for(run: Run, risk: dict[str, Any]) -> list[dict[str, Any]] | None:
    if risk.get("status") == "READY" and risk.get("snapshot_hash") == run.built.snapshot_hash:
        return risk.get("fan") or None
    return None


def safe_ladder(run: Run, risk: dict[str, Any]) -> list[dict[str, Any]]:
    """How much cash can leave today and the net position still stay above the buffer on every day up to D.
    'plan' uses the engine's forecast; 'cautious' uses the 1-in-10 worse future from the risk engine."""
    series = run.derived["series"]
    buffer = run.derived["summary"]["buffer_paise"]
    fan = _fan_for(run, risk)
    rows = []
    for days in LADDER:
        last = min(days, len(series) - 1)
        if last < 1:
            continue
        low = min(series[d]["net_paise"] for d in range(last + 1))
        low_day = min(range(last + 1), key=lambda d: (series[d]["net_paise"], d))
        plan = low - buffer
        cautious = None
        if fan and len(fan) > last:
            cautious = min((fan[d]["p10_paise"] if fan[d]["p10_paise"] is not None else series[d]["net_paise"]) for d in range(last + 1)) - buffer
            cautious = min(cautious, plan)
        rows.append({"days": days, "plan_paise": _floor_k(plan), "cautious_paise": _floor_k(cautious) if cautious is not None else None,
                     "binding_day": low_day, "binding_date": series[low_day]["date"]})
    return rows


def upcoming_payments(run: Run, limit: int = 8) -> list[dict[str, Any]]:
    """Algorithmic check of each payment coming due: does the engine pay it on the day, and what is left after.
    A bill with a due date is judged against it; a purchase paid 'N days after arrival' is judged on the day the engine gets to it."""
    series = run.derived["series"]
    buffer = run.derived["summary"]["buffer_paise"]
    start = run.built.snapshot.start_date
    events = {e.id: e for e in run.built.snapshot.events}
    rows = []
    for view in cached_views(run):
        event = events.get(view["id"])
        if view["type"] != "SUPPLIER_PAYMENT" or event is None or event.amount_paise is None:
            continue
        fixed = event.due_date
        due_day = (fixed - start).days if fixed else (view["executed_day"] if view["executed_day"] is not None else view["waited_from_day"])
        if due_day is None or due_day > 45 or due_day >= len(series):
            continue
        due_day = max(0, due_day)
        executed_day = view["executed_day"]
        headroom = series[due_day]["net_paise"] - buffer
        if view["state"] == "BLOCKED" or (executed_day is None and view["state"] != "LATER"):
            verdict, detail = "BLOCKED", "Not enough cash: the engine cannot pay it inside the forecast."
        elif executed_day is None:
            continue
        elif fixed and executed_day > due_day:
            verdict, detail = "LATE", f"Not enough cash on the day; paid {executed_day - due_day} days late."
        elif headroom < 0:
            verdict, detail = "TIGHT", f"Paid, but net position is {rs(-headroom)} under your buffer that day."
        else:
            verdict, detail = "OK", f"Paid, with {rs(headroom)} above your buffer that day."
        rows.append({"event_id": view["id"], "party_id": view["party_id"], "party_name": view["party_name"] or "Supplier", "label": view["label"],
                     "detail": view["detail"], "amount_paise": event.amount_paise,
                     "due_date": series[due_day]["date"], "due_day": due_day, "executed_date": view["executed_date"],
                     "verdict": verdict, "message": detail, "headroom_paise": headroom,
                     "invoice_id": view["record_id"] if view["record_type"] == "invoice" else None})
    rows.sort(key=lambda r: (r["due_day"], -r["amount_paise"]))
    return rows[:limit]


# ---------------------------------------------------------------- risk: signals

def signals(business_id: str, run: Run, risk: dict[str, Any]) -> list[dict[str, Any]]:
    """Other ways the business can get hurt, each with the number behind it and where to act."""
    out: list[dict[str, Any]] = []
    summary = run.derived["summary"]
    parties = {p["id"]: p for p in query("SELECT * FROM party WHERE business_id = ?", (business_id,))}

    def add(sid: str, severity: str, title: str, detail: str, link: str, metric: str | None = None) -> None:
        out.append({"id": sid, "severity": severity, "title": title, "detail": detail, "link": link, "metric": metric})

    receivables = open_invoices(business_id, "RECEIVABLE")
    total_in = sum(i["outstanding_paise"] for i in receivables)
    if total_in:
        by_party: dict[str, int] = {}
        for inv in receivables:
            by_party[inv["party_id"]] = by_party.get(inv["party_id"], 0) + inv["outstanding_paise"]
        top_id, top = max(by_party.items(), key=lambda kv: kv[1])
        share = top / total_in
        if share >= 0.4:
            add("concentration", "out" if share >= 0.6 else "attention", f"{round(share * 100)}% of what you are owed is with {parties[top_id]['name']}",
                f"{rs(top)} of {rs(total_in)}. One late payment from them moves the whole forecast.", "/app/khata", f"{round(share * 100)}%")
        overdue = sum(i["outstanding_paise"] for i in receivables if i["days_overdue"] > 0)
        if overdue and overdue / total_in >= 0.2:
            late = [i for i in receivables if i["days_overdue"] > 0]
            add("overdue", "out" if overdue / total_in >= 0.4 else "attention", f"{rs(overdue)} is overdue across {len({i['party_id'] for i in late})} customers",
                f"{round(overdue * 100 / total_in)}% of receivables is past its due date; the oldest is {max(i['days_overdue'] for i in late)} days late.",
                "/app/khata", f"{round(overdue * 100 / total_in)}%")

    history = delay_history(business_id)
    for party_id, delays in history.items():
        if len(delays) >= 6:
            earlier, recent = statistics.mean(delays[:-3]), statistics.mean(delays[-3:])
            if recent - earlier >= 5 and party_id in parties:
                add(f"slipping-{party_id}", "attention", f"{parties[party_id]['name']} is paying later than before",
                    f"Last three payments averaged {recent:.0f} days from the due date; before that {earlier:.0f}.", "/app/khata", f"+{recent - earlier:.0f}d")

    for inv in open_invoices(business_id, "PAYABLE"):
        party = parties.get(inv["party_id"])
        if not party or party["msme_category"] not in ("MICRO", "SMALL"):
            continue
        age = (today() - date.fromisoformat(inv["invoice_date"])).days
        if age > 45:
            add(f"msme-{inv['id']}", "out", f"{party['name']} is owed past the 45-day limit",
                f"{inv['number']}, {rs(inv['outstanding_paise'])}, {age} days old. Bills to micro and small suppliers carry interest after 45 days (MSMED Act).",
                "/app/khata", f"{age}d")
        elif age > 35:
            add(f"msme-soon-{inv['id']}", "attention", f"{party['name']}: 45-day limit in {45 - age} days",
                f"{inv['number']}, {rs(inv['outstanding_paise'])}. Pay or agree terms in writing before day 45.", "/app/khata", f"{45 - age}d")

    inv_rows = inventory_rows(business_id, run)["materials"]
    short = [m for m in inv_rows if m["status"] == "SHORT"]
    low = [m for m in inv_rows if m["status"] == "REORDER"]
    if short:
        add("stock-short", "out", f"{len(short)} material{'s' if len(short) > 1 else ''} short for confirmed orders",
            ", ".join(f"{m['name']} ({', '.join(m['short_orders'][:2]) or 'orders'})" for m in short[:3]) + ".", "/app/inventory", str(len(short)))
    if low:
        add("stock-low", "attention", f"{len(low)} material{'s' if len(low) > 1 else ''} at or under the reorder point",
            ", ".join(f"{m['name']} ({m['days_of_cover']} days left)" if m["days_of_cover"] is not None else m["name"] for m in low[:3]) + ".", "/app/inventory", str(len(low)))

    facilities = run.built.snapshot.approved_credit_facilities
    if facilities and (summary["first_shortfall"] or summary["buffer_breach"]):
        best = max(facilities, key=lambda f: f.approved_limit_paise)
        label = run.built.meta["facilities"].get(best.id, {}).get("label", "Approved credit")
        add("backstop", "ok", f"Backstop exists: {label.split(' (')[0]}", f"Up to {rs(best.approved_limit_paise)} approved if the dip arrives.", "/app/book#fixes")

    if risk.get("status") == "READY":
        if risk.get("customers_without_history"):
            names = ", ".join(risk["customers_without_history"][:3])
            add("no-history", "attention", "The model knows little about some customers",
                f"{names}: no payment history yet, so the average of all customers is used.", "/app/khata")
    return sorted(out, key=lambda s: {"out": 0, "attention": 1, "ok": 2}[s["severity"]])


# ---------------------------------------------------------------- finance: flags

def _reviews(business_id: str) -> tuple[dict[str, str], dict[str, dict[str, int]]]:
    """Latest verdict per flag, and per-rule tallies of what the owner decided (the false-positive and false-negative counts)."""
    rows = query("SELECT * FROM guard_review WHERE business_id = ? ORDER BY created_at, rowid", (business_id,))
    latest: dict[str, tuple[str, str]] = {}
    missed: dict[str, int] = {}
    for row in rows:
        if row["verdict"] == "MISSED":
            missed[row["rule"]] = missed.get(row["rule"], 0) + 1
        else:
            latest[row["flag_key"]] = (row["verdict"], row["rule"])
    stats: dict[str, dict[str, int]] = {r: {"confirmed": 0, "dismissed": 0, "missed": missed.get(r, 0)} for r in RULES}
    for verdict, rule in latest.values():
        if rule in stats and verdict in ("CONFIRMED", "DISMISSED"):
            stats[rule]["confirmed" if verdict == "CONFIRMED" else "dismissed"] += 1
    return {k: v[0] for k, v in latest.items()}, stats


def _outlier_multiplier(stat: dict[str, int]) -> float:
    """Starts at 3x the party's usual amount; every two net 'Fine' verdicts raise it by half a step (cap 5x)."""
    return 3.0 + 0.5 * min(4, max(0, stat["dismissed"] - stat["confirmed"]) // 2)


def flags(business_id: str) -> dict[str, Any]:
    parties = {p["id"]: p for p in query("SELECT * FROM party WHERE business_id = ?", (business_id,))}
    txns = query("SELECT * FROM txn WHERE business_id = ? ORDER BY date, created_at", (business_id,))
    invoices = query("SELECT * FROM invoice WHERE business_id = ?", (business_id,))
    paid = cleared_paid_by_invoice(txns)
    verdicts, stats = _reviews(business_id)
    found: list[dict[str, Any]] = []

    def name_of(pid: str | None) -> str:
        return parties[pid]["name"] if pid in parties else "No party"

    def add(rule: str, key: str, severity: str, confidence: str, title: str, detail: str, **extra: Any) -> None:
        found.append({"key": f"{rule}:{key}", "rule": rule, "rule_label": RULES[rule], "severity": severity, "confidence": confidence,
                      "title": title, "detail": detail, **extra})

    def own(t: dict[str, Any]) -> bool:
        return t["party_id"] is not None and not (t["details"] or "").startswith("Production cost")

    # Possible duplicates: same party, direction and amount within three days, not two different bills.
    groups: dict[tuple, list[dict[str, Any]]] = {}
    for t in txns:
        if own(t) and t["status"] != "BOUNCED" and t["amount_paise"] >= 100_000 and _within(t["date"], 120):
            groups.setdefault((t["party_id"], t["direction"], t["amount_paise"]), []).append(t)
    for (pid, direction, amount), rows in groups.items():
        for first, second in zip(rows, rows[1:]):
            gap = (date.fromisoformat(second["date"]) - date.fromisoformat(first["date"])).days
            if gap > 3 or (first["invoice_id"] and second["invoice_id"] and first["invoice_id"] != second["invoice_id"]):
                continue
            same_ref = bool(first["reference"] and first["reference"] == second["reference"])
            add("DUPLICATE", second["id"], "high" if same_ref or gap == 0 else "medium", "High" if same_ref else "Medium",
                f"Two {rs(amount)} entries {'from' if direction == 'IN' else 'to'} {name_of(pid)}",
                f"{_human(date.fromisoformat(first['date']))} and {_human(date.fromisoformat(second['date']))}"
                f"{', same reference' if same_ref else ''}. If it was paid once, delete the second entry.",
                party_id=pid, party_name=name_of(pid), amount_paise=amount, date=second["date"], txn_id=second["id"], link="/app/book?tab=ledger")

    for inv in invoices:
        over = paid.get(inv["id"], 0) - inv["amount_paise"]
        if over > 0:
            add("OVERPAID", inv["id"], "high", "High", f"{inv['number']}: {rs(over)} more than the bill",
                f"Payments of {rs(paid[inv['id']])} are linked to a bill of {rs(inv['amount_paise'])}.",
                party_id=inv["party_id"], party_name=name_of(inv["party_id"]), amount_paise=over, date=inv["due_date"], invoice_id=inv["id"], link="/app/khata")

    # A payment with no bill linked, while that party has an open bill of about the same amount: the khata still shows it as owed.
    open_bills: dict[tuple, list[dict[str, Any]]] = {}
    for inv in invoices:
        if inv["status"] != "PAID" and paid.get(inv["id"], 0) < inv["amount_paise"]:
            open_bills.setdefault((inv["party_id"], "IN" if inv["kind"] == "RECEIVABLE" else "OUT"), []).append(inv)
    for t in txns:
        if not own(t) or t["status"] != "CLEARED" or t["invoice_id"] or t["amount_paise"] < 1_000_000 or not _within(t["date"], 90):
            continue
        match = next((i for i in open_bills.get((t["party_id"], t["direction"]), [])
                      if abs(i["amount_paise"] - paid.get(i["id"], 0) - t["amount_paise"]) <= max(100, t["amount_paise"] // 100)), None)
        if match is None:
            continue
        add("UNMATCHED", t["id"], "medium", "Medium", f"{rs(t['amount_paise'])} {'from' if t['direction'] == 'IN' else 'to'} {name_of(t['party_id'])} looks like {match['number']}",
            f"{match['number']} still shows {rs(match['amount_paise'] - paid.get(match['id'], 0))} as owed. If this was that payment, link it so the khata and the forecast stop counting it twice.",
            party_id=t["party_id"], party_name=name_of(t["party_id"]), amount_paise=t["amount_paise"], date=t["date"], txn_id=t["id"], invoice_id=match["id"], link="/app/khata")

    outlier_k = _outlier_multiplier(stats["OUTLIER"])
    per_party: dict[tuple, list[dict[str, Any]]] = {}
    for t in txns:
        if own(t) and t["status"] == "CLEARED":
            per_party.setdefault((t["party_id"], t["direction"]), []).append(t)
    for (pid, direction), rows in per_party.items():
        if len(rows) < 5:
            continue
        for t in rows:
            if not _within(t["date"], 90) or t["amount_paise"] < 1_000_000:
                continue
            others = [r["amount_paise"] for r in rows if r["id"] != t["id"]]
            usual = statistics.median(others)
            if usual and t["amount_paise"] > usual * outlier_k:
                ratio = t["amount_paise"] / usual
                add("OUTLIER", t["id"], "medium", "Medium" if ratio < 5 else "High",
                    f"{rs(t['amount_paise'])} is {ratio:.1f}x the usual for {name_of(pid)}",
                    f"Their usual is about {rs(round(usual))} over {len(others)} other entries. Flagged above {outlier_k:g}x.",
                    party_id=pid, party_name=name_of(pid), amount_paise=t["amount_paise"], date=t["date"], txn_id=t["id"], link="/app/book?tab=ledger")

    for t in txns:
        if t["medium"] != "CASH" or not own(t) or t["status"] != "CLEARED" or not _within(t["date"], 180):
            continue
        if t["direction"] == "IN" and t["amount_paise"] >= 20_000_000:
            add("CASH", t["id"], "high", "High", f"{rs(t['amount_paise'])} received in cash from {name_of(t['party_id'])}",
                "Cash receipts of ₹2,00,000 or more in one day can attract a penalty (Income Tax Act s.269ST). Ask your CA.",
                party_id=t["party_id"], party_name=name_of(t["party_id"]), amount_paise=t["amount_paise"], date=t["date"], txn_id=t["id"], link="/app/book?tab=ledger")
        elif t["direction"] == "OUT" and t["amount_paise"] > 1_000_000:
            add("CASH", t["id"], "low", "Low", f"{rs(t['amount_paise'])} paid in cash to {name_of(t['party_id'])}",
                "Cash payments above ₹10,000 to one party in a day may be disallowed as a business expense (s.40A(3)). Bank transfer is safer.",
                party_id=t["party_id"], party_name=name_of(t["party_id"]), amount_paise=t["amount_paise"], date=t["date"], txn_id=t["id"], link="/app/book?tab=ledger")

    for t in txns:
        if t["status"] == "BOUNCED" and _within(t["date"], 180):
            add("BOUNCED", t["id"], "high", "High", f"{rs(t['amount_paise'])} cheque from {name_of(t['party_id'])} bounced",
                "It does not count as cash. Follow up and record the replacement payment.",
                party_id=t["party_id"], party_name=name_of(t["party_id"]), amount_paise=t["amount_paise"], date=t["date"], txn_id=t["id"], link="/app/khata")
        elif t["status"] == "PENDING" and (today() - date.fromisoformat(t["date"])).days > 10:
            add("STALE", t["id"], "medium", "Medium", f"{rs(t['amount_paise'])} cheque pending for {(today() - date.fromisoformat(t['date'])).days} days",
                "Cheques usually clear in 3 to 5 days. Confirm with the bank.",
                party_id=t["party_id"], party_name=name_of(t["party_id"]), amount_paise=t["amount_paise"], date=t["date"], txn_id=t["id"], link="/app/book?tab=ledger")

    open_flags, confirmed = [], []
    for f in found:
        verdict = verdicts.get(f["key"])
        if verdict == "DISMISSED":
            continue
        (confirmed if verdict == "CONFIRMED" else open_flags).append({**f, "status": "CONFIRMED" if verdict == "CONFIRMED" else "OPEN"})
    order = lambda f: (SEVERITY_ORDER[f["severity"]], -(f.get("amount_paise") or 0))  # noqa: E731
    open_flags.sort(key=order)
    confirmed.sort(key=order)
    rule_rows = []
    for rule, label in RULES.items():
        s = stats[rule]
        decided = s["confirmed"] + s["dismissed"]
        rule_rows.append({"rule": rule, "label": label, **s, "precision": round(s["confirmed"] / decided, 2) if decided else None,
                          "sensitivity": f"flags above {_outlier_multiplier(s):g}x the usual" if rule == "OUTLIER" else None})
    return {"open": open_flags[:12], "open_count": len(open_flags), "confirmed": confirmed[:6], "rules": rule_rows,
            "scanned": {"payments": len(txns), "bills": len(invoices), "rules": len(RULES)}}


def review_flag(business_id: str, user_id: str, flag_key: str, verdict: str, note: str | None = None) -> dict[str, Any]:
    rule = flag_key.split(":", 1)[0]
    if rule not in RULES:
        return {"ok": False, "code": "UNKNOWN_RULE"}
    insert(get_conn(), "guard_review", {"id": f"gr-{uuid.uuid4().hex[:14]}", "business_id": business_id, "flag_key": flag_key, "rule": rule,
                                         "verdict": verdict, "note": (note or None) and note[:200], "user_id": user_id})
    return {"ok": True}


def report_missed(business_id: str, user_id: str, rule: str, note: str) -> dict[str, Any]:
    if rule not in RULES:
        return {"ok": False, "code": "UNKNOWN_RULE"}
    insert(get_conn(), "guard_review", {"id": f"gr-{uuid.uuid4().hex[:14]}", "business_id": business_id, "flag_key": f"MISSED:{uuid.uuid4().hex[:8]}",
                                         "rule": rule, "verdict": "MISSED", "note": note[:200], "user_id": user_id})
    return {"ok": True}


# ---------------------------------------------------------------- finance: verification

def checks(business_id: str, run: Run) -> list[dict[str, Any]]:
    """Reconciliation. Each check compares two sets of records that must agree; the count of disagreements is shown, not hidden."""
    txns = query("SELECT * FROM txn WHERE business_id = ?", (business_id,))
    invoices = query("SELECT * FROM invoice WHERE business_id = ?", (business_id,))
    parties = {p["id"] for p in query("SELECT id FROM party WHERE business_id = ?", (business_id,))}
    movements = query("SELECT * FROM stock_movement WHERE business_id = ?", (business_id,))
    pos = query("SELECT * FROM purchase_order WHERE business_id = ?", (business_id,))
    orders = query("SELECT * FROM sales_order WHERE business_id = ?", (business_id,))
    paid = cleared_paid_by_invoice(txns)
    invoice_ids = {i["id"] for i in invoices}
    out: list[dict[str, Any]] = []

    def add(cid: str, title: str, bad: list[str], good: str) -> None:
        out.append({"id": cid, "title": title, "ok": not bad, "count": len(bad), "detail": good if not bad else "; ".join(bad[:3]) + (f"; and {len(bad) - 3} more" if len(bad) > 3 else "")})

    add("overpaid", "No bill is paid more than it is worth",
        [f"{i['number']} paid {rs(paid[i['id']])} of {rs(i['amount_paise'])}" for i in invoices if paid.get(i["id"], 0) > i["amount_paise"]],
        f"{len(invoices)} bills checked against their payments.")
    add("status", "Bill status matches its payments",
        [f"{i['number']} is marked paid with {rs(paid.get(i['id'], 0))} of {rs(i['amount_paise'])} received" for i in invoices
         if i["status"] == "PAID" and 0 < paid.get(i["id"], 0) < i["amount_paise"]]
        + [f"{i['number']} is still open but fully paid" for i in invoices if i["status"] != "PAID" and paid.get(i["id"], 0) >= i["amount_paise"]],
        "Paid bills are fully paid; open bills are not.")
    stock = on_hand(movements, today())
    names = {m["id"]: m["name"] for m in query("SELECT id, name FROM material WHERE business_id = ?", (business_id,))}
    names.update({p["id"]: p["name"] for p in query("SELECT id, name FROM product WHERE business_id = ?", (business_id,))})
    add("stock", "Stock is never below zero",
        [f"{names.get(i, i)} is at {q}" for i, q in stock.items() if q < 0], f"{len(stock)} items; every stock figure is the sum of its movements.")
    arrival_refs = {(m["item_id"], m["ref"]) for m in movements if m["reason"] == "PURCHASE_ARRIVAL"}
    add("arrivals", "Every received purchase has its stock-in entry",
        [f"{p['number']} is received but has no stock-in" for p in pos
         if p["status"] in ("ARRIVED", "CLOSED") and p["material_id"] and p["qty"] > 0 and (p["material_id"], p["number"]) not in arrival_refs],
        "Received purchase orders and stock movements agree.")
    dispatch_refs = {m["ref"] for m in movements if m["reason"] == "DISPATCH"}
    invoice_orders = {i["order_id"] for i in invoices if i["kind"] == "RECEIVABLE"}
    delivered = [o for o in orders if STAGES.index(o["stage"]) >= STAGES.index("DELIVERED")]
    add("delivered", "Every delivered order has stock out and a bill",
        [f"{o['number']} has no {'stock-out' if o['number'] not in dispatch_refs else 'bill'}" for o in delivered
         if o["number"] not in dispatch_refs or o["number"] not in invoice_orders],
        f"{len(delivered)} delivered orders checked.")
    add("links", "Every payment points to a real party and bill",
        [f"{t['id']} points to a missing {'party' if t['party_id'] not in parties else 'bill'}" for t in txns
         if (t["party_id"] and t["party_id"] not in parties) or (t["invoice_id"] and t["invoice_id"] not in invoice_ids)],
        f"{len(txns)} payments checked.")
    future = [t for t in txns if t["status"] == "CLEARED" and t["date"] > today().isoformat()]
    add("future", "No cleared payment is dated in the future",
        [f"{rs(t['amount_paise'])} dated {t['date']}" for t in future], "Cash now counts only entries up to today.")
    current = business_row(business_id)["data_version"]
    add("engine", "The forecast was built from the current books",
        [] if run.data_version == current else [f"forecast is at data version {run.data_version}, books at {current}"],
        f"Engine run {run.id[-8:]} matches data version {current}.")
    return out


def activity(business_id: str, limit: int = 10) -> list[dict[str, Any]]:
    """The latest changes the engine has taken in: payments, order steps, goods received."""
    items: list[dict[str, Any]] = []
    names = {p["id"]: p["name"] for p in query("SELECT id, name FROM party WHERE business_id = ?", (business_id,))}
    for t in query("SELECT * FROM txn WHERE business_id = ? ORDER BY created_at DESC LIMIT ?", (business_id, limit)):
        who = names.get(t["party_id"], t["details"] or "an expense")
        items.append({"at": t["created_at"], "kind": "PAYMENT", "direction": t["direction"], "amount_paise": t["amount_paise"],
                      "text": f"{'Received from' if t['direction'] == 'IN' else 'Paid to'} {who} ({t['medium'].title()}{', pending' if t['status'] == 'PENDING' else ''})"})
    for so in query("SELECT number, stage_history_json FROM sales_order WHERE business_id = ? AND stage_history_json != '[]'", (business_id,)):
        try:
            log = json.loads(so["stage_history_json"])
        except ValueError:
            continue
        for entry in log[-3:]:
            if entry.get("at"):
                back = entry.get("direction") == "BACK"
                items.append({"at": entry["at"], "kind": "ORDER", "direction": None, "amount_paise": None,
                              "text": f"{so['number']} {'stepped back' if back else 'moved'} from {entry['from'].replace('_', ' ').title()} to {entry['to'].replace('_', ' ').title()}"})
    for po in query("SELECT number, status, updated_at FROM purchase_order WHERE business_id = ? AND status IN ('ARRIVED','PAID') ORDER BY updated_at DESC LIMIT 4", (business_id,)):
        items.append({"at": po["updated_at"], "kind": "PURCHASE", "direction": None, "amount_paise": None,
                      "text": f"{po['number']} marked {po['status'].lower()}"})
    items.sort(key=lambda i: i["at"], reverse=True)
    return items[:limit]


# ---------------------------------------------------------------- finance: opportunities

def opportunities(business_id: str, run: Run, ladder: list[dict[str, Any]], yield_bp: int) -> dict[str, Any]:
    """Offered only inside the amount Risk says is safe. If nothing is safe, nothing is offered, and the owner is told why."""
    pos = position(business_id)
    key = "cautious_paise"
    safe_rows = [r for r in ladder if (r[key] if r[key] is not None else r["plan_paise"]) > 0]
    items: list[dict[str, Any]] = []
    rate = yield_bp / 10_000

    def safe_for(days: int) -> int:
        row = next((r for r in reversed(ladder) if r["days"] <= days), None)
        if row is None:
            return 0
        return min(row["cautious_paise"] if row["cautious_paise"] is not None else row["plan_paise"], pos["cash_now_paise"])

    best = None
    for row in safe_rows:
        amount = min(row["cautious_paise"] if row["cautious_paise"] is not None else row["plan_paise"], pos["cash_now_paise"])
        if amount >= 2_500_000:
            gain = round(amount * rate * row["days"] / 365)
            if best is None or gain > best[2]:
                best = (row["days"], amount, gain)
    if best:
        days, amount, gain = best
        items.append({"id": "idle-cash", "kind": "CAPITAL", "title": f"{rs(amount)} can sit idle for {days} days",
                      "detail": f"At {yield_bp / 100:g}% a year in a liquid fund or sweep deposit that is about {rs(gain)}. Keep it where you can take it out in a day.",
                      "amount_paise": amount, "gain_paise": gain, "days": days, "link": None, "cta": None})

    suppliers = [i for i in open_invoices(business_id, "PAYABLE") if 7 <= (date.fromisoformat(i["due_date"]) - today()).days <= 45]
    names = {p["id"]: p["name"] for p in query("SELECT id, name FROM party WHERE business_id = ?", (business_id,))}
    for inv in sorted(suppliers, key=lambda i: -i["outstanding_paise"])[:2]:
        early = (date.fromisoformat(inv["due_date"]) - today()).days
        if inv["outstanding_paise"] <= safe_for(early):
            breakeven = rate * early / 365 * 100
            annual = 2 / early * 365
            items.append({"id": f"early-{inv['id']}", "kind": "RESOURCE", "title": f"Pay {names.get(inv['party_id'], 'a supplier')} {early} days early, for a discount",
                          "detail": f"{inv['number']}, {rs(inv['outstanding_paise'])}. Worth it if they take off {breakeven:.2f}% or more. A usual 2% is about {annual:.0f}% a year.",
                          "amount_paise": inv["outstanding_paise"], "gain_paise": round(inv["outstanding_paise"] * 0.02), "days": early,
                          "link": "/app/khata", "cta": "Open Khata"})

    for m in inventory_rows(business_id, run)["materials"]:
        if m["status"] not in ("REORDER", "SHORT") or m["reorder_point"] is None:
            continue
        quantity = max(0, 2 * m["reorder_point"] - (m["on_hand"] + m["on_the_way"]))
        cost = quantity * m["avg_cost_paise"] // (m["unit_factor"] or 1)
        if quantity <= 0 or cost <= 0:
            continue
        fundable = cost <= safe_for(min(30, max(m["lead_time_days"] or 7, 7)))
        items.append({"id": f"stock-{m['id']}", "kind": "RESOURCE", "title": f"Restock {m['name']}",
                      "detail": (f"{m['days_of_cover']} days left against a {m['lead_time_days']}-day lead time. " if m["days_of_cover"] is not None else "")
                                + (f"About {rs(cost)} to reach two reorder points; it fits inside the safe amount." if fundable
                                   else f"About {rs(cost)}; more than the safe amount, so order part now."),
                      "amount_paise": cost, "gain_paise": None, "days": None, "link": f"/app/orders?tab=purchase&material={m['id']}", "cta": "Draft the order"})
        if len([i for i in items if i["id"].startswith("stock-")]) >= 2:
            break
    why_none = None
    if not items:
        first = ladder[0] if ladder else None
        why_none = ("Nothing is offered because no cash is safe to move: the cautious forecast stays at or under your buffer."
                    if not safe_rows else "Nothing worthwhile is safe to move right now.")
        if first and first["binding_date"]:
            why_none += f" The tightest day in the first {first['days']} days is {_human(date.fromisoformat(first['binding_date']))}."
    return {"yield_bp": yield_bp, "items": items, "reason_none": why_none,
            "note": "Indicative figures from an assumed return you can change. Not financial advice; check the product's terms and your CA before acting."}


# ---------------------------------------------------------------- back-test and confidence

def calibration(business_id: str) -> dict[str, Any]:
    """Was the model right about past payments? For each customer, predict each payment's delay from the ones before it
    (a P10 to P90 band) and count how often the real delay fell inside the band."""
    tested = hits = 0
    errors: list[int] = []
    for delays in delay_history(business_id).values():
        for i in range(3, len(delays)):
            past = sorted(delays[:i])
            low, high = past[round(0.1 * (len(past) - 1))], past[round(0.9 * (len(past) - 1))]
            median = statistics.median(past)
            tested += 1
            hits += 1 if low <= delays[i] <= high else 0
            errors.append(abs(round(median) - delays[i]))
    if tested < 6:
        return {"status": "TOO_FEW", "tested": tested, "message": f"Only {tested} past payments can be tested; the check needs 6."}
    coverage = hits / tested
    return {"status": "READY", "tested": tested, "hits": hits, "coverage": round(coverage, 2), "target": 0.8,
            "median_error_days": statistics.median(errors),
            "message": f"Of {tested} past payments, {round(coverage * 100)}% landed inside the range predicted from that customer's earlier payments alone (a well-tuned 10 to 90 range lands near 80%)."}


# ---------------------------------------------------------------- the verdict

def verdict(run: Run, risk: dict[str, Any], flag_data: dict[str, Any], check_rows: list[dict[str, Any]], sigs: list[dict[str, Any]]) -> dict[str, Any]:
    summary = run.derived["summary"]
    chance30 = risk["shortfall_chance"]["30"] if risk.get("status") == "READY" else None
    failed = [c for c in check_rows if not c["ok"]]
    high = [f for f in flag_data["open"] if f["severity"] == "high"]
    urgent = [s for s in sigs if s["severity"] == "out"]
    reasons: list[str] = []
    if summary["first_shortfall"]:
        reasons.append(f"Cash runs short on {_human(date.fromisoformat(summary['first_shortfall']['date']))} by {rs(summary['first_shortfall']['shortfall_paise'])}.")
    elif summary["buffer_breach"]:
        reasons.append(f"Net position dips under your buffer on {_human(date.fromisoformat(summary['buffer_breach']['date']))}.")
    if chance30 is not None and chance30 >= 0.25:
        reasons.append(f"{round(chance30 * 100)}% of simulated futures run short within 30 days.")
    if high:
        reasons.append(f"{len(high)} serious entr{'y' if len(high) == 1 else 'ies'} to look at in the books.")
    if failed:
        reasons.append(f"{len(failed)} reconciliation check{'s' if len(failed) > 1 else ''} failed.")
    for s in urgent[:2]:
        reasons.append(s["title"] + ".")
    if summary["first_shortfall"] or (chance30 is not None and chance30 >= 0.5) or high or failed:
        level = "act"
    elif summary["buffer_breach"] or (chance30 is not None and chance30 >= 0.25) or flag_data["open_count"] or sigs and sigs[0]["severity"] != "ok":
        level = "watch"
    else:
        level = "ok"
    if not reasons:
        reasons.append("No shortfall in the forecast, no serious entries, and every check passes.")
    headline = {"act": "Act this week", "watch": "Keep an eye on it", "ok": "All clear"}[level]
    return {"level": level, "headline": headline, "reasons": reasons[:4]}


# ---------------------------------------------------------------- the whole picture

def build(business_id: str, run: Run, risk: dict[str, Any], yield_bp: int = DEFAULT_YIELD_BP) -> dict[str, Any]:
    ladder = safe_ladder(run, risk)
    flag_data = flags(business_id)
    check_rows = checks(business_id, run)
    sigs = signals(business_id, run, risk)
    ready = risk.get("status") == "READY" and risk.get("snapshot_hash") == run.built.snapshot_hash
    drivers = [d for d in (risk.get("drivers") or []) if d["share"] > 0][:4] if ready else []
    return {
        "as_of": run.as_of.isoformat(), "run_id": run.id, "buffer_paise": run.derived["summary"]["buffer_paise"],
        "verdict": verdict(run, risk, flag_data, check_rows, sigs),
        "risk": {
            "status": "READY" if ready else ("COMPUTING" if risk.get("status") in (None, "READY") else risk["status"]),
            "shortfall_chance": risk.get("shortfall_chance") if ready else None,
            "first_shortfall": risk.get("first_shortfall") if ready else None,
            "expected_shortfall_paise": risk.get("expected_shortfall_paise") if ready else None,
            "drivers": drivers, "paths": risk.get("paths") if ready else None, "path_days": risk.get("path_days") if ready else None,
            "fan": risk.get("fan") if ready else None, "n_samples": risk.get("n_samples") if ready else None,
            "payments_used": risk.get("payments_used"), "customers_with_history": risk.get("customers_with_history"),
            "customers_without_history": risk.get("customers_without_history") or [],
            "series": [{"day": p["day"], "net_paise": p["net_paise"]} for p in run.derived["series"]],
            "ladder": ladder, "payments": upcoming_payments(run), "signals": sigs,
        },
        "finance": {
            "flags": flag_data, "checks": check_rows, "checks_passed": sum(1 for c in check_rows if c["ok"]),
            "activity": activity(business_id), "opportunities": opportunities(business_id, run, ladder, yield_bp),
        },
        "calibration": calibration(business_id),
    }


def brief(business_id: str, run: Run, risk: dict[str, Any]) -> dict[str, Any]:
    """The small version shown on Today."""
    ladder = safe_ladder(run, risk)
    flag_data = flags(business_id)
    check_rows = checks(business_id, run)
    sigs = signals(business_id, run, risk)
    thirty = next((r for r in ladder if r["days"] == 30), None)
    return {"verdict": verdict(run, risk, flag_data, check_rows, sigs),
            "safe_30": None if thirty is None else {"plan_paise": thirty["plan_paise"], "cautious_paise": thirty["cautious_paise"]},
            "flags_open": flag_data["open_count"], "checks_passed": sum(1 for c in check_rows if c["ok"]), "checks_total": len(check_rows)}


# ---------------------------------------------------------------- dynamic: "if I make this payment"

def payment_options(run: Run, event_id: str | None, amount_paise: int | None, pay_on: date | None, label: str | None) -> dict[str, Any]:
    """Re-runs the engine for each way of making a payment, and ranks them. Existing bill: pay on the due date, pay now,
    pay half then the rest, ask for more time. New spend: pay on the date, a week later, two weeks later."""
    base = run.derived["summary"]
    start = run.as_of
    last = start + timedelta(days=run.built.snapshot.horizon_days - 1)
    options: list[dict[str, Any]] = []

    def option(oid: str, title: str, summary_text: str, fix: dict[str, Any] | None, request: dict[str, Any] | None) -> None:
        options.append({"id": oid, "title": title, "summary": summary_text, "fix": fix, "request": request})

    if event_id:
        event = next((e for e in run.built.snapshot.events if e.id == event_id and e.type.value == "SUPPLIER_PAYMENT"), None)
        if event is None:
            raise fixes_service.FixError("UNKNOWN_EVENT", {"event_id": event_id})
        due = event.due_date or event.earliest_date
        amount = event.amount_paise or 0
        info = run.built.meta["events"].get(event_id, {})
        subject = f"{rs(amount)} to {info.get('party_name', 'the supplier')}"
        option("due", "Pay on the due date", f"{subject} on {_human(due)}, as the books stand now.", None, None)
        if event.earliest_date > start:
            option("now", "Pay now", f"Pay {subject} from {_human(start)}, as soon as cash allows.",
                   {"id": "pay-early", "kind": "PAY_EARLY", "params": {"event_id": event_id, "date": start.isoformat()}, "title": "Pay now", "cost_paise": 0},
                   {"kind": "PAY_EARLY", "event_id": event_id, "date": start.isoformat()})
        half = amount // 2 // 100 * 100
        if half >= 100_000 and amount - half >= 100_000:
            option("split", "Half now, the rest in 14 days", f"{rs(half)} on {_human(max(start, due))}, {rs(amount - half)} fourteen days later.",
                   {"id": "split-supplier", "kind": "SPLIT_SUPPLIER_PAYMENT", "params": {"event_id": event_id, "first_paise": half, "first_date": max(start, due).isoformat(), "second_after_days": 14},
                    "title": "Pay in two parts", "cost_paise": 0},
                   {"kind": "SPLIT_SUPPLIER_PAYMENT", "event_id": event_id, "amount_paise": half, "days": 14})
        if due + timedelta(days=14) <= last:
            option("extend", "Ask for 14 more days", f"Move the payment from {_human(due)} to {_human(due + timedelta(days=14))}; the supplier must agree.",
                   {"id": "extension", "kind": "EXTENSION", "params": {"event_id": event_id, "days": 14}, "title": "Extension", "cost_paise": 0},
                   {"kind": "EXTENSION", "event_id": event_id, "days": 14})
        title = subject
    else:
        if not amount_paise or pay_on is None:
            raise fixes_service.FixError("AMOUNT_AND_DATE_REQUIRED", {})
        subject = f"{rs(amount_paise)} for {label or 'a new payment'}"
        option("skip", "Don't pay it", "The forecast as it stands, without this payment.", None, None)
        for oid, text, shift in (("on", f"Pay on {_human(pay_on)}", 0), ("week", "Pay a week later", 7), ("fortnight", "Pay two weeks later", 14)):
            day = pay_on + timedelta(days=shift)
            if day > last:
                continue
            body = {"kind": "ADD_PAYMENT", "amount_paise": amount_paise, "date": day.isoformat(), "label": label}
            option(oid, text, f"{subject}, paid on {_human(day)}.", {"id": "adhoc", "kind": "ADD_PAYMENT", "params": {"date": day.isoformat(), "amount_paise": amount_paise, "label": label},
                                                                      "title": text, "cost_paise": 0}, body)
        title = subject

    rows = []
    base_first = base["first_shortfall"]
    for item in options:
        if item["fix"] is None:
            series, first, breach, late = run.derived["series"], base_first, base["buffer_breach"], base["late_orders"]
            global_low = base["lowest"]
        else:
            try:
                evaluation = fixes_service.evaluate(run, item["fix"])
            except (fixes_service.FixError, ValueError) as exc:
                rows.append({**{k: item[k] for k in ("id", "title", "summary", "request")}, "error": getattr(exc, "code", "INVALID"), "verdict": "ERROR"})
                continue
            series, first, breach, late = evaluation["series"], evaluation["first_shortfall_after"], evaluation["buffer_breach_after"], evaluation["late_orders_after"]
            global_low = {"net_paise": evaluation["dip_after_paise"], "day": evaluation["dip_after_day"]}
        near = series[: NEAR_DAYS + 1]
        low = min(near, key=lambda p: (p["net_paise"], p["day"]))
        state = "SHORTFALL" if low["net_paise"] < 0 else ("TIGHT" if low["net_paise"] < base["buffer_paise"] else "SAFE")
        rows.append({"id": item["id"], "title": item["title"], "summary": item["summary"], "request": item["request"],
                     "near_low_paise": low["net_paise"], "near_low_day": low["day"], "near_low_date": low["date"], "verdict": state,
                     "first_shortfall": first, "shortfall_unchanged": (first or {}).get("day") == (base_first or {}).get("day")
                     and (first or {}).get("shortfall_paise") == (base_first or {}).get("shortfall_paise"),
                     "late_orders": len(late or []),
                     "lowest_paise": global_low["net_paise"], "lowest_day": global_low["day"],
                     "lowest_change_paise": (global_low["net_paise"] - base["lowest"]["net_paise"]) if base["lowest"] else 0,
                     "near_change_paise": low["net_paise"] - min(p["net_paise"] for p in run.derived["series"][: NEAR_DAYS + 1])})
    ranked = [r for r in rows if r["verdict"] != "ERROR" and r["id"] != "skip"]
    rank = {"SAFE": 0, "TIGHT": 1, "SHORTFALL": 2}
    order = [o["id"] for o in options]
    best = min(ranked, key=lambda r: (rank[r["verdict"]], r["first_shortfall"] is not None, r["late_orders"], -r["near_low_paise"], order.index(r["id"]))) if ranked else None
    recommendation = None
    if best is not None:
        low_text = f"lowest {rs(best['near_low_paise'])} on {_human(date.fromisoformat(best['near_low_date']))}"
        recommendation = {"SAFE": f"{best['title']} keeps the next {NEAR_DAYS} days above your buffer ({low_text}).",
                          "TIGHT": f"No option keeps clear of your buffer. {best['title']} is closest ({low_text}).",
                          "SHORTFALL": f"Every option runs short within {NEAR_DAYS} days. {best['title']} is the least bad ({low_text})."}[best["verdict"]]
        if best["lowest_change_paise"] < 0:
            recommendation += f" It deepens the lowest point of the forecast by {rs(-best['lowest_change_paise'])}."
        if best["first_shortfall"]:
            later = _human(date.fromisoformat(best["first_shortfall"]["date"]))
            recommendation += (f" The shortfall on {later} is separate and this payment does not change it."
                               if best["shortfall_unchanged"] else f" The forecast still runs short on {later}.")
        elif base_first:
            recommendation += f" It also removes the shortfall on {_human(date.fromisoformat(base_first['date']))}."
    return {"subject": title, "options": rows, "best": best["id"] if best else None, "recommendation": recommendation,
            "buffer_paise": base["buffer_paise"], "window_days": NEAR_DAYS}
