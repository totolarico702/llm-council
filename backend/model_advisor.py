# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
model_advisor.py — LLM Council V3
===================================
Base de connaissance des modèles + recommandation intelligente.
Combine la connaissance statique et les scores d'usage réels (meta-learning).
"""
from typing import Optional, Dict, Any, List
from . import db as _db

Q = _db.Q

# ── Base de connaissance modèles ──────────────────────────────────────────────

MODEL_CAPABILITIES: Dict[str, Dict[str, Any]] = {
    "anthropic/claude-sonnet-4-5": {
        "strengths":    ["juridique", "analyse", "nuance", "français", "long_context",
                         "conformité", "rh", "médical", "marketing"],
        "weaknesses":   ["code_bas_niveau", "maths_complexes"],
        "best_temperature": {"analyse": 0.2, "créatif": 0.8, "code": 0.3, "résumé": 0.4},
        "cost_tier":    "medium",
        "context_window": 200000,
    },
    "anthropic/claude-opus-4-6": {
        "strengths":    ["raisonnement_complexe", "juridique", "stratégie", "long_context"],
        "weaknesses":   ["vitesse", "coût"],
        "best_temperature": {"analyse": 0.1, "stratégie": 0.3},
        "cost_tier":    "high",
        "context_window": 200000,
    },
    "openai/gpt-4o": {
        "strengths":    ["code", "raisonnement", "multimodal", "anglais", "analyse_données"],
        "weaknesses":   ["français_nuancé"],
        "best_temperature": {"code": 0.1, "analyse": 0.3, "créatif": 0.7},
        "cost_tier":    "high",
        "context_window": 128000,
    },
    "mistralai/mistral-medium-3": {
        "strengths":    ["français", "rapport_qualite_prix", "synthèse", "résumé",
                         "veille", "analyse_données"],
        "weaknesses":   ["raisonnement_complexe"],
        "best_temperature": {"analyse": 0.3, "résumé": 0.4, "créatif": 0.7},
        "cost_tier":    "low",
        "context_window": 32000,
    },
    "google/gemini-2.0-flash-001": {
        "strengths":    ["vitesse", "veille", "résumé", "multimodal", "rapport_qualite_prix"],
        "weaknesses":   ["précision_juridique"],
        "best_temperature": {"résumé": 0.3, "veille": 0.4, "créatif": 0.7},
        "cost_tier":    "free",
        "context_window": 1000000,
    },
    "mistral:latest": {
        "strengths":    ["gratuit", "privé", "rapide", "conformité_rgpd"],
        "weaknesses":   ["qualité_limitée", "contexte_court"],
        "best_temperature": {"analyse": 0.3, "résumé": 0.4},
        "cost_tier":    "free",
        "context_window": 8000,
    },
}

TASK_TO_MODEL_MAPPING: Dict[str, List[str]] = {
    "juridique":          ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
    "fiscal":             ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
    "conformité":         ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
    "code":               ["openai/gpt-4o", "mistralai/mistral-medium-3"],
    "résumé":             ["mistralai/mistral-medium-3", "google/gemini-2.0-flash-001"],
    "veille":             ["google/gemini-2.0-flash-001", "mistralai/mistral-medium-3"],
    "rh":                 ["anthropic/claude-sonnet-4-5", "mistralai/mistral-medium-3"],
    "médical":            ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
    "marketing":          ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
    "analyse_données":    ["openai/gpt-4o", "mistralai/mistral-medium-3"],
    "créatif":            ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
    "sales":              ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
    "interne":            ["mistralai/mistral-medium-3", "google/gemini-2.0-flash-001"],
    "communication":      ["anthropic/claude-sonnet-4-5", "mistralai/mistral-medium-3"],
    "raisonnement":       ["anthropic/claude-opus-4-6", "openai/gpt-4o"],
}

RAG_RECOMMENDED_FOR = [
    "juridique", "fiscal", "rh", "médical", "conformité",
    "interne", "procédure", "politique", "contrat",
]

WEB_SEARCH_RECOMMENDED_FOR = [
    "veille", "actualité", "marché", "concurrence",
    "prix", "news", "réglementation_récente",
]

MCP_SUGGESTIONS: Dict[str, List[str]] = {
    "juridique":  ["CNIL MCP", "Légifrance MCP"],
    "fiscal":     ["URSSAF MCP", "DGFiP MCP"],
    "médical":    ["HAS MCP", "ANSM MCP"],
    "veille":     ["Newscatcher MCP", "Brave Search MCP"],
    "code":       ["GitHub MCP", "GitLab MCP"],
    "marketing":  ["Google Analytics MCP", "HubSpot MCP"],
    "sales":      ["Salesforce MCP", "HubSpot MCP"],
}

SYSTEM_PROMPT_TEMPLATES: Dict[str, str] = {
    "juridique": (
        "Tu es un expert juridique spécialisé en droit français. "
        "Analyse le document fourni avec rigueur et structure ta réponse. "
        "Identifie clairement : ✅ Conforme / ⚠ À vérifier / ❌ Non conforme."
    ),
    "fiscal": (
        "Tu es un expert-comptable spécialisé en fiscalité française. "
        "Analyse les données financières fournies, identifie les risques fiscaux "
        "et propose des recommandations concrètes."
    ),
    "résumé": (
        "Tu es un assistant de synthèse efficace. "
        "Produis un résumé structuré et concis du document fourni, "
        "en préservant les informations clés et en éliminant le superflu."
    ),
    "veille": (
        "Tu es un analyste en veille stratégique. "
        "Synthétise les informations collectées, identifie les tendances, "
        "et produis un rapport actionnable."
    ),
    "rh": (
        "Tu es un expert RH. Analyse le document fourni avec objectivité "
        "et fournis des recommandations professionnelles et conformes au droit du travail."
    ),
    "médical": (
        "Tu es un assistant médical de second avis. "
        "Analyse les informations médicales fournies avec rigueur. "
        "Toujours recommander la consultation d'un professionnel de santé."
    ),
    "code": (
        "Tu es un expert en développement logiciel. "
        "Analyse le code fourni, identifie les bugs, améliorations de performance "
        "et problèmes de sécurité. Propose des solutions concrètes avec exemples."
    ),
    "marketing": (
        "Tu es un expert en marketing digital et communication. "
        "Analyse la demande et produis un contenu engageant, "
        "adapté à la cible et aux objectifs business."
    ),
}

# ── Détection de tâche depuis texte libre ────────────────────────────────────

TASK_KEYWORDS: Dict[str, List[str]] = {
    "juridique":    ["contrat", "juridique", "legal", "droit", "loi", "clause", "litige"],
    "conformité":   ["rgpd", "conformité", "compliance", "gdpr", "réglementation", "norme"],
    "fiscal":       ["fiscal", "comptable", "bilan", "tva", "impôt", "taxe", "financier"],
    "code":         ["code", "programme", "bug", "développement", "python", "javascript", "api"],
    "résumé":       ["résumé", "synthèse", "résumer", "synthétiser", "récapituler"],
    "veille":       ["veille", "actualité", "concurrence", "marché", "news", "tendance"],
    "rh":           ["rh", "recrutement", "cv", "entretien", "salarié", "contrat de travail"],
    "médical":      ["médical", "médecin", "patient", "ordonnance", "diagnostic", "santé"],
    "marketing":    ["marketing", "campagne", "contenu", "communication", "réseaux sociaux"],
    "sales":        ["vente", "lead", "prospect", "crm", "opportunité", "commercial"],
    "analyse_données": ["données", "data", "analyse", "statistique", "tableau", "graphique"],
}

def detect_task_type(text: str) -> Optional[str]:
    """Détecte le type de tâche à partir d'une description en texte libre."""
    text_lower = text.lower()
    scores = {}
    for task, keywords in TASK_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > 0:
            scores[task] = score
    if not scores:
        return None
    return max(scores, key=lambda t: scores[t])

