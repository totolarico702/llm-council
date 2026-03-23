"""
DAG Execution Engine for LLM Council.

Each node in the graph has:
  - id          : unique identifier within the graph
  - model       : OpenRouter model string
  - role        : explorer / critic / optimizer / devil_advocate / synthesizer / reader / custom
  - role_prompt : system prompt injected for this node (auto-filled from role if empty)
  - inputs      : list of node ids whose output this node receives ([] = user_prompt only)
  - accepts_documents : bool — whether this node receives uploaded documents

The chairman node is the node with no downstream consumers (leaf node).
"""

from typing import List, Dict, Any, Optional, AsyncGenerator
import json

from .openrouter import query_model, health_check_pipeline
from .fallback_models import get_chain, FALLBACK_CHAINS
from .tool_executor import execute_tool_node
from .usage_logger import log_fallback_incident
from .config import DEFAULT_MODEL, DEFAULT_CHAIRMAN
from . import rag_store

# ─── Résolution du modèle d'un node ──────────────────────────────────────────

def resolve_model(node: dict) -> str:
    """
    Retourne le modèle à utiliser pour un node.
    Priorité : modèle explicite > rôle chairman > défaut global.

    Un node sans modèle (ou model='') utilise le DEFAULT_MODEL configuré
    par l'admin, ce qui permet de changer le modèle de toute une flotte
    de pipelines en une seule opération.
    """
    import os as _os
    model = (node.get("model") or "").strip()
    if model and model != "default":
        return model
    if node.get("role") == "chairman":
        return _os.getenv("DEFAULT_CHAIRMAN", DEFAULT_CHAIRMAN)
    return _os.getenv("DEFAULT_MODEL", DEFAULT_MODEL)


# ─── Normalisation des IDs modèles ───────────────────────────────────────────

# Préfixes connus OpenRouter + locaux
_KNOWN_PREFIXES = [
    "google/", "openai/", "anthropic/", "meta-llama/", "mistralai/",
    "deepseek/", "qwen/", "cohere/", "nvidia/", "microsoft/",
    "amazon/", "01-ai/", "x-ai/", "perplexity/", "nous/",
    "ollama/", "local/",  # nœuds locaux Ollama
]


def is_local_model(model: str) -> bool:
    """Retourne True si le modèle est destiné à Ollama (local)."""
    return model.startswith("ollama/") or model.startswith("local/")

def normalize_model_id(model: str) -> str:
    """
    Assure que l'ID modèle a le format provider/model-name attendu par OpenRouter.
    Si l'ID est déjà préfixé → retourné tel quel.
    Sinon → cherche dans FALLBACK_CHAINS et les préfixes connus.
    """
    if not model:
        return model
    # Déjà préfixé
    if any(model.startswith(p) for p in _KNOWN_PREFIXES):
        return model
    # Chercher dans la table de fallbacks (clé complète contenant le nom court)
    for full_id in FALLBACK_CHAINS.keys():
        short = full_id.split("/", 1)[-1]
        if short == model or short.replace(":free", "") == model:
            print(f"[DAG] ⚠ ID normalisé: '{model}' → '{full_id}'")
            return full_id
    # Pas trouvé — retourner tel quel, OpenRouter donnera l'erreur explicite
    print(f"[DAG] ⚠ ID modèle inconnu (pas de préfixe): '{model}' — vérifier le pipeline")
    return model

# ─── Role system prompts ──────────────────────────────────────────────────────

