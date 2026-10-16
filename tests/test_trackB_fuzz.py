"""Track B: a bounded fuzz over every mounted route that takes a body, path ids or query values.

For each route, the request body schema is read from the app itself and each field is replaced in turn with hostile values
(null, wrong type, huge, negative, markup, SQL text, control characters). Whatever is sent, the server must answer with a clean
error envelope and never a 500, a traceback or a leaked path. Nothing here leaves the test database."""
from __future__ import annotations

import json
import re
import unittest

from support import sandbox

from backend.app.core.auth import limiter
from backend.app.main import app

BAD_VALUES = [None, "", "x" * 5000, -1, 0, 1.5, 10**30, -(10**18), [], {}, [1, 2], {"a": 1}, True, "<script>alert(1)</script>", "' OR 1=1 --",
              "../../etc/passwd", "a\u0000b", "=cmd|' /C calc'!A0", "\u202e", "9" * 400, "NaN", "Infinity"]
PATH_VALUES = ["../../etc/passwd", "%00", "' OR '1'='1", "a" * 3000, "..", "x y", "\u202e", "%2e%2e%2f", "nonexistent-id", ""]
SKIP = {  # routes that call out to a service or cost time on purpose; they have their own tests
    ("POST", "/api/assistant/chat"), ("POST", "/api/setup/draft"), ("POST", "/api/snapshot/draft"), ("POST", "/api/risk/run"),
    ("POST", "/api/auth/logout"), ("POST", "/api/auth/logout-all"),  # these end the session the rest of the fuzz needs
}
LEAK = re.compile(r"Traceback|File \"|sqlite3\.|OperationalError|IntegrityError|C:\\\\|/home/|site-packages|\.py\", line")


def resolve(schema: dict, spec: dict) -> dict:
    if "$ref" in schema:
        node = spec
        for part in schema["$ref"].lstrip("#/").split("/"):
            node = node[part]
        return resolve(node, spec)
    return schema


def body_schema(op: dict, spec: dict):
    content = (op.get("requestBody") or {}).get("content", {}).get("application/json")
    return resolve(content["schema"], spec) if content else None


def routes():
    spec = app.openapi()
    for path, item in spec["paths"].items():
        if not path.startswith("/api/"):
            continue
        for method, op in item.items():
            if method.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE") and (method.upper(), path) not in SKIP:
                yield method.upper(), path, op, spec


def fill_path(path: str, value: str) -> str:
    return re.sub(r"\{[^}]+\}", lambda _: value.replace("/", "%2F") if value else "x", path)


