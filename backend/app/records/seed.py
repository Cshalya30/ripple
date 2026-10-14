"""Mahalakshmi Fabrics: the synthetic persona dataset used by the demo.

Every date is an offset from the anchor day (the day the business is seeded), so
the story reads the same on any judging day. All amounts are integer paise.
The payment-delay history is synthetic and is labelled as such in the product.
"""
from __future__ import annotations

import random
import sqlite3
from datetime import date, timedelta

from ..core.db import insert

R = 100  # paise per rupee


def _d(anchor: date, offset: int) -> str:
    return (anchor + timedelta(days=offset)).isoformat()


SUPPLIERS = [
    # key, name, city, description, phone, msme, terms_type, terms_days, lead, tags, since
    ("sharma", "Sharma Yarn Mills", "Ludhiana", "Spinning mill", "+91 98000 00101", "SMALL", "CREDIT", 30, 2, ["Cotton yarn 40s"], "2021-06-01"),
    ("bhavani", "Bhavani Dyeing Works", "Tiruppur", "Dyeing and washing unit", "+91 98000 00102", "MICRO", "CREDIT", 15, 0, ["Reactive dyeing", "Fabric washing"], "2022-01-10"),
    ("gopal", "Gopal Cotton Spinners", "Coimbatore", "Yarn mill", "+91 98000 00103", "MICRO", "CREDIT", 30, 6, ["Combed cotton yarn"], "2023-03-15"),
    ("rajdhani", "Rajdhani Roadlines", "Delhi", "Freight and transport", "+91 98000 00104", None, "CREDIT", 15, 0, ["Inter-state freight"], "2022-08-01"),
    ("lakshmi", "Lakshmi Silk Threads", "Kanchipuram", "Silk yarn and zari merchant", "+91 98000 00105", "MICRO", "ADVANCE", 0, 5, ["Silk yarn", "Zari thread"], "2020-11-20"),
    ("patel", "Patel Packaging", "Ahmedabad", "Packaging supplier", "+91 98000 00106", "SMALL", "CREDIT", 45, 3, ["Packing covers", "Cartons"], "2023-07-01"),
]

CUSTOMERS = [
    # key, name, city, description, phone, terms_days, tags, since, delay history (days after due)
    ("kaveri", "Kaveri Boutique", "Mysuru", "Saree boutique", "+91 98000 00201", 30, ["Silk sarees", "Dress material"], "2024-03-01",
     [0, 0, 0, 0, 6, 9, 14, 18, 21, 22]),
    ("anand", "Anand Silk Emporium", "Bengaluru", "Retail silk shop", "+91 98000 00202", 30, ["Soft silk sarees", "Blouse pieces"], "2022-05-01",
     [0, 0, 0, -2, 0, 1, 0, 3, 0, 0, 5, 0, 2, 0, -1, 4]),
    ("mehta", "Mehta Cloth House", "Pune", "Cloth merchant", "+91 98000 00203", 15, ["Dhotis", "Cotton suiting"], "2023-01-15",
     [2, 4, 0, 6, 3, 5, 0, 7, 4, 2, 8, 3, 5, 4]),
    ("venkat", "Sri Venkateswara Textiles", "Hyderabad", "Wholesale shop", "+91 98000 00204", 30, ["Cotton sarees", "Dhotis"], "2021-09-01",
     [0, 2, 1, 0, 5, 3, 0, 4, 2, 6, 0, 1, 3, 0, 7, 2, 4, 0, 3, 5]),
    ("meenakshi", "Meenakshi Sarees", "Madurai", "Saree showroom", "+91 98000 00205", 30, ["Cotton sarees"], "2022-10-01",
     [3, 5, 8, 2, 6, 4, 10, 5, 3, 7, 6, 4, 9, 2, 5]),
    ("fashion", "Fashion Junction", "Kochi", "Garment store", "+91 98000 00206", 30, ["Dress material"], "2023-06-01",
     [4, 8, 6, 10, 3, 7, 12, 5, 9, 4, 6, 8]),
    ("rohini", "Rohini Boutique", "Hubballi", "Boutique", "+91 98000 00207", 30, ["Cotton sarees"], "2024-01-10",
     [6, 10, 4, 12, 8, 15, 5, 9, 7]),
    ("gupta", "Gupta Garments", "Jaipur", "Garment wholesaler", "+91 98000 00208", 45, ["Dress material"], None, []),
]