DEFAULT_ROLE_PROMPTS: Dict[str, str] = {
    "explorer": (
        "Tu es un explorateur d'idées créatif. "
        "Propose plusieurs angles d'approche différents, "
        "pense hors des sentiers battus."
    ),
    "critic": (
        "Tu es un esprit critique rigoureux. "
        "Identifie les failles, les points faibles et "
        "les angles morts dans les propositions présentées. "
        "Sois constructif mais sans concession."
    ),
    "synthesizer": (
        "Tu es un synthétiseur expert. "
        "Unifie les différents points de vue en une "
        "synthèse cohérente et actionnable."
    ),
    "optimizer": (
        "Tu es un optimiseur. Prends les meilleures idées "
        "et améliore-les concrètement."
    ),
    "reader": (
        "Tu es un lecteur analytique. "
        "Lis et analyse attentivement le contenu fourni, "
        "extrait les informations clés."
    ),
    "devil_advocate": (
        "Tu es un contradicteur. Trouve des arguments "
        "opposés aux propositions présentées pour enrichir "
        "le débat."
    ),
    "contradicteur": (
        "Tu es un contradicteur. Trouve des arguments "
        "opposés aux propositions présentées pour enrichir "
        "le débat."
    ),
    "chairman": (
        "Tu es le président du council. "
        "Tu reçois les contributions de tous les agents "
        "et produis une synthèse finale claire, structurée "
        "et directement actionnable."
    ),
    "custom": "",
}

# Alias conservé pour compatibilité interne
ROLE_PROMPTS = DEFAULT_ROLE_PROMPTS

LANG_INSTRUCTION: Dict[str, str] = {
    "fr": "Réponds toujours en français.",
    "en": "Always answer in English.",
}


def get_system_prompt(node: Dict[str, Any], language: str = "fr") -> str:
    """Return the effective system prompt for a node.

    Priority: explicit role_prompt > default prompt for the node's role.
    The language instruction is appended dynamically based on user preference.
    """
    custom = (node.get("role_prompt") or node.get("system_prompt") or "").strip()
    base = custom if custom else DEFAULT_ROLE_PROMPTS.get(node.get("role", ""), "")
    lang_suffix = LANG_INSTRUCTION.get(language, LANG_INSTRUCTION["fr"])
    return f"{base} {lang_suffix}".strip() if base else lang_suffix


# ─── DAG validation ───────────────────────────────────────────────────────────

def validate_dag(nodes: List[Dict[str, Any]]) -> List[str]:
    """
    Returns a list of error strings. Empty list = valid DAG.
    Checks:
      - All input references exist
      - No cycles (DFS)
      - Exactly one terminal node (no outgoing edges)
    """
    errors = []
    node_ids = {n["id"] for n in nodes}

    # Check all inputs reference existing nodes
    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt" and inp not in node_ids:
                errors.append(f"Node '{node['id']}' references unknown input '{inp}'")

    if errors:
        return errors

    # Cycle detection via DFS
    adj: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt":
                adj[inp].append(node["id"])

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n["id"]: WHITE for n in nodes}

    def dfs(nid: str) -> bool:
        color[nid] = GRAY
        for neighbor in adj[nid]:
            if color[neighbor] == GRAY:
                return True  # cycle found
            if color[neighbor] == WHITE and dfs(neighbor):
                return True
        color[nid] = BLACK
        return False

    for node in nodes:
        if color[node["id"]] == WHITE:
            if dfs(node["id"]):
                errors.append("Graph contains a cycle — DAG must be acyclic")
                break

    return errors


