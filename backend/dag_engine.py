# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
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

import asyncio
from typing import List, Dict, Any, Optional, Set

import json
import structlog

from .openrouter import query_model, health_check_pipeline
from .fallback_models import get_chain, FALLBACK_CHAINS
from .tool_executor import execute_tool_node
from .usage_logger import log_fallback_incident
from .config import DEFAULT_MODEL, DEFAULT_CHAIRMAN
from . import rag_store

log = structlog.get_logger("dag_engine")

MAX_LOOP_ITERATIONS = 10

# Nœuds I/O virtuels — overlays visuels du PipelineEditor, jamais exécutés
_IO_NODE_TYPES = {"prompt", "response"}

# ─── Résolution du modèle d'un node ──────────────────────────────────────────

def get_model_id(node: dict) -> str:
    """
    Retourne le modèle à utiliser pour un node.
    Priorité : modèle explicite > rôle chairman > défaut global.
    """
    import os as _os
    model = (node.get("model") or "").strip()
    if model and model != "default":
        return model
    if node.get("role") == "chairman":
        return _os.getenv("DEFAULT_CHAIRMAN", DEFAULT_CHAIRMAN)
    return _os.getenv("DEFAULT_MODEL", DEFAULT_MODEL)


# ─── Normalisation des IDs modèles ───────────────────────────────────────────

_KNOWN_PREFIXES = [
    "google/", "openai/", "anthropic/", "meta-llama/", "mistralai/",
    "deepseek/", "qwen/", "cohere/", "nvidia/", "microsoft/",
    "amazon/", "01-ai/", "x-ai/", "perplexity/", "nous/",
    "ollama/", "local/",
]


def is_ollama_model(model: str) -> bool:
    return model.startswith("ollama/") or model.startswith("local/")


def normalize_provider_id(model: str) -> str:
    if not model:
        return model
    if any(model.startswith(p) for p in _KNOWN_PREFIXES):
        return model
    for full_id in FALLBACK_CHAINS.keys():
        short = full_id.split("/", 1)[-1]
        if short == model or short.replace(":free", "") == model:
            print(f"[DAG] ⚠ ID normalisé: '{model}' → '{full_id}'")
            return full_id
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

ROLE_PROMPTS = DEFAULT_ROLE_PROMPTS

LANG_INSTRUCTION: Dict[str, str] = {
    "fr": "Réponds toujours en français.",
    "en": "Always answer in English.",
}


def build_system_prompt(node: Dict[str, Any], language: str = "fr") -> str:
    custom = (node.get("role_prompt") or node.get("system_prompt") or "").strip()
    base = custom if custom else DEFAULT_ROLE_PROMPTS.get(node.get("role", ""), "")
    lang_suffix = LANG_INSTRUCTION.get(language, LANG_INSTRUCTION["fr"])
    return f"{base} {lang_suffix}".strip() if base else lang_suffix


# ─── DAG validation ───────────────────────────────────────────────────────────

def check_pipeline(nodes: List[Dict[str, Any]]) -> List[str]:
    errors = []
    node_ids = {n["id"] for n in nodes}

    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt" and inp not in node_ids:
                errors.append(f"Node '{node['id']}' references unknown input '{inp}'")

    if errors:
        return errors

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
                return True
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