MATERIALS = [
    # key, sku, name, unit, base_unit, factor, supplier, avg cost per display unit (rupees), on hand (base units)
    ("cotton", "RM-YRN-C40", "Cotton yarn 40s combed", "kg", "g", 1000, "sharma", 280, 95_000),
    ("silk", "RM-YRN-SLK", "Mulberry silk yarn 20/22D", "kg", "g", 1000, "lakshmi", 5200, 12_000),
    ("zari", "RM-THR-ZRI", "Half-fine zari thread", "kg", "g", 1000, "lakshmi", 9000, 1_500),
    ("dye", "RM-DYE-MRN", "Reactive dye, maroon", "kg", "g", 1000, "bhavani", 850, 9_000),
    ("cover", "RM-PKG-CVR", "Packing cover", "pc", "pc", 1, "patel", 6, 450),
    ("carton", "RM-PKG-CTN", "Carton, 5-ply", "pc", "pc", 1, "patel", 42, 120),
]

PRODUCTS = [
    # key, sku, name, variant, cost per piece, days, price, recipe [(material, qty per piece base units, wastage bp)]
    ("cs", "FG-CS-001", "Cotton saree, plain border", {"length": "6.0 m", "colour": "Maroon"}, 310, 4, 780,
     [("cotton", 620, 600), ("dye", 30, 0), ("cover", 1, 0)]),
    ("ss", "FG-SS-002", "Soft silk saree, zari border", {"length": "6.2 m", "design": "Temple border"}, 1450, 7, 5200,
     [("silk", 450, 500), ("zari", 60, 300), ("cover", 1, 0)]),
    ("dm", "FG-DM-003", "Dress material, 3-piece cotton", {"pieces": "3", "colour": "Assorted"}, 180, 3, 650,
     [("cotton", 480, 600), ("dye", 20, 0), ("cover", 1, 0)]),
    ("dh", "FG-DH-004", "Dhoti, 4 m", {"length": "4.0 m", "colour": "Off-white"}, 95, 2, 320,
     [("cotton", 350, 400), ("cover", 1, 0)]),
]

# number, customer, product, qty, price, order offset, earliest start offset, promised offset, priority, terms override
SALES_ORDERS = [
    ("SO-0109", "gupta", "dm", 120, 650, -6, 20, 40, 5, None),
    ("SO-0111", "anand", "ss", 20, 5200, -4, 3, 47, 5, 45),
    ("SO-0112", "venkat", "cs", 80, 780, -3, 0, 27, 5, None),
    ("SO-0113", "mehta", "dh", 150, 320, -2, 0, 22, 5, None),
    ("SO-0114", "fashion", "dm", 90, 650, -1, 10, 42, 5, None),
    ("SO-0115", "rohini", "cs", 70, 850, 0, 15, 48, 5, None),
]

# Open receivables: number, customer, description, amount, invoice offset, due offset, promised offset, part-paid today
RECEIVABLES = [
    ("INV-0398", "kaveri", "Silk sarees x24", 145_000, -42, -12, 41, 0),
    ("INV-0405", "anand", "Soft silk sarees x16", 85_000, -25, 5, None, 0),
    ("INV-0407", "mehta", "Dhotis x200", 62_000, -1, 14, None, 0),
    ("INV-0412", "venkat", "Cotton sarees x220", 170_000, -8, 22, None, 50_000),
    ("INV-0414", "meenakshi", "Cotton sarees x100", 78_000, -3, 27, None, 0),
    ("INV-0416", "fashion", "Dress material x140", 90_000, -5, 45, None, 0),
    ("INV-0418", "rohini", "Cotton sarees x120", 96_000, -3, 58, None, 0),
    ("INV-0419", "gupta", "Dress material x170", 110_000, -2, 74, None, 0),
]

