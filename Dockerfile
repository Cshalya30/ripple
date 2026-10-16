# Ripple: one service. FastAPI serves /api and the built SPA from the same origin.

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DATABASE_URL=/data/ripple.db FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist frontend/dist
RUN mkdir -p /data
EXPOSE 8000
# One worker: rate limits, caches and intake drafts live in process memory.
# Runs as root on purpose: a Railway volume is mounted root-owned, and a non-root user cannot write to it. /data is not made world-writable.
CMD ["sh", "-c", "mkdir -p /data && exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
