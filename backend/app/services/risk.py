"""Risk engine (PRD 11). Samples each customer's payment delay from their own history
(shrunk towards the pooled history) and re-runs the deterministic core once per sample.

No randomness lives in the engine: this module samples dates, builds ordinary snapshots,
and calls `simulate`. Same snapshot + scenario + seed gives the same numbers.
"""
from __future__ import annotations

import hashlib
import os
import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any, Callable

from ..core.db import insert, get_conn, now_iso, query_one
from ..simulation.engine import simulate
from ..simulation.schemas import BusinessSnapshot, EventType, Scenario
from ..snapshot.builder import BuiltSnapshot
from .position import delay_model
from .runs import derive

WINDOWS = (30, 60, 90)


def n_samples() -> int:
    return int(os.getenv("RISK_SAMPLES", "200"))


def m_samples() -> int:
    return int(os.getenv("RISK_DRIVER_SAMPLES", "30"))


def fix_samples() -> int:
    return int(os.getenv("RISK_FIX_SAMPLES", "100"))


class DelaySampler:
    def __init__(self, model: dict[str, Any]):
        self.model = model
        self.pool = sorted(model["pool"])

    def draw(self, rng: random.Random, customer_id: str | None, at_least: int | None) -> int:
        info = self.model["customers"].get(customer_id or "")
        own = sorted(self.model["history"].get(customer_id or "", []))
        weight = info["own_weight"] if info else 0.0
        source = own if own and rng.random() < weight else self.pool
        if not source:
            return max(0, at_least or 0)
        if at_least is not None:
            eligible = [d for d in source if d >= at_least] or [d for d in self.pool if d >= at_least]
            if not eligible:
                # Beyond everything seen: overdue already, add a draw from the positive tail.
                tail = [d for d in self.pool if d > 0] or [0]
                return at_least + rng.choice(tail)
            return rng.choice(eligible)
        return rng.choice(source)


def _seed(*parts: str) -> int:
    return int(hashlib.sha256("|".join(parts).encode()).hexdigest()[:12], 16)


def sample_snapshot(
    snapshot: BusinessSnapshot,
    meta_events: dict[str, dict[str, Any]],
    sampler: DelaySampler,
    rng: random.Random,
    forced_on_terms: str | None = None,
) -> BusinessSnapshot:
    as_of = snapshot.start_date
    new_events = []
    for event in snapshot.events:
        info = meta_events.get(event.id, {})
        if event.type != EventType.CASH_RECEIPT or info.get("direction") != "IN" or "receipt_kind" not in info:
            new_events.append(event)
            continue
        customer = event.counterparty_id
        # Every receipt consumes exactly one draw so that forcing one customer leaves the others unchanged.
        if info["receipt_kind"] == "FIXED_DATE":
            anchor = date.fromisoformat(info["anchor_date"])
            overdue = max(0, (as_of - anchor).days)
            delay = sampler.draw(rng, customer, overdue if overdue > 0 else None)
            expected = max(as_of, anchor + timedelta(days=delay))
            if customer == forced_on_terms:
                expected = max(as_of, date.fromisoformat(info["due_date"]))
            new_events.append(event.model_copy(update={"earliest_date": expected}))
        else:
            delay = sampler.draw(rng, customer, None)
            if customer == forced_on_terms:
                delay = 0
            lag = max(0, info["terms_days"] + delay)
            deps = [dep.model_copy(update={"lag_days": lag}) for dep in event.dependencies]
            new_events.append(event.model_copy(update={"dependencies": deps}))
    return snapshot.model_copy(update={"events": new_events})


