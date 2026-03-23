"""
ollama_client.py — Client Ollama pour LLM Council
API REST Ollama : http://localhost:11434 (compatible OpenAI)
"""
import os
import httpx
from typing import Optional

OLLAMA_URL     = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_TIMEOUT = 120  # secondes

_ollama_available: Optional[bool] = None  # None = pas encore testé
_ollama_models: list[dict] = []


async def check_ollama() -> bool:
    """Teste si Ollama tourne. Rafraîchit le cache à chaque appel."""
    global _ollama_available, _ollama_models
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            if r.status_code == 200:
                _ollama_models = r.json().get("models", [])
                _ollama_available = True
                print(f"[ollama] Disponible — {len(_ollama_models)} modèle(s) : "
                      f"{[m['name'] for m in _ollama_models]}")
                return True
    except Exception:
        pass
    _ollama_available = False
    print(f"[ollama] Non disponible ({OLLAMA_URL})")
    return False


def ollama_available() -> bool:
    return _ollama_available is True


def strip_local_prefix(model: str) -> str:
    """Supprime le préfixe ollama/ ou local/ : 'ollama/mistral:latest' → 'mistral:latest'."""
    return model.replace("ollama/", "").replace("local/", "")


def is_model_available_locally(model: str) -> bool:
    """Vérifie si un modèle local spécifique est installé dans Ollama.
    Accepte 'ollama/mistral:latest', 'mistral:latest' ou 'mistral'.
    Compare sans préfixe et sans tag pour gérer les variantes de nommage.
    """
    clean = strip_local_prefix(model)          # "ollama/mistral:latest" → "mistral:latest"
    base  = clean.split(":")[0]                # "mistral:latest"        → "mistral"
    return any(
        m["name"] == clean or m["name"].split(":")[0] == base
        for m in _ollama_models
    )


OLLAMA_CATALOG: list[dict] = [
    {"id": "mistral:latest",  "name": "Mistral 7B",       "family": "mistral",
     "size_gb": 4.1, "tags": ["fast", "chat", "european"],
     "description": "Modèle phare Mistral AI, excellent rapport qualité/taille. Idéal pour la rédaction et l'analyse."},
    {"id": "llama3.1:8b",     "name": "Llama 3.1 8B",     "family": "llama",
     "size_gb": 4.7, "tags": ["balanced", "code", "reasoning"],
     "description": "Modèle Meta bien équilibré, performant en code et raisonnement."},
    {"id": "llama3.2:3b",     "name": "Llama 3.2 3B",     "family": "llama",
     "size_gb": 2.0, "tags": ["ultra-fast", "lightweight"],
     "description": "Version ultra-légère de Llama, idéale pour les tâches simples et les machines peu puissantes."},
    {"id": "qwen2.5:7b",      "name": "Qwen 2.5 7B",      "family": "qwen",
     "size_gb": 4.4, "tags": ["code", "reasoning", "multilingual"],
     "description": "Excellent en code et raisonnement. Supporte de nombreuses langues dont le français."},
    {"id": "deepseek-r1:7b",  "name": "DeepSeek R1 7B",   "family": "deepseek",
     "size_gb": 4.7, "tags": ["reasoning", "analysis"],
     "description": "Spécialisé dans le raisonnement complexe. Version distillée du modèle DeepSeek R1."},
    {"id": "phi4:latest",     "name": "Phi-4 14B",         "family": "phi",
     "size_gb": 8.9, "tags": ["reasoning", "code", "microsoft"],
     "description": "Modèle Microsoft très performant en raisonnement malgré sa taille modérée."},
    {"id": "gemma3:4b",       "name": "Gemma 3 4B",        "family": "gemma",
     "size_gb": 3.3, "tags": ["fast", "google", "multilingual"],
     "description": "Modèle Google compact, rapide et multilingue."},
]


def get_catalog() -> list[dict]:
    """Retourne le catalogue de modèles Ollama recommandés (copies indépendantes)."""
    return [m.copy() for m in OLLAMA_CATALOG]


def list_ollama_models() -> list[dict]:
    """Liste les modèles Ollama installés."""
    return [
        {
            "id":    f"ollama/{m['name']}",
            "name":  m["name"],
            "size":  m.get("size", 0),
            "local": True,
        }
        for m in _ollama_models
    ]


async def ollama_chat(
    model: str,
    messages: list[dict],
) -> dict:
    """
    Appel Ollama via son API compatible OpenAI (/v1/chat/completions).
    model : identifiant complet avec préfixe ollama/ (ex: "ollama/mistral")
    Pas de fallback cloud — les données sensibles ne doivent pas quitter la machine.
    """
    if not ollama_available():
        raise RuntimeError(
            f"Ollama non disponible — impossible d'exécuter le nœud local '{model}'. "
            f"Vérifiez qu'Ollama tourne sur {OLLAMA_URL}"
        )

    clean_name = model.removeprefix("ollama/").removeprefix("local/")
    payload = {
        "model":    clean_name,
        "messages": messages,
        "stream":   False,
    }
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        r = await client.post(
            f"{OLLAMA_URL}/v1/chat/completions",
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
        return {
            "content": data["choices"][0]["message"]["content"],
            "usage": {
                "prompt_tokens":     data.get("usage", {}).get("prompt_tokens", 0),
                "completion_tokens": data.get("usage", {}).get("completion_tokens", 0),
                "cost": 0.0,  # local = gratuit
            },
            "model": model,
            "local": True,
        }
