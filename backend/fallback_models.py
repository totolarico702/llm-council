# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
Fallback model chains — production only, no :free models.
Règle absolue : aucun modèle :free en production enterprise.
"""

# ── Catalogue prod-ready ───────────────────────────────────────────────────────

PRODUCTION_MODELS: dict[str, dict] = {
    # Tier 1 — Qualité maximale
    "anthropic/claude-sonnet-4-6":         {"cost": 3, "tags": ["reasoning", "code", "analysis"]},
    "anthropic/claude-haiku-4-5-20251001": {"cost": 1, "tags": ["fast", "chat"]},
    "google/gemini-2.5-pro-preview":       {"cost": 3, "tags": ["reasoning", "vision", "long-context"]},
    "google/gemini-2.0-flash-001":         {"cost": 1, "tags": ["fast", "chat", "vision"]},
    "openai/gpt-4o":                       {"cost": 3, "tags": ["reasoning", "code", "vision"]},
    "openai/gpt-4o-mini":                  {"cost": 1, "tags": ["fast", "chat", "code"]},

    # Tier 2 — Bon rapport qualité/prix
    "deepseek/deepseek-chat":                   {"cost": 1, "tags": ["code", "reasoning", "fast"]},
    "deepseek/deepseek-r1":                     {"cost": 2, "tags": ["reasoning", "analysis"]},
    "mistralai/mistral-small-3.1-24b-instruct": {"cost": 1, "tags": ["fast", "chat", "european", "rgpd"]},
    "mistralai/mistral-medium-3":               {"cost": 2, "tags": ["reasoning", "analysis", "european", "rgpd"]},
    "mistralai/mistral-large-2411":             {"cost": 3, "tags": ["reasoning", "code", "european", "rgpd"]},
    "mistralai/codestral-2501":                 {"cost": 2, "tags": ["code", "european", "rgpd"]},
    "meta-llama/llama-4-maverick":              {"cost": 1, "tags": ["fast", "code"]},
    "qwen/qwen-2.5-72b-instruct":               {"cost": 1, "tags": ["code", "reasoning"]},
}

# ── Chaînes de fallback — uniquement modèles payants ──────────────────────────

FALLBACK_CHAINS: dict[str, list[str]] = {
    "anthropic/claude-sonnet-4-6": [
        "anthropic/claude-haiku-4-5-20251001",
        "google/gemini-2.0-flash-001",
        "openai/gpt-4o-mini",
    ],
    "anthropic/claude-haiku-4-5-20251001": [
        "google/gemini-2.0-flash-001",
        "openai/gpt-4o-mini",
        "mistralai/mistral-small-3.1-24b-instruct",
    ],
    "google/gemini-2.5-pro-preview": [
        "google/gemini-2.0-flash-001",
        "anthropic/claude-haiku-4-5-20251001",
        "openai/gpt-4o-mini",
    ],
    "google/gemini-2.0-flash-001": [
        "anthropic/claude-haiku-4-5-20251001",
        "openai/gpt-4o-mini",
        "mistralai/mistral-small-3.1-24b-instruct",
    ],
    "openai/gpt-4o": [
        "openai/gpt-4o-mini",
        "anthropic/claude-haiku-4-5-20251001",
        "google/gemini-2.0-flash-001",
    ],
    "openai/gpt-4o-mini": [
        "google/gemini-2.0-flash-001",
        "anthropic/claude-haiku-4-5-20251001",
        "mistralai/mistral-small-3.1-24b-instruct",
    ],
    "deepseek/deepseek-chat": [
        "mistralai/mistral-small-3.1-24b-instruct",
        "google/gemini-2.0-flash-001",
        "openai/gpt-4o-mini",
    ],
    "deepseek/deepseek-r1": [
        "deepseek/deepseek-chat",
        "google/gemini-2.5-pro-preview",
        "openai/gpt-4o",
    ],
    "mistralai/mistral-small-3.1-24b-instruct": [
        "mistralai/mistral-medium-3",
        "google/gemini-2.0-flash-001",
        "openai/gpt-4o-mini",
    ],
    "mistralai/mistral-medium-3": [
        "mistralai/mistral-small-3.1-24b-instruct",
        "mistralai/mistral-large-2411",
        "google/gemini-2.0-flash-001",
        "openai/gpt-4o-mini",
    ],
    "mistralai/mistral-large-2411": [
        "mistralai/mistral-medium-3",
        "mistralai/mistral-small-3.1-24b-instruct",
        "google/gemini-2.0-flash-001",
        "anthropic/claude-haiku-4-5-20251001",
    ],
    "mistralai/codestral-2501": [
        "mistralai/mistral-large-2411",
        "mistralai/mistral-medium-3",
        "deepseek/deepseek-chat",
    ],
    "meta-llama/llama-4-maverick": [
        "google/gemini-2.0-flash-001",
        "openai/gpt-4o-mini",
        "anthropic/claude-haiku-4-5-20251001",
    ],
    "qwen/qwen-2.5-72b-instruct": [
        "deepseek/deepseek-chat",
        "google/gemini-2.0-flash-001",
        "openai/gpt-4o-mini",
    ],
    # Fallback générique — Mistral first (RGPD, hébergé en France)
    "__default__": [
        "mistralai/mistral-medium-3",
        "mistralai/mistral-small-3.1-24b-instruct",
        "mistralai/mistral-large-2411",
        "google/gemini-2.0-flash-001",
        "anthropic/claude-haiku-4-5-20251001",
    ],
}


def get_chain(model: str) -> list[str]:
    """Retourne le modèle + ses fallbacks (tous payants)."""
    chain = FALLBACK_CHAINS.get(model, FALLBACK_CHAINS["__default__"])
    return [model] + [m for m in chain if m != model]


def get_fallbacks(model: str) -> list[str]:
    """Retourne uniquement les fallbacks (sans le modèle principal)."""
    return get_chain(model)[1:]


def is_production_safe(model: str) -> bool:
    """Vérifie qu'un modèle est autorisé en production (payant + dans la liste)."""
    return (
        model in PRODUCTION_MODELS
        and not model.endswith(":free")
        and not model.endswith(":extended")
    )
