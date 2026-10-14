"""E-5: measure one engine run and one risk refresh on the demo dataset.

    python -m scripts.bench_engine
"""
import os
import time

os.environ.setdefault("DATABASE_URL", ":memory:")

from backend.app.core.db import today, tx  # noqa: E402
from backend.app.records.seed import seed_business  # noqa: E402
from backend.app.services import risk, runs  # noqa: E402
from backend.app.simulation.engine import simulate  # noqa: E402

with tx() as conn:
    seed_business(conn, "bench", today())
run = runs.baseline("bench")
snapshot = run.built.snapshot
count = 30
started = time.perf_counter()
for _ in range(count):
    simulate(snapshot)
per_run = (time.perf_counter() - started) * 1000 / count
print(f"events: {len(snapshot.events)}  horizon: {snapshot.horizon_days} days")
print(f"one run: {per_run:.1f} ms")
started = time.perf_counter()
result = risk.compute("bench", run.built, run.derived["summary"]["buffer_paise"])
print(f"risk refresh: N={result['n_samples']} M={result['m_samples']} in {(time.perf_counter() - started):.1f} s")
