"""Generates postman/collections/ripple-api.json (Track A folders: today, book, engine, fixes, risk, guard, Munim).

Run from the repo root:  python postman/build_collection.py
The collection is plain Postman v2.1 JSON, so it can be run with the Postman CLI or Newman and imported into the Postman app.
Variables only: no credentials, tokens or keys are written into it.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = "{{base_url}}"


def js(*lines):
    return list(lines)


def req(name, method, path, tests, body=None, headers=None, csrf=True, raw_body=None, content_type="application/json", pre=None):
    hdrs = []
    if csrf and method != "GET":
        hdrs.append({"key": "X-Ripple", "value": "1"})
    if body is not None or raw_body is not None:
        hdrs.append({"key": "Content-Type", "value": content_type})
    hdrs += headers or []
    item = {"name": name, "request": {"method": method, "header": hdrs, "url": {"raw": f"{BASE}{path}", "host": ["{{base_url}}"], "path": [p for p in path.split("?")[0].split("/") if p],
                                                                                   "query": [{"key": kv.split("=")[0], "value": kv.split("=", 1)[1]} for kv in path.split("?")[1].split("&")] if "?" in path else []}},
            "event": [{"listen": "test", "script": {"type": "text/javascript", "exec": tests}}]}
    if body is not None:
        item["request"]["body"] = {"mode": "raw", "raw": json.dumps(body)}
    if raw_body is not None:
        item["request"]["body"] = {"mode": "raw", "raw": raw_body}
    if pre:
        item["event"].insert(0, {"listen": "prerequest", "script": {"type": "text/javascript", "exec": pre}})
    return item


def status(code, code_name=None):
    lines = [f"pm.test('status is {code}', () => pm.response.to.have.status({code}));"]
    if code_name:
        lines.append(f"pm.test('error code is {code_name}', () => pm.expect(pm.response.json().error.code).to.eql('{code_name}'));")
    return lines


def is_json():
    return ["pm.test('content type is JSON', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json'));"]


SKIP = ["if (!pm.environment.get('supervisor_password')) { pm.execution.skipRequest(); }"]

folders = []

folders.append({"name": "00 Not signed in", "item": [
    req("health", "GET", "/api/health", status(200) + is_json() + ["pm.test('only status ok, nothing else leaks', () => pm.expect(pm.response.json()).to.eql({status: 'ok'}));"]),
    req("health (short path)", "GET", "/health", status(200)),
    req("today needs a session", "GET", "/api/today", status(401) + ["pm.test('error envelope', () => pm.expect(pm.response.json()).to.have.nested.property('error.code'));"]),
    req("engine run needs a session", "GET", "/api/engine/run", status(401)),
    req("guard needs a session", "GET", "/api/guard", status(401)),
    req("book summary needs a session", "GET", "/api/book/summary", status(401)),
    req("munim needs a session", "POST", "/api/assistant/chat", status(401), body={"message": "hi"}),
    req("write without the CSRF header is refused before anything else", "POST", "/api/guard/payment-check", status(403, "MISSING_CSRF_HEADER"), body={"event_id": "x"}, csrf=False),
    req("unknown API path is a JSON 404", "GET", "/api/nope", status(404) + is_json()),
    req("no API documentation is exposed", "GET", "/api/docs", ["pm.test('not an interactive docs page', () => pm.expect(pm.response.text()).to.not.include('swagger-ui'));"]),
]})

folders.append({"name": "01 Session (private sandbox)", "item": [
    req("open a sandbox business", "POST", "/api/auth/demo", status(200) + ["pm.test('a session cookie was set', () => pm.expect(pm.cookies.has('ripple_session') || pm.cookies.toObject && Object.keys(pm.cookies.toObject()).length > 0).to.be.true);"]),
    req("who am I", "GET", "/api/me", status(200) + js("const me = pm.response.json();",
        "pm.test('owner role', () => pm.expect(me.user.role).to.eql('OWNER'));",
        "pm.collectionVariables.set('my_user_id', me.user.id);",
        "pm.test('sandbox flag set', () => pm.expect(me.business.is_sandbox).to.eql(true));",
        "pm.test('no password hash or token in the payload', () => pm.expect(JSON.stringify(me)).to.not.match(/scrypt|password|token/i));")),
]})

folders.append({"name": "02 Today and Book", "item": [
    req("today", "GET", "/api/today", status(200) + is_json() + js("const t = pm.response.json();",
        "pm.test('headline and position present', () => { pm.expect(t.headline).to.be.an('object'); pm.expect(t.position.cash_now_paise).to.be.a('number'); });",
        "pm.test('money is whole paise', () => ['cash_now_paise','to_receive_paise','to_pay_paise'].forEach(k => pm.expect(Number.isInteger(t.position[k])).to.be.true));",
        "pm.test('guard brief present with a valid level', () => pm.expect(['ok','watch','act']).to.include(t.guard.verdict.level));",
        "pm.test('removed count boxes are gone', () => { pm.expect(t).to.not.have.property('from_suppliers'); pm.expect(t).to.not.have.property('money_today'); });")),
    req("alerts", "GET", "/api/alerts", status(200) + js("const a = pm.response.json();", "pm.test('count matches list', () => pm.expect(a.count).to.eql(a.alerts.length));")),
    req("book summary", "GET", "/api/book/summary", status(200) + js("const b = pm.response.json();",
        "pm.test('series covers the horizon', () => pm.expect(b.series.length).to.eql(b.summary.horizon_days));",
        "pm.test('every point has integer cash and net', () => b.series.forEach(p => { pm.expect(Number.isInteger(p.cash_paise)).to.be.true; pm.expect(Number.isInteger(p.net_paise)).to.be.true; }));")),
    req("transactions list", "GET", "/api/transactions", status(200) + js("const t = pm.response.json();", "pm.test('rows and totals', () => { pm.expect(t.rows).to.be.an('array'); pm.expect(Number.isInteger(t.totals.in_paise)).to.be.true; });")),
    req("transactions: bad direction filter", "GET", "/api/transactions?direction=SIDEWAYS", status(422)),
]})

folders.append({"name": "03 Engine", "item": [
    req("engine run", "GET", "/api/engine/run", status(200) + js("const r = pm.response.json();",
        "pm.test('series and events', () => { pm.expect(r.series.length).to.be.above(0); pm.expect(r.events.length).to.be.above(0); });",
        "const sup = r.events.find(e => e.type === 'SUPPLIER_PAYMENT' && e.due_day !== null && e.executed_day === e.due_day);",
        "const rec = r.events.find(e => e.type === 'CASH_RECEIPT' && e.executed_day !== null);",
        "pm.collectionVariables.set('supplier_event', sup ? sup.id : '');",
        "pm.collectionVariables.set('receipt_event', rec ? rec.id : '');",
        "pm.collectionVariables.set('as_of', r.as_of);",
        "pm.collectionVariables.set('base_series_len', r.series.length);")),
    req("engine network view", "GET", "/api/engine/graph?view=network", status(200) + is_json()),
    req("engine day 0", "GET", "/api/engine/day/0", status(200) + js("const d = pm.response.json();", "pm.test('day log shape', () => { pm.expect(d.day).to.eql(0); pm.expect(d.rows).to.be.an('array'); pm.expect(d.source).to.eql('execution_log'); });")),
    req("engine day outside the horizon", "GET", "/api/engine/day/9999", status(422, "DAY_OUT_OF_RANGE")),
    req("engine run for an unknown scenario key", "GET", "/api/engine/run?scenario=doesnotexist", status(404, "SCENARIO_EXPIRED")),
    req("scenario: extension of a supplier bill", "POST", "/api/engine/scenario", status(200) + js("const s = pm.response.json();",
        "pm.test('a key and an evaluation come back', () => { pm.expect(s.key).to.be.a('string'); pm.expect(s.evaluation.series.length).to.eql(Number(pm.collectionVariables.get('base_series_len'))); });",
        "pm.test('the moved bill is reported as changed', () => pm.expect(s.evaluation.changed_events.length).to.be.above(0));"),
        body={"kind": "EXTENSION", "event_id": "{{supplier_event}}", "days": 10}),
    req("scenario: new payment (ADD_PAYMENT)", "POST", "/api/engine/scenario", status(200) + js("const s = pm.response.json();",
        "pm.test('the added payment appears as a new event', () => pm.expect(s.run.events.some(e => e.id.startsWith('adhoc-'))).to.be.true);"),
        body={"kind": "ADD_PAYMENT", "amount_paise": 1000000, "date": "2026-10-20", "label": "collection test"}),
    req("scenario: missing fields", "POST", "/api/engine/scenario", status(422, "MISSING_FIELDS"), body={"kind": "EXTENSION"}),
    req("scenario: date outside the horizon", "POST", "/api/engine/scenario", status(422, "DATE_OUTSIDE_HORIZON"), body={"kind": "ADD_PAYMENT", "amount_paise": 1000, "date": "2030-01-01"}),
    req("scenario: unknown kind", "POST", "/api/engine/scenario", status(422), body={"kind": "TELEPORT_CASH"}),
    req("scenario: extra property is refused", "POST", "/api/engine/scenario", status(422), body={"kind": "ADD_PAYMENT", "amount_paise": 1000, "date": "2026-10-20", "business_id": "other"}),
    req("scenario: negative amount", "POST", "/api/engine/scenario", status(422), body={"kind": "ADD_PAYMENT", "amount_paise": -5, "date": "2026-10-20"}),
    req("scenario: unknown event", "POST", "/api/engine/scenario", status(422), body={"kind": "EXTENSION", "event_id": "no-such-event", "days": 5}),
    req("scenario chance (cheap poll)", "POST", "/api/engine/scenario/chance", status(200) + js("const c = pm.response.json();", "pm.test('status is a known value', () => pm.expect(['READY','COMPUTING','MISSING','INSUFFICIENT_HISTORY','UNAVAILABLE']).to.include(c.chance_after.status));"),
        body={"kind": "ADD_PAYMENT", "amount_paise": 1000000, "date": "2026-10-20", "label": "collection test"}),
]})

folders.append({"name": "04 Fixes and risk", "item": [
    req("ways to fix", "GET", "/api/fixes", status(200) + js("const f = pm.response.json();", "pm.test('each fix has a title and a dip after', () => f.fixes.forEach(x => { pm.expect(x.fix.title).to.be.a('string'); pm.expect(x).to.have.property('dip_after_paise'); }));")),
    req("fix evaluate: unknown fix", "POST", "/api/fixes/evaluate", status(404, "UNKNOWN_FIX"), body={"fix_id": "no-such-fix"}),
    req("fix evaluate: neither fix nor kind", "POST", "/api/fixes/evaluate", status(422, "FIX_OR_KIND_REQUIRED"), body={}),
    req("risk forecast", "GET", "/api/risk/forecast", status(200) + js("const r = pm.response.json();",
        "pm.test('known status', () => pm.expect(['READY','COMPUTING','MISSING','INSUFFICIENT_HISTORY','UNAVAILABLE']).to.include(r.status));",
        "if (r.status === 'READY') {",
        "  pm.test('chances are between 0 and 1 and never fall as the window grows', () => { const c = r.shortfall_chance; pm.expect(c['30']).to.be.within(0, 1); pm.expect(c['60']).to.be.at.least(c['30']); pm.expect(c['90']).to.be.at.least(c['60']); });",
        "  pm.test('at most 36 drawn futures, each as long as the day list', () => { pm.expect(r.paths.length).to.be.at.most(36); r.paths.forEach(p => pm.expect(p.net.length).to.eql(r.path_days.length)); });",
        "}")),
]})

folders.append({"name": "05 Risk and Finance (guard)", "item": [
    req("guard", "GET", "/api/guard", status(200) + is_json() + js("const g = pm.response.json();",
        "pm.test('both halves and a verdict', () => { pm.expect(['ok','watch','act']).to.include(g.verdict.level); pm.expect(g.risk.ladder).to.be.an('array'); pm.expect(g.finance.checks).to.be.an('array'); });",
        "pm.test('safe amounts are whole thousands and never grow with the window', () => { const p = g.risk.ladder.map(r => r.plan_paise); p.forEach(v => pm.expect(v % 100000).to.eql(0)); for (let i = 1; i < p.length; i++) pm.expect(p[i]).to.be.at.most(p[i-1]); });",
        "pm.test('checks passed count is consistent', () => pm.expect(g.finance.checks_passed).to.eql(g.finance.checks.filter(c => c.ok).length));",
        "const first = g.risk.payments[0]; pm.collectionVariables.set('guard_event', first ? first.event_id : '');",
        "const dupes = g.finance.flags.rules.find(r => r.rule === 'DUPLICATE'); pm.collectionVariables.set('missed_before', dupes ? dupes.missed : 0);")),
    req("guard: yield too high", "GET", "/api/guard?yield_bp=99999", status(422)),
    req("guard: yield negative", "GET", "/api/guard?yield_bp=-1", status(422)),
    req("payment check: a bill", "POST", "/api/guard/payment-check", status(200) + js("const r = pm.response.json();",
        "pm.test('first option is the baseline and the best is one of the options', () => { pm.expect(r.options[0].id).to.eql('due'); pm.expect(r.options.map(o => o.id)).to.include(r.best); });",
        "pm.test('each option has a verdict and a figure', () => r.options.forEach(o => { pm.expect(['SAFE','TIGHT','SHORTFALL']).to.include(o.verdict); pm.expect(Number.isInteger(o.near_low_paise)).to.be.true; }));"),
        body={"event_id": "{{guard_event}}"}),
    req("payment check: a new payment", "POST", "/api/guard/payment-check", status(200) + js("const r = pm.response.json();",
        "pm.test('skipping it is never the recommendation', () => pm.expect(r.best).to.not.eql('skip'));",
        "pm.test('a real payment lowers the forecast low point', () => pm.expect(r.options.find(o => o.id === 'on').lowest_change_paise).to.be.below(0));"),
        body={"amount_paise": 15000000, "date": "2026-11-10", "label": "New loom"}),
    req("payment check: nothing to check", "POST", "/api/guard/payment-check", status(422), body={}),
    req("payment check: date outside the forecast", "POST", "/api/guard/payment-check", status(422, "DATE_OUTSIDE_HORIZON"), body={"amount_paise": 100000, "date": "2031-01-01"}),
    req("payment check: unknown bill", "POST", "/api/guard/payment-check", status(422), body={"event_id": "no-such-bill"}),
    req("payment check: negative amount", "POST", "/api/guard/payment-check", status(422), body={"amount_paise": -1, "date": "2026-10-20"}),
    req("payment check: extra property", "POST", "/api/guard/payment-check", status(422), body={"event_id": "x", "role": "OWNER"}),
    req("flag review: unknown check", "POST", "/api/guard/flags/review", status(422), body={"flag_key": "MADEUP:1", "verdict": "DISMISSED"}),
    req("flag review: bad verdict", "POST", "/api/guard/flags/review", status(422), body={"flag_key": "DUPLICATE:1", "verdict": "MAYBE"}),
    req("log a missed entry", "POST", "/api/guard/missed", status(200), body={"rule": "DUPLICATE", "note": "paid the same bill twice"}),
    req("the miss is counted (persistence)", "GET", "/api/guard", status(200) + js("const g = pm.response.json();",
        "const d = g.finance.flags.rules.find(r => r.rule === 'DUPLICATE');",
        "pm.test('missed count rose by one', () => pm.expect(d.missed).to.eql(Number(pm.collectionVariables.get('missed_before')) + 1));")),
    req("log a miss for an unknown check", "POST", "/api/guard/missed", status(422), body={"rule": "MADEUP", "note": "nothing"}),
]})

folders.append({"name": "06 Munim", "item": [
    req("ask why there is a dip", "POST", "/api/assistant/chat", status(200) + js("const c = pm.response.json();",
        "pm.test('a non-empty reply in a known mode', () => { pm.expect(c.reply).to.be.a('string').and.not.empty; pm.expect(['AI','TEMPLATE']).to.include(c.mode); pm.expect(c.grounded).to.be.a('boolean'); });",
        "pm.test('no raw error text in the reply', () => pm.expect(c.reply).to.not.match(/Traceback|Internal Server Error|undefined|\\[object Object\\]/));"),
        body={"message": "Why is there a dip?"}),
    req("ask who owes the most", "POST", "/api/assistant/chat", status(200) + js("const c = pm.response.json();", "pm.test('answers from the books, not with the runway message', () => { pm.expect(c.tools).to.include('top_owed'); });"), body={"message": "Who owes me the most?"}),
    req("ask how much is safe to spend", "POST", "/api/assistant/chat", status(200) + js("const c = pm.response.json();", "pm.test('uses the Risk and Finance tool', () => pm.expect(c.tools).to.include('get_guard'));"), body={"message": "How much can I safely spend?"}),
    req("out-of-scope question is declined", "POST", "/api/assistant/chat", status(200) + js("const c = pm.response.json();", "pm.test('declines instead of giving an unrelated answer', () => { pm.expect(c.tools).to.eql([]); pm.expect(c.reply).to.include(\"can't answer\"); });"), body={"message": "What is the weather in Chennai?"}),
    req("script tag in the question is plain text", "POST", "/api/assistant/chat", status(200) + js("const c = pm.response.json();", "pm.test('the reply does not echo markup', () => pm.expect(c.reply).to.not.include('<script'));"), body={"message": "<script>alert(1)</script>"}),
    req("blank question", "POST", "/api/assistant/chat", status(422), body={"message": "   "}),
    req("empty question", "POST", "/api/assistant/chat", status(422), body={"message": ""}),
    req("question over 1000 characters", "POST", "/api/assistant/chat", status(422), body={"message": "x" * 1001}),
    req("unknown language", "POST", "/api/assistant/chat", status(422), body={"message": "hi", "language": "xx"}),
    req("extra property is refused", "POST", "/api/assistant/chat", status(422), body={"message": "hi", "role": "OWNER"}),
    req("wrong content type", "POST", "/api/assistant/chat", status(422), raw_body="message=hi", content_type="text/plain"),
]})

folders.append({"name": "07 Supervisor role (runs only if supervisor_password is set)", "item": [
    req("sign in as the supervisor", "POST", "/api/auth/login", status(200),
        body={"email": "supervisor@ripple.demo", "password": "{{supervisor_password}}"},
        pre=SKIP),
    req("supervisor cannot read today", "GET", "/api/today", status(403), pre=SKIP),
    req("supervisor cannot read the engine", "GET", "/api/engine/run", status(403), pre=SKIP),
    req("supervisor cannot read the guard", "GET", "/api/guard", status(403), pre=SKIP),
    req("supervisor cannot read the book", "GET", "/api/book/summary", status(403), pre=SKIP),
    req("supervisor cannot log a miss", "POST", "/api/guard/missed", status(403), body={"rule": "DUPLICATE", "note": "should not be allowed"}, pre=SKIP),
    req("supervisor gets no money tools from Munim", "POST", "/api/assistant/chat", status(200) + js("const c = pm.response.json();", "pm.test('no finance tool was used', () => pm.expect(c.tools).to.not.include.members(['get_runway','get_position','get_guard','top_owed']));"), body={"message": "How much cash do we have?"}, pre=SKIP),
]})

import sys  # noqa: E402

sys.path.insert(0, str(ROOT))
from trackB_folders import build as build_track_b  # noqa: E402

folders += build_track_b(req, status, is_json, js)
# The supervisor folders sign in as the supervisor, so every folder that needs the owner's session runs before them.
folders.sort(key=lambda f: ("Supervisor" in f["name"], 0))

collection = {
    "info": {"name": "Ripple API (Track A: today, book, engine, fixes, risk, guard, Munim. Track B: parties, invoices, payments, orders, inventory, settings, cross-business)", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
             "description": "Direct API checks for the owner-facing engine screens. Sign-in uses a private sandbox business (POST /api/auth/demo), so no credentials are stored. Writes need the header X-Ripple: 1."},
    "variable": [{"key": "base_url", "value": "http://localhost:8000"}],
    "item": folders,
}
out = ROOT / "collections" / "ripple-api.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(collection, indent=1), encoding="utf8")
env = {"id": "ripple-local", "name": "Ripple local (template)", "values": [{"key": "base_url", "value": "http://localhost:8000", "enabled": True},
                                                                              {"key": "supervisor_password", "value": "", "enabled": True, "type": "secret"}],
       "_postman_variable_scope": "environment"}
(ROOT / "environments").mkdir(exist_ok=True)
(ROOT / "environments" / "local.example.json").write_text(json.dumps(env, indent=1), encoding="utf8")
print("requests:", sum(len(f["item"]) for f in folders))