def topo_order(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    node_map = {n["id"]: n for n in nodes}
    in_degree: Dict[str, int] = {n["id"]: 0 for n in nodes}

    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt" and inp in in_degree:
                in_degree[node["id"]] += 1

    queue = [n for n in nodes if in_degree[n["id"]] == 0]
    sorted_nodes = []

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


def find_output_node(nodes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    referenced_as_input = set()
    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt":
                referenced_as_input.add(inp)
    terminals = [n for n in nodes if n["id"] not in referenced_as_input]
    return terminals[-1] if terminals else nodes[-1]


# ─── Node prompt builder ──────────────────────────────────────────────────────

def compose_node_prompt(
    node: Dict[str, Any],
    user_query: str,
    outputs: Dict[str, str],
    document_content: Optional[str],
    web_search_mode: str,
    language: str = "fr",
) -> tuple[str, str]:
    system_prompt = build_system_prompt(node, language=language)
    parts = []

    if document_content:
        parts.append(
            f"[DOCUMENT PROVIDED BY USER]\n{document_content}\n[END DOCUMENT]\n"
        )

    parent_inputs = [
        inp for inp in node.get("inputs", [])
        if inp != "user_prompt" and inp in outputs
    ]
    if parent_inputs:
        parts.append("--- Previous agent contributions ---")
        for inp_id in parent_inputs:
            parts.append(f"[{inp_id}]:\n{outputs[inp_id]}")
        parts.append("--- End of contributions ---\n")

    parts.append(f"User question: {user_query}")

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

async def compose_prompt_with_rag(node: dict, user_prompt: str, service_id: str = "global") -> str:
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


# ─── Parallel execution helpers ───────────────────────────────────────────────

def _get_execution_levels(nodes: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """
    Groups nodes into execution levels for parallel execution.
    All nodes within a level can execute concurrently — no direct dependencies between them.
    """
    node_map   = {n["id"]: n for n in nodes}
    in_degree:  Dict[str, int]       = {n["id"]: 0 for n in nodes}
    dependents: Dict[str, List[str]] = {n["id"]: [] for n in nodes}

    for node in nodes:
        for inp in node.get("inputs", []):
            if inp != "user_prompt" and inp in in_degree:
                in_degree[node["id"]] += 1
                dependents[inp].append(node["id"])

    levels: List[List[Dict[str, Any]]] = []
    remaining = {n["id"] for n in nodes}

    while remaining:
        ready = [nid for nid in remaining if in_degree[nid] == 0]
        if not ready:
            break
        levels.append([node_map[nid] for nid in ready])
        for nid in ready:
            remaining.discard(nid)
            for dep in dependents[nid]:
                in_degree[dep] -= 1

    return levels


def _get_descendants(node_id: str, nodes: List[Dict[str, Any]]) -> Set[str]:
    """Returns all descendant IDs reachable from node_id."""
    adj: Dict[str, List[str]] = {}
    for n in nodes:
        for inp in n.get("inputs", []):
            if inp != "user_prompt":
                adj.setdefault(inp, []).append(n["id"])

    result: Set[str] = set()
    queue = list(adj.get(node_id, []))
    while queue:
        nid = queue.pop()
        if nid not in result:
            result.add(nid)
            queue.extend(adj.get(nid, []))
    return result


def evaluate_condition(node: dict, outputs: Dict[str, str], user_input: str = "") -> Optional[str]:
    """
    Evaluates a condition expression and returns the id of the taken branch.
    Safe eval with limited variables: output, user_input, confidence, chunks_count.
    """
    condition = node.get("condition", "True")
    safe_vars = {
        "output":       outputs.get(node["id"], ""),
        "user_input":   user_input,
        "confidence":   1.0,
        "chunks_count": 0,
        "len":          len,
        "True":         True,
        "False":        False,
    }
    try:
        result = eval(condition, {"__builtins__": {}}, safe_vars)
    except Exception:
        result = False
    return node.get("branch_true") if result else node.get("branch_false")


def execute_merge_node(node: dict, outputs: Dict[str, str]) -> str:
    """
    Merges outputs from parent nodes without an LLM call.
    Strategies: concatenate (default), vote (longest output).
    """
    strategy = node.get("strategy", "concatenate")
    separator = node.get("separator", "\n\n---\n\n")

    parent_outputs = [
        outputs[inp]
        for inp in node.get("inputs", [])
        if inp != "user_prompt" and inp in outputs
    ]

    if not parent_outputs:
        return ""
    if strategy == "vote":
        return max(parent_outputs, key=len)
    return separator.join(parent_outputs)


# ─── Per-node executor ────────────────────────────────────────────────────────

async def _run_node(
    node: Dict[str, Any],
    user_query: str,
    outputs: Dict[str, str],
    document_content: Optional[str],
    web_search_mode: str,
    history: List[Dict[str, Any]],
    user_language: str,
    service_id: Optional[str],
    terminal_node_id: str,
    pipeline_id: Optional[str],
    user_id: Optional[str],
    on_node_start,
    on_node_done,
    on_node_error,
) -> tuple[str, str, Optional[str]]:
    """
    Execute a single node. Returns (node_id, output_text, error_msg_or_None).
    """
    import time as _time
    node_id   = node["id"]
    node_type = node.get("node_type", "llm")
    _node_t   = _time.monotonic()

    ntype_label    = (f"⚙ tool:{node.get('tool_type','?')}" if node_type == "tool"
                      else f"● {node_type}:{node.get('role','?')}")
    inputs_preview = [inp for inp in node.get("inputs", []) if inp != "user_prompt"]
    _raw_model     = node.get("model", "—")
    _local_tag     = " [LOCAL]" if is_ollama_model(_raw_model) else ""
    log.info("node_start", node_id=node_id, node_type=node_type,
             model=_raw_model, inputs=inputs_preview, pipeline_id=pipeline_id)
    print(f"[DAG] ┌ {node_id} ({ntype_label}) model={_raw_model.split('/')[-1]}{_local_tag}")
    for inp in inputs_preview:
        prev = (outputs.get(inp, "")[:60].replace(chr(10), " ") + "…") if inp in outputs else "pending"
        print(f"[DAG] │   input [{inp}]: {prev}")

    # ── Merge node ────────────────────────────────────────────────────────────
    if node_type == "merge":
        if on_node_start:
            await on_node_start(node_id, "__merge__", "merge")
        output  = execute_merge_node(node, outputs)
        elapsed = _time.monotonic() - _node_t
        print(f"[DAG] └ {node_id} ✓ (merge) {elapsed:.1f}s | {len(output)} chars")
        if on_node_done:
            await on_node_done(node_id, "__merge__", "merge", output,
                               duration_s=round(elapsed, 1))
        return node_id, output, None

    # ── Condition node ────────────────────────────────────────────────────────
    if node_type == "condition":
        if on_node_start:
            await on_node_start(node_id, "__condition__", "condition")
        taken   = evaluate_condition(node, outputs, user_query)
        output  = f"[condition] → {taken}"
        elapsed = _time.monotonic() - _node_t
        print(f"[DAG] └ {node_id} ✓ (condition) → {taken} {elapsed:.1f}s")
        if on_node_done:
            await on_node_done(node_id, "__condition__", "condition", output,
                               duration_s=round(elapsed, 1))
        return node_id, output, None

    # ── Agent node (inter-agents V3) ──────────────────────────────────────────
    if node_type == "agent":
        target_agent_id = node.get("agent_id")
        if on_node_start:
            await on_node_start(node_id, "__agent__", "agent")
        try:
            from . import agent_manager as _amgr
            sub_agent = _amgr.get_agent(target_agent_id)
            if not sub_agent:
                raise ValueError(f"Agent cible introuvable : {target_agent_id}")
            # Construire le contexte à partir des sorties précédentes
            prior_outputs = "\n\n".join(
                f"[{k}]\n{v}" for k, v in outputs.items()
                if k in (node.get("inputs") or [])
            )
            sub_context = {
                "user_input": prior_outputs or user_query,
                "pass_context": node.get("pass_context", True),
            }
            exec_id = await _amgr.trigger_agent(target_agent_id, sub_context, "inter_agent")
            # Attendre la fin si wait_for_result
            timeout  = node.get("timeout", 120)
            agent_output = f"[agent:{sub_agent['name']}] exécution lancée ({exec_id})"
            if node.get("wait_for_result", True):
                waited = 0
                while waited < timeout:
                    await asyncio.sleep(2)
                    waited += 2
                    execs = _amgr.list_executions(target_agent_id, limit=1)
                    if execs and execs[0].get("execution_id") == exec_id:
                        if execs[0].get("status") in ("success", "error"):
                            agent_output = execs[0].get("output") or agent_output
                            break
            elapsed = _time.monotonic() - _node_t
            if on_node_done:
                await on_node_done(node_id, "__agent__", "agent", agent_output,
                                   duration_s=round(elapsed, 1))
            return node_id, agent_output, None
        except Exception as e:
            elapsed = _time.monotonic() - _node_t
            err = f"[agent error] {e}"
            if on_node_error:
                await on_node_error(node_id, str(e), model="__agent__",
                                    duration_s=round(elapsed, 1))
            return node_id, err, str(e)

    # ── Tool node ─────────────────────────────────────────────────────────────
    if node_type == "tool":
        if on_node_start:
            await on_node_start(node_id, "__tool__", node.get("tool_type", "tool"))
        try:
            tool_output = await execute_tool_node(node, user_query, outputs, document_content)
            elapsed     = _time.monotonic() - _node_t
            print(f"[DAG] └ {node_id} ✓ (outil) {elapsed:.1f}s | "
                  f"{tool_output[:80].replace(chr(10), ' ')}…")
            if on_node_done:
                await on_node_done(node_id, "__tool__", node.get("tool_type", "tool"),
                                   tool_output, duration_s=round(elapsed, 1))
            return node_id, tool_output, None
        except Exception as e:
            elapsed = _time.monotonic() - _node_t
            err     = f"[tool error] {e}"
            if on_node_error:
                await on_node_error(node_id, str(e), model="__tool__",
                                    duration_s=round(elapsed, 1))
            return node_id, err, str(e)

    # ── LLM node ──────────────────────────────────────────────────────────────
    model          = normalize_provider_id(get_model_id(node))
    original_model = model
    role           = node.get("role", "explorer")

    if on_node_start:
        await on_node_start(node_id, model, role)

    try:
        effective_query = await compose_prompt_with_rag(
            node, user_query, service_id=service_id or "global"
        )
        system_prompt, user_content = compose_node_prompt(
            node, effective_query, outputs, document_content,
            web_search_mode, language=user_language,
        )

        messages = list(history) if history else []
        if system_prompt:
            has_system = any(m.get("role") == "system" for m in messages)
            if not has_system:
                messages = [{"role": "system", "content": system_prompt}] + messages
        messages.append({"role": "user", "content": user_content})

        node_ws = node.get("web_search", "none")
        if isinstance(node_ws, bool):
            node_ws = "deep" if node_ws else "none"
        use_web = (
            web_search_mode == "deep"
            or node_ws == "deep"
            or (web_search_mode == "factcheck" and node_id == terminal_node_id)
            or node_ws == "factcheck"
        )

        response   = None
        used_model = model

        if is_ollama_model(model):
            try:
                response   = await query_model(model, messages)
                used_model = model
            except Exception as local_err:
                err_msg = (
                    f"[ollama] ERREUR nœud local {node_id} — {local_err}\n"
                    f"Le nœud '{node_id}' est configuré en local mais Ollama n'est pas disponible."
                )
                print(err_msg)
                if on_node_error:
                    await on_node_error(node_id, str(local_err), model=original_model,
                                        duration_s=round(_time.monotonic() - _node_t, 1))
                return node_id, err_msg, err_msg
        else:
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
                tried_short = ", ".join(
                    m.split("/")[-1].replace(":free", "") for m in chain
                )
                error_msg = f"[Aucun modèle disponible — essayés : {tried_short}]"
                if on_node_error:
                    await on_node_error(node_id, error_msg, model=original_model,
                                        duration_s=round(_time.monotonic() - _node_t, 1))
                return node_id, error_msg, error_msg

        output_text = response.get("content", "").strip() if response else ""
        if not output_text:
            output_text = f"[{used_model.split('/')[-1]} n'a pas retourné de contenu]"

        elapsed       = _time.monotonic() - _node_t
        tokens_in     = response.get("usage", {}).get("prompt_tokens", 0) if response else 0
        tokens_out    = response.get("usage", {}).get("completion_tokens", 0) if response else 0
        cost          = response.get("usage", {}).get("cost") if response else None
        _is_local     = response.get("local", False) if response else False
        cost_str      = " [local, $0.00]" if _is_local else (f" ${cost:.5f}" if cost else "")
        fallback_used = used_model != original_model
        fallback_str  = f" [fallback→{used_model.split('/')[-1]}]" if fallback_used else ""
        log.info("node_done", node_id=node_id, model=used_model,
                 duration_s=round(elapsed, 1), output_len=len(output_text),
                 tokens_in=tokens_in, tokens_out=tokens_out,
                 output_preview=output_text[:120].replace("\n", " "))
        print(f"[DAG] └ {node_id} ✓ {elapsed:.1f}s | "
              f"↑{tokens_in}t ↓{tokens_out}t{cost_str}{fallback_str} | "
              f"réponse: {output_text[:80].replace(chr(10), ' ')}…")

        if on_node_done:
            await on_node_done(
                node_id, original_model, role, output_text,
                used_model   = used_model,
                fallback     = fallback_used,
                duration_s   = round(elapsed, 1),
                tokens_in    = tokens_in,
                tokens_out   = tokens_out,
                cost         = cost or 0.0,
            )
        return node_id, output_text, None

    except Exception as e:
        elapsed   = _time.monotonic() - _node_t
        error_msg = str(e)
        log.error("node_error", node_id=node_id, model=original_model,
                  error=error_msg, duration_s=round(elapsed, 1))
        if on_node_error:
            await on_node_error(node_id, error_msg, model=original_model,
                                duration_s=round(elapsed, 1))
        return node_id, f"[Node {node_id} unavailable: {error_msg}]", error_msg


# ─── Main DAG executor ────────────────────────────────────────────────────────

async def run_pipeline(
    nodes: List[Dict[str, Any]],
    user_query: str,
    history: List[Dict[str, Any]] = None,
    document_content: Optional[str] = None,
    web_search_mode: str = "none",
    on_node_start=None,
    on_node_done=None,
    on_node_error=None,
    user_id: Optional[str] = None,
    pipeline_id: Optional[str] = None,
    user_language: str = "fr",
    service_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute the DAG and return:
    {
        "outputs":         { node_id: response_text },
        "final":           response_text of terminal node,
        "terminal_node":   node dict,
        "errors":          { node_id: error_message },
        "execution_order": [node_id, ...]
    }

    Supports:
    - Parallel execution of independent nodes via asyncio.gather per level
    - Condition nodes with branch routing (skips not-taken subtree)
    - Merge nodes (concatenates parent outputs, no LLM call)
    - Loop protection (MAX_LOOP_ITERATIONS per condition node)
    - Tool nodes (web_search, rag_search, fact_check, mcp, …)
    - LLM nodes with cloud fallback chains and local Ollama support
    """
    # ── Filtrer les nœuds I/O visuels (overlays frontend, pas exécutables) ────
    nodes = [n for n in nodes if n.get("node_type") not in _IO_NODE_TYPES]
    if not nodes:
        log.warning("dag_empty", reason="all nodes filtered (only I/O nodes)")
        return {"outputs": {}, "final": "", "terminal_node": {},
                "errors": {}, "execution_order": []}

    # ── Normaliser les références aux nœuds I/O virtuels dans les inputs ──────
    # __prompt__ → user_prompt  (entrée utilisateur)
    # __response__ → supprimé   (nœud terminal fictif, pas de sortie réelle)
    for node in nodes:
        normalized = []
        for inp in node.get("inputs", []):
            if inp == "__prompt__":
                normalized.append("user_prompt")
            elif inp == "__response__":
                pass  # référence au nœud de sortie fictif — ignorée
            else:
                normalized.append(inp)
        node["inputs"] = normalized

    log.info("dag_execution_start", pipeline_id=pipeline_id, nodes=len(nodes),
             node_ids=[n["id"] for n in nodes])

    # ── Validate ──────────────────────────────────────────────────────────────
    errors_found = check_pipeline(nodes)
    if errors_found:
        return {
            "outputs":         {},
            "final":           f"DAG validation error: {'; '.join(errors_found)}",
            "terminal_node":   nodes[-1] if nodes else {},
            "errors":          {"_validation": errors_found},
            "execution_order": [],
        }

    terminal_node = find_output_node(nodes)
    term_id       = terminal_node["id"] if terminal_node else "?"

    # ── Health check pré-exécution ────────────────────────────────────────────
    try:
        health = await health_check_pipeline(nodes)
        if not health["ok"]:
            for nid, ns in health["nodes"].items():
                if not ns["available"] and ns.get("fallback") and not ns.get("local"):
                    print(f"[DAG] ⚠ {nid}: {ns['model']} indisponible → fallback {ns['fallback']}")
                    log_fallback_incident(
                        original_model = ns["model"],
                        fallback_model = ns["fallback"],
                        reason         = "model_unavailable",
                        node_id        = nid,
                        pipeline_id    = pipeline_id,
                        user_id        = user_id,
                    )
    except Exception as e:
        print(f"[DAG] health check error (ignoré): {e}")

    # ── Build execution levels ────────────────────────────────────────────────
    levels = _get_execution_levels(nodes)

    import time as _time
    _dag_start = _time.monotonic()

    print(f"\n[DAG] ▶ Démarrage — {len(nodes)} nodes | {len(levels)} niveaux | terminal: {term_id}")
    for i, level in enumerate(levels):
        ids    = [n["id"] for n in level]
        prefix = "∥" if len(ids) > 1 else "→"
        print(f"[DAG]   niveau {i}: {prefix} {', '.join(ids)}")

    outputs:      Dict[str, str] = {}
    node_errors:  Dict[str, str] = {}
    skipped:      Set[str]       = set()
    loop_counter: Dict[str, int] = {}
    executed_ids: List[str]      = []

    # ── Execute level by level ────────────────────────────────────────────────
    for level in levels:
        active = [n for n in level if n["id"] not in skipped]
        if not active:
            continue

        tasks = [
            _run_node(
                node             = n,
                user_query       = user_query,
                outputs          = outputs,
                document_content = document_content,
                web_search_mode  = web_search_mode,
                history          = history or [],
                user_language    = user_language,
                service_id       = service_id,
                terminal_node_id = term_id,
                pipeline_id      = pipeline_id,
                user_id          = user_id,
                on_node_start    = on_node_start,
                on_node_done     = on_node_done,
                on_node_error    = on_node_error,
            )
            for n in active
        ]
        results = await asyncio.gather(*tasks)

        for node_id, output, error in results:
            outputs[node_id] = output
            executed_ids.append(node_id)
            if error:
                node_errors[node_id] = error

        # ── Condition routing ─────────────────────────────────────────────────
        for node in active:
            if node.get("node_type") == "condition":
                loop_counter[node["id"]] = loop_counter.get(node["id"], 0) + 1
                if loop_counter[node["id"]] > MAX_LOOP_ITERATIONS:
                    print(f"[DAG] ⚠ boucle infinie détectée sur {node['id']}, arrêt forcé")
                    continue
                taken     = evaluate_condition(node, outputs, user_query)
                skipped_b = (
                    node.get("branch_false")
                    if taken == node.get("branch_true")
                    else node.get("branch_true")
                )
                if skipped_b:
                    skipped.add(skipped_b)
                    skipped |= _get_descendants(skipped_b, nodes)
                    print(f"[DAG]   condition {node['id']}: → {taken} | skip: {skipped_b}")

    # ── Final output ──────────────────────────────────────────────────────────
    final_output  = outputs.get(term_id, "No output produced.")
    total_elapsed = _time.monotonic() - _dag_start
    log.info("dag_execution_done", pipeline_id=pipeline_id, terminal_node=term_id,
             duration_s=round(total_elapsed, 1), nodes_ok=len(outputs),
             errors=len(node_errors), final_len=len(final_output))
    print(f"[DAG] ■ Terminé en {total_elapsed:.1f}s | "
          f"{len(outputs)} nodes OK | {len(node_errors)} erreurs")
    if node_errors:
        for nid, err in node_errors.items():
            print(f"[DAG]   ✗ {nid}: {err[:120]}")

    return {
        "outputs":         outputs,
        "final":           final_output,
        "terminal_node":   terminal_node,
        "errors":          node_errors,
        "execution_order": executed_ids,
    }


# ─── Single model bypass ─────────────────────────────────────────────────────

async def run_single_model(
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
    messages     = list(history) if history else []
    messages.append({"role": "user", "content": user_content})

    use_web  = web_search_mode != "none"
    response = await query_model(model, messages, web_search=use_web)

    return {
        "model":    model,
        "response": response.get("content", "") if response else "Model unavailable.",
        "mode":     "single",
    }
