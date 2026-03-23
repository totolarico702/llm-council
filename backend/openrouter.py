"""OpenRouter API client for making LLM requests."""

import httpx
import time as _time
from typing import List, Dict, Any, Optional
from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL
from .ollama_client import ollama_chat

# ── Cache disponibilité modèles (5 minutes) ───────────────────────────────────
_AVAIL_CACHE: Dict[str, Dict] = {}
_CACHE_TTL = 300  # secondes

WEB_SEARCH_TOOL = {
    "type": "web_search_20250305",
    "name": "web_search"
}


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 120.0,
    web_search: bool = False,
    max_retries: int = 3,
) -> Optional[Dict[str, Any]]:
    """
    Query a single model.
    Route vers Ollama si le modèle est préfixé ollama/ ou local/,
    sinon vers OpenRouter (cloud).
    Retry automatique avec backoff exponentiel sur 429 / 5xx (cloud uniquement).
    """
    # ── Routage local (Ollama) ────────────────────────────────────────────────
    if model.startswith("ollama/") or model.startswith("local/"):
        return await ollama_chat(model, messages)

    import asyncio

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
    }

    if web_search:
        payload["tools"] = [WEB_SEARCH_TOOL]

    last_error = None
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    OPENROUTER_API_URL,
                    headers=headers,
                    json=payload
                )

                # 429 Rate limit — backoff exponentiel
                if response.status_code == 429:
                    wait = 2 ** attempt  # 1s, 2s, 4s
                    print(f"[openrouter] 429 rate limit on {model}, retry {attempt+1}/{max_retries} in {wait}s")
                    await asyncio.sleep(wait)
                    last_error = "429 rate limit"
                    continue

                # 5xx erreurs serveur — retry
                if response.status_code >= 500:
                    wait = 2 ** attempt
                    print(f"[openrouter] {response.status_code} server error on {model}, retry {attempt+1}/{max_retries} in {wait}s")
                    await asyncio.sleep(wait)
                    last_error = f"HTTP {response.status_code}"
                    continue

                response.raise_for_status()
                data = response.json()

                # Certains modèles free retournent une erreur dans le body
                if "error" in data:
                    err_msg = data["error"].get("message", str(data["error"]))
                    err_code = data["error"].get("code", 0)
                    # 429 dans le body
                    if err_code == 429 or "rate limit" in err_msg.lower():
                        wait = 2 ** attempt
                        print(f"[openrouter] body 429 on {model}, retry {attempt+1}/{max_retries} in {wait}s")
                        await asyncio.sleep(wait)
                        last_error = err_msg
                        continue
                    # Modèle indisponible / quota épuisé — pas la peine de retry
                    print(f"[openrouter] model error {model}: {err_msg}")
                    return None

                if not data.get("choices"):
                    print(f"[openrouter] no choices for {model}: {data}")
                    return None

                message = data["choices"][0]["message"]
                content = message.get("content") or ""
                if not content and message.get("tool_calls"):
                    content = "[Web search effectué — pas de réponse textuelle retournée]"

                return {
                    "content": content,
                    "reasoning_details": message.get("reasoning_details"),
                }

        except httpx.TimeoutException:
            wait = 2 ** attempt
            print(f"[openrouter] timeout on {model}, retry {attempt+1}/{max_retries} in {wait}s")
            await asyncio.sleep(wait)
            last_error = "timeout"
            continue

        except Exception as e:
            print(f"[openrouter] error on {model}: {e}")
            last_error = str(e)
            break

    print(f"[openrouter] all retries failed for {model}: {last_error}")
    return None


async def check_model_availability(model: str) -> Dict[str, Any]:
    """
    Vérifie la disponibilité d'un modèle via l'API endpoints OpenRouter.
    GET https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints
    Timeout 5s — ne bloque jamais l'exécution.
    Cache 5 minutes en mémoire.
    """
    now = _time.monotonic()
    cached = _AVAIL_CACHE.get(model)
    if cached and (now - cached["_t"]) < _CACHE_TTL:
        return cached

    result: Dict[str, Any]
    try:
        # Retirer le suffixe :free/:extended pour l'URL
        clean = model.split(":")[0]
        parts = clean.split("/", 1)
        if len(parts) != 2:
            raise ValueError(f"Format modèle invalide: {model}")
        author, slug = parts
        url = f"https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints"

        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"})

        if r.status_code == 200:
            endpoints = r.json().get("data", {}).get("endpoints", [])
            count     = len(endpoints)
            result = {"available": count > 0, "endpoints_count": count, "_t": now}
        elif r.status_code == 404:
            result = {"available": False, "endpoints_count": 0, "_t": now}
        else:
            # Erreur inattendue → assumer disponible pour ne pas bloquer
            result = {"available": True, "endpoints_count": -1, "_t": now}

    except Exception as e:
        print(f"[openrouter] health check failed for {model}: {e}")
        # En cas d'erreur réseau → assumer disponible (pas de faux négatif)
        result = {"available": True, "endpoints_count": -1, "_t": now}

    _AVAIL_CACHE[model] = result
    return result


async def health_check_pipeline(nodes: list) -> Dict[str, Any]:
    """
    Vérifie tous les LLM nodes d'un pipeline avant exécution.
    Retourne:
      {
        "ok": True/False,
        "nodes": { node_id: {"model": "...", "available": bool, "fallback": "..."} }
      }
    """
    import asyncio
    from .fallback_models import get_chain
    from .ollama_client import ollama_available as _oa, is_model_available_locally

    llm_nodes = [n for n in nodes if n.get("node_type", "llm") == "llm" and n.get("model")]
    unique_models = list({n["model"] for n in llm_nodes})

    # Séparer modèles locaux (Ollama) et cloud (OpenRouter)
    cloud_models = [m for m in unique_models if not (m.startswith("ollama/") or m.startswith("local/"))]
    local_models  = [m for m in unique_models if m.startswith("ollama/") or m.startswith("local/")]

    availability: Dict[str, Any] = {}

    # Modèles locaux : vérifier via cache Ollama, pas via OpenRouter
    for m in local_models:
        avail = _oa() and is_model_available_locally(m)
        availability[m] = {"available": avail, "endpoints_count": 0, "local": True}

    # Modèles cloud : vérifier via OpenRouter
    if cloud_models:
        checks = await asyncio.gather(
            *[check_model_availability(m) for m in cloud_models],
            return_exceptions=True,
        )
        for m, res in zip(cloud_models, checks):
            if isinstance(res, Exception):
                availability[m] = {"available": True, "endpoints_count": -1}
            else:
                availability[m] = res

    node_status = {}
    all_ok = True
    for n in llm_nodes:
        m     = n["model"]
        avail = availability.get(m, {}).get("available", True)
        count = availability.get(m, {}).get("endpoints_count", -1)
        fb    = None
        if not avail:
            all_ok = False
            chain = get_chain(m)
            fb    = chain[1] if len(chain) > 1 else None
        node_status[n["id"]] = {
            "model":           m,
            "available":       avail,
            "endpoints_count": count,
            "fallback":        fb,
            "local":           availability.get(m, {}).get("local", False),
        }

    return {"ok": all_ok, "nodes": node_status}


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
    web_search: bool = False,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model
        web_search: Whether to enable web search for all models

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    tasks = [query_model(model, messages, web_search=web_search) for model in models]
    responses = await asyncio.gather(*tasks)
    return {model: response for model, response in zip(models, responses)}
