import os
os.environ["DATABASE_URL"] = ":memory:"; os.environ["RIPPLE_TODAY"] = "2026-10-14"; os.environ["RISK_PROCESSES"] = "0"
from backend.app.core.db import tx, today
from backend.app.records.seed import seed_business
from backend.app.services import runs, risk, fixes
with tx() as c: seed_business(c, "d", today())
r = runs.baseline("d"); s = r.derived["summary"]
print("short", s["first_shortfall"]["day"], s["first_shortfall"]["shortfall_paise"]/100, "lowest", s["lowest"], "late", s["late_orders"])
base = risk.compute("d", r.built, s["buffer_paise"], with_drivers=True, samples=200)
print("base", base["shortfall_chance"], [(d["name"], d["share"]) for d in base["drivers"][:4]])
for f in fixes.candidates(r):
    snap, sc, _ = fixes.build_variant(r, f)
    e = fixes.evaluate(r, f)
    rr = risk.compute("d", r.built, s["buffer_paise"], snapshot=snap, scenario=sc, scenario_key=f["id"], with_drivers=False, samples=100)
    print(f"{f['id']:16} dip {e['dip_after_paise']/100:>10,.0f} cost {(e['fix']['cost_paise'] or 0)/100:>8} chance {rr['shortfall_chance']}")
