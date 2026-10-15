import sys, re, itertools
sys.path.insert(0, "tests"); sys.path.insert(0, ".")
from support import sandbox
c = sandbox()
parties = c.get("/api/parties").json()["parties"]
cust = next(p for p in parties if p["kind"] == "CUSTOMER" and p["name"].startswith("Kaveri"))
supp = next(p for p in parties if p["kind"] == "SUPPLIER")
bad, total = [], 0
for party, intents in ((cust, ["reminder", "early_discount", "deposit"]), (supp, ["extension", "instalment"])):
    for intent, tone, lang in itertools.product(intents, ["polite", "firm"], ["en", "ta", "hi"]):
        r = c.post("/api/messages/draft", json={"party_id": party["id"], "intent": intent, "tone": tone, "language": lang})
        total += 1
        if r.status_code != 200:
            bad.append((party["name"], intent, tone, lang, r.status_code, r.text[:100])); continue
        j = r.json(); text = j.get("text") or j.get("message") or ""
        if not text.strip() or re.search(r"[{}]|None|undefined|NaN|\[object", text) or "wa.me" not in (j.get("whatsapp_url") or j.get("link") or "wa.me"):
            bad.append((party["name"], intent, tone, lang, text[:120]))
print("drafts checked:", total, "| problems:", len(bad))
for b in bad[:8]: print("  ", b)
print(sorted(r.json().keys()))
