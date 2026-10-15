"""Printable datasheets as CSV: one company, one customer or one supplier.

Layout is built for people opening it in Excel or Sheets: a title block, then labelled sections separated by a
blank line. Key/value sections have two columns; tables have a header row and a totals row where a total means
something. Money is plain rupees with two decimals (no symbol, no thousands separator) so it sums and sorts;
every section says "INR". Text is guarded against spreadsheet formula injection.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import date
from decimal import Decimal
from typing import Any, Iterable

from ..core.db import query, query_one, today
from ..records import repo
from . import runs
from .inventory import inventory_rows
from .position import delay_model, exposures, open_invoices, position
from .views import cached_views

BOM = "﻿"
STAGE_LABEL = {"PLANNED": "Planned", "MATERIALS_READY": "Materials ready", "IN_PRODUCTION": "In production", "READY": "Ready",
               "DELIVERED": "Delivered", "PAID": "Paid"}
STATE_LABEL = {"EXECUTED": "Happens in window", "BLOCKED": "Blocked", "WAITING": "Waits on an earlier step", "LATER": "After the window"}
TERMS_LABEL = {"CREDIT": "Credit", "ADVANCE": "Advance", "ON_DELIVERY": "On delivery"}


NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


def inr(paise: int | None) -> str:
    """Integer paise to a plain two-decimal rupee string, without floating point."""
    if paise is None:
        return ""
    sign = "-" if paise < 0 else ""
    whole, frac = divmod(abs(int(paise)), 100)
    return f"{sign}{whole}.{frac:02d}"


def safe(value: Any) -> Any:
    """Text cells cannot start a formula. Numbers and dates pass through untouched."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r") and not NUMBER.match(value):
        return "'" + value
    return "" if value is None else value


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "datasheet"


def percent(share: float | None) -> str:
    return "" if share is None else f"{share * 100:.1f}"


def qty_label(qty: int, material: dict[str, Any] | None) -> str:
    if not material:
        return str(qty)
    factor = material["unit_factor"] or 1
    if factor == 1:
        return f"{qty:,} {material['unit']}"
    text = f"{qty / factor:,.1f}"
    return f"{text[:-2] if text.endswith('.0') else text} {material['unit']}"


class Sheet:
    def __init__(self) -> None:
        self.rows: list[list[Any]] = []

    def blank(self) -> None:
        self.rows.append([])

    def line(self, *cells: Any) -> None:
        self.rows.append([safe(c) for c in cells])

    def title(self, text: str) -> None:
        if self.rows:
            self.blank()
        self.line(text.upper())

    def kv(self, pairs: Iterable[tuple[str, Any]]) -> None:
        for key, value in pairs:
            self.line(key, value)

    def table(self, headers: list[str], rows: list[list[Any]], totals: list[Any] | None = None, empty: str = "None") -> None:
        if not rows:
            self.line(empty)
            return
        self.line(*headers)
        for row in rows:
            self.line(*row)
        if totals:
            self.line(*totals)

    def render(self) -> str:
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\r\n")
        for row in self.rows:
            writer.writerow(row)
        return BOM + buffer.getvalue()


def _header(sheet: Sheet, kind: str, business: dict[str, Any], subject: str | None = None) -> None:
    sheet.line("RIPPLE DATASHEET")
    sheet.line("Report", kind)
    if subject:
        sheet.line("Subject", subject)
    sheet.line("Business", business["name"])
    sheet.line("Generated on", today().isoformat())
    sheet.line("Currency", "All amounts in INR (rupees), two decimals")
    sheet.line("Source", "Your records in Ripple. Forecast figures come from the engine run of the same day.")


def _invoice_rows(invoices: list[dict[str, Any]], paid: dict[str, int]) -> list[list[Any]]:
    now = today()
    out = []
    for inv in invoices:
        paid_paise = paid.get(inv["id"], 0)
        outstanding = max(0, inv["amount_paise"] - paid_paise)
        due = date.fromisoformat(inv["due_date"])
        if outstanding > 0:
            late = max(0, (now - due).days)
            status = "Overdue" if late else ("Part paid" if paid_paise else "Open")
        else:
            late = (date.fromisoformat(inv["paid_date"]) - due).days if inv["paid_date"] else ""
            status = "Paid"
        out.append([inv["number"], inv["description"] or "", inv["invoice_date"], inv["due_date"], inv["promised_date"] or "",
                    inv["paid_date"] or "", inr(inv["amount_paise"]), inr(paid_paise), inr(outstanding), late, status])
    return out