# ── Meta-learning depuis les scores d'usage ───────────────────────────────────

def get_best_model_for_task(task_type: str, user_context: dict = None) -> str:
    """
    Recommande le meilleur modèle pour une tâche donnée.
    1. Consulte les scores d'usage réels (meta-learning)
    2. Fallback sur la base de connaissance statique
    """
    try:
        usage_scores = _db._table("scores").search(
            Q.stage == task_type
        )
        if usage_scores:
            model_avg = {}
            for s in usage_scores:
                m = s.get("model")
                v = s.get("score", 0)
                if m:
                    if m not in model_avg:
                        model_avg[m] = []
                    model_avg[m].append(v)
            if model_avg:
                best = max(model_avg, key=lambda m: sum(model_avg[m]) / len(model_avg[m]))
                return best
    except Exception:
        pass
    # Fallback statique
    candidates = TASK_TO_MODEL_MAPPING.get(task_type, ["mistralai/mistral-medium-3"])
    return candidates[0] if candidates else "mistralai/mistral-medium-3"

# ── Recommandation complète d'un nœud ────────────────────────────────────────

def recommend_node(description: str, user_context: dict = None) -> Dict[str, Any]:
    """
    Produit une recommandation complète pour un nœud pipeline à partir
    d'une description en langage naturel.
    """
    task_type = detect_task_type(description)
    if not task_type:
        task_type = "résumé"  # défaut générique

    model_id   = get_best_model_for_task(task_type, user_context)
    caps       = MODEL_CAPABILITIES.get(model_id, {})
    candidates = TASK_TO_MODEL_MAPPING.get(task_type, [model_id])

    # Température recommandée
    temperature = caps.get("best_temperature", {}).get(task_type, 0.4)

    # RAG recommandé ?
    rag_recommended = task_type in RAG_RECOMMENDED_FOR or any(
        kw in description.lower() for kw in RAG_RECOMMENDED_FOR
    )

    # Web search recommandé ?
    web_search = task_type in WEB_SEARCH_RECOMMENDED_FOR or any(
        kw in description.lower() for kw in WEB_SEARCH_RECOMMENDED_FOR
    )

    # MCP suggestions
    mcps = MCP_SUGGESTIONS.get(task_type, [])

    # Prompt système
    system_prompt = SYSTEM_PROMPT_TEMPLATES.get(task_type, "")

    # Coût estimé (très approximatif)
    cost_map = {"free": "$0.000", "low": "$0.002", "medium": "$0.008", "high": "$0.015"}
    cost_tier = caps.get("cost_tier", "medium")
    estimated_cost = cost_map.get(cost_tier, "$0.008")

    return {
        "task_type":         task_type,
        "model_recommended": model_id,
        "model_reason":      f"Meilleure performance détectée pour les tâches '{task_type}'",
        "model_alternatives": [m for m in candidates if m != model_id][:2],
        "model_capabilities": {
            "strengths":    caps.get("strengths", []),
            "cost_tier":    cost_tier,
            "context_window": caps.get("context_window", 32000),
        },
        "temperature":       temperature,
        "max_tokens":        2000 if task_type in ("résumé", "veille") else 3000,
        "rag_recommended":   rag_recommended,
        "web_search":        "deep" if web_search else "none",
        "mcp_suggestions":   mcps,
        "system_prompt":     system_prompt,
        "estimated_cost":    estimated_cost,
        "node_config": {
            "id":          f"{task_type}_node",
            "role":        "explorer",
            "model":       model_id,
            "temperature": temperature,
            "max_tokens":  2000 if task_type in ("résumé", "veille") else 3000,
            "system_prompt": system_prompt,
            "rag_enabled": rag_recommended,
            "web_search":  "deep" if web_search else "none",
        },
    }
