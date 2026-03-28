#!/bin/bash
# Copyright 2026 LLM Council Project
# Script de démarrage Docker — démarre API + MCP server en parallèle

set -e

# Démarrer le MCP server SSE en arrière-plan
python -m backend.mcp_server --sse &
MCP_PID=$!
echo "[start] MCP server démarré (PID $MCP_PID) sur :${MCP_PORT:-8002}"

# Trap pour arrêter proprement le MCP server si le conteneur est stoppé
trap "kill $MCP_PID 2>/dev/null; exit 0" SIGTERM SIGINT

# Démarrer l'API FastAPI (bloquant)
exec uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8001 \
    --workers ${UVICORN_WORKERS:-1} \
    --log-level ${LOG_LEVEL:-info}