INVOICE_HEADERS = ["Invoice", "Description", "Invoice date", "Due date", "Promised date", "Paid on", "Amount", "Paid", "Outstanding", "Days late", "Status"]


def _paid_by_invoice(business_id: str) -> dict[str, int]:
    paid: dict[str, int] = {}
    for t in query("SELECT invoice_id, amount_paise FROM txn WHERE business_id = ? AND invoice_id IS NOT NULL AND status = 'CLEARED'", (business_id,)):
        paid[t["invoice_id"]] = paid.get(t["invoice_id"], 0) + t["amount_paise"]
    return paid


def _paise(cell: Any) -> int:
    """Back from a rupee string to integer paise, exactly."""
    return int((Decimal(str(cell)) * 100).to_integral_value()) if cell != "" else 0


def _sum_cols(rows: list[list[Any]], indexes: Iterable[int]) -> dict[int, str]:
    return {i: inr(sum(_paise(r[i]) for r in rows)) for i in indexes}


def _totals_row(width: int, label: str, sums: dict[int, str]) -> list[Any]:
    row: list[Any] = [""] * width
    row[0] = label
    for i, v in sums.items():
        row[i] = v
    return row


def party_sheet(business_id: str, party_id: str) -> tuple[str, str]:
    """Returns (csv_text, file_stem) for one customer or one supplier. Raises RecordError(404) for a stranger's id."""
    party = repo.owned("party", party_id, business_id)
    business = query_one("SELECT * FROM business WHERE id = ?", (business_id,))
    customer = party["kind"] == "CUSTOMER"
    kind_word = "Customer" if customer else "Supplier"
    now = today()
    sheet = Sheet()
    _header(sheet, f"{kind_word} datasheet", business, party["name"])

    invoices = query("SELECT * FROM invoice WHERE business_id = ? AND party_id = ? ORDER BY invoice_date, number", (business_id, party_id))
    paid = _paid_by_invoice(business_id)
    txns = query("SELECT * FROM txn WHERE business_id = ? AND party_id = ? ORDER BY date, created_at", (business_id, party_id))
    inv_by_id = {i["id"]: i for i in invoices}
    exp = exposures(business_id).get(party_id, {})
    notes = json.loads(party["notes_json"] or "[]")
    tags = json.loads(party["tags_json"] or "[]")

    sheet.title("Profile")
    terms = TERMS_LABEL.get(party["terms_type"], party["terms_type"])
    if party["terms_type"] == "CREDIT":
        terms += f", {party['terms_days']} days"
    profile = [("Name", party["name"]), ("Type", kind_word), ("City", party["city"] or ""), ("Description", party["description"] or ""),
               ("Buys" if customer else "Supplies", ", ".join(tags)), ("Phone", party["phone"] or ""), ("GSTIN", party["gstin"] or ""),
               ("Terms", terms)]
    if not customer:
        profile += [("Lead time (days)", party["lead_time_days"]), ("MSME category", party["msme_category"] or "Not registered"),
                    ("Udyam number", party["udyam_number"] or "")]
    profile.append(("Relationship since", party["since"] or ""))
    sheet.kv(profile)

    outstanding_invoices = [i for i in open_invoices(business_id) if i["party_id"] == party_id]
    billed = sum(i["amount_paise"] for i in invoices)
    settled = sum(t["amount_paise"] for t in txns if t["status"] == "CLEARED")
    outstanding = sum(i["outstanding_paise"] for i in outstanding_invoices)
    overdue = sum(i["outstanding_paise"] for i in outstanding_invoices if i["days_overdue"] > 0)
    summary: list[tuple[str, Any]] = [
        ("Total billed" if customer else "Total billed by supplier", inr(billed)),
        ("Total received" if customer else "Total paid", inr(settled)),
        ("Outstanding" if customer else "You owe", inr(outstanding)),
        ("Overdue amount", inr(overdue)),
        ("Open invoices", len(outstanding_invoices)),
        ("Longest overdue (days)", max((i["days_overdue"] for i in outstanding_invoices), default=0)),
        ("Oldest due date", exp.get("oldest_due") or ""),
        ("Share of all receivables (%)" if customer else "Share of all payables (%)", f"{(exp.get('exposure_bp', 0)) / 100:.1f}"),
    ]
    if customer:
        model = delay_model(business_id)["customers"].get(party_id, {})
        summary += [
            ("Payments recorded", len(txns)), ("Paid invoices with history", model.get("n", 0)),
            ("Paid on time (%)", percent(model.get("on_time_share"))),
            ("Average days late (negative is early)", model.get("avg_delay_days", "") if model.get("avg_delay_days") is not None else ""),
            ("Delay used by risk, typical (P50 days)", model.get("p50_days", "") if model.get("p50_days") is not None else ""),
            ("Delay used by risk, bad case (P90 days)", model.get("p90_days", "") if model.get("p90_days") is not None else ""),
        ]
        if business["udyam_number"] and outstanding_invoices:
            oldest = min(outstanding_invoices, key=lambda i: i["invoice_date"])
            summary.append(("MSME 45-day clock, days left on oldest invoice", 45 - (now - date.fromisoformat(oldest["invoice_date"])).days))
    else:
        nxt = min(outstanding_invoices, key=lambda i: i["due_date"], default=None)
        summary += [("Payments made", len(txns)), ("Next due date", nxt["due_date"] if nxt else ""), ("Next due amount", inr(nxt["outstanding_paise"]) if nxt else "")]
    sheet.title("Summary")
    sheet.kv(summary)

    open_rows = [r for r in _invoice_rows(invoices, paid) if r[-1] != "Paid"]
    sheet.title("Open invoices")
    sums = _sum_cols(open_rows, (6, 7, 8))
    sheet.table(INVOICE_HEADERS, open_rows, _totals_row(len(INVOICE_HEADERS), "Total", sums), empty="Nothing open")

    all_rows = _invoice_rows(invoices, paid)
    sheet.title("All invoices")
    sums = _sum_cols(all_rows, (6, 7, 8))
    sheet.table(INVOICE_HEADERS, all_rows, _totals_row(len(INVOICE_HEADERS), "Total", sums), empty="No invoices")

    pay_rows = []
    for t in txns:
        inv = inv_by_id.get(t["invoice_id"])
        vs_due = ""
        if inv and customer:
            vs_due = (date.fromisoformat(t["date"]) - date.fromisoformat(inv["due_date"])).days
        pay_rows.append([t["date"], "Received" if t["direction"] == "IN" else "Paid", inr(t["amount_paise"]), t["medium"], t["reference"] or "",
                         inv["number"] if inv else (t["details"] or ""), vs_due, t["status"].title()])
    sheet.title("Payments")
    pay_totals = None
    if pay_rows:
        cleared = sum(t["amount_paise"] for t in txns if t["status"] == "CLEARED")
        pay_totals = ["Total cleared", "", inr(cleared), "", "", "", "", ""]
    sheet.table(["Date", "Direction", "Amount", "Medium", "Reference", "Invoice", "Days after due (negative is early)", "Status"], pay_rows, pay_totals, empty="No payments recorded")

    run = runs.baseline(business_id)
    views = cached_views(run)
    if customer:
        products = {p["id"]: p["name"] for p in query("SELECT id, name FROM product WHERE business_id = ?", (business_id,))}
        results = {o.order_id: o for o in run.result.order_results}
        order_rows = []
        for so in query("SELECT * FROM sales_order WHERE business_id = ? AND customer_id = ? ORDER BY number", (business_id, party_id)):
            res = results.get(so["number"])
            order_rows.append([so["number"], products.get(so["product_id"], "Custom order"), so["qty"], inr(so["unit_price_paise"]),
                               inr(so["qty"] * so["unit_price_paise"]), so["promised_date"], STAGE_LABEL.get(so["stage"], so["stage"]),
                               res.delivery_date.isoformat() if res and res.delivery_date else "",
                               res.delivery_lateness_days if res and res.delivery_date else ""])
        sheet.title("Sales orders")
        sheet.table(["Order", "Product", "Quantity", "Unit price", "Value", "Promised", "Stage", "Forecast delivery", "Days late (forecast)"],
                    order_rows, _totals_row(9, "Total", {4: inr(sum(_paise(r[4]) for r in order_rows))}) if order_rows else None, empty="No orders")
    else:
        materials = {m["id"]: m for m in query("SELECT * FROM material WHERE business_id = ?", (business_id,))}
        by_po: dict[str, dict[str, Any]] = {}
        for e in views:
            if e["record_type"] == "purchase_order":
                by_po.setdefault(e["record_id"], {})[e["type"]] = e
        po_rows = []
        for po in query("SELECT * FROM purchase_order WHERE business_id = ? AND supplier_id = ? ORDER BY number", (business_id, party_id)):
            ev = by_po.get(po["id"], {})
            arrival, pay = ev.get("INVENTORY_ARRIVAL"), ev.get("SUPPLIER_PAYMENT")
            m = materials.get(po["material_id"])
            po_rows.append([po["number"], m["name"] if m else "", qty_label(po["qty"], m), inr(po["amount_paise"]), TERMS_LABEL.get(po["terms_type"], po["terms_type"]),
                            po["ordered_date"], po["status"].title(), po["expected_arrival"] or "",
                            (arrival or {}).get("executed_date") or "", (pay or {}).get("executed_date") or ""])
        sheet.title("Purchase orders")
        sheet.table(["Order", "Material", "Quantity", "Value", "Terms", "Ordered", "Status", "Expected arrival", "Forecast arrival", "Forecast payment"],
                    po_rows, _totals_row(10, "Total", {3: inr(sum(_paise(r[3]) for r in po_rows))}) if po_rows else None, empty="No purchase orders")

    forecast_rows = [[e["label"], e["type"].replace("_", " ").title(), "In" if e["direction"] == "IN" else ("Out" if e["direction"] == "OUT" else ""),
                      inr(e["amount_paise"]) if e["amount_paise"] else "", e["due_date"] or "", e["executed_date"] or "Not within forecast",
                      e["lateness_days"] if e["lateness_days"] is not None else "", STATE_LABEL.get(e["state"], e["state"])]
                     for e in sorted(views, key=lambda e: (e["executed_day"] if e["executed_day"] is not None else 10**6, e["id"])) if e["party_id"] == party_id]
    sheet.title("In the forecast")
    sheet.table(["Event", "Type", "Direction", "Amount", "Due", "Forecast date", "Days late", "Forecast result"], forecast_rows, empty="Nothing in the forecast window")

    sheet.title("Notes")
    sheet.table(["Date", "By", "Note"], [[n.get("date", ""), n.get("by", ""), n.get("text", "")] for n in notes], empty="No notes")
    label = slug(party["name"]) if re.search(r"[A-Za-z0-9]", party["name"]) else party_id[-6:]  # names in other scripts have no ASCII slug
    return sheet.render(), f"ripple-{kind_word.lower()}-{label}-{now.isoformat()}"


