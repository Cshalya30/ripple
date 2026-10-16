"""SQLite persistence for customers and suppliers, scoped per workspace.

Each browser gets its own workspace (a random id the frontend keeps in
localStorage), seeded with the demo khata on first use. One visitor adding or
importing parties never changes what another visitor sees.

Demo seed rows are stored with an anchor date and shifted to "today" when
read, so "Day 34" stays Day 34 whichever day the app is opened (the frontend's
mock data behaved the same way). Rows a user adds or imports keep their real
calendar dates.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from . import config

WORKSPACE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
DEFAULT_WORKSPACE = "public-demo-workspace"
MAX_WORKSPACES = 2000


@dataclass
class PartyRecord:
    id: str
    kind: str
    name: str
    phone: str
    details: str
    products: list[str]
    quantity: float
    total_amount: int
    paid_amount: int
    transaction_date: date
    due_date: date
    expected_pay_date: date | None
    is_seed: bool

    @property
    def owed_amount(self) -> int:
        return max(0, self.total_amount - self.paid_amount)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parties (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('customer', 'supplier')),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    details TEXT NOT NULL,
    products TEXT NOT NULL,
    quantity REAL NOT NULL,
    total_amount INTEGER NOT NULL,
    paid_amount INTEGER NOT NULL,
    transaction_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    expected_pay_date TEXT,
    seed_anchor TEXT,
    sort_key TEXT NOT NULL,
    PRIMARY KEY (workspace_id, id)
);
"""

_COLUMNS = (
    "id, kind, name, phone, details, products, quantity, total_amount, paid_amount,"
    " transaction_date, due_date, expected_pay_date, seed_anchor"
)


class PartyStore:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._memory_conn = sqlite3.connect(":memory:", check_same_thread=False) if self.path == ":memory:" else None
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            conn = self._memory_conn or sqlite3.connect(self.path, timeout=10)
            conn.execute("PRAGMA foreign_keys = ON")
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                if self._memory_conn is None:
                    conn.close()

    def close(self) -> None:
        if self._memory_conn is not None:
            self._memory_conn.close()
            self._memory_conn = None

    # ── workspaces ───────────────────────────────────────────────────────

    def touch(self, workspace: str) -> None:
        """Create (and seed) the workspace on first use; evict the stalest one past the cap."""
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            exists = conn.execute("SELECT 1 FROM workspaces WHERE id = ?", (workspace,)).fetchone()
            if exists:
                conn.execute("UPDATE workspaces SET last_seen = ? WHERE id = ?", (now, workspace))
                return
            count = conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0]
            if count >= MAX_WORKSPACES:
                conn.execute(
                    "DELETE FROM workspaces WHERE id IN (SELECT id FROM workspaces WHERE id != ? ORDER BY last_seen LIMIT ?)",
                    (DEFAULT_WORKSPACE, count - MAX_WORKSPACES + 1),
                )
            conn.execute("INSERT INTO workspaces (id, last_seen) VALUES (?, ?)", (workspace, now))
            self._seed(conn, workspace)

    # ── reads ────────────────────────────────────────────────────────────

    def list(self, workspace: str) -> list[PartyRecord]:
        self.touch(workspace)
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM parties WHERE workspace_id = ?"
                " ORDER BY seed_anchor IS NOT NULL, CASE WHEN seed_anchor IS NULL THEN sort_key END DESC, sort_key",
                (workspace,),
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def count(self, workspace: str) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM parties WHERE workspace_id = ?", (workspace,)).fetchone()[0]

    @staticmethod
    def _to_record(row: tuple) -> PartyRecord:
        (pid, kind, name, phone, details, products, quantity, total, paid, tx, due, expected, anchor) = row
        shift = timedelta(days=(config.today() - date.fromisoformat(anchor)).days) if anchor else timedelta(0)
        return PartyRecord(
            id=pid,
            kind=kind,
            name=name,
            phone=phone,
            details=details,
            products=json.loads(products),
            quantity=quantity,
            total_amount=total,
            paid_amount=paid,
            transaction_date=date.fromisoformat(tx) + shift,
            due_date=date.fromisoformat(due) + shift,
            expected_pay_date=date.fromisoformat(expected) + shift if expected else None,
            is_seed=anchor is not None,
        )

    # ── writes ───────────────────────────────────────────────────────────

    def add_many(self, workspace: str, records: list[dict]) -> list[PartyRecord]:
        """Insert parties. Raises ValueError if the workspace would exceed its cap."""
        self.touch(workspace)
        ids: list[str] = []
        with self._conn() as conn:
            current = conn.execute("SELECT COUNT(*) FROM parties WHERE workspace_id = ?", (workspace,)).fetchone()[0]
            if current + len(records) > config.MAX_PARTIES:
                raise ValueError(f"A khata can hold at most {config.MAX_PARTIES} parties. You have {current}.")
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
            for i, rec in enumerate(records):
                pid = f"{rec['kind'][:3]}-{secrets.token_hex(6)}"
                conn.execute(
                    f"INSERT INTO parties (workspace_id, {_COLUMNS}, sort_key)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
                    (
                        workspace,
                        pid,
                        rec["kind"],
                        rec["name"],
                        rec["phone"],
                        rec["details"],
                        json.dumps(rec["products"], ensure_ascii=False),
                        float(rec["quantity"]),
                        int(rec["total_amount"]),
                        int(rec["paid_amount"]),
                        rec["transaction_date"].isoformat(),
                        rec["due_date"].isoformat(),
                        # Later rows in one import sort below earlier ones.
                        f"{stamp}-{len(records) - i:05d}",
                    ),
                )
                ids.append(pid)
        by_id = {p.id: p for p in self.list(workspace)}
        return [by_id[i] for i in ids]

    def delete(self, workspace: str, party_id: str) -> bool:
        with self._conn() as conn:
            return conn.execute("DELETE FROM parties WHERE workspace_id = ? AND id = ?", (workspace, party_id)).rowcount > 0

    def reset(self, workspace: str) -> None:
        self.touch(workspace)
        with self._conn() as conn:
            conn.execute("DELETE FROM parties WHERE workspace_id = ?", (workspace,))
            self._seed(conn, workspace)

    @staticmethod
    def _seed(conn: sqlite3.Connection, workspace: str) -> None:
        anchor = config.today()
        for i, s in enumerate(config.SEED_PARTIES):
            conn.execute(
                f"INSERT INTO parties (workspace_id, {_COLUMNS}, sort_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    workspace,
                    s.id,
                    s.kind,
                    s.name,
                    s.phone,
                    s.details,
                    json.dumps(list(s.products), ensure_ascii=False),
                    float(s.quantity),
                    s.total,
                    s.paid,
                    (anchor - timedelta(days=s.sold_days_ago)).isoformat(),
                    (anchor + timedelta(days=s.due_in)).isoformat(),
                    (anchor + timedelta(days=s.expected_in)).isoformat() if s.expected_in is not None else None,
                    anchor.isoformat(),
                    f"seed-{i:03d}",
                ),
            )


def valid_workspace(value: str | None) -> str:
    if value and WORKSPACE_PATTERN.fullmatch(value):
        return value
    return DEFAULT_WORKSPACE


_store: PartyStore | None = None


def get_store() -> PartyStore:
    global _store
    if _store is None:
        _store = PartyStore(config.DB_PATH)
    return _store


def set_store(store: PartyStore) -> None:
    """Used by tests to swap in an in-memory store."""
    global _store
    _store = store