class TestFuzz(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = sandbox()
        cls.failures: list[str] = []
        cls.statuses: dict[int, int] = {}

    def send(self, method, path, **kw):
        limiter._hits.clear()
        try:
            r = self.c.request(method, path, **kw)
        except Exception as exc:  # a crash that escaped the app is also a failure
            self.failures.append(f"{method} {path}: exception {type(exc).__name__}: {str(exc)[:80]}")
            return None
        text = r.text[:2000]
        if r.status_code >= 500:
            self.failures.append(f"{method} {path[:70]}: HTTP {r.status_code}")
        elif LEAK.search(text):
            self.failures.append(f"{method} {path[:70]}: leaked internals: {LEAK.search(text).group(0)}")
        elif r.status_code >= 400 and r.headers.get("content-type", "").startswith("application/json"):
            body = r.json()
            if not (isinstance(body, dict) and "error" in body and isinstance(body["error"], dict) and "code" in body["error"]):
                self.failures.append(f"{method} {path[:70]}: {r.status_code} without the error envelope: {text[:80]}")
        return r

    def test_bodies_never_cause_a_server_error(self):
        count = 0
        for method, path, op, spec in routes():
            if method == "GET":
                continue
            url = fill_path(path, "nonexistent-id")
            schema = body_schema(op, spec)
            variants: list[object] = [{}, [], "text", 12, None]
            if schema and "properties" in schema:
                for field in schema["properties"]:
                    for value in BAD_VALUES:
                        variants.append({field: value})
                variants.append({"is_admin": True, "business_id": "other", "__proto__": {"x": 1}})
            for variant in variants:
                count += 1
                r = self.send(method, url, json=variant)
                if r is not None:
                    self.statuses[r.status_code] = self.statuses.get(r.status_code, 0) + 1
            self.send(method, url, content="{not json", headers={"Content-Type": "application/json"})
            self.send(method, url, content="a=b", headers={"Content-Type": "application/x-www-form-urlencoded"})
            self.send(method, url, content="plain", headers={"Content-Type": "text/plain"})
        self.assertGreater(count, 500)
        self.assertEqual(self.failures, [], "\n".join(self.failures[:40]))

    def test_one_hostile_field_in_an_otherwise_valid_body_never_causes_a_server_error(self):
        c = self.c
        customer = next(p for p in c.get("/api/parties?kind=CUSTOMER").json()["parties"] if p["name"] == "Kaveri Boutique")
        supplier = c.get("/api/parties?kind=SUPPLIER").json()["parties"][0]
        catalogue = c.get("/api/catalogue").json()
        product, material = catalogue["products"][0], catalogue["materials"][0]
        invoice = c.get(f"/api/parties/{customer['id']}").json()["open_items"][0]
        bases = [
            ("POST", "/api/transactions", {"party_id": customer["id"], "direction": "IN", "amount_paise": 100, "date": "2026-10-14", "medium": "UPI", "reference": "R1", "invoice_id": None}),
            ("POST", "/api/parties", {"kind": "CUSTOMER", "name": "Fuzz Co", "city": "Chennai", "phone": "9876543210", "terms_days": 30, "tags": ["a"]}),
            ("PATCH", f"/api/parties/{customer['id']}", {"name": "Kaveri Boutique", "city": "Chennai", "terms_days": 30, "lead_time_days": 0}),
            ("POST", f"/api/parties/{customer['id']}/notes", {"text": "called, will pay Friday"}),
            ("POST", "/api/invoices", {"party_id": customer["id"], "number": "F-1", "amount_paise": 1000, "invoice_date": "2026-10-10", "due_date": "2026-11-10"}),
            ("PATCH", f"/api/invoices/{invoice['id']}", {"promised_date": "2026-10-20"}),
            ("POST", "/api/sales-orders", {"customer_id": customer["id"], "product_id": product["id"], "qty": 5, "promised_date": "2026-12-01"}),
            ("POST", "/api/orders/what-if", {"customer_id": customer["id"], "product_id": product["id"], "qty": 5, "promised_date": "2026-12-01"}),
            ("POST", "/api/purchase-orders", {"supplier_id": supplier["id"], "material_id": material["id"], "qty": 5}),
            ("POST", "/api/stock-movements", {"item_type": "MATERIAL", "item_id": material["id"], "qty_delta": 1, "note": "count"}),
            ("POST", "/api/materials", {"name": "Fuzz dye", "unit": "kg", "cost_paise": 100, "opening_qty": 1}),
            ("PUT", f"/api/recipes/{product['id']}", {"lines": [{"material_id": material["id"], "qty_per_piece": 100, "wastage_bp": 0}], "production_cost_paise": 100, "production_days": 2}),
            ("PUT", "/api/settings/business", {"name": "Mahalakshmi Fabrics", "owner_name": "Meera", "address": "Chennai", "horizon_days": 90}),
            ("PUT", "/api/settings/money", {"safety_buffer_paise": 100000, "default_customer_terms_days": 30, "default_supplier_terms_days": 30}),
            ("POST", "/api/settings/recurring", {"label": "Rent", "amount_paise": 100000, "day_of_month": 5, "active": True}),
            ("POST", "/api/settings/facilities", {"label": "CC", "approved_limit_paise": 100000, "annual_rate_bps": 1100, "drawdown_fee_paise": 0, "available_from": "2026-10-20", "repayment_date": "2026-12-20"}),
            ("POST", "/api/team", {"email": "fz@example.com", "name": "Fz", "role": "ACCOUNTANT"}),
            ("POST", "/api/messages/draft", {"intent": "reminder", "party_id": customer["id"], "tone": "polite", "language": "en"}),
            ("POST", "/api/guard/payment-check", {"amount_paise": 100000, "date": "2026-10-20"}),
        ]
        dates = ["0001-01-01", "9999-12-31", "2026-02-30", "2024-02-29", "2026-13-01", "20261014", "2026-10-14T00:00:00", "-2026-10-14"]
        amounts = [1, 2**31, 2**53, 2**63, 10**15, -(2**63)]
        sent = 0
        for method, path, base in bases:
            for field, good in base.items():
                values = list(BAD_VALUES)
                if "date" in field:
                    values += dates
                if "paise" in field or field in ("qty", "qty_delta", "opening_qty", "terms_days", "amount"):
                    values += amounts
                for value in values:
                    sent += 1
                    self.send(method, path, json={**base, field: value})
        self.assertGreater(sent, 1500)
        self.assertEqual(self.c.get("/api/me").status_code, 200)
        self.assertEqual(self.failures, [], chr(10).join(self.failures[:40]))

    def test_path_ids_and_query_values_never_cause_a_server_error(self):
        for method, path, op, spec in routes():
            if "{" in path:
                for value in PATH_VALUES:
                    self.send(method, fill_path(path, value), json={} if method != "GET" else None)
            if method == "GET":
                for param in op.get("parameters", []):
                    if param.get("in") == "query":
                        for value in BAD_VALUES[:12]:
                            self.send("GET", fill_path(path, "x"), params={param["name"]: "" if value is None else str(value)[:300]})
        self.assertEqual(self.failures, [], "\n".join(self.failures[:40]))

    def test_every_write_is_refused_without_the_csrf_header(self):
        bare = sandbox()
        bare.headers.pop("X-Ripple", None)
        for method, path, op, spec in routes():
            if method != "GET":
                limiter._hits.clear()
                r = bare.request(method, fill_path(path, "x"), json={})
                self.assertEqual(r.status_code, 403, f"{method} {path} -> {r.status_code}")
                self.assertEqual(r.json()["error"]["code"], "MISSING_CSRF_HEADER")


if __name__ == "__main__":
    unittest.main()
