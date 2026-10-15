"""Builds docs/audit/chirantan/ui-control-coverage.json from the sweep results and the regression run.

Run from the repo root after the sweeps:  python docs/audit/chirantan/tools/build_coverage.py
"""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/audit/chirantan/evidence"

# which run is the final word for each route state at each width
SOURCES = [
    ("controls-1440-full.json", {"engine-network", "engine-flow", "engine-decisions", "engine-table"}),
    ("controls-1440-today.json", {"today"}),
    ("controls-1440-book.json", {"book-position", "book-risk", "book-ledger"}),
    ("controls-390-today.json", {"today"}),
    ("controls-390-book.json", {"book-position", "book-risk", "book-ledger"}),
    ("controls-390-engine-flow.json", {"engine-flow"}),
]

# sweep results that were examined by hand and are not defects (see bug-ledger.md, "Things the control sweep flagged that were not bugs")
EXPLAINED = {
    ("book-ledger", "Export CSV"): "Download link: the page navigation is aborted because the response is a file. Verified by Playwright R9 (file downloaded, 195 lines).",
}

controls, pages = [], []
for name, keep in SOURCES:
    path = EVIDENCE / name
    if not path.exists():
        continue
    data = json.loads(path.read_text(encoding="utf8"))
    width = data["viewport"][0]
    for row in data["results"]:
        if row["route"] not in keep:
            continue
        if row.get("kind") == "page-load":
            pages.append({"route": row["route"], "viewport_width": width, "controls_found": row["controls"], "load_issues": row["issues"], "error_text_on_screen": row["bad_text"]})
            continue
        status = row["status"]
        note = row.get("note") or row.get("problems")
        explained = EXPLAINED.get((row["route"], row["name"]))
        if status == "FAIL" and explained:
            status, note = "PASS (explained)", explained
        controls.append({"route": row["route"], "viewport_width": width, "index": row["index"], "role": row["role"], "name": row["name"], "href": row.get("href"),
                         "status": status, "requests": row.get("requests", []), "note": note})

tally = collections.Counter((c["viewport_width"], c["status"]) for c in controls)
regression = json.loads((EVIDENCE / "regression-trackA.json").read_text(encoding="utf8")) if (EVIDENCE / "regression-trackA.json").exists() else []
out = {
    "scope": "Track A screens: Today, Engine (Network, Flow, Decisions, Table), Book (Position, Risk & Finance, Ledger), shell controls on those screens",
    "method": "e2e/audit-controls.mjs clicks every control on a fresh page load, records requests, dialogs, URL and DOM change, console and page errors; e2e/regression-trackA.mjs verifies user journeys",
    "statuses": "PASS = acted, effect observed, no console/page/HTTP error; FAIL = error or no observable effect; BLOCKED = destructive or external, covered by a targeted check; NOT APPLICABLE = disabled or hidden in that state",
    "summary_by_width": {str(w): {s: n for (ww, s), n in tally.items() if ww == w} for w in sorted({w for w, _ in tally})},
    "route_states_loaded": pages,
    "journeys": regression,
    "controls": controls,
}
(ROOT / "docs/audit/chirantan/ui-control-coverage.json").write_text(json.dumps(out, indent=1), encoding="utf8")
print(json.dumps(out["summary_by_width"]))
print(len(pages), "route states,", len(controls), "controls,", len(regression), "journey checks")
