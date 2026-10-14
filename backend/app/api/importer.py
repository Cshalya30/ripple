"""Parse an uploaded Excel/CSV ledger into validated parties.

Column names are matched loosely, so the Ripple template
(``Party name, Type, Phone, Item, Qty, Bill amount, Received / Paid, Bill date, Due date``)
and common variants (``name, type, total_amount, amount_paid, due_date`` ...) both work.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta

from pydantic import ValidationError

from . import config
from .models import PartyIn

FIELD_SYNONYMS: dict[str, tuple[str, ...]] = {
    "name": ("party name", "name", "party", "customer name", "supplier name", "business name"),
    "type": ("type", "customer or supplier", "kind", "party type", "category"),
    "phone": ("phone", "mobile", "phone number", "mobile number", "contact", "whatsapp"),
    "products": ("item", "items", "product", "products", "product(s)", "goods"),
    "quantity": ("qty", "quantity", "units"),
    "total": ("bill amount", "total amount", "total", "amount", "bill", "invoice amount"),
    "paid": ("received / paid", "received/paid", "amount paid", "paid", "received", "settled", "paid amount"),
    "tx_date": ("bill date", "transaction date", "sale date", "supply date", "sale or supply date", "date", "invoice date"),
    "due_date": ("due date", "payment due date", "due"),
    "details": ("details", "address", "shop", "business"),
    "city": ("city", "place", "location", "town"),
}
CUSTOMER_WORDS = {"customer", "c", "cust", "debtor", "buyer", "receivable"}
SUPPLIER_WORDS = {"supplier", "s", "sup", "vendor", "creditor", "seller", "payable"}


class UploadError(ValueError):
    pass


def _norm(header: object) -> str:
    return re.sub(r"\s+", " ", str(header or "").replace("_", " ").strip().lower())


def _map_headers(headers: list[object]) -> dict[str, int]:
    normalised = [_norm(h) for h in headers]
    mapping: dict[str, int] = {}
    for field, names in FIELD_SYNONYMS.items():
        for name in names:
            if name in normalised and normalised.index(name) not in mapping.values():
                mapping[field] = normalised.index(name)
                break
    missing = [f for f in ("name", "type", "total") if f not in mapping]
    if missing:
        raise UploadError(
            "Couldn't find these columns: " + ", ".join(missing) + ". Download the template to see the expected headers."
        )
    return mapping


def _amount(value: object) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[₹,\s]|rs\.?|inr", "", str(value), flags=re.IGNORECASE)
    return float(cleaned)


def _quantity(value: object) -> float:
    """'800 m', '1,500 kg', '24 pcs' -> the number. Units are dropped."""
    if value is None or value == "":
        return 1.0
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"\d[\d,]*(?:\.\d+)?", str(value))
    if not match:
        raise ValueError(f"unreadable quantity '{str(value)[:20]}'")
    return float(match.group(0).replace(",", ""))


def _date(value: object, default: date) -> date:
    if value is None or value == "":
        return default
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):  # Excel serial date
        return date(1899, 12, 30) + timedelta(days=int(value))
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unreadable date '{text[:20]}'")


def _kind(value: object) -> str:
    word = _norm(value)
    if word in CUSTOMER_WORDS:
        return "customer"
    if word in SUPPLIER_WORDS:
        return "supplier"
    raise ValueError(f"type must be Customer or Supplier, got '{str(value)[:20]}'")


def _rows_from_file(filename: str, data: bytes) -> list[list[object]]:
    lower = filename.lower()
    if lower.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        return [row for row in csv.reader(io.StringIO(text))]
    if lower.endswith((".xlsx", ".xlsm")):
        try:
            from openpyxl import load_workbook
        except ImportError as exc:  # pragma: no cover - dependency is in requirements.txt
            raise UploadError("Excel support is not installed on the server. Upload a CSV instead.") from exc
        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:
            raise UploadError("That Excel file couldn't be opened. Save it again as .xlsx or .csv.") from exc
        ws = wb.worksheets[0]
        rows = [list(r) for r, _ in zip(ws.iter_rows(values_only=True), range(config.MAX_IMPORT_ROWS + 50))]
        wb.close()
        return rows
    raise UploadError("Only .xlsx and .csv files are supported. Save older .xls files as .xlsx.")


def parse_upload(filename: str, data: bytes) -> tuple[list[PartyIn], list[dict]]:
    """Return (valid parties, skipped rows with reasons)."""
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise UploadError("File is too large. The limit is 2 MB.")
    rows = [r for r in _rows_from_file(filename, data) if any(c not in (None, "") for c in r)]
    if not rows:
        raise UploadError("The file is empty.")
    mapping = _map_headers(rows[0])
    body = rows[1:]
    if len(body) > config.MAX_IMPORT_ROWS:
        raise UploadError(f"Import at most {config.MAX_IMPORT_ROWS} rows at a time.")

    today = config.today()
    parties: list[PartyIn] = []
    skipped: list[dict] = []
    for line_no, row in enumerate(body, start=2):
        def cell(field: str) -> object:
            idx = mapping.get(field)
            return row[idx] if idx is not None and idx < len(row) else None

        try:
            kind = _kind(cell("type"))
            tx_date = _date(cell("tx_date"), today)
            due = _date(cell("due_date"), tx_date + timedelta(days=30))
            products_raw = str(cell("products") or "General goods")
            details_parts = [str(v).strip() for v in (cell("details"), cell("city")) if v not in (None, "")]
            parties.append(
                PartyIn(
                    kind=kind,
                    name=str(cell("name") or ""),
                    phone=str(cell("phone") or ""),
                    details=", ".join(details_parts) or ("Imported customer" if kind == "customer" else "Imported supplier"),
                    products=[p for p in products_raw.split(",")],
                    quantity=_quantity(cell("quantity")),
                    totalAmount=_amount(cell("total")),
                    paidAmount=_amount(cell("paid")),
                    transactionDate=tx_date,
                    dueDate=due,
                )
            )
        except ValidationError as exc:
            reasons = "; ".join(f"{'/'.join(str(p) for p in e['loc']) or 'row'}: {e['msg']}" for e in exc.errors())
            skipped.append({"row": line_no, "reason": reasons})
        except (ValueError, TypeError) as exc:
            skipped.append({"row": line_no, "reason": str(exc)})
    return parties, skipped
