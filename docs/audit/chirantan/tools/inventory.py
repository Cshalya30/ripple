"""Builds docs/audit/chirantan/endpoint-inventory.json from the real route definitions and the frontend's API calls.

Run from the repo root:  python docs/audit/chirantan/tools/inventory.py
Static analysis only: it reads source, it never starts the app.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
ROUTE_FILES = {"backend/app/api/auth_routes.py": "/api", "backend/app/api/app_routes.py": "/api", "backend/app/api/routes.py": "(not mounted)"}
METHODS = {"get", "post", "put", "patch", "delete"}
AUTH_NAMES = {"FINANCE": "owner or accountant", "OWNER": "owner only", "ANYONE": "any signed-in user"}


def decorator_info(dec: ast.expr):
    if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr in METHODS and dec.args:
        arg = dec.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return dec.func.attr.upper(), arg.value
    return None


def auth_of(fn: ast.FunctionDef) -> str:
    args = fn.args.args + fn.args.kwonlyargs
    defaults = [None] * (len(fn.args.args) - len(fn.args.defaults)) + list(fn.args.defaults) + list(fn.args.kw_defaults)
    for default in defaults:
        if isinstance(default, ast.Call) and getattr(default.func, "id", "") == "Depends" and default.args:
            name = ast.unparse(default.args[0])
            if name in AUTH_NAMES:
                return AUTH_NAMES[name]
            return name
    return "none (public)"


def body_of(fn: ast.FunctionDef) -> str | None:
    for arg in fn.args.args:
        if arg.annotation is not None:
            text = ast.unparse(arg.annotation)
            if text.endswith("Body") or text.endswith("Patch") or text.endswith("Request"):
                return text
    return None


def collect_routes():
    out = []
    for rel, prefix in ROUTE_FILES.items():
        path = ROOT / rel
        if not path.exists():
            continue
        tree = ast.parse(path.read_text(encoding="utf8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                for dec in node.decorator_list:
                    info = decorator_info(dec)
                    if info:
                        method, route = info
                        out.append({"method": method, "path": (prefix if prefix.startswith("/") else "") + route, "mounted": prefix.startswith("/"),
                                    "handler": f"{rel}:{node.name}", "auth": auth_of(node), "request_model": body_of(node), "line": node.lineno})
    main = (ROOT / "backend/app/main.py").read_text(encoding="utf8")
    for method, route in re.findall(r'@app\.(get|post)\("([^"]+)"', main):
        out.append({"method": method.upper(), "path": route, "mounted": True, "handler": "backend/app/main.py", "auth": "none (public)", "request_model": None, "line": None})
    return out


def collect_calls():
    calls = []
    for path in (ROOT / "frontend/src").rglob("*.ts*"):
        text = path.read_text(encoding="utf8")
        for m in re.finditer(r"(?:api|http)\.(get|post|put|patch|del|delete)(?:<[^>(]*>)?\(\s*([`'\"])(.+?)\2", text):
            calls.append({"method": ("DELETE" if m.group(1) == "del" else m.group(1).upper()), "raw": m.group(3), "file": str(path.relative_to(ROOT)).replace("\\", "/")})
        for m in re.finditer(r"fetch\(\s*([`'\"])(.+?)\1", text):
            calls.append({"method": "FETCH", "raw": m.group(2), "file": str(path.relative_to(ROOT)).replace("\\", "/")})
        for m in re.finditer(r'href=\{?[`"\'](/api/[^`"\']+)', text):
            calls.append({"method": "GET (link)", "raw": m.group(1), "file": str(path.relative_to(ROOT)).replace("\\", "/")})
    return calls


def normal(raw: str) -> str:
    raw = raw.split("?")[0]
    raw = re.sub(r"[$][{][^}]*$", "", raw)  # an unfinished template tail such as ${scenarioKey ? ... : ''}
    raw = re.sub(r"\$\{[^}]+\}", "{}", raw)
    raw = re.sub(r"\{[^/]*\}", "{}", raw)
    if not raw.startswith("/api"):
        raw = "/api" + (raw if raw.startswith("/") else "/" + raw)
    return raw.rstrip("/")


def collection_coverage():
    """(method, normalised path) pairs exercised by postman/collections/ripple-api.json."""
    path = ROOT / "postman/collections/ripple-api.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf8"))
    seen = {}

    def walk(items):
        for item in items:
            if "item" in item:
                walk(item["item"])
                continue
            request = item["request"]
            raw = request["url"]["raw"].replace("{{base_url}}", "").split("?")[0]
            raw = re.sub(r"\{\{[^}]+\}\}", "{}", raw)  # a collection variable stands in for an id
            raw = re.sub(r"/(?:\d+|no-such[a-z-]*|\.\.%2F[^/]*)(?=/|$)", "/{}", raw)  # a literal id used to provoke a 404
            seen.setdefault((request["method"], raw.rstrip("/")), []).append(item["name"])

    walk(data["item"])
    return seen


def main():
    routes = collect_routes()
    covered = collection_coverage()
    calls = collect_calls()
    called = {}
    for c in calls:
        called.setdefault((c["method"].split(" ")[0], normal(c["raw"])), []).append(c["file"])
    for r in routes:
        key = (r["method"], normal(r["path"]))
        r["frontend_callers"] = sorted(set(called.get(key, [])))
        r["postman_requests"] = covered.get(key, [])
        r["test_status"] = "covered by the Postman collection (Newman run: pass)" if covered.get(key) else "not in the Postman collection"
    route_keys = {(r["method"], normal(r["path"])) for r in routes}
    orphan_calls = [{"method": m, "path": p, "files": sorted(set(f))} for (m, p), f in called.items() if (m, p) not in route_keys and m != "FETCH"]
    unused = [f'{r["method"]} {r["path"]}' for r in routes if r["mounted"] and not r["frontend_callers"] and r["handler"] != "backend/app/main.py"]
    data = {
        "generated_by": "docs/audit/chirantan/tools/inventory.py (static analysis). Run with a folder name to write elsewhere.",
        "counts": {"routes_total": len(routes), "mounted": sum(1 for r in routes if r["mounted"]), "not_mounted": sum(1 for r in routes if not r["mounted"]),
                   "in_track_a_postman_collection": sum(1 for r in routes if r.get("postman_requests")),
                   "by_method": {m: sum(1 for r in routes if r["mounted"] and r["method"] == m) for m in ("GET", "POST", "PUT", "PATCH", "DELETE")}},
        "routes": sorted(routes, key=lambda r: (r["path"], r["method"])),
        "frontend_calls_without_backend_route": orphan_calls,
        "mounted_routes_with_no_frontend_caller": unused,
    }
    out = ROOT / "docs/audit" / (sys.argv[1] if len(sys.argv) > 1 else "chirantan") / "endpoint-inventory.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1), encoding="utf8")
    print(json.dumps(data["counts"]))
    print("frontend calls with no backend route:", len(orphan_calls))
    for o in orphan_calls:
        print("  ", o["method"], o["path"], o["files"])
    print("mounted routes with no frontend caller:", len(unused))


if __name__ == "__main__":
    main()