# Open payables: number, supplier, description, amount, bill offset, due offset
PAYABLES = [
    ("RRL/1188", "rajdhani", "Freight, September dispatches", 38_000, -12, 3),
    ("BDW/0763", "bhavani", "Dyeing, 1,400 m", 95_000, 5, 20),
    ("GCS/5521", "gopal", "Combed cotton yarn 560 kg", 160_000, 20, 50),
    ("SYM/2207", "sharma", "Cotton yarn 40s, 1,250 kg", 352_000, 4, 34),
    ("LST/0342", "lakshmi", "Zari thread and silk yarn", 40_000, -10, 52),
    ("PPK/2290", "patel", "Packing covers and cartons", 24_000, 26, 71),
]

# Purchase orders: number, supplier, material, qty (base units), amount, ordered, arrival, payment due, terms, release-after payable
PURCHASE_ORDERS = [
    ("PO-0118", "gopal", "cotton", 120_000, 33_600, -4, 2, None, "CREDIT", None),
    ("PO-0119", "lakshmi", "silk", 10_000, 52_000, -1, None, 12, "ADVANCE", None),
    ("PO-0120", "patel", "cover", 600, 3_600, -2, 5, None, "CREDIT", None),
    ("PO-0121", "sharma", "cotton", 400_000, 112_000, -2, None, None, "CREDIT", "SYM/2207"),
]

TARGET_CASH = 230_000


