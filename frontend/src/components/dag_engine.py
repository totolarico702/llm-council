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

from .openrouter import query_model
from .fallback_models import get_chain
from .tool_executor import execute_tool_node

# ─── Role system prompts ──────────────────────────────────────────────────────

ROLE_PROMPTS: Dict[str, str] = {
    "explorer": (
        "You are a creative explorer. Given the user's question and any prior responses, "
        "generate multiple distinct approaches or ideas without self-censorship. "
        "Prioritize breadth and originality over consensus."
    ),
    "critic": (
        "You are a rigorous critic. Analyze the responses provided and identify flaws, "
        "logical gaps, missing nuance, or factual risks. Be direct and specific. "
        "Do not simply restate what was said — focus on what is wrong or incomplete."
    ),
    "optimizer": (
        "You are an optimizer. Take the best elements from the previous responses and "
        "improve them concretely. Eliminate redundancy, sharpen the reasoning, and produce "
        "a more refined and actionable version."
    ),
    "devil_advocate": (
        "You are a devil's advocate. Systematically challenge the assumptions in the previous "
        "responses. Propose alternative interpretations, edge cases, or radically different approaches. "
        "Your goal is to stress-test the ideas, not to be contrarian for its own sake."
    ),
    "synthesizer": (
        "You are a synthesizer. Integrate the contributions from all previous responses into "
        "a single, coherent, well-structured final answer. Balance the different perspectives, "
        "resolve contradictions, and produce a response that is both comprehensive and actionable."
    ),
    "chairman": (
        "You are the Chairman of an LLM Council. Synthesize all previous agent contributions "
        "into a single, authoritative final answer. Weigh the arguments, acknowledge disagreements "
        "where relevant, and deliver a clear, well-reasoned conclusion."
    ),
    "reader": (
        "You are an expert document reader. Extract and summarize the key information from the "
        "provided document. Focus on what is most relevant to the user's question. "
        "Be precise and avoid speculation beyond the document's content."
    ),
    "custom": "",  # user-defined
}


def get_system_prompt(node: Dict[str, Any]) -> str:
    """Return the effective system prompt for a node."""
    custom = (node.get("role_prompt") or "").strip()
    if custom:
        return custom
    role = node.get("role", "explorer")
    return ROLE_PROMPTS.get(role, ROLE_PROMPTS["explorer"])


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
) -> tuple[str, str]:
    """
    Returns (system_prompt, user_prompt_for_node).
    """
    system_prompt = get_system_prompt(node)

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

    outputs: Dict[str, str] = {}
    node_errors: Dict[str, str] = {}

    for node in execution_order:
        node_id   = node["id"]
        node_type = node.get("node_type", "llm")

        # ── Tool node — route vers tool_executor ─────────────────────
        if node_type == "tool":
            if on_node_start:
                await on_node_start(node_id, "__tool__", node.get("tool_type", "tool"))
            try:
                tool_output = await execute_tool_node(
                    node, user_query, outputs, document_content
                )
                outputs[node_id] = tool_output
                if on_node_done:
                    await on_node_done(node_id, "__tool__",
                                       node.get("tool_type", "tool"), tool_output, None)
            except Exception as e:
                err = f"[tool error] {e}"
                node_errors[node_id] = str(e)
                outputs[node_id] = err
                if on_node_error:
                    await on_node_error(node_id, str(e))
            continue  # passer au node suivant

        # ── LLM node ─────────────────────────────────────────────────
        model = node.get("model", "openai/gpt-4o-mini")
        role  = node.get("role", "explorer")

        if on_node_start:
            await on_node_start(node_id, model, role)

        try:
            system_prompt, user_content = build_node_prompt(
                node, user_query, outputs, document_content, web_search_mode
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

            # ── Fallback chain ────────────────────────────────────────
            response = None
            used_model = model
            chain = get_chain(model)
            for candidate in chain:
                response = await query_model(candidate, messages, web_search=use_web)
                if response is not None:
                    used_model = candidate
                    if candidate != model:
                        print(f"[fallback] {node_id}: {model} → {candidate}")
                    break

            if response is None:
                # Toute la chaîne a échoué
                tried = ", ".join(m.split("/")[-1].replace(":free","") for m in chain)
                error_msg = f"[Aucun modèle disponible — essayés : {tried}]"
                node_errors[node_id] = error_msg
                outputs[node_id] = error_msg
                if on_node_error:
                    await on_node_error(node_id, error_msg)
                continue
            # Mettre à jour model pour les callbacks (modèle réellement utilisé)
            model = used_model

            output_text = response.get("content", "").strip()
            if not output_text:
                output_text = f"[{model.split('/')[-1]} n'a pas retourné de contenu]"
            outputs[node_id] = output_text

            if on_node_done:
                await on_node_done(node_id, model, role, output_text, used_model if used_model != node.get('model', model) else None)

        except Exception as e:
            error_msg = str(e)
            node_errors[node_id] = error_msg
            outputs[node_id] = f"[Node {node_id} unavailable: {error_msg}]"

            if on_node_error:
                await on_node_error(node_id, error_msg)

    final_output = outputs.get(terminal_node["id"], "No output produced.")

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