def company_sheet(business_id: str) -> tuple[str, str]:
    business = query_one("SELECT * FROM business WHERE id = ?", (business_id,))
    now = today()
    sheet = Sheet()
    _header(sheet, "Company datasheet", business, business["name"])

    sheet.title("Business profile")
    sheet.kv([("Business name", business["name"]), ("Owner", business["owner_name"] or ""), ("Address", business["address"] or ""),
              ("GSTIN", business["gstin"] or ""), ("Udyam number", business["udyam_number"] or ""),
              ("MSME category", business["msme_category"] or "Not registered"), ("Business type", (business["business_type"] or "").title()),
              ("Financial year starts (MM-DD)", business["fy_start"] or "")])

    pos = position(business_id)
    run = runs.baseline(business_id)
    s = run.derived["summary"]
    sheet.title("Position today")
    sheet.kv([("Cash now", inr(pos["cash_now_paise"])), ("To receive from customers", inr(pos["to_receive_paise"])),
              ("To pay suppliers", inr(pos["to_pay_paise"])), ("Net position", inr(pos["net_paise"])),
              ("Customers owing", pos["customers_owing"]), ("Suppliers owed", pos["suppliers_owed"]),
              ("Material on the way (orders)", pos["materials_on_the_way"]["count"]), ("Material on the way (value)", inr(pos["materials_on_the_way"]["value_paise"])),
              ("Goods to deliver (orders)", pos["goods_to_deliver"]["count"]), ("Goods to deliver (value)", inr(pos["goods_to_deliver"]["value_paise"])),
              ("Cheques pending (count)", pos["pending_cheques"]["count"]), ("Cheques pending (value)", inr(pos["pending_cheques"]["value_paise"]))])

    sheet.title("Forecast")
    sheet.kv([("Forecast window (days)", s["horizon_days"]), ("Safety buffer", inr(s["buffer_paise"])),
              ("First shortfall", f"Day {s['first_shortfall']['day']} ({s['first_shortfall']['date']}), short by {inr(s['first_shortfall']['shortfall_paise'])}" if s["first_shortfall"] else "None in the window"),
              ("Buffer first breached", f"Day {s['buffer_breach']['day']} ({s['buffer_breach']['date']})" if s["buffer_breach"] else "Not breached"),
              ("Lowest net position", inr(s["lowest"]["net_paise"]) if s["lowest"] else ""),
              ("Lowest net position on", s["lowest"]["date"] if s["lowest"] else ""),
              ("Closing cash at end of window", inr(s["closing_cash_paise"])),
              ("Missed commitments", s["missed_commitment_count"]), ("Orders not delivered in window", s["unresolved_order_count"]),
              ("Orders late", len([o for o in s["late_orders"] if (o["lateness_days"] or 0) > 0]))])

    parties = query("SELECT * FROM party WHERE business_id = ? ORDER BY name", (business_id,))
    exp = exposures(business_id)
    model = delay_model(business_id)["customers"]
    cust_rows, sup_rows = [], []
    for p in parties:
        e = exp.get(p["id"], {})
        if p["kind"] == "CUSTOMER":
            m = model.get(p["id"], {})
            cust_rows.append([p["name"], p["city"] or "", p["terms_days"], inr(e.get("outstanding_paise", 0)), e.get("oldest_due") or "", e.get("max_days_overdue", 0),
                              f"{e.get('exposure_bp', 0) / 100:.1f}", m.get("n", 0), percent(m.get("on_time_share")), m.get("avg_delay_days") if m.get("avg_delay_days") is not None else ""])
        else:
            sup_rows.append([p["name"], p["city"] or "", TERMS_LABEL.get(p["terms_type"], p["terms_type"]), p["lead_time_days"], inr(e.get("outstanding_paise", 0)),
                             e.get("oldest_due") or "", e.get("max_days_overdue", 0), f"{e.get('exposure_bp', 0) / 100:.1f}", p["msme_category"] or ""])
    sheet.title("Customers")
    sheet.table(["Customer", "City", "Credit days", "Outstanding", "Oldest due", "Days overdue", "Share of receivables (%)", "Payments on record", "Paid on time (%)", "Average days late"],
                cust_rows, _totals_row(10, "Total", {3: inr(sum(_paise(r[3]) for r in cust_rows))}) if cust_rows else None, empty="No customers")
    sheet.title("Suppliers")
    sheet.table(["Supplier", "City", "Terms", "Lead time (days)", "You owe", "Oldest due", "Days overdue", "Share of payables (%)", "MSME category"],
                sup_rows, _totals_row(9, "Total", {4: inr(sum(_paise(r[4]) for r in sup_rows))}) if sup_rows else None, empty="No suppliers")

    names = {p["id"]: p["name"] for p in parties}
    open_rows = [[i["number"], "Receivable" if i["kind"] == "RECEIVABLE" else "Payable", names.get(i["party_id"], ""), i["invoice_date"], i["due_date"],
                  inr(i["amount_paise"]), inr(i["outstanding_paise"]), i["days_overdue"]] for i in open_invoices(business_id)]
    sheet.title("Open invoices")
    sheet.table(["Invoice", "Kind", "Party", "Invoice date", "Due date", "Amount", "Outstanding", "Days late"], open_rows, empty="Nothing open")

    products = {p["id"]: p["name"] for p in query("SELECT id, name FROM product WHERE business_id = ?", (business_id,))}
    results = {o.order_id: o for o in run.result.order_results}
    so_rows = []
    for so in query("SELECT * FROM sales_order WHERE business_id = ? AND stage != 'PAID' ORDER BY number", (business_id,)):
        res = results.get(so["number"])
        so_rows.append([so["number"], names.get(so["customer_id"], ""), products.get(so["product_id"], "Custom order"), so["qty"], inr(so["qty"] * so["unit_price_paise"]),
                        so["promised_date"], STAGE_LABEL.get(so["stage"], so["stage"]), res.delivery_date.isoformat() if res and res.delivery_date else "",
                        res.delivery_lateness_days if res and res.delivery_date else ""])
    sheet.title("Open sales orders")
    sheet.table(["Order", "Customer", "Product", "Quantity", "Value", "Promised", "Stage", "Forecast delivery", "Days late (forecast)"], so_rows, empty="No open orders")

    materials = {m["id"]: m for m in query("SELECT * FROM material WHERE business_id = ?", (business_id,))}
    po_rows = [[po["number"], names.get(po["supplier_id"], ""), materials.get(po["material_id"], {}).get("name", ""), qty_label(po["qty"], materials.get(po["material_id"])),
                inr(po["amount_paise"]), TERMS_LABEL.get(po["terms_type"], po["terms_type"]), po["status"].title(), po["expected_arrival"] or ""]
               for po in query("SELECT * FROM purchase_order WHERE business_id = ? AND status IN ('ORDERED','PAID') ORDER BY number", (business_id,))]
    sheet.title("Open purchase orders")
    sheet.table(["Order", "Supplier", "Material", "Quantity", "Value", "Terms", "Status", "Expected arrival"], po_rows, empty="No open purchase orders")

    inv = inventory_rows(business_id, run)
    stock_rows = [[m["sku"], m["name"], m["unit"], m["on_hand_label"], m["needed_label"], m["free_label"], m["on_the_way_label"],
                   m["days_of_cover"] if m["days_of_cover"] is not None else "", m["reorder_point_label"], m["status"].title(), inr(m["stock_value_paise"])] for m in inv["materials"]]
    sheet.title("Raw material stock")
    sheet.table(["SKU", "Material", "Unit", "On hand", "Needed for orders", "Free", "On the way", "Days of cover", "Reorder point", "Status", "Stock value"], stock_rows,
                _totals_row(11, "Total", {10: inr(inv["summary"]["stock_value_paise"])}) if stock_rows else None, empty="No materials")
    fg_rows = [[p["sku"], p["name"], p["on_hand"], p["committed"], p["in_production"], p["planned"], p["free"], p["next_delivery"] or "", inr(p["value_paise"])] for p in inv["finished"]]
    sheet.title("Finished goods")
    sheet.table(["SKU", "Product", "On hand", "Committed", "In production", "Planned", "Free", "Next delivery", "Value at cost"], fg_rows, empty="No products")

    sheet.title("Recurring expenses")
    sheet.table(["Expense", "Day of month", "Amount", "Active"],
                [[r["label"], r["day_of_month"], inr(r["amount_paise"]), "Yes" if r["active"] else "No"]
                 for r in query("SELECT * FROM recurring_expense WHERE business_id = ? ORDER BY day_of_month", (business_id,))], empty="None")
    sheet.title("Approved credit facilities")
    sheet.table(["Facility", "Limit", "Annual rate (%)", "Drawdown fee", "Available from", "Repay by"],
                [[f["label"], inr(f["approved_limit_paise"]), f"{f['annual_rate_bps'] / 100:.2f}", inr(f["drawdown_fee_paise"]), f["available_from"], f["repayment_date"]]
                 for f in query("SELECT * FROM credit_facility WHERE business_id = ?", (business_id,))], empty="None")

    sheet.title("Settings used by the forecast")
    sheet.kv([("Safety buffer", inr(business["safety_buffer_paise"])), ("Forecast window (days)", business["horizon_days"]),
              ("Default customer credit days", business["default_customer_terms_days"]), ("Default supplier credit days", business["default_supplier_terms_days"]),
              ("MSME alerts", "On" if business["msme_alerts"] else "Off")])
    label = slug(business["name"]) if re.search(r"[A-Za-z0-9]", business["name"]) else "business"
    return sheet.render(), f"ripple-company-{label}-{now.isoformat()}"