def seed_business(
    conn: sqlite3.Connection,
    business_id: str,
    anchor: date,
    *,
    is_sandbox: bool = False,
    name: str = "Mahalakshmi Fabrics",
) -> None:
    rng = random.Random(2214)
    insert(conn, "business", {
        "id": business_id,
        "name": name,
        "owner_name": "Meera Sundaram",
        "address": "14 Weavers Street, Erode, Tamil Nadu 638001",
        "gstin": "33AAJFM4721K1Z8",
        "udyam_number": "UDYAM-TN-08-0012345",
        "msme_category": "MICRO",
        "safety_buffer_paise": 50_000 * R,
        "default_customer_terms_days": 30,
        "default_supplier_terms_days": 30,
        "horizon_days": 90,
        "opening_balance_paise": 0,
        "is_sandbox": is_sandbox,
    })

    ids: dict[str, str] = {}

    def pid(key: str) -> str:
        return ids[key]

    for key, name_, city, desc, phone, msme, terms_type, terms_days, lead, tags, since in SUPPLIERS:
        ids[key] = f"{business_id}:p:{key}"
        insert(conn, "party", {
            "id": ids[key], "business_id": business_id, "kind": "SUPPLIER", "name": name_, "city": city,
            "description": desc, "phone": phone, "gstin": None, "udyam_number": f"UDYAM-XX-00-{rng.randint(1000000, 9999999)}" if msme else None,
            "msme_category": msme, "terms_type": terms_type, "terms_days": terms_days, "lead_time_days": lead,
            "tags_json": tags, "notes_json": [], "since": since,
        })
    for key, name_, city, desc, phone, terms_days, tags, since, _ in CUSTOMERS:
        ids[key] = f"{business_id}:p:{key}"
        notes = []
        if key == "kaveri":
            notes = [{"text": "Pays after Dussehra stock clears. Promised to settle INV-0398 by " + _human(anchor + timedelta(days=41)) + ".",
                      "by": "Meera", "date": _d(anchor, -41)}]
        insert(conn, "party", {
            "id": ids[key], "business_id": business_id, "kind": "CUSTOMER", "name": name_, "city": city,
            "description": desc, "phone": phone, "gstin": f"{rng.choice(['29', '27', '36', '33', '32', '08'])}AABC{key.upper()[:1]}{rng.randint(1000, 9999)}F1Z{rng.randint(1, 9)}",
            "udyam_number": None, "msme_category": None, "terms_type": "CREDIT", "terms_days": terms_days, "lead_time_days": 0,
            "tags_json": tags, "notes_json": notes, "since": since or _d(anchor, -60),
        })

    for key, sku, mname, unit, base, factor, sup, cost, on_hand in MATERIALS:
        ids["m:" + key] = f"{business_id}:m:{key}"
        insert(conn, "material", {
            "id": ids["m:" + key], "business_id": business_id, "sku": sku, "name": mname, "unit": unit, "base_unit": base,
            "unit_factor": factor, "reorder_safety_days": 7, "primary_supplier_id": pid(sup), "avg_cost_paise": cost * R,
        })

    for key, sku, pname, variant, cost, days, price, recipe in PRODUCTS:
        ids["f:" + key] = f"{business_id}:f:{key}"
        insert(conn, "product", {
            "id": ids["f:" + key], "business_id": business_id, "sku": sku, "name": pname, "variant_json": variant,
            "production_cost_paise": cost * R, "production_days": days, "unit_price_paise": price * R,
        })
        for index, (mat, qty, wastage) in enumerate(recipe):
            insert(conn, "recipe_line", {
                "id": f"{ids['f:' + key]}:r{index}", "business_id": business_id, "product_id": ids["f:" + key],
                "material_id": ids["m:" + mat], "qty_per_piece": qty, "wastage_bp": wastage,
            })

    _seed_stock(conn, business_id, anchor, ids, rng)

    for number, cust, prod, qty, price, ordered, earliest, promised, priority, terms in SALES_ORDERS:
        insert(conn, "sales_order", {
            "id": f"{business_id}:so:{number}", "business_id": business_id, "number": number, "customer_id": pid(cust),
            "product_id": ids["f:" + prod], "qty": qty, "unit_price_paise": price * R, "order_date": _d(anchor, ordered),
            "earliest_start_date": _d(anchor, earliest), "promised_date": _d(anchor, promised), "priority": priority,
            "stage": "PLANNED", "deposit_paise": 0, "collection_terms_days": terms,
        })

    invoice_ids: dict[str, str] = {}
    txn_rows: list[dict] = []
    for number, cust, desc, amount, inv_off, due_off, promised_off, part_paid in RECEIVABLES:
        invoice_ids[number] = f"{business_id}:inv:{number}"
        insert(conn, "invoice", {
            "id": invoice_ids[number], "business_id": business_id, "kind": "RECEIVABLE", "party_id": pid(cust),
            "number": number, "description": desc, "amount_paise": amount * R, "invoice_date": _d(anchor, inv_off),
            "due_date": _d(anchor, due_off), "promised_date": _d(anchor, promised_off) if promised_off is not None else None,
            "status": "PART_PAID" if part_paid else "OPEN",
        })
        if part_paid:
            txn_rows.append({"party_id": pid(cust), "direction": "IN", "amount_paise": part_paid * R, "date": _d(anchor, 0),
                             "medium": "UPI", "reference": "447120998182", "invoice_id": invoice_ids[number], "details": f"{number} part payment"})

    for number, sup, desc, amount, bill_off, due_off in PAYABLES:
        invoice_ids[number] = f"{business_id}:inv:{number.replace('/', '-')}"
        insert(conn, "invoice", {
            "id": invoice_ids[number], "business_id": business_id, "kind": "PAYABLE", "party_id": pid(sup),
            "number": number, "description": desc, "amount_paise": amount * R, "invoice_date": _d(anchor, min(bill_off, -1)),
            "due_date": _d(anchor, due_off), "status": "OPEN",
        })

    for number, sup, mat, qty, amount, ordered, arrival, pay_due, terms, release in PURCHASE_ORDERS:
        insert(conn, "purchase_order", {
            "id": f"{business_id}:po:{number}", "business_id": business_id, "number": number, "supplier_id": pid(sup),
            "material_id": ids["m:" + mat], "qty": qty, "amount_paise": amount * R, "ordered_date": _d(anchor, ordered),
            "expected_arrival": _d(anchor, arrival) if arrival is not None else None,
            "payment_due": _d(anchor, pay_due) if pay_due is not None else None, "terms_type": terms,
            "release_after_invoice_id": invoice_ids[release] if release else None, "status": "ORDERED",
        })

    txn_rows.extend(_history(business_id, anchor, ids, rng, conn))
    insert(conn, "recurring_expense", {"id": f"{business_id}:rx:rent", "business_id": business_id, "label": "Rent and wages",
                                       "amount_paise": 40_000 * R, "day_of_month": 15, "active": 1})
    insert(conn, "recurring_expense", {"id": f"{business_id}:rx:power", "business_id": business_id, "label": "Electricity",
                                       "amount_paise": 6_000 * R, "day_of_month": 7, "active": 1})
    insert(conn, "credit_facility", {
        "id": f"{business_id}:cf:od", "business_id": business_id, "label": "Canara Bank overdraft (approved)",
        "approved_limit_paise": 2_00_000 * R, "annual_rate_bps": 1150, "drawdown_fee_paise": 1_500 * R,
        "available_from": _d(anchor, 0), "repayment_date": _d(anchor, 80),
    })

    txn_rows.sort(key=lambda row: (row["date"], row["direction"]))
    net = 0
    for index, row in enumerate(txn_rows):
        net += row["amount_paise"] if row["direction"] == "IN" else -row["amount_paise"]
        insert(conn, "txn", {"id": f"{business_id}:t:{index:04d}", "business_id": business_id, "status": "CLEARED", **row})
    first_date = txn_rows[0]["date"] if txn_rows else _d(anchor, 0)
    opening = TARGET_CASH * R - net
    conn.execute(
        "UPDATE business SET opening_balance_paise = ?, opening_balance_date = ? WHERE id = ?",
        (opening, (date.fromisoformat(first_date) - timedelta(days=1)).isoformat(), business_id),
    )