def _percentile(values: list[int], q: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return ordered[index]


def run_samples(
    built: BuiltSnapshot,
    snapshot: BusinessSnapshot,
    scenario: Scenario | None,
    sampler: DelaySampler,
    buffer_paise: int,
    count: int,
    seed: int,
    forced_on_terms: str | None = None,
) -> list[dict[str, Any]]:
    outcomes = []
    for index in range(count):
        rng = random.Random(seed + index)
        sampled = sample_snapshot(snapshot, built.meta["events"], sampler, rng, forced_on_terms)
        result = simulate(sampled, scenario)
        derived = derive(built, result, buffer_paise, snapshot=sampled)
        summary = derived["summary"]
        outcomes.append({
            "first_short_day": summary["first_shortfall"]["day"] if summary["first_shortfall"] else None,
            "breach_day": summary["buffer_breach"]["day"] if summary["buffer_breach"] else None,
            "lowest_net": summary["lowest"]["net_paise"] if summary["lowest"] else 0,
            "net": [point["net_paise"] for point in derived["series"]],
        })
    return outcomes


def expected_gap(outcomes: list[dict[str, Any]]) -> float:
    """Mean amount by which net position goes below zero (0 when it never does)."""
    if not outcomes:
        return 0.0
    return sum(max(0, -o["lowest_net"]) for o in outcomes) / len(outcomes)


def chance(outcomes: list[dict[str, Any]], key: str, window: int) -> float:
    if not outcomes:
        return 0.0
    return sum(1 for o in outcomes if o[key] is not None and o[key] < window) / len(outcomes)


def summarise(outcomes: list[dict[str, Any]], start: date) -> dict[str, Any]:
    horizon = len(outcomes[0]["net"]) if outcomes else 0
    short_days = [o["first_short_day"] for o in outcomes if o["first_short_day"] is not None]
    fan = []
    for day in range(horizon):
        values = [o["net"][day] for o in outcomes]
        fan.append({"day": day, "date": (start + timedelta(days=day)).isoformat(),
                    "p10_paise": _percentile(values, 0.1), "p50_paise": _percentile(values, 0.5), "p90_paise": _percentile(values, 0.9)})
    lows = [o["lowest_net"] for o in outcomes if o["first_short_day"] is not None]

    def day_info(value: int | None) -> dict[str, Any] | None:
        return None if value is None else {"day": value, "date": (start + timedelta(days=value)).isoformat()}

    return {
        "shortfall_chance": {str(w): round(chance(outcomes, "first_short_day", w), 4) for w in WINDOWS},
        "buffer_chance": {str(w): round(chance(outcomes, "breach_day", w), 4) for w in WINDOWS},
        "first_shortfall": {"p10": day_info(_percentile(short_days, 0.1)), "p50": day_info(_percentile(short_days, 0.5)),
                            "p90": day_info(_percentile(short_days, 0.9)), "samples_with_shortfall": len(short_days)},
        "expected_shortfall_paise": round(sum(lows) / len(lows)) if lows else None,
        "fan": fan,
    }


def compute(
    business_id: str,
    built: BuiltSnapshot,
    buffer_paise: int,
    snapshot: BusinessSnapshot | None = None,
    scenario: Scenario | None = None,
    scenario_key: str = "baseline",
    with_drivers: bool = True,
    samples: int | None = None,
) -> dict[str, Any]:
    """Read the delay history (database, this process), sample (worker process), store the run."""
    model = delay_model(business_id)
    args = (model, built, buffer_paise, snapshot, scenario, scenario_key, with_drivers, samples or n_samples(), m_samples())
    result = run_pure(simulate_risk, *args)
    if result["status"] == "READY":
        insert(get_conn(), "risk_run", {
            "id": f"risk-{uuid.uuid4().hex[:16]}", "business_id": business_id, "snapshot_hash": built.snapshot_hash,
            "scenario_hash": scenario_key, "seed": result["seed"], "n_samples": result["n_samples"], "m_samples": result["m_samples"],
            "summary_json": {k: v for k, v in result.items() if k != "fan"}, "duration_ms": result["duration_ms"],
        })
    return result


def simulate_risk(
    model: dict[str, Any],
    built: BuiltSnapshot,
    buffer_paise: int,
    snapshot: BusinessSnapshot | None,
    scenario: Scenario | None,
    scenario_key: str,
    with_drivers: bool,
    n: int,
    m_default: int,
) -> dict[str, Any]:
    """Pure: no database, safe to run in a worker process."""
    started = time.perf_counter()
    snap = snapshot or built.snapshot
    receipts = [e for e in snap.events if e.type == EventType.CASH_RECEIPT and built.meta["events"].get(e.id, {}).get("receipt_kind")]
    customers_in_play = sorted({e.counterparty_id for e in receipts if e.counterparty_id})
    no_history = [model["customers"][c]["name"] for c in customers_in_play if c in model["customers"] and model["customers"][c]["no_history"]]
    base = {
        "snapshot_hash": built.snapshot_hash,
        "scenario_key": scenario_key,
        "payments_used": model["pool_size"],
        "customers_with_history": model["customers_with_history"],
        "customers_without_history": no_history,
        "shrinkage_k": model["k"],
        "method": "Each customer's delay is drawn from their own payment history with weight n/(n+5), else from all customers' history; "
                  "invoices already overdue only draw delays at least as long as the days already late. The deterministic engine runs once per sample. "
                  "A customer's driver share is the part of the expected shortfall that disappears when only that customer pays on terms.",
    }
    if not model["sufficient"]:
        return {**base, "status": "INSUFFICIENT_HISTORY", "n_samples": 0, "m_samples": 0, "computed_at": now_iso()}

    seed = _seed(built.snapshot_hash, scenario_key)
    sampler = DelaySampler(model)
    outcomes = run_samples(built, snap, scenario, sampler, buffer_paise, n, seed)
    summary = summarise(outcomes, snap.start_date)
    drivers: list[dict[str, Any]] = []
    m = 0
    if with_drivers:
        # Driver share: how much of the expected shortfall disappears when one customer pays on terms,
        # measured on the same random draws (common random numbers) so only that customer changes.
        m = min(m_default, n)
        reference = expected_gap(outcomes[:m])
        reductions = {}
        for customer in customers_in_play:
            forced = run_samples(built, snap, scenario, sampler, buffer_paise, m, seed, forced_on_terms=customer)
            reductions[customer] = max(0, reference - expected_gap(forced))
        total = sum(reductions.values())
        for customer, reduction in sorted(reductions.items(), key=lambda item: (-item[1], item[0])):
            info = model["customers"].get(customer, {})
            drivers.append({"party_id": customer, "name": info.get("name", customer),
                            "share": round(reduction / total, 4) if total > 0 else 0.0,
                            "reduction_paise": round(reduction), "no_history": info.get("no_history", False)})
    duration = (time.perf_counter() - started) * 1000
    return {**base, **summary, "status": "READY", "n_samples": n, "m_samples": m, "seed": seed, "drivers": drivers,
            "computed_at": now_iso(), "duration_ms": round(duration)}


# ---------------------------------------------------------------- worker process
# Sampling is CPU-bound. In a thread it holds the GIL and slows every API request,
# so it runs in a separate process. RISK_PROCESSES=0 keeps it in-process (tests).

_pool = None
_pool_lock = threading.Lock()


def run_pure(fn: Callable[..., dict[str, Any]], *args: Any) -> dict[str, Any]:
    global _pool
    if os.getenv("RISK_PROCESSES", "1") == "0":
        return fn(*args)
    with _pool_lock:
        if _pool is None:
            import multiprocessing
            from concurrent.futures import ProcessPoolExecutor
            _pool = ProcessPoolExecutor(max_workers=int(os.getenv("RISK_PROCESSES", "1")), mp_context=multiprocessing.get_context("spawn"))
        pool = _pool
    try:
        return pool.submit(fn, *args).result(timeout=120)
    except Exception:  # noqa: BLE001 - a broken pool falls back to in-process work
        with _pool_lock:
            _pool = None
        return fn(*args)


# ---------------------------------------------------------------- background jobs

class RiskJobs:
    """One worker, de-duplicated by key, results cached by snapshot hash + scenario."""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="risk")
        self._results: dict[str, dict[str, Any]] = {}
        self._pending: set[str] = set()
        self._errors: dict[str, str] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            return self._results.get(key)

    def status(self, key: str) -> str:
        with self._lock:
            if key in self._results:
                return "READY"
            if key in self._pending:
                return "COMPUTING"
            if key in self._errors:
                return "UNAVAILABLE"
            return "MISSING"

    def submit(self, key: str, fn: Callable[[], dict[str, Any]], delay_s: float = 0.0) -> None:
        with self._lock:
            if key in self._results or key in self._pending:
                return
            self._pending.add(key)
            self._errors.pop(key, None)

        def job() -> None:
            if delay_s:
                time.sleep(delay_s)
            try:
                value = fn()
                with self._lock:
                    self._results[key] = value
                    if len(self._results) > 400:
                        for old in list(self._results)[:100]:
                            self._results.pop(old, None)
            except Exception as exc:  # noqa: BLE001 - surfaced as "Risk unavailable"
                with self._lock:
                    self._errors[key] = type(exc).__name__
            finally:
                with self._lock:
                    self._pending.discard(key)

        self._executor.submit(job)


jobs = RiskJobs()


def latest_stored(business_id: str) -> dict[str, Any] | None:
    return query_one("SELECT created_at, snapshot_hash FROM risk_run WHERE business_id = ? AND scenario_hash = 'baseline' ORDER BY created_at DESC LIMIT 1", (business_id,))
