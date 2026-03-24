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


async def _exec_rag_search(node: Dict[str, Any], context: str,
                           user_query: str) -> str:
    """
    Recherche dans le RAG organisationnel (Qdrant ou stub JSON).
    Retourne les chunks les plus pertinents formatés pour injection LLM.
    """
    try:
        from . import rag_store

        cfg     = node.get("tool_config", {})
        query   = cfg.get("query") or user_query
        limit   = int(cfg.get("limit", 5))
        filters = cfg.get("filters") or {}           # ex: {"user_login": "dupont"}
        threshold = float(cfg.get("score_threshold", 0.3))

        chunks = await rag_store.search(
            query          = query,
            limit          = limit,
            filters        = filters if filters else None,
            score_threshold = threshold,
        )

        if not chunks:
            return (
                f"[rag_search] Aucun résultat pertinent trouvé pour : {query[:80]}\n"
                f"Le RAG ne contient pas de données correspondantes."
            )

        formatted = rag_store.format_chunks_for_context(chunks, max_chars=4000)
        return f"[rag_search: {query[:60]}]\n\n{formatted}"

    except Exception as e:
        return f"[rag_search error] {e}"


async def _exec_fact_check(node: Dict[str, Any], context: str,
                           user_query: str) -> str:
    """
    Envoie le texte précédent à un LLM dédié pour vérification factuelle.
    Annote chaque affirmation avec ✅ vérifié / ⚠️ douteux / ❌ incorrect.
    """
    try:
        from .openrouter import query_model

        text_to_check = context or user_query
        prompt = (
            "Tu es un fact-checker expert. Analyse le texte suivant et :\n"
            "1. Identifie les affirmations vérifiables\n"
            "2. Note leur niveau de certitude (✅ vérifié / ⚠️ douteux / ❌ incorrect)\n"
            "3. Explique brièvement chaque annotation\n\n"
            f"Texte à vérifier :\n{text_to_check}"
        )
        model    = node.get("model") or "mistralai/mistral-medium-3"
        messages = [
            {"role": "system", "content": "Tu es un fact-checker rigoureux et impartial."},
            {"role": "user",   "content": prompt},
        ]
        response = await query_model(model, messages)
        if response and response.get("content"):
            return f"[fact_check]\n\n{response['content']}"
        return "[fact_check] Aucune réponse du modèle"
    except Exception as e:
        return f"[fact_check error] {e}"


async def _exec_mcp(node: Dict[str, Any], context: str,
                    user_query: str) -> str:
    """
    Appel d'un serveur MCP externe via HTTP POST.
    Supporte les variables dynamiques {{user_input}} et {{previous_output}}.
    """
    try:
        import httpx

        server_url = node.get("server_url", "")
        tool_name  = node.get("tool_name", "")
        raw_params = node.get("params", {})
        auth       = node.get("auth", {})

        if not server_url or not tool_name:
            return "[mcp error] server_url et tool_name sont requis"

        params: Dict[str, Any] = {}
        for key, value in raw_params.items():
            if isinstance(value, str):
                value = value.replace("{{user_input}}", user_query)
                value = value.replace("{{previous_output}}", context)
            params[key] = value

        headers: Dict[str, str] = {}
        if auth.get("type") == "bearer":
            headers["Authorization"] = f"Bearer {auth.get('token', '')}"

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{server_url}/tools/{tool_name}",
                json=params,
                headers=headers,
            )
            response.raise_for_status()
            result = response.json()

        return f"[mcp:{tool_name}]\n\n{json.dumps(result, ensure_ascii=False, indent=2)}"

    except Exception as e:
        return f"[mcp error] {e}"


# ── Dispatcher principal ──────────────────────────────────────────────────────

EXECUTORS = {
    "web_search":  _exec_web_search,
    "rag_search":  _exec_rag_search,
    "fact_check":  _exec_fact_check,
    "mcp":         _exec_mcp,
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

    # Outils nécessitant user_query séparément
    if tool_type in ("web_search", "rag_search", "fact_check", "mcp"):
        return await executor(node, context, user_query)
    else:
        return await executor(node, context)
