# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "anthropic/claude-sonnet-4-6",
    "google/gemini-2.0-flash-001",
    "openai/gpt-4o-mini",
    "deepseek/deepseek-chat",
]

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "anthropic/claude-sonnet-4-6"

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Data directory for conversation storage
DATA_DIR = os.getenv("DATA_DIR", "data")  # racine des données

# ── Modèle par défaut — Mistral (RGPD, hébergé en France) ─────────────────────
# Configurable via data/settings.json (route PUT /api/admin/settings)
# ou variables d'environnement DEFAULT_MODEL / DEFAULT_CHAIRMAN
DEFAULT_MODEL    = os.getenv("DEFAULT_MODEL",    "mistralai/mistral-medium-3")
DEFAULT_CHAIRMAN = os.getenv("DEFAULT_CHAIRMAN", "mistralai/mistral-medium-3")

# Catalogue Mistral disponible sur OpenRouter
MISTRAL_MODELS: dict[str, dict] = {
    "mistralai/mistral-small-3.1-24b-instruct": {
        "cost": 1, "tags": ["fast", "chat", "european", "rgpd"],
    },
    "mistralai/mistral-medium-3": {
        "cost": 2, "tags": ["reasoning", "analysis", "european", "rgpd"],
    },
    "mistralai/mistral-large-2411": {
        "cost": 3, "tags": ["reasoning", "code", "european", "rgpd"],
    },
    "mistralai/codestral-2501": {
        "cost": 2, "tags": ["code", "european", "rgpd"],
    },
}