def _human(day: date) -> str:
    return f"{day.day} {day.strftime('%b')}"


def _seed_stock(conn, business_id: str, anchor: date, ids: dict, rng: random.Random) -> None:
    rows = []
    # Last 30 days of real-looking use so average daily use and cover have history.
    usage = {"cotton": [(-27, 61_000), (-20, 54_000), (-13, 58_000), (-6, 49_000)],
             "silk": [(-22, 6_800), (-9, 7_400)], "zari": [(-22, 900), (-9, 1_000)],
             "dye": [(-27, 2_400), (-20, 2_100), (-13, 2_600), (-6, 1_900)],
             "cover": [(-27, 180), (-20, 160), (-13, 170), (-6, 150)]}
    arrivals = {"cotton": [(-29, 200_000)], "silk": [(-25, 15_000)], "zari": [(-25, 2_000)], "dye": [(-28, 8_000)], "cover": [(-28, 600)]}
    for key, _sku, _name, _unit, _base, _factor, _sup, _cost, on_hand in MATERIALS:
        mid = ids["m:" + key]
        used = sum(q for _, q in usage.get(key, []))
        arrived = sum(q for _, q in arrivals.get(key, []))
        opening = on_hand + used - arrived
        rows.append((mid, "MATERIAL", opening, "ADJUSTMENT", "Opening stock count", -45))
        for off, qty in arrivals.get(key, []):
            rows.append((mid, "MATERIAL", qty, "PURCHASE_ARRIVAL", "Purchase arrival", off))
        for off, qty in usage.get(key, []):
            rows.append((mid, "MATERIAL", -qty, "PRODUCTION_USE", "Production", off))
    finished = {"cs": 12, "ss": 3, "dm": 0, "dh": 18}
    for key, qty in finished.items():
        if qty:
            rows.append((ids["f:" + key], "PRODUCT", qty, "ADJUSTMENT", "Opening stock count", -45))
    for index, (item_id, item_type, qty, reason, note, off) in enumerate(rows):
        insert(conn, "stock_movement", {
            "id": f"{business_id}:mv:{index:04d}", "business_id": business_id, "item_type": item_type, "item_id": item_id,
            "qty_delta": qty, "reason": reason, "ref": None, "note": note, "user_id": None, "date": _d(anchor, off),
        })


