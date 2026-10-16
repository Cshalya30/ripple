"""Bounded CSV normalization for the setup import flow."""
from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta
from dataclasses import dataclass

from ..intake.schemas import (
    BusinessFacts,
    CollectionStatus,
    CustomerOrderFact,
    ExpenseFact,
    InventoryFact,
    Money,
    ReceivableFact,
    SupplierPurchaseFact,
)

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 2000


class CsvImportError(ValueError):
    pass


@dataclass(frozen=True)
class CsvPreview:
    facts: BusinessFacts
    format: str
    rows: int
    warnings: list[str]
    errors: list[dict[str, str]]


def _norm(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def _money(value: object) -> Money | None:
    text = str(value or "").strip()
    if not text:
        return None
    cleaned = re.sub(r"[₹,\s]|rs\.?|inr", "", text, flags=re.IGNORECASE)
    try:
        amount = float(cleaned)
    except ValueError as exc:
        raise CsvImportError(f"invalid amount '{text[:30]}'") from exc
    if amount < 0:
        raise CsvImportError("amount cannot be negative")
    return Money(amount=cleaned)


def _date(value: object, default: date) -> date:
    text = str(value or "").strip()
    if not text:
        return default
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y", "%Y/%m/%d"):
        try:
            parsed = datetime.strptime(text, fmt).date()
            if not date(2000, 1, 1) <= parsed <= date(2100, 12, 31):
                raise CsvImportError("date must be between 2000 and 2100")
            return parsed
        except ValueError:
            continue
    raise CsvImportError(f"invalid date '{text[:30]}'")


def _quantity(value: object) -> int:
    text = str(value or "").strip()
    if not text:
        return 1
    match = re.search(r"\d[\d,]*(?:\.\d+)?", text)
    if not match:
        raise CsvImportError(f"invalid quantity '{text[:30]}'")
    number = float(match.group(0).replace(",", ""))
    if number <= 0 or not number.is_integer():
        raise CsvImportError("quantity must be a positive whole number")
    return int(number)


def _kind(value: object) -> str:
    kind = _norm(value)
    if kind in {"customer", "c", "cust", "debtor", "buyer", "receivable"}:
        return "CUSTOMER"
    if kind in {"supplier", "s", "sup", "vendor", "creditor", "seller", "payable"}:
        return "SUPPLIER"
    raise CsvImportError("type must be Customer or Supplier")


def _field(row: dict[str, str], *names: str) -> str:
    for name in names:
        if name in row and row[name].strip():
            return row[name].strip()
    return ""


def _canonical_row(raw: dict[str | None, str | None]) -> dict[str, str]:
    return {_norm(key): str(value or "").strip() for key, value in raw.items() if key is not None}


def parse_csv(filename: str, data: bytes, as_of: date) -> CsvPreview:
    if len(data) > MAX_BYTES:
        raise CsvImportError("File is too large. The limit is 2 MB.")
    if not filename.lower().endswith(".csv"):
        raise CsvImportError("Upload a .csv file.")
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise CsvImportError("The CSV needs a header row.")
    headers = {_norm(header) for header in reader.fieldnames if header}
    legacy = {"party name", "type", "bill amount"}.issubset(headers)
    structured = "record type" in headers or "opening cash" in headers or "business name" in headers
    if not legacy and not structured:
        raise CsvImportError("Use the Ripple template or the ledger headers: Party name, Type, Bill amount.")

    facts = BusinessFacts(
        opening_cash=Money(amount="0"),
        inventory_status=CollectionStatus.CONFIRMED_COMPLETE,
        supplier_purchases_status=CollectionStatus.CONFIRMED_COMPLETE,
        customer_orders_status=CollectionStatus.CONFIRMED_COMPLETE,
        existing_receivables_status=CollectionStatus.CONFIRMED_COMPLETE,
        facilities_status=CollectionStatus.CONFIRMED_COMPLETE,
    )
    warnings: list[str] = []
    errors: list[dict[str, str]] = []
    saw_cash = False
    row_count = 0
    for line, raw in enumerate(reader, start=2):
        row_count += 1
        if row_count > MAX_ROWS:
            raise CsvImportError(f"Import at most {MAX_ROWS} rows at a time.")
        row = _canonical_row(raw)
        if not any(row.values()):
            continue
        try:
            business_name = _field(row, "business name")
            cash = _field(row, "opening cash", "cash", "opening balance")
            if business_name:
                facts.business_name = business_name
            if cash:
                facts.opening_cash = _money(cash)
                saw_cash = True
            if legacy or _field(row, "record type").lower() in {"", "ledger", "transaction"}:
                name = _field(row, "party name", "name", "party", "customer name", "supplier name")
                kind = _kind(_field(row, "type", "kind", "party type"))
                amount = _money(_field(row, "bill amount", "total amount", "total", "amount"))
                if not name or amount is None:
                    raise CsvImportError("party name and bill amount are required")
                paid = _money(_field(row, "received paid", "received / paid", "amount paid", "paid", "received"))
                outstanding = max(float(amount.amount) - float(paid.amount if paid else "0"), 0)
                due = _date(_field(row, "due date", "payment due date", "due"), as_of + timedelta(days=30))
                reference = _field(row, "reference", "invoice", "invoice number", "bill number") or f"CSV-{line}"
                if outstanding <= 0:
                    continue
                money = Money(amount=f"{outstanding:.2f}".rstrip("0").rstrip("."))
                if kind == "CUSTOMER":
                    facts.existing_receivables.append(ReceivableFact(source_reference=reference, customer=name, amount=money, expected_collection_date=due))
                else:
                    facts.supplier_purchases.append(SupplierPurchaseFact(source_reference=reference, supplier=name, outstanding_payment=money, contractual_due_date=due))
                continue

            record_type = _norm(_field(row, "record type"))
            name = _field(row, "party name", "party", "customer", "supplier", "customer name", "supplier name")
            if record_type in {"business", "company"}:
                continue
            if record_type in {"inventory", "stock"}:
                facts.opening_inventory.append(InventoryFact(material_reference=_field(row, "item", "material", "sku"),
                    material_name=_field(row, "item", "material", "sku"), quantity=_quantity(_field(row, "quantity", "qty")), unit=_field(row, "unit") or "unit"))
            elif record_type in {"expense", "scheduled expense"}:
                amount = _money(_field(row, "amount", "bill amount", "total"))
                if amount is None:
                    raise CsvImportError("expense amount is required")
                facts.expenses.append(ExpenseFact(source_reference=_field(row, "reference") or f"CSV-{line}",
                    description=_field(row, "description", "label") or "Imported expense", amount=amount,
                    due_date=_date(_field(row, "due date", "date"), as_of)))
            elif record_type in {"receivable", "invoice"}:
                amount = _money(_field(row, "amount", "bill amount", "total"))
                if amount is None or not name:
                    raise CsvImportError("customer and amount are required")
                facts.existing_receivables.append(ReceivableFact(source_reference=_field(row, "reference", "invoice") or f"CSV-{line}",
                    customer=name, amount=amount, expected_collection_date=_date(_field(row, "due date", "date"), as_of + timedelta(days=30))))
            elif record_type in {"purchase", "supplier"}:
                amount = _money(_field(row, "amount", "bill amount", "total"))
                if amount is None or not name:
                    raise CsvImportError("supplier and amount are required")
                facts.supplier_purchases.append(SupplierPurchaseFact(source_reference=_field(row, "reference", "invoice") or f"CSV-{line}",
                    supplier=name, outstanding_payment=amount, contractual_due_date=_date(_field(row, "due date", "date"), as_of + timedelta(days=30))))
            elif record_type in {"order", "customer order"}:
                amount = _money(_field(row, "amount", "bill amount", "total"))
                if amount is None or not name:
                    raise CsvImportError("customer and amount are required")
                facts.customer_orders.append(CustomerOrderFact(source_reference=_field(row, "reference", "order") or f"CSV-{line}",
                    order_reference=_field(row, "reference", "order") or f"CSV-{line}", customer=name,
                    outstanding_collection=amount, promised_delivery_date=_date(_field(row, "due date", "date"), as_of)))
            else:
                raise CsvImportError("record type must be inventory, purchase, receivable, order, or expense")
        except (CsvImportError, ValueError) as exc:
            errors.append({"row": str(line), "message": str(exc)})
    if not saw_cash:
        warnings.append("Opening cash was not provided, so it will be imported as ₹0.")
    if not row_count:
        raise CsvImportError("The CSV has no data rows.")
    return CsvPreview(facts=facts, format="ledger" if legacy else "structured", rows=row_count, warnings=warnings, errors=errors)
