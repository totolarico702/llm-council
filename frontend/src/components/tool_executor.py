"""
tool_executor.py — LLM Council
================================
Exécute les nodes de type 'tool' dans le DAG.

Chaque tool reçoit :
  - node        : le dict du node (tool_type, tool_config, inputs, …)
  - user_query  : la question utilisateur
  - outputs     : dict des outputs déjà produits par les nodes précédents
  - document_content : contenu du document glissé (optionnel)

Retourne une string qui sera injectée comme output du node dans le DAG,
exactement comme un node LLM.

⚠ Status par tool_type :
  web_search   → ACTIF  (via OpenRouter web_search)
  code_exec    → STUB   (sécurité : non exécuté, output descriptif)
  file_read    → STUB
  git          → STUB
  http_call    → STUB
  custom_tool  → STUB

Les STUBs produisent un output JSON structuré décrivant ce qui serait exécuté,
permettant au pipeline de continuer et aux LLM suivants de raisonner dessus.
"""

import json
import os
from typing import Any, Dict, Optional

# ── Helpers ───────────────────────────────────────────────────────────────────

def _gather_inputs(node: Dict[str, Any], outputs: Dict[str, str],
                   user_query: str) -> str:
    """Concatène les outputs des nodes parents + la query user."""
    parts = []
    for inp in node.get("inputs", []):
        if inp == "user_prompt":
            parts.append(f"[user]: {user_query}")
        elif inp in outputs:
            parts.append(f"[{inp}]: {outputs[inp]}")
    return "\n\n".join(parts) if parts else user_query


def _stub_output(tool_type: str, config: dict, context: str) -> str:
    """
    Retourne un output structuré pour les outils non encore implémentés.
    Le LLM suivant peut raisonner sur ce que l'outil aurait retourné.
    """
    return json.dumps({
        "tool":    tool_type,
        "status":  "stub — exécution réelle non activée dans cette version",
        "config":  config,
        "context_preview": context[:200] + ("…" if len(context) > 200 else ""),
        "note": (
            "Ce node outil est défini dans le graphe et sera exécuté "
            "dans une version ultérieure du moteur. "
            "Les LLM suivants peuvent raisonner sur l'intention de cet outil."
        ),
    }, ensure_ascii=False, indent=2)


# ── Executors ─────────────────────────────────────────────────────────────────

async def _exec_web_search(node: Dict[str, Any], context: str,
                           user_query: str) -> str:
    """
    Web search via OpenRouter (modèle avec plugin web search).
    Utilise le modèle configuré ou un modèle léger par défaut.
    """
    try:
        from .openrouter import query_model

        cfg   = node.get("tool_config", {})
        query = user_query if cfg.get("query_from_input", True) else context

        messages = [
            {"role": "system", "content": (
                "You are a web search assistant. Search the web for accurate, "
                "recent information about the query and return a concise, "
                "factual summary with the key points found."
            )},
            {"role": "user", "content": query},
        ]

        # Utiliser un modèle léger avec web_search activé
        model = node.get("model") or "openai/gpt-4o-mini"
        response = await query_model(model, messages, web_search=True)

        if response and response.get("content"):
            return f"[web_search results for: {query[:80]}]\n\n{response['content']}"
        return f"[web_search] Aucun résultat pour : {query[:80]}"

    except Exception as e:
        return f"[web_search error] {e}"


async def _exec_code_exec(node: Dict[str, Any], context: str) -> str:
    cfg = node.get("tool_config", {})
    return _stub_output("code_exec", {
        "language": cfg.get("language", "python"),
        "script_preview": (cfg.get("script", "") or "")[:100],
    }, context)


async def _exec_file_read(node: Dict[str, Any], context: str) -> str:
    cfg  = node.get("tool_config", {})
    path = cfg.get("path", "").strip()

    # Sécurité minimale : pas de traversal
    if ".." in path or path.startswith("/"):
        return _stub_output("file_read", {"error": "chemin non autorisé"}, context)

    # Lecture réelle si le fichier existe dans le workspace
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(8000)  # max 8k chars
            return f"[file_read: {path}]\n\n{content}"
    except Exception as e:
        return _stub_output("file_read", {"path": path, "error": str(e)}, context)

    return _stub_output("file_read", {"path": path}, context)


async def _exec_git(node: Dict[str, Any], context: str) -> str:
    cfg = node.get("tool_config", {})
    return _stub_output("git", {"command": cfg.get("command", "git status")}, context)


async def _exec_http_call(node: Dict[str, Any], context: str) -> str:
    cfg = node.get("tool_config", {})
    # HTTP call non activé pour éviter les appels réseau non contrôlés
    return _stub_output("http_call", {
        "url":    cfg.get("url", ""),
        "method": cfg.get("method", "GET"),
    }, context)


async def _exec_custom(node: Dict[str, Any], context: str) -> str:
    cfg = node.get("tool_config", {})
    return _stub_output("custom_tool", {"command": cfg.get("command", "")}, context)


# ── Dispatcher principal ──────────────────────────────────────────────────────

EXECUTORS = {
    "web_search":  _exec_web_search,
    "code_exec":   _exec_code_exec,
    "file_read":   _exec_file_read,
    "git":         _exec_git,
    "http_call":   _exec_http_call,
    "custom_tool": _exec_custom,
}


async def execute_tool_node(
    node: Dict[str, Any],
    user_query: str,
    outputs: Dict[str, str],
    document_content: Optional[str] = None,
) -> str:
    """
    Point d'entrée unique pour exécuter un node tool.
    Appelé par dag_engine.execute_dag à la place de query_model.
    """
    tool_type = node.get("tool_type", "custom_tool")
    context   = _gather_inputs(node, outputs, user_query)

    executor = EXECUTORS.get(tool_type, _exec_custom)

    # web_search a besoin de user_query séparément
    if tool_type == "web_search":
        return await executor(node, context, user_query)
    else:
        return await executor(node, context)
