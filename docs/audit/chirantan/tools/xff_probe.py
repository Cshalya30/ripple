import sys
sys.path.insert(0, "tests"); sys.path.insert(0, ".")
from support import client
c = client(); c.__enter__()
plain = [c.post("/api/auth/demo").status_code for _ in range(8)]
print("same client, 8 demo requests:", plain)
from backend.app.core.auth import limiter
limiter._hits.clear()
spoof = [c.post("/api/auth/demo", headers={"X-Forwarded-For": f"10.9.8.{i}"}).status_code for i in range(8)]
print("8 requests each with a different X-Forwarded-For:", spoof)
limiter._hits.clear()
login = [c.post("/api/auth/login", json={"email": "owner@ripple.demo", "password": "wrong"}, headers={"X-Forwarded-For": f"10.1.1.{i}"}).status_code for i in range(15)]
print("15 wrong-password logins, rotating X-Forwarded-For:", login)
limiter._hits.clear()
login2 = [c.post("/api/auth/login", json={"email": "owner@ripple.demo", "password": "wrong"}).status_code for i in range(15)]
print("15 wrong-password logins, no header:", login2)
