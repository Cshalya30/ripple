import os
os.chdir("C:/ripple")
p = "backend/app/services/munim.py"
s = open(p, encoding="utf8").read()

def rep(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)

rep("from . import fixes as fixes_service\n", "from . import fixes as fixes_service\nfrom . import guard as guard_service\n")

# new tools
rep('''def tool_get_party(ctx: Context, name: str = "", **_: Any) -> dict[str, Any]:''', '''def tool_get_guard(ctx: Context, **_: Any) -> dict[str, Any]:
    """Safe-to-spend, suspicious entries and the books check, from the Risk and Finance engine."""
    risk = risk_service.jobs.get(f"{ctx.run.built.snapshot_hash}:baseline") or {"status": "COMPUTING"}
    ladder = guard_service.safe_ladder(ctx.run, risk)
    flags = guard_service.flags(ctx.business_id)
    checks = guard_service.checks(ctx.business_id, ctx.run)
    ctx.actions.append({"type": "open_view", "screen": "book", "view": "risk"})
    return {
        "safe_to_spend": [{"within_days": r["days"], "plan": rupees(r["plan_paise"]),
                           "if_customers_pay_late": rupees(r["cautious_paise"]) if r["cautious_paise"] is not None else "risk still being calculated"} for r in ladder],
        "suspicious_entries": [{"check": f["rule_label"], "what": f["title"]} for f in flags["open"][:5]],
        "open_flag_count": flags["open_count"],
        "books_checks": f"{sum(1 for c in checks if c['ok'])} of {len(checks)} pass",
        "failed_checks": [c["title"] for c in checks if not c["ok"]],
    }


def tool_top_owed(ctx: Context, **_: Any) -> dict[str, Any]:
    """Customers ranked by what they owe, and how much of it is overdue."""
    names = {p["id"]: p["name"] for p in query("SELECT id, name FROM party WHERE business_id = ? AND kind = 'CUSTOMER'", (ctx.business_id,))}
    rows: dict[str, dict[str, int]] = {}
    for inv in open_invoices(ctx.business_id, "RECEIVABLE"):
        row = rows.setdefault(inv["party_id"], {"owed": 0, "overdue": 0})
        row["owed"] += inv["outstanding_paise"]
        if inv["days_overdue"] > 0:
            row["overdue"] += inv["outstanding_paise"]
    ranked = sorted(rows.items(), key=lambda kv: -kv[1]["owed"])[:5]
    ctx.actions.append({"type": "open_view", "screen": "khata"})
    return {"customers": [{"customer": names.get(pid, pid), "owes": rupees(v["owed"]), "of_which_overdue": rupees(v["overdue"])} for pid, v in ranked],
            "total_owed": rupees(sum(v["owed"] for v in rows.values()))}


def tool_get_party(ctx: Context, name: str = "", **_: Any) -> dict[str, Any]:''')

rep('''    "get_party": (tool_get_party,''', '''    "get_guard": (tool_get_guard, "How much is safe to spend, suspicious entries in the books, and the books check.", {}),
    "top_owed": (tool_top_owed, "Which customers owe the most and how much is overdue.", {}),
    "get_party": (tool_get_party,''')
rep('''FINANCE_TOOLS = {"get_position", "get_runway",''', '''FINANCE_TOOLS = {"get_guard", "top_owed", "get_position", "get_runway",''')

# help text
rep('''    "unknown": {
        "en": "I can only answer''', '''    "help": {
        "en": "I answer from your books. Ask me: why is there a dip, who owes me the most, how much can I safely spend, is anything suspicious, what should I do today, or give a customer's name.",
        "ta": "I answer from your books. Ask me: why is there a dip, who owes me the most, how much can I safely spend, is anything suspicious, what should I do today, or give a customer's name.",
        "hi": "I answer from your books. Ask me: why is there a dip, who owes me the most, how much can I safely spend, is anything suspicious, what should I do today, or give a customer's name.",
    },
    "unknown": {
        "en": "I can only answer''')
rep("Try: why the dip, ways to fix, who to chase, or a customer's name.\"", "Try: why the dip, ways to fix, who owes me, how much can I safely spend, or a customer's name.\"")

# routing: explicit intents before the party branch, and no catch-all runway answer
rep('''    elif party and ctx.role != "SUPERVISOR":
        intent = "reminder"''', '''    elif ctx.role != "SUPERVISOR" and any(w in text for w in ("safe", "spend", "afford", "invest", "spare", "idle", "suspicious", "suspect", "flag", "duplicate", "fraud", "mistake", "reconcil", "books check")):
        r = use("get_guard")
        thirty = next((x for x in r["safe_to_spend"] if x["within_days"] == 30), None)
        parts = []
        if thirty:
            parts.append(f"Safe to spend over the next 30 days: {thirty['if_customers_pay_late']} (plan {thirty['plan']}).")
        parts.append(f"Books check: {r['books_checks']}." + (f" Failed: {', '.join(r['failed_checks'])}." if r["failed_checks"] else ""))
        parts.append(f"{r['open_flag_count']} suspicious {'entry' if r['open_flag_count'] == 1 else 'entries'} to review." + "".join(f" {e['what']}." for e in r["suspicious_entries"][:3]))
        reply = " ".join(parts)
    elif ctx.role != "SUPERVISOR" and any(w in text for w in ("owe", "owes", "owed", "receivable", "outstanding", "who has not paid", "unpaid")):
        r = use("top_owed")
        reply = (f"Customers owe {r['total_owed']} in total.\\n" + "\\n".join(f"- {c['customer']}: {c['owes']} ({c['of_which_overdue']} overdue)" for c in r["customers"])) if r["customers"] else "No customer owes you anything right now."
    elif party and ctx.role != "SUPERVISOR":
        intent = "reminder"''')
rep('''    elif ctx.role != "SUPERVISOR":
        r = use("get_runway")
        if r["first_shortfall"]:''', '''    elif ctx.role != "SUPERVISOR" and re.fullmatch(r"\\W*(hi|hello|hey|namaste|vanakkam|help|what can you do)\\W*", text):
        reply = T["help"][lang]
    elif ctx.role != "SUPERVISOR" and any(w in text for w in ("dip", "short", "run out", "runs out", "runway", "why", "when", "gap", "பற்றாக்குறை", "कमी")):
        r = use("get_runway")
        if r["first_shortfall"]:''')
open(p, "w", encoding="utf8").write(s)

# blank messages are not a question
p = "backend/app/api/app_routes.py"
s = open(p, encoding="utf8").read()
rep('''    message: str = Field(min_length=1, max_length=1000)
    context: ChatContext | None = None''', '''    message: str = Field(min_length=1, max_length=1000)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Type a question first.")
        return value.strip()

    context: ChatContext | None = None''')
open(p, "w", encoding="utf8").write(s)
print("ok")
