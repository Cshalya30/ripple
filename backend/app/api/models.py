"""Request/response models for the Ripple API.

Field names are camelCase on the wire so they match ``frontend/src/types``
without any mapping on the client.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
MIN_DATE = date(2000, 1, 1)
MAX_DATE = date(2100, 12, 31)
MAX_AMOUNT = 10_000_000_000  # ₹1,000 crore per bill is plenty for a small business
MAX_QUANTITY = 1_000_000_000


def _clean_text(value: str, field: str, max_len: int) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"{field} can't be empty")
    if len(value) > max_len:
        raise ValueError(f"{field} can be at most {max_len} characters")
    if _CONTROL_CHARS.search(value):
        raise ValueError(f"{field} contains invalid characters")
    return value


def normalise_phone(value: str) -> str:
    """Accepts '+91 98765 43210', '9876543210', '919876543210'; returns '+91 98765 43210'."""
    value = value.strip()
    if len(value) > 20:
        raise ValueError("Enter a 10-digit mobile number")
    digits = re.sub(r"\D", "", value)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) != 10:
        raise ValueError("Enter a 10-digit mobile number")
    return f"+91 {digits[:5]} {digits[5:]}"


class PartyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["customer", "supplier"]
    name: str
    phone: str
    details: str
    products: list[str] = Field(min_length=1, max_length=10)
    quantity: float
    totalAmount: float
    paidAmount: float
    transactionDate: date
    dueDate: date

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_text(v, "Name", 80)

    @field_validator("details")
    @classmethod
    def _details(cls, v: str) -> str:
        return _clean_text(v, "Details", 120)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalise_phone(v)

    @field_validator("products")
    @classmethod
    def _products(cls, v: list[str]) -> list[str]:
        cleaned = [_clean_text(p, "Product", 60) for p in v if p and p.strip()]
        if not cleaned:
            raise ValueError("Add at least one product")
        return cleaned

    @field_validator("quantity")
    @classmethod
    def _quantity(cls, v: float) -> float:
        if not math.isfinite(v) or v <= 0:
            raise ValueError("Quantity must be more than 0")
        if v > MAX_QUANTITY:
            raise ValueError("Quantity is too large")
        return v

    @field_validator("totalAmount", "paidAmount")
    @classmethod
    def _amount(cls, v: float) -> float:
        if not math.isfinite(v) or v < 0:
            raise ValueError("Amount can't be negative")
        if v > MAX_AMOUNT:
            raise ValueError("Amount is too large")
        return v

    @field_validator("transactionDate", "dueDate")
    @classmethod
    def _date_range(cls, v: date) -> date:
        if not (MIN_DATE <= v <= MAX_DATE):
            raise ValueError("Date is out of range")
        return v

    @model_validator(mode="after")
    def _consistency(self) -> "PartyIn":
        if round(self.totalAmount) <= 0:
            raise ValueError("Total amount must be more than ₹0")
        if self.paidAmount > self.totalAmount:
            raise ValueError("Amount paid can't be more than the total")
        if self.dueDate < self.transactionDate:
            raise ValueError("Due date can't be before the sale or supply date")
        return self

    def to_record(self) -> dict:
        return {
            "kind": self.kind,
            "name": self.name,
            "phone": self.phone,
            "details": self.details,
            "products": self.products,
            "quantity": self.quantity,
            "total_amount": round(self.totalAmount),
            "paid_amount": round(self.paidAmount),
            "transaction_date": self.transactionDate,
            "due_date": self.dueDate,
        }


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parties: list[PartyIn] = Field(min_length=1, max_length=200)


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=1000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=10)
    language: str = Field(default="en", max_length=5)


# ── formatting (mirrors frontend/src/lib/format.ts) ───────────────────────

MINUS = "−"


def _indian_group(n: int) -> str:
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups) + "," + tail


def format_inr(value: float) -> str:
    rounded = round(value)
    body = f"₹{_indian_group(abs(rounded))}"
    return f"{MINUS}{body}" if rounded < 0 else body


def format_compact(value: float) -> str:
    a = abs(value)

    def trim(x: float) -> str:
        return f"{x:.1f}".removesuffix(".0")

    if a >= 1e7:
        body = f"₹{trim(a / 1e7)}Cr"
    elif a >= 1e5:
        body = f"₹{trim(a / 1e5)}L"
    elif a >= 1e3:
        body = f"₹{trim(a / 1e3)}K"
    else:
        body = f"₹{round(a)}"
    return f"{MINUS}{body}" if value < 0 else body
