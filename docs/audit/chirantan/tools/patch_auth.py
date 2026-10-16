import os
os.chdir("C:/ripple")
p = "backend/app/core/auth.py"
s = open(p, encoding="utf8").read()
old = '''def client_ip(request: Request) -> str:
    if os.getenv("TRUST_PROXY", "1") == "1":
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"
'''
new = '''def client_ip(request: Request) -> str:
    """The address rate limits are counted against.

    Behind a proxy, each proxy appends the address it saw to X-Forwarded-For, so everything to the LEFT of the entries our own
    proxies added was written by the client and can be anything. The Nth entry from the right (N = TRUSTED_PROXY_HOPS, default 1)
    is the one a trusted proxy recorded. Taking the leftmost entry, as this used to, let one client dodge every limit by sending
    a different X-Forwarded-For header each time. Set TRUST_PROXY=0 when the app is not behind a proxy.
    """
    if os.getenv("TRUST_PROXY", "1") == "1":
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            parts = [part.strip() for part in forwarded.split(",") if part.strip()]
            try:
                hops = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))
            except ValueError:
                hops = 1
            if parts:
                return parts[-min(hops, len(parts))][:64]
    return request.client.host if request.client else "unknown"
'''
assert old in s
s = s.replace(old, new, 1)
open(p, "w", encoding="utf8").write(s)

p = "backend/app/api/auth_routes.py"
s = open(p, encoding="utf8").read()
old = '''    limiter.check(f"login:{client_ip(request)}", 10, 60)
    user = query_one("SELECT * FROM user WHERE email = ?", (body.email.strip().lower(),))'''
new = '''    limiter.check(f"login:{client_ip(request)}", 10, 60)
    # A second, slower limit per account: one address cannot be the only thing standing between a guesser and a password.
    limiter.check(f"login:acct:{body.email.strip().lower()[:120]}", 30, 900)
    user = query_one("SELECT * FROM user WHERE email = ?", (body.email.strip().lower(),))'''
assert old in s
open(p, "w", encoding="utf8").write(s.replace(old, new, 1))
print("ok")
