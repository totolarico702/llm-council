# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
cost_estimator.py — Simulation de coûts par pipeline
Estime le coût d'exécution d'un pipeline basé sur les modèles configurés.
"""

PRICE_PER_1K_TOKENS = {
    "mistralai/mistral-medium-3":       {"input": 0.0004, "output": 0.002},
    "anthropic/claude-sonnet-4-5":      {"input": 0.003,  "output": 0.015},
    "anthropic/claude-sonnet-4-6":      {"input": 0.003,  "output": 0.015},
    "openai/gpt-4o":                    {"input": 0.005,  "output": 0.015},
    "openai/gpt-4o-mini":               {"input": 0.00015, "output": 0.0006},
    "google/gemini-2.0-flash-001":      {"input": 0.0001, "output": 0.0004},
    "google/gemini-2.5-flash-preview":  {"input": 0.00015, "output": 0.0006},
    "mistral:latest":                   {"input": 0.0,    "output": 0.0},
    "llama3.2:3b":                      {"input": 0.0,    "output": 0.0},
    "llama3.2:latest":                  {"input": 0.0,    "output": 0.0},
    "deepseek-r1:latest":               {"input": 0.0,    "output": 0.0},
}

DEFAULT_TOKENS = {
    "input": 500,   # tokens d'entrée estimés par nœud
    "output": 800,  # tokens de sortie estimés par nœud
}


def estimate_pipeline_cost(pipeline: dict) -> dict:
    """
    Estime le coût total d'exécution d'un pipeline.

    Args:
        pipeline: dict avec clés "nodes" et "edges" (format .cog ou react-flow)

    Returns:
        dict avec total_usd, node_breakdown, disclaimer
    """
    total = 0.0
    node_costs = []

    for node in pipeline.get("nodes", []):
        node_type = node.get("type", "")
        # Nœuds non-LLM (condition, merge, rag_search, fact_check, mcp, tool)
        # Les nœuds outil font quand même appel à un LLM
        if node_type not in ("llm", "llm_local", "tool", "fact_check", "rag_search"):
            continue

        model = node.get("model") or node.get("data", {}).get("model") or "mistralai/mistral-medium-3"

        # Nœuds locaux (Ollama) → gratuit
        is_local = ":" in model and "/" not in model  # heuristique : "mistral:latest" vs "mistralai/..."
        prices = PRICE_PER_1K_TOKENS.get(model, {"input": 0.001, "output": 0.002})

        cost = (
            DEFAULT_TOKENS["input"] / 1000 * prices["input"] +
            DEFAULT_TOKENS["output"] / 1000 * prices["output"]
        )
        total += cost

        node_id = node.get("id", "?")
        label = node.get("label") or node.get("data", {}).get("label") or node_id

        node_costs.append({
            "node_id": node_id,
            "label": label,
            "model": model,
            "cost_usd": round(cost, 6),
            "is_local": is_local or prices["input"] == 0.0,
        })

    return {
        "total_usd": round(total, 6),
        "node_breakdown": node_costs,
        "disclaimer": "Estimation basée sur ~500 tokens input / ~800 tokens output par nœud",
    }
