# Copyright 2026 LLM Council Project
# Licensed under MIT
"""
mcp_server.py — LLM Council MCP Server (Sprint 2)

Expose le moteur de délibération comme outils MCP natifs.
Compatible Claude Desktop, n8n, Cursor et tout client MCP.

Transport :
  - stdio  (défaut)        : python -m backend.mcp_server
  - SSE    (Docker/:8002)  : python -m backend.mcp_server --sse

Configuration Claude Desktop :
  {
    "mcpServers": {
      "llm-council": {
        "command": "docker",
        "args": ["run", "--rm", "-i",
                 "-e", "OPENROUTER_API_KEY=sk-or-v1-...",
                 "-e", "LLM_COUNCIL_API_KEY=llmc_...",
                 "llmcouncil/council:latest",
                 "python", "-m", "backend.mcp_server"]
      }
    }
  }
"""
import os, sys, json, asyncio
from typing import Optional

# ── Dépendance optionnelle : mcp SDK ─────────────────────────────────────────
try:
    from mcp.server.fastmcp import FastMCP
    _HAS_MCP = True
except ImportError:
    _HAS_MCP = False

if not _HAS_MCP:
    print(
        "[mcp_server] Package 'mcp' introuvable. "
        "Installez-le : uv add mcp",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Init FastMCP ───────────────────────────────────────────────────────────────

_PORT = int(os.getenv("MCP_PORT", "8002"))
mcp   = FastMCP(
    "LLM Council",
    host = "0.0.0.0",
    port = _PORT,
)

# ── Import du moteur (chemin relatif depuis package) ──────────────────────────

def _get_engine():
    """Import tardif pour éviter les effets de bord au chargement du module."""
    from .dag_engine   import run_pipeline as execute_dag
    from .cog_parser   import parse_cog, cog_to_dag
    from .cost_estimator import estimate_pipeline_cost
    from . import db
    return execute_dag, parse_cog, cog_to_dag, estimate_pipeline_cost, db


# ── Outil 1 : deliberate ──────────────────────────────────────────────────────

@mcp.tool()
async def deliberate(
    message: str,
    pipeline_id: Optional[str] = None,
    cog: Optional[dict] = None,
    context: Optional[str] = None,
    language: str = "fr",
    timeout: int = 300,
) -> str:
    """
    Submit a question to the LLM Council for multi-model deliberation.

    Multiple LLMs debate the question anonymously, score each other's responses,
    and a Chairman synthesizes the final answer.

    Args:
        message:     The question or task to deliberate on.
        pipeline_id: ID of a saved pipeline to use (optional).
        cog:         Inline .cog pipeline definition (optional, overrides pipeline_id).
        context:     External context to inject (e.g. RAG content from your own system).
        language:    Response language ("fr" or "en"). Default: "fr".
        timeout:     Max execution time in seconds. Default: 300.

    Returns:
        The final synthesized answer from the Chairman.
    """
    execute_dag, parse_cog, cog_to_dag, _, db_mod = _get_engine()

    # Résoudre le .cog
    if cog:
        cog_doc = parse_cog(cog)
    elif pipeline_id:
        group = db_mod.get_group(pipeline_id)
        if not group:
            return f"[Erreur] Pipeline '{pipeline_id}' introuvable."
        cog_doc = {
            "cog_version": "1.0",
            "nodes":  group.get("nodes", []),
            "edges":  group.get("edges", []),
            "config": group.get("config", {}),
        }
    else:
        return "[Erreur] Fournissez pipeline_id ou cog."

    dag   = cog_to_dag(cog_doc)
    nodes = dag["nodes"]

    try:
        result = await asyncio.wait_for(
            execute_dag(
                nodes            = nodes,
                user_query       = message,
                document_content = context,
                user_language    = language,
            ),
            timeout=timeout,
        )
        return result.get("final", "(aucune réponse)")
    except asyncio.TimeoutError:
        return f"[Erreur] Pipeline timeout après {timeout}s."
    except Exception as e:
        return f"[Erreur] {e}"


# ── Outil 2 : validate_cog ────────────────────────────────────────────────────

@mcp.tool()
def validate_cog(cog: dict) -> dict:
    """
    Validate a .cog pipeline definition without executing it.

    Returns a validation report: valid (bool), node_count, any errors.
    """
    _, parse_cog_fn, *_ = _get_engine()
    try:
        doc = parse_cog_fn(cog)
        return {
            "valid":       True,
            "cog_version": doc.get("cog_version"),
            "name":        doc.get("name", ""),
            "node_count":  len(doc.get("nodes", [])),
            "edge_count":  len(doc.get("edges", [])),
        }
    except ValueError as e:
        return {"valid": False, "error": str(e)}


# ── Outil 3 : list_pipelines ──────────────────────────────────────────────────

@mcp.tool()
def list_pipelines() -> list:
    """
    List all saved pipelines available in LLM Council.

    Returns a list of {id, name, node_count} for each saved pipeline.
    """
    *_, db_mod = _get_engine()
    groups = db_mod.list_groups()
    return [
        {
            "id":         g["id"],
            "name":       g.get("name", ""),
            "node_count": len(g.get("nodes", [])),
            "created_at": g.get("created_at", ""),
        }
        for g in groups
    ]


# ── Outil 4 : estimate_cost ───────────────────────────────────────────────────

@mcp.tool()
def estimate_cost(cog: dict) -> dict:
    """
    Estimate the cost (USD) of running a .cog pipeline.

    Returns total_usd and a per-node cost breakdown.
    """
    _, parse_cog_fn, cog_to_dag_fn, estimate_fn, _ = _get_engine()
    try:
        doc = parse_cog_fn(cog)
        dag = cog_to_dag_fn(doc)
        return estimate_fn(dag)
    except ValueError as e:
        return {"error": str(e)}


# ── Entrée principale ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    transport = "stdio"
    if "--sse" in sys.argv:
        transport = "sse"
        print(f"[mcp_server] Démarrage SSE sur :{_PORT}", file=sys.stderr)
    else:
        print("[mcp_server] Démarrage stdio", file=sys.stderr)

    mcp.run(transport=transport)
