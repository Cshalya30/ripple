"""SQLite persistence. Money columns are integer paise; every row carries business_id."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

IST = timezone(timedelta(hours=5, minutes=30))

SCHEMA = """
CREATE TABLE IF NOT EXISTS business (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_name TEXT,
  address TEXT,
  gstin TEXT,
  udyam_number TEXT,
  msme_category TEXT,
  fy_start TEXT DEFAULT '04-01',
  business_type TEXT DEFAULT 'MANUFACTURER',
  safety_buffer_paise INTEGER NOT NULL DEFAULT 0,
  default_customer_terms_days INTEGER NOT NULL DEFAULT 30,
  default_supplier_terms_days INTEGER NOT NULL DEFAULT 30,
  horizon_days INTEGER NOT NULL DEFAULT 90,
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  opening_balance_date TEXT,
  msme_alerts INTEGER NOT NULL DEFAULT 1,
  is_sandbox INTEGER NOT NULL DEFAULT 0,
  data_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  prefs_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS party (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  description TEXT,
  phone TEXT,
  gstin TEXT,
  udyam_number TEXT,
  msme_category TEXT,
  terms_type TEXT NOT NULL DEFAULT 'CREDIT',
  terms_days INTEGER NOT NULL DEFAULT 30,
  lead_time_days INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes_json TEXT NOT NULL DEFAULT '[]',
  since TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS material (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  base_unit TEXT NOT NULL,
  unit_factor INTEGER NOT NULL DEFAULT 1,
  reorder_safety_days INTEGER NOT NULL DEFAULT 7,
  primary_supplier_id TEXT,
  avg_cost_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  variant_json TEXT NOT NULL DEFAULT '{}',
  production_cost_paise INTEGER NOT NULL DEFAULT 0,
  production_days INTEGER NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_line (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  qty_per_piece INTEGER NOT NULL,
  wastage_bp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movement (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  note TEXT,
  user_id TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_order (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  product_id TEXT,
  qty INTEGER NOT NULL,
  unit_price_paise INTEGER NOT NULL,
  order_date TEXT,
  earliest_start_date TEXT,
  promised_date TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  stage TEXT NOT NULL DEFAULT 'PLANNED',
  deposit_paise INTEGER NOT NULL DEFAULT 0,
  materials_json TEXT,
  production_cost_paise INTEGER,
  production_days INTEGER,
  collection_terms_days INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_order (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  number TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  material_id TEXT,
  qty INTEGER NOT NULL DEFAULT 0,
  amount_paise INTEGER NOT NULL,
  ordered_date TEXT NOT NULL,
  expected_arrival TEXT,
  payment_due TEXT,
  terms_type TEXT NOT NULL DEFAULT 'CREDIT',
  release_after_invoice_id TEXT,
  status TEXT NOT NULL DEFAULT 'ORDERED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  party_id TEXT NOT NULL,
  order_id TEXT,
  number TEXT NOT NULL,
  description TEXT,
  amount_paise INTEGER NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  promised_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  paid_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS txn (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  party_id TEXT,
  direction TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  date TEXT NOT NULL,
  medium TEXT NOT NULL,
  reference TEXT,
  invoice_id TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'CLEARED',
  receipt_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recurring_expense (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  day_of_month INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_expense (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_facility (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  label TEXT NOT NULL,
  approved_limit_paise INTEGER NOT NULL,
  annual_rate_bps INTEGER NOT NULL,
  drawdown_fee_paise INTEGER NOT NULL DEFAULT 0,
  available_from TEXT NOT NULL,
  repayment_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sim_run (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  data_version INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  scenario_json TEXT,
  snapshot_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  kind TEXT NOT NULL,
  duration_ms REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_run (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  scenario_hash TEXT NOT NULL,
  seed INTEGER NOT NULL,
  n_samples INTEGER NOT NULL,
  m_samples INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  duration_ms REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_turn (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  tool_calls_json TEXT NOT NULL,
  reply TEXT NOT NULL,
  grounding_passed INTEGER NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_party_b ON party(business_id);
CREATE INDEX IF NOT EXISTS ix_invoice_b ON invoice(business_id, party_id);
CREATE INDEX IF NOT EXISTS ix_txn_b ON txn(business_id, date);
CREATE INDEX IF NOT EXISTS ix_so_b ON sales_order(business_id);
CREATE INDEX IF NOT EXISTS ix_po_b ON purchase_order(business_id);
CREATE INDEX IF NOT EXISTS ix_mv_b ON stock_movement(business_id, item_id);
CREATE INDEX IF NOT EXISTS ix_sim_b ON sim_run(business_id, kind, created_at);
CREATE INDEX IF NOT EXISTS ix_risk_b ON risk_run(business_id, snapshot_hash, scenario_hash);
CREATE INDEX IF NOT EXISTS ix_session_user ON session(user_id);
"""

BUSINESS_TABLES = [
    "party", "material", "product", "recipe_line", "stock_movement", "sales_order", "purchase_order",
    "invoice", "txn", "recurring_expense", "scheduled_expense", "credit_facility", "sim_run", "risk_run",
    "assistant_turn",
]

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def database_path() -> str:
    url = os.getenv("DATABASE_URL", "")
    if url.startswith("sqlite:///"):
        return url[len("sqlite:///"):]
    if url:
        return url
    return str(Path(__file__).resolve().parents[3] / "data" / "ripple.db")


def _connect() -> sqlite3.Connection:
    path = database_path()
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL" if path != ":memory:" else "PRAGMA journal_mode=MEMORY")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def get_conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            _conn = _connect()
        return _conn


def reset_connection() -> None:
    """Used by tests to point at a fresh database."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    conn = get_conn()
    with _lock:
        conn.execute("BEGIN")
        try:
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def query(sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
    conn = get_conn()
    with _lock:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today() -> date:
    override = os.getenv("RIPPLE_TODAY")
    if override:
        return date.fromisoformat(override)
    return datetime.now(IST).date()


def insert(conn: sqlite3.Connection, table: str, row: dict[str, Any]) -> None:
    stamp = now_iso()
    row = {**row}
    row.setdefault("created_at", stamp)
    row.setdefault("updated_at", stamp)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    with _lock:
        conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", [_sql_value(v) for v in row.values()])


def update(conn: sqlite3.Connection, table: str, row_id: str, business_id: str, changes: dict[str, Any]) -> int:
    if not changes:
        return 0
    changes = {**changes, "updated_at": now_iso()}
    sets = ", ".join(f"{key} = ?" for key in changes)
    with _lock:
        cursor = conn.execute(
            f"UPDATE {table} SET {sets} WHERE id = ? AND business_id = ?",
            [_sql_value(v) for v in changes.values()] + [row_id, business_id],
        )
        return cursor.rowcount


def execute(sql: str, params: tuple | list = ()) -> int:
    conn = get_conn()
    with _lock:
        return conn.execute(sql, params).rowcount


def bump_data_version(conn: sqlite3.Connection, business_id: str) -> None:
    conn.execute("UPDATE business SET data_version = data_version + 1, updated_at = ? WHERE id = ?", (now_iso(), business_id))


def _sql_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return int(value)
    return value


def delete_business_data(conn: sqlite3.Connection, business_id: str) -> None:
    for table in BUSINESS_TABLES:
        conn.execute(f"DELETE FROM {table} WHERE business_id = ?", (business_id,))