def topological_sort(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Kahn's algorithm — returns nodes in execution order.
    Nodes with inputs=[] or inputs=["user_prompt"] are roots.
    """
    node_map = {n["id"]: n for n in nodes}
    in_degree: Dict[str, int] = {n["id"]: 0 for n in nodes}

    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt" and inp in in_degree:
                in_degree[node["id"]] += 1

    queue = [n for n in nodes if in_degree[n["id"]] == 0]
    sorted_nodes = []

    # Build adjacency: who depends on me?
    dependents: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt" and inp in dependents:
                dependents[inp].append(node["id"])

    while queue:
        node = queue.pop(0)
        sorted_nodes.append(node)
        for dep_id in dependents[node["id"]]:
            in_degree[dep_id] -= 1
            if in_degree[dep_id] == 0:
                queue.append(node_map[dep_id])

    return sorted_nodes


def find_terminal_node(nodes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The terminal node is the one no other node depends on."""
    referenced_as_input = set()
    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt":
                referenced_as_input.add(inp)
    terminals = [n for n in nodes if n["id"] not in referenced_as_input]
    return terminals[-1] if terminals else nodes[-1]


# ─── Node prompt builder ──────────────────────────────────────────────────────

def build_node_prompt(
    node: Dict[str, Any],
    user_query: str,
    outputs: Dict[str, str],
    document_content: Optional[str],
    web_search_mode: str,
    language: str = "fr",
) -> tuple[str, str]:
    """
    Returns (system_prompt, user_prompt_for_node).
    """
    system_prompt = get_system_prompt(node, language=language)

    parts = []

    # Document injection — injecté sur tous les nodes si présent
    # (plus besoin de accepts_documents : le contexte document est global au pipeline)
    if document_content:
        parts.append(
            f"[DOCUMENT PROVIDED BY USER]\n{document_content}\n[END DOCUMENT]\n"
        )

    # Outputs from parent nodes
    parent_inputs = [
        inp for inp in node.get("inputs", [])
        if inp != "user_prompt" and inp in outputs
    ]
    if parent_inputs:
        parts.append("--- Previous agent contributions ---")
        for inp_id in parent_inputs:
            parts.append(f"[{inp_id}]:\n{outputs[inp_id]}")
        parts.append("--- End of contributions ---\n")

    # User query
    parts.append(f"User question: {user_query}")

    # Web search hint selon le niveau
    node_ws = node.get("web_search", "none")
    if isinstance(node_ws, bool):
        node_ws = "deep" if node_ws else "none"
    effective_ws = web_search_mode
    if node_ws == "deep":
        effective_ws = "deep"
    elif node_ws == "factcheck" and effective_ws == "none":
        effective_ws = "factcheck"

    if effective_ws == "deep":
        parts.append(
            "\nYou have access to web search. "
            "Actively use it to find recent information, verify facts, and enrich your response."
        )
    elif effective_ws == "factcheck":
        parts.append(
            "\nIf you are unsure about a specific fact, date, name, or statistic, "
            "use web search to verify it before including it in your response."
        )

    return system_prompt, "\n\n".join(parts)


# ─── RAG enrichissement du prompt ────────────────────────────────────────────

async def build_prompt_with_rag(node: dict, user_prompt: str, service_id: str = "global") -> str:
    """
    Enrichit le user_prompt avec le contexte RAG si use_rag=True sur le node.
    Les filtres service_id, folder_id, doc_id sont configurables par node.
    """
    if not node.get("use_rag", False):
        return user_prompt

    rag_filter = {
        "service_id": node.get("rag_service") or service_id,
        "folder_id":  node.get("rag_folder"),
        "doc_id":     node.get("rag_doc_id"),
    }
    try:
        chunks = await rag_store.search(
            query  = user_prompt,
            limit  = node.get("rag_limit", 5),
            **{k: v for k, v in rag_filter.items() if v},
        )
    except Exception as e:
        print(f"[DAG] RAG search error: {e}")
        return user_prompt

    if not chunks:
        return user_prompt

    context = rag_store.format_chunks_for_context(chunks)
    return f"{context}\n\n{user_prompt}"


# ─── Main DAG executor ────────────────────────────────────────────────────────

async def execute_dag(
    nodes: List[Dict[str, Any]],
    user_query: str,
    history: List[Dict[str, Any]] = None,
    document_content: Optional[str] = None,
    web_search_mode: str = "none",
    on_node_start=None,   # async callback(node_id, model, role)
    on_node_done=None,    # async callback(node_id, model, role, output)
    on_node_error=None,   # async callback(node_id, error_msg)
    user_id: Optional[str] = None,
    pipeline_id: Optional[str] = None,
    user_language: str = "fr",
    service_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute the DAG and return:
    {
        "outputs": { node_id: response_text },
        "final": response_text of terminal node,
        "terminal_node": node dict,
        "errors": { node_id: error_message },
        "execution_order": [node_id, ...]
    }
    """
    # Validate
    errors_found = validate_dag(nodes)
    if errors_found:
        return {
            "outputs": {},
            "final": f"DAG validation error: {'; '.join(errors_found)}",
            "terminal_node": nodes[-1] if nodes else {},
            "errors": {"_validation": errors_found},
            "execution_order": []
        }

    execution_order = topological_sort(nodes)
    terminal_node = find_terminal_node(nodes)

    # ── Health check pré-exécution ────────────────────────────────────────────
    try:
        health = await health_check_pipeline(nodes)
        if not health["ok"]:
            for nid, ns in health["nodes"].items():
                if not ns["available"] and ns.get("fallback") and not ns.get("local"):
                    # Modèles locaux (Ollama) n'ont pas de fallback cloud — warning ignoré
                    print(f"[DAG] ⚠ {nid}: {ns['model']} indisponible → fallback {ns['fallback']}")
                    log_fallback_incident(
                        original_model=ns["model"],
                        fallback_model=ns["fallback"],
                        reason="model_unavailable",
                        node_id=nid,
                        pipeline_id=pipeline_id,
                        user_id=user_id,
                    )
    except Exception as e:
        print(f"[DAG] health check error (ignoré): {e}")

    # ── Log de démarrage ─────────────────────────────────────────────────────
    term_id = terminal_node["id"] if terminal_node else "?"
    print(f"\n[DAG] ▶ Démarrage — {len(execution_order)} nodes | terminal: {term_id}")
    print(f"[DAG] Ordre topologique: {' → '.join(n['id'] for n in execution_order)}")
    for n in nodes:
        ntype = n.get('node_type', 'llm')
        if ntype == 'tool':
            print(f"[DAG]   ⚙ {n['id']} ({n.get('tool_type','?')}) ← {n.get('inputs',[])}")
        else:
            ws = n.get('web_search','none')
            ws_tag = f" 🌐{ws}" if ws and ws != 'none' else ""
            print(f"[DAG]   {'👑' if n['id']==term_id else '●'} {n['id']} "
                  f"[{n.get('role','?')}] {n.get('model','?').split('/')[-1]}{ws_tag} "
                  f"← {n.get('inputs',[])}")
    import time as _time
    _dag_start = _time.monotonic()

    outputs: Dict[str, str] = {}
    node_errors: Dict[str, str] = {}

    for node in execution_order:
        node_id   = node["id"]
        node_type = node.get("node_type", "llm")

        # ── Log node ─────────────────────────────────────────────────
        import time as _time
        _node_t = _time.monotonic()
        ntype_label = f"⚙ tool:{node.get('tool_type','?')}" if node_type == "tool" else f"● llm:{node.get('role','?')}"
        inputs_preview = [inp for inp in node.get("inputs", []) if inp != "user_prompt"]
        _raw_model = node.get('model', '—')
        _local_tag = " [LOCAL]" if is_local_model(_raw_model) else ""
        print(f"[DAG] ┌ {node_id} ({ntype_label}) model={_raw_model.split('/')[-1]}{_local_tag}")
        if inputs_preview:
            for inp in inputs_preview:
                prev = (outputs.get(inp, "")[:60].replace(chr(10),' ') + "…") if inp in outputs else "pending"
                print(f"[DAG] │   input [{inp}]: {prev}")

        # ── Tool node — route vers tool_executor ─────────────────────
        if node_type == "tool":
            if on_node_start:
                await on_node_start(node_id, "__tool__", node.get("tool_type", "tool"))
            try:
                tool_output = await execute_tool_node(
                    node, user_query, outputs, document_content
                )
                elapsed = _time.monotonic() - _node_t
                print(f"[DAG] └ {node_id} ✓ (outil) {elapsed:.1f}s | "
                      f"output: {tool_output[:80].replace(chr(10),' ')}…")
                outputs[node_id] = tool_output
                if on_node_done:
                    await on_node_done(node_id, "__tool__",
                                       node.get("tool_type", "tool"), tool_output,
                                       duration_s=round(elapsed, 1))
            except Exception as e:
                _tool_elapsed = _time.monotonic() - _node_t
                err = f"[tool error] {e}"
                node_errors[node_id] = str(e)
                outputs[node_id] = err
                if on_node_error:
                    await on_node_error(node_id, str(e),
                                        model="__tool__",
                                        duration_s=round(_tool_elapsed, 1))
            continue  # passer au node suivant

        # ── LLM node ─────────────────────────────────────────────────
        model          = normalize_model_id(resolve_model(node))
        original_model = model  # modèle demandé, avant tout fallback
        role           = node.get("role", "explorer")

        if on_node_start:
            await on_node_start(node_id, model, role)

        try:
            # Enrichir le prompt utilisateur avec le contexte RAG si use_rag=True
            effective_query = await build_prompt_with_rag(
                node, user_query, service_id=service_id or "global"
            )

            system_prompt, user_content = build_node_prompt(
                node, effective_query, outputs, document_content, web_search_mode,
                language=user_language,
            )

            # Build messages: history + current prompt
            messages = list(history) if history else []

            # System prompt injected as first message if supported
            # (OpenRouter accepts system role for most models)
            if system_prompt:
                # Prepend system as first message if no system already in history
                has_system = any(m.get("role") == "system" for m in messages)
                if not has_system:
                    messages = [{"role": "system", "content": system_prompt}] + messages

            messages.append({"role": "user", "content": user_content})

            # Web search : mode global OU niveau défini sur le node
            node_ws = node.get("web_search", "none")
            if isinstance(node_ws, bool):  # rétrocompat anciens pipelines
                node_ws = "deep" if node_ws else "none"
            node_wants_deep      = node_ws == "deep"
            node_wants_factcheck = node_ws == "factcheck"
            use_web = (
                web_search_mode == "deep"
                or node_wants_deep
                or (web_search_mode == "factcheck" and node_id == terminal_node["id"])
                or node_wants_factcheck
            )

            # ── Exécution : local (Ollama) ou cloud (fallback chain) ──────────
            response  = None
            used_model = model

            if is_local_model(model):
                # Nœud local — PAS de fallback cloud (données sensibles)
                try:
                    response = await query_model(model, messages)
                    used_model = model
                except Exception as local_err:
                    err_msg = (
                        f"[ollama] ERREUR nœud local {node_id} — {local_err}\n"
                        f"Le nœud '{node_id}' est configuré en local mais Ollama n'est pas disponible."
                    )
                    print(err_msg)
                    node_errors[node_id] = err_msg
                    outputs[node_id] = err_msg
                    if on_node_error:
                        await on_node_error(node_id, str(local_err),
                                            model=original_model,
                                            duration_s=round(_time.monotonic() - _node_t, 1))
                    continue
            else:
                # Nœud cloud — chaîne de fallback standard
                chain = get_chain(model)
                for candidate in chain:
                    response = await query_model(candidate, messages, web_search=use_web)
                    if response is not None:
                        used_model = candidate
                        if candidate != model:
                            print(f"[fallback] {node_id}: {model} → {candidate}")
                            log_fallback_incident(
                                original_model=model,
                                fallback_model=candidate,
                                reason="error_runtime",
                                node_id=node_id,
                                pipeline_id=pipeline_id,
                                user_id=user_id,
                            )
                        break

                if response is None:
                    tried_short = ", ".join(m.split("/")[-1].replace(":free","") for m in chain)
                    tried_full  = ", ".join(chain)
                    print(f"[DAG] ✗ {node_id}: tous les modèles ont échoué → {tried_full}")
                    error_msg = f"[Aucun modèle disponible — essayés : {tried_short}]"
                    node_errors[node_id] = error_msg
                    outputs[node_id] = error_msg
                    if on_node_error:
                        await on_node_error(node_id, error_msg,
                                            model=original_model,
                                            duration_s=round(_time.monotonic() - _node_t, 1))
                    continue
            output_text = response.get("content", "").strip()
            if not output_text:
                output_text = f"[{used_model.split('/')[-1]} n'a pas retourné de contenu]"
            outputs[node_id] = output_text

            elapsed    = _time.monotonic() - _node_t
            tokens_in  = response.get("usage", {}).get("prompt_tokens", 0) if response else 0
            tokens_out = response.get("usage", {}).get("completion_tokens", 0) if response else 0
            cost       = response.get("usage", {}).get("cost") if response else None
            _is_local  = response.get("local", False) if response else False
            cost_str     = " [local, $0.00]" if _is_local else (f" ${cost:.5f}" if cost else "")
            fallback_used = used_model != original_model
            fallback_str  = f" [fallback→{used_model.split('/')[-1]}]" if fallback_used else ""
            print(f"[DAG] └ {node_id} ✓ {elapsed:.1f}s | "
                  f"↑{tokens_in}t ↓{tokens_out}t{cost_str}{fallback_str} | "
                  f"réponse: {output_text[:80].replace(chr(10),' ')}…")
            if on_node_done:
                await on_node_done(
                    node_id, original_model, role, output_text,
                    used_model=used_model,
                    fallback=fallback_used,
                    duration_s=round(elapsed, 1),
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost=cost or 0.0,
                )

        except Exception as e:
            error_msg = str(e)
            node_errors[node_id] = error_msg
            outputs[node_id] = f"[Node {node_id} unavailable: {error_msg}]"

            if on_node_error:
                await on_node_error(node_id, error_msg,
                                    model=original_model,
                                    duration_s=round(_time.monotonic() - _node_t, 1))

    final_output = outputs.get(terminal_node["id"], "No output produced.")
    total_elapsed = _time.monotonic() - _dag_start
    print(f"[DAG] ■ Terminé en {total_elapsed:.1f}s | "
          f"{len(outputs)} nodes OK | {len(node_errors)} erreurs")
    if node_errors:
        for nid, err in node_errors.items():
            print(f"[DAG]   ✗ {nid}: {err[:120]}")

    return {
        "outputs": outputs,
        "final": final_output,
        "terminal_node": terminal_node,
        "errors": node_errors,
        "execution_order": [n["id"] for n in execution_order],
    }


# ─── Single model bypass ─────────────────────────────────────────────────────

async def execute_single_model(
    model: str,
    user_query: str,
    history: List[Dict[str, Any]] = None,
    document_content: Optional[str] = None,
    web_search_mode: str = "none",
) -> Dict[str, Any]:
    """
    Direct call to a single model — no council stages, no chairman overhead.
    Used when only one model is selected.
    """
    parts = []

    if document_content:
        parts.append(
            f"[DOCUMENT PROVIDED BY USER]\n{document_content}\n[END DOCUMENT]\n"
            "Analyze the document above and answer the following question:"
        )

    parts.append(user_query)

    if web_search_mode in ("deep", "factcheck"):
        parts.append(
            "\nYou have access to web search. Use it to verify facts and provide current information."
        )

    user_content = "\n\n".join(parts)
    messages = list(history) if history else []
    messages.append({"role": "user", "content": user_content})

    use_web = web_search_mode != "none"
    response = await query_model(model, messages, web_search=use_web)

    return {
        "model": model,
        "response": response.get("content", "") if response else "Model unavailable.",
        "mode": "single",
    }
