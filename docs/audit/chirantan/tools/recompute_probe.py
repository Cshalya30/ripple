import sys, json
sys.path.insert(0, "tests"); sys.path.insert(0, ".")
from support import sandbox
c = sandbox()
run = c.get("/api/engine/run").json()
base = {p["day"]: p for p in run["series"]}
print("keys", list(run.keys())[:12], "series0", run["series"][0])
pos = c.get("/api/book/summary").json()["position"]
print("cash_now", pos["cash_now_paise"], "series0 cash", base[0]["cash_paise"], "net0", base[0]["net_paise"], "net today (position)", pos["net_paise"])
def delta(body):
    r = c.post("/api/engine/scenario", json=body); j = r.json()
    ev = j["evaluation"]; s = {p["day"]: p for p in ev["series"]}
    return [(d, s[d]["net_paise"] - base[d]["net_paise"], s[d]["cash_paise"] - base[d]["cash_paise"]) for d in range(0, 45)]
amt = 1_000_000
d = delta({"kind": "ADD_PAYMENT", "amount_paise": amt, "date": "2026-10-20", "label": "t"})
print("ADD", [(x[0], x[1]) for x in d if x[0] in (5, 6, 7, 20, 30, 33, 34, 35, 44)])
ev = [e for e in run["events"] if e["type"] == "SUPPLIER_PAYMENT" and e.get("due_date")]
e0 = sorted(ev, key=lambda e: e["due_day"])[0]; print("pay event", e0["id"], e0["due_date"], e0["amount_paise"], e0["executed_day"])
d = delta({"kind": "EXTENSION", "event_id": e0["id"], "days": 10})
print("EXT", [(x[0], x[1]) for x in d if x[1] != 0][:25])
rc = [e for e in run["events"] if e["type"] == "CASH_RECEIPT" and e["executed_day"] is not None and e["executed_day"] > 3][0]; print("receipt", rc["id"], rc["executed_day"], rc["amount_paise"])
d = delta({"kind": "MOVE_RECEIPT_DATE", "event_id": rc["id"], "date": "2026-11-20"})
print("MOVE", [(x[0], x[1], x[2]) for x in d if x[1] != 0][:30])
