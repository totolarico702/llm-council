# Copyright 2026 LLM Council Project
# Licensed under MIT
# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile multi-stage — image auto-suffisante LLM Council V3
#
# Usage :
#   docker build -t llmcouncil/council:latest .
#   docker run -d \
#     -p 8001:8001 -p 8002:8002 \
#     -e OPENROUTER_API_KEY=sk-or-v1-... \
#     -v llmcouncil_data:/app/data \
#     llmcouncil/council:latest
#
# Ports :
#   8001 → API REST + PipelineEditor (static)
#   8002 → MCP Server (SSE)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1 : dépendances Python ─────────────────────────────────────────────
FROM python:3.11-slim AS backend-deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ── Stage 2 : build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --prefer-offline
COPY frontend/ ./
RUN npm run build

# ── Stage 3 : image finale ────────────────────────────────────────────────────
FROM python:3.11-slim AS final

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# UV runtime
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Venv Python
COPY --from=backend-deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Code backend
COPY pyproject.toml uv.lock ./
COPY backend/ ./backend/

# Frontend buildé
COPY --from=frontend-build /app/dist ./frontend/dist

# Données persistantes (montées en volume)
RUN mkdir -p /app/data

# Script de démarrage (API + MCP en parallèle)
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

EXPOSE 8001 8002

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8001/api/v1/health || exit 1

CMD ["/app/docker-start.sh"]
