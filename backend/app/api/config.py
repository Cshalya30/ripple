"""Business profile, demo seed data and runtime settings for the Ripple API.

Money in this module is whole rupees. The simulation engine works in integer
paise, so the forecast adapter multiplies by 100 at the boundary.

The seed mirrors ``frontend/src/data/parties.ts`` and ``frontend/src/data/forecast.ts``
exactly, so the numbers the UI already talks about (the Day 34 dip, Sharma Yarn
Mills, Kaveri Boutique) come out of the real engine unchanged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

TIMEZONE = ZoneInfo(os.getenv("RIPPLE_TIMEZONE", "Asia/Kolkata"))
HORIZON_DAYS = 90  # the UI shows day 0 (today) through day 90
DB_PATH = Path(os.getenv("RIPPLE_DB_PATH", str(BACKEND_DIR / "data" / "ripple.db")))

MAX_PARTIES = 300  # keeps every snapshot well under the engine's 500-event cap
MAX_IMPORT_ROWS = 200
MAX_UPLOAD_BYTES = 2 * 1024 * 1024


def today() -> date:
    """Business 'today' in Indian time, matching what the browser shows."""
    return datetime.now(TIMEZONE).date()


@dataclass(frozen=True)
class BusinessProfile:
    business_id: str = "mahalakshmi-fabrics"
    name: str = "Mahalakshmi Fabrics"
    owner: str = "Ramesh Agarwal"
    city: str = "Bengaluru"
    cash_today: int = 230_000
    safety_buffer: int = 50_000


BUSINESS = BusinessProfile()


@dataclass(frozen=True)
class RecurringEvent:
    id: str
    kind: str  # "inflow" | "outflow"
    label: str
    amount: int
    day: int


# Non-party cash movements from frontend/src/data/forecast.ts.
RECURRING_EVENTS: tuple[RecurringEvent, ...] = (
    RecurringEvent("e-staff-1", "outflow", "Shop rent and staff", 40_000, 2),
    RecurringEvent("e-sales-1", "inflow", "Counter sales", 30_000, 10),
    RecurringEvent("e-staff-2", "outflow", "Shop rent and staff", 40_000, 32),
    RecurringEvent("e-sales-2", "inflow", "Counter sales", 30_000, 40),
    RecurringEvent("e-staff-3", "outflow", "Shop rent and staff", 40_000, 62),
    RecurringEvent("e-sales-3", "inflow", "Counter sales", 30_000, 70),
)


@dataclass(frozen=True)
class SeedParty:
    id: str
    kind: str
    name: str
    phone: str
    details: str
    products: tuple[str, ...]
    quantity: float
    total: int
    paid: int
    sold_days_ago: int
    due_in: int
    expected_in: int | None = None  # when the money actually lands, if different from due date


SEED_PARTIES: tuple[SeedParty, ...] = (
    # Suppliers
    SeedParty("sup-sharma", "supplier", "Sharma Yarn Mills", "+91 98000 00101", "Spinning mill, Ludhiana", ("Cotton yarn 40s", "Polyester blend yarn"), 1850, 640_000, 288_000, 21, 34),
    SeedParty("sup-bhavani", "supplier", "Bhavani Dyeing Works", "+91 98000 00102", "Dyeing unit, Tiruppur", ("Reactive dyeing", "Fabric washing"), 920, 210_000, 115_000, 14, 6),
    SeedParty("sup-gopal", "supplier", "Gopal Cotton Spinners", "+91 98000 00103", "Yarn mill, Coimbatore", ("Combed cotton yarn", "Hosiery yarn"), 1200, 380_000, 220_000, 18, 18),
    SeedParty("sup-rajdhani", "supplier", "Rajdhani Roadlines", "+91 98000 00104", "Freight and transport, Delhi", ("Inter-state freight",), 36, 96_000, 58_000, 9, 3),
    SeedParty("sup-lakshmi", "supplier", "Lakshmi Silk Threads", "+91 98000 00105", "Thread merchant, Kanchipuram", ("Zari thread", "Silk thread"), 310, 120_000, 80_000, 25, 52),
    SeedParty("sup-patel", "supplier", "Patel Packaging", "+91 98000 00106", "Packaging supplier, Ahmedabad", ("Poly bags", "Cartons"), 2400, 54_000, 30_000, 6, 71),
    # Customers
    SeedParty("cus-kaveri", "customer", "Kaveri Boutique", "+91 98000 00201", "Saree boutique, Mysuru", ("Silk sarees", "Dress material"), 140, 325_000, 180_000, 42, -12, expected_in=41),
    SeedParty("cus-anand", "customer", "Anand Silk Emporium", "+91 98000 00202", "Retail shop, Bengaluru", ("Kanjivaram silk", "Blouse pieces"), 95, 240_000, 155_000, 20, 5),
    SeedParty("cus-mehta", "customer", "Mehta Cloth House", "+91 98000 00203", "Cloth merchant, Pune", ("Cotton suiting", "Shirting"), 410, 188_000, 126_000, 16, 14),
    SeedParty("cus-venkateswara", "customer", "Sri Venkateswara Textiles", "+91 98000 00204", "Wholesale shop, Hyderabad", ("Cotton sarees", "Dhotis"), 260, 310_000, 190_000, 24, 22),
    SeedParty("cus-meenakshi", "customer", "Meenakshi Sarees", "+91 98000 00205", "Saree showroom, Madurai", ("Soft silk sarees",), 88, 215_000, 137_000, 19, 27),
    SeedParty("cus-fashion", "customer", "Fashion Junction", "+91 98000 00206", "Garment store, Kochi", ("Kurta fabric", "Linen blends"), 300, 205_000, 115_000, 11, 45),
    SeedParty("cus-rohini", "customer", "Rohini Boutique", "+91 98000 00207", "Boutique, Hubballi", ("Georgette", "Chiffon"), 175, 168_000, 72_000, 8, 58),
    SeedParty("cus-gupta", "customer", "Gupta Garments", "+91 98000 00208", "Garment wholesaler, Jaipur", ("Block-print cotton", "Rayon"), 520, 260_000, 150_000, 5, 74),
)

# Assumption used when a customer is already overdue and gave no new date.
OVERDUE_CUSTOMER_GRACE_DAYS = 7

# Fix parameters (kept in line with the copy already shown in the UI).
EARLY_PAYMENT_DISCOUNT = 0.02
FINANCING_ADVANCE_RATE = 0.92
FINANCING_INTEREST_BPS = 1800  # 18% a year, simple daily
FINANCE_PARTNER = {"name": "BillBridge Finance", "phone": "+91 98000 00301"}