MEDIUMS = ["UPI", "NEFT", "NEFT", "RTGS", "IMPS", "UPI", "CHEQUE"]


def _history(business_id: str, anchor: date, ids: dict, rng: random.Random, conn) -> list[dict]:
    """Synthetic paid invoices (the delay history the risk engine samples) and supplier payments."""
    txns: list[dict] = []
    for key, _name, _city, _desc, _phone, terms, _tags, _since, delays in CUSTOMERS:
        count = len(delays)
        for index, delay in enumerate(delays):
            # Spread invoices across the last ~13 months, oldest first.
            due_off = -400 + int((index + 0.5) * (360 / max(count, 1))) + rng.randint(-6, 6)
            due_off = min(due_off, -45)
            paid_off = min(due_off + delay, -2)
            amount = rng.randrange(40_000, 160_000, 500)
            number = f"INV-H{key[:3].upper()}{index + 1:02d}"
            inv_id = f"{business_id}:inv:{number}"
            insert(conn, "invoice", {
                "id": inv_id, "business_id": business_id, "kind": "RECEIVABLE", "party_id": ids[key], "number": number,
                "description": "Delivered goods", "amount_paise": amount * R, "invoice_date": _d(anchor, due_off - terms),
                "due_date": _d(anchor, due_off), "status": "PAID", "paid_date": _d(anchor, paid_off),
            })
            medium = rng.choice(MEDIUMS)
            txns.append({"party_id": ids[key], "direction": "IN", "amount_paise": amount * R, "date": _d(anchor, paid_off),
                         "medium": medium, "reference": _ref(medium, rng), "invoice_id": inv_id, "details": f"{number}"})
    for key, *_rest in SUPPLIERS:
        for month in range(12, 0, -1):
            off = -month * 30 + rng.randint(-5, 5)
            amount = {"sharma": (150_000, 260_000), "bhavani": (40_000, 80_000), "gopal": (60_000, 120_000),
                      "rajdhani": (12_000, 30_000), "lakshmi": (30_000, 70_000), "patel": (8_000, 18_000)}[key]
            value = rng.randrange(amount[0], amount[1], 500)
            medium = rng.choice(["NEFT", "RTGS", "UPI", "NEFT"])
            txns.append({"party_id": ids[key], "direction": "OUT", "amount_paise": value * R, "date": _d(anchor, off),
                         "medium": medium, "reference": _ref(medium, rng), "invoice_id": None, "details": "Bill payment"})
    for month in range(12, 0, -1):
        txns.append({"party_id": None, "direction": "OUT", "amount_paise": 40_000 * R, "date": _d(anchor, -month * 30 + 1),
                     "medium": "NEFT", "reference": _ref("NEFT", rng), "invoice_id": None, "details": "Rent and wages"})
        txns.append({"party_id": None, "direction": "IN", "amount_paise": rng.randrange(20_000, 45_000, 500) * R,
                     "date": _d(anchor, -month * 30 + 12), "medium": "CASH", "reference": None, "invoice_id": None,
                     "details": "Counter sales"})
    return txns


def _ref(medium: str, rng: random.Random) -> str | None:
    if medium == "CASH":
        return None
    if medium == "CHEQUE":
        return f"{rng.randint(100000, 999999)}"
    if medium == "UPI":
        return f"{rng.randint(10**11, 10**12 - 1)}"
    return f"{medium[0]}{rng.randint(10**9, 10**10 - 1)}"
