"""
scorer.py — LLM Council
=======================
Scoring qualité des réponses LLM.

- Scoring automatique (auto) : LLM juge appelé après chaque réponse Chairman
- Scoring manuel (user) : boutons 👍 👎 ⭐ dans le chat
- Stockage : TinyDB table "llm_scores"
- Agrégats par modèle / période
"""

import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from .db import _table, Q


# ── Stockage ───────────────────────────────────────────────────────────────────

def save_score(
    *,
    conversation_id: str,
    model: str,
    stage: str,                    # "stage1" | "stage2" | "chairman"
    user_id: str,
    source: str,                   # "user" | "auto"
    scores: dict,                  # {relevance, accuracy, format, overall}
    message_id: Optional[str] = None,
) -> dict:
    """Enregistre un score dans TinyDB."""
    entry = {
        "id":              str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "message_id":      message_id or str(uuid.uuid4()),
        "model":           model,
        "stage":           stage,
        "user_id":         user_id,
        "timestamp":       datetime.now(timezone.utc).isoformat(),
        "scores":          scores,
        "source":          source,
    }
    _table("llm_scores").insert(entry)
    return entry


def get_all_scores(days: Optional[int] = None) -> list:
    """Tous les scores (admin). Filtre optionnel par période."""
    rows = _table("llm_scores").all()
    if days:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        rows = [r for r in rows if r.get("timestamp", "") >= cutoff]
    return rows


def get_scores_summary(days: int = 30, model: Optional[str] = None) -> list:
    """
    Agrégat par modèle : moyenne relevance / accuracy / format / overall.
    Retourne une liste triée par overall décroissant.
    """
    rows = get_all_scores(days=days)
    if model:
        rows = [r for r in rows if r.get("model") == model]

    # Grouper par modèle
    by_model: dict = {}
    for r in rows:
        m = r.get("model", "unknown")
        if m not in by_model:
            by_model[m] = {"relevance": [], "accuracy": [], "format": [], "overall": []}
        s = r.get("scores", {})
        for k in ("relevance", "accuracy", "format", "overall"):
            if isinstance(s.get(k), (int, float)):
                by_model[m][k].append(s[k])

    def avg(lst):
        return round(sum(lst) / len(lst), 2) if lst else None

    result = []
    for m, data in by_model.items():
        n = max(len(data["overall"]), 1)
        result.append({
            "model":       m,
            "model_short": m.split("/")[-1],
            "n":           len(data["overall"]) or len(data["relevance"]),
            "relevance":   avg(data["relevance"]),
            "accuracy":    avg(data["accuracy"]),
            "format":      avg(data["format"]),
            "overall":     avg(data["overall"]),
        })

    # Trier par overall décroissant (None en dernier)
    result.sort(key=lambda x: x["overall"] or 0, reverse=True)
    return result


# ── Scoring automatique (LLM juge) ────────────────────────────────────────────

_JUDGE_MODEL = "mistralai/mistral-medium-3"

_JUDGE_PROMPT = """Tu es un évaluateur de qualité pour des réponses LLM. Note la réponse ci-dessous sur 3 critères (score 1-10) :

Question posée : {question}

Réponse à évaluer : {response}

Réponds UNIQUEMENT en JSON valide, sans aucun autre texte :
{{"relevance": X, "accuracy": X, "format": X, "overall": X, "reasoning": "explication courte"}}

Critères :
- relevance (1-10) : pertinence par rapport à la question
- accuracy (1-10) : précision et exactitude factuelle
- format (1-10) : clarté, structure et lisibilité
- overall (1-10) : note globale"""


async def auto_score_response(
    *,
    question: str,
    response: str,
    model: str,
    conversation_id: str,
    user_id: str,
    message_id: Optional[str] = None,
) -> Optional[dict]:
    """
    Lance le LLM juge pour scorer une réponse Chairman.
    Fire-and-forget : doit être appelé via asyncio.create_task().
    Retourne le score enregistré ou None si échec.
    """
    import asyncio
    from .openrouter import query_model

    try:
        prompt = _JUDGE_PROMPT.format(
            question=question[:2000],   # limiter la taille
            response=response[:3000],
        )
        result = await query_model(
            model=_JUDGE_MODEL,
            messages=[{"role": "user", "content": prompt}],
            timeout=30.0,
        )
        if not result:
            return None

        raw = result.get("content", "")

        # Extraire le JSON (le modèle peut ajouter du texte)
        start = raw.find("{")
        end   = raw.rfind("}") + 1
        if start < 0 or end <= start:
            return None
        scores_data = json.loads(raw[start:end])

        # Valider et normaliser les scores (1-10)
        scores = {}
        for k in ("relevance", "accuracy", "format", "overall"):
            v = scores_data.get(k)
            if isinstance(v, (int, float)) and 1 <= v <= 10:
                scores[k] = round(float(v), 1)

        if not scores:
            return None

        return save_score(
            conversation_id=conversation_id,
            model=model,
            stage="chairman",
            user_id=user_id,
            source="auto",
            scores=scores,
            message_id=message_id,
        )

    except Exception as e:
        print(f"[scorer] auto_score_response failed: {e}")
        return None
