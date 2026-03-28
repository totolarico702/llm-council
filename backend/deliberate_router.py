# Copyright 2026 LLM Council Project
# Licensed under MIT
"""
deliberate_router.py — V3 public REST API
POST /api/v1/deliberate  — point d'entrée unique pour la délibération multi-LLM
Gestion des API keys (admin), validation et estimation .cog.
"""
import uuid, json, time, asyncio, datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from . import db
from .db import Q, require_admin, verify_token
from .dag_engine import run_pipeline as execute_dag
from .cog_parser import parse_cog, cog_to_dag
from .cost_estimator import estimate_pipeline_cost

router = APIRouter(prefix="/api/v1", tags=["v3-public"])

_bearer = HTTPBearer(auto_error=False)

# ── Auth : API key OU JWT ──────────────────────────────────────────────────────

def _resolve_auth(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials],
) -> dict:
    """
    Accepte :
    - Bearer llmc_<token>  → API key (usage externe)
    - Bearer <jwt>         → JWT utilisateur (usage interne)
    - Cookie llmc_token    → JWT utilisateur (usage interne)
    """
    token = creds.credentials if creds else None
    if token and token.startswith("llmc_"):
        key_doc = db.verify_api_key(token)
        db.increment_api_key_usage(key_doc["id"])
        return {"auth_type": "api_key", **key_doc}
    # Fallback JWT
    jwt = request.cookies.get("llmc_token") or token
    if not jwt:
        raise HTTPException(status_code=401,
                            detail="Authentification requise (Bearer API key ou cookie JWT)")
    payload = verify_token(jwt)
    row = db._table("users").get(Q.id == payload.get("sub"))
    if not row:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    return {"auth_type": "user", **row}


def get_api_auth(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    return _resolve_auth(request, creds)


# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class DeliberateInput(BaseModel):
    message: str
    context: Optional[str] = None   # contexte injecté par l'appelant (ex: contenu RAG externe)


class DeliberateOptions(BaseModel):
    stream: bool = False
    cafeine_mode: bool = False
    scoring: bool = False
    language: str = "fr"


class DeliberateRequest(BaseModel):
    input: DeliberateInput
    cog: dict                                        # .cog v1.0 ou v2.0 inline
    options: Optional[DeliberateOptions] = None


class ApiKeyCreate(BaseModel):
    label: str
    quota_per_day: int = 1000


# ── Stockage des délibérations passées ────────────────────────────────────────

def _store_deliberation(doc: dict) -> dict:
    db._table("deliberations").insert(doc)
    return doc


def _get_deliberation(delib_id: str) -> Optional[dict]:
    return db._table("deliberations").get(Q.id == delib_id)


# ── POST /deliberate ───────────────────────────────────────────────────────────

@router.post("/deliberate")
async def deliberate(
    req: DeliberateRequest,
    request: Request,
    auth: dict = Depends(get_api_auth),
):
    """
    Soumet une question au moteur de délibération LLM Council.
    Accepte un .cog v1.0/v2.0 inline et retourne la réponse délibérée.
    Supporte le streaming SSE via options.stream=true.
    """
    opts = req.options or DeliberateOptions()

    # Valider le .cog
    try:
        cog = parse_cog(req.cog)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    dag        = cog_to_dag(cog)
    nodes      = dag["nodes"]
    config     = dag.get("config", {})
    language   = config.get("language", opts.language)
    timeout    = int(config.get("timeout_global", 300))
    delib_id   = str(uuid.uuid4())
    user_query = req.input.message
    doc_ctx    = req.input.context or None

    if opts.stream:
        return StreamingResponse(
            _stream_deliberation(delib_id, nodes, user_query, doc_ctx,
                                 language, timeout, cog),
            media_type="text/event-stream",
            headers={
                "Cache-Control":       "no-cache",
                "X-Accel-Buffering":   "no",
                "X-Deliberation-Id":   delib_id,
            },
        )

    # ── Mode non-stream ───────────────────────────────────────────────────────
    started = time.time()
    trace: list[dict] = []

    async def on_node_start(node_id, model, role):
        trace.append({"node_id": node_id, "model": model, "role": role,
                      "_t": time.time()})

    async def on_node_done(node_id, model, role, output, used_model=None,
                           fallback=False, duration_s=None,
                           tokens_in=0, tokens_out=0, cost=0.0):
        for t in trace:
            if t["node_id"] == node_id:
                t["duration_ms"] = round((duration_s or 0) * 1000)
                t["tokens"]      = (tokens_in or 0) + (tokens_out or 0)
                t["cost_usd"]    = round(cost or 0.0, 6)

    async def on_node_error(node_id, error_msg, model=None, duration_s=None):
        for t in trace:
            if t["node_id"] == node_id:
                t["error"] = error_msg

    try:
        result = await asyncio.wait_for(
            execute_dag(
                nodes            = nodes,
                user_query       = user_query,
                document_content = doc_ctx,
                on_node_start    = on_node_start,
                on_node_done     = on_node_done,
                on_node_error    = on_node_error,
                user_language    = language,
            ),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504,
                            detail=f"Pipeline timeout après {timeout}s")

    duration_ms = round((time.time() - started) * 1000)
    cost_data   = estimate_pipeline_cost({"nodes": nodes, "edges": dag.get("edges", [])})
    for t in trace:
        t.pop("_t", None)

    response = {
        "id":     delib_id,
        "status": "completed",
        "result": {
            "final":   result.get("final", ""),
            "outputs": result.get("outputs", {}),
        },
        "trace": trace,
        "cost": {
            "total_usd": cost_data.get("total_usd", 0.0),
            "breakdown": cost_data.get("node_breakdown", []),
        },
        "duration_ms": duration_ms,
    }
    _store_deliberation({
        **response,
        "cog_name":   cog.get("name", ""),
        "created_at": datetime.datetime.utcnow().isoformat(),
    })
    return response


async def _stream_deliberation(delib_id, nodes, user_query, doc_ctx,
                                language, timeout, cog):
    """Générateur SSE pour le mode stream."""
    evt_queue = asyncio.Queue()
    _SENTINEL = object()
    started   = time.time()
    trace: list[dict] = []

    async def on_node_start(node_id, model, role):
        trace.append({"node_id": node_id, "model": model, "role": role,
                      "_t": time.time()})
        await evt_queue.put(json.dumps({
            "type": "node_start", "node_id": node_id,
            "model": model, "role": role,
        }))

    async def on_node_done(node_id, model, role, output, used_model=None,
                           fallback=False, duration_s=None,
                           tokens_in=0, tokens_out=0, cost=0.0):
        dur = round((duration_s or 0) * 1000)
        for t in trace:
            if t["node_id"] == node_id:
                t["duration_ms"] = dur
                t["tokens"]      = (tokens_in or 0) + (tokens_out or 0)
                t["cost_usd"]    = round(cost or 0.0, 6)
        await evt_queue.put(json.dumps({
            "type":        "node_done",
            "node_id":     node_id,
            "model":       used_model or model,
            "duration_ms": dur,
            "tokens_in":   tokens_in,
            "tokens_out":  tokens_out,
            "cost":        cost,
        }))

    async def on_node_error(node_id, error_msg, model=None, duration_s=None):
        await evt_queue.put(json.dumps({
            "type": "node_error", "node_id": node_id, "error": error_msg,
        }))

    async def run_dag():
        try:
            return await asyncio.wait_for(
                execute_dag(
                    nodes            = nodes,
                    user_query       = user_query,
                    document_content = doc_ctx,
                    on_node_start    = on_node_start,
                    on_node_done     = on_node_done,
                    on_node_error    = on_node_error,
                    user_language    = language,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            await evt_queue.put(json.dumps({
                "type": "error", "error": f"Pipeline timeout après {timeout}s",
            }))
            return None
        finally:
            await evt_queue.put(_SENTINEL)

    yield f"data: {json.dumps({'type': 'deliberation_start', 'id': delib_id, 'node_count': len(nodes)})}\n\n"

    dag_task = asyncio.create_task(run_dag())

    while True:
        evt = await evt_queue.get()
        if evt is _SENTINEL:
            break
        yield f"data: {evt}\n\n"

    result = await dag_task or {"final": "", "outputs": {}}
    duration_ms = round((time.time() - started) * 1000)
    cost_data   = estimate_pipeline_cost({"nodes": nodes, "edges": []})
    for t in trace:
        t.pop("_t", None)

    done = {
        "type":        "done",
        "id":          delib_id,
        "final":       result.get("final", ""),
        "trace":       trace,
        "cost":        {"total_usd": cost_data.get("total_usd", 0.0)},
        "duration_ms": duration_ms,
    }
    yield f"data: {json.dumps(done)}\n\n"

    _store_deliberation({
        "id":          delib_id,
        "status":      "completed",
        "result":      {"final": result.get("final", ""), "outputs": result.get("outputs", {})},
        "trace":       trace,
        "cost":        {"total_usd": cost_data.get("total_usd", 0.0)},
        "duration_ms": duration_ms,
        "cog_name":    cog.get("name", ""),
        "created_at":  datetime.datetime.utcnow().isoformat(),
    })


# ── Endpoints secondaires ──────────────────────────────────────────────────────

@router.post("/cog/validate")
async def validate_cog_endpoint(
    body: dict,
    auth: dict = Depends(get_api_auth),
):
    """Valide un .cog sans l'exécuter."""
    try:
        cog = parse_cog(body)
        return {
            "valid":       True,
            "cog_version": cog.get("cog_version"),
            "name":        cog.get("name", ""),
            "node_count":  len(cog.get("nodes", [])),
            "edge_count":  len(cog.get("edges", [])),
        }
    except ValueError as e:
        return {"valid": False, "error": str(e)}


@router.post("/cog/estimate")
async def estimate_cog_endpoint(
    body: dict,
    auth: dict = Depends(get_api_auth),
):
    """Estime le coût d'un .cog sans l'exécuter."""
    try:
        cog = parse_cog(body)
        dag = cog_to_dag(cog)
        return estimate_pipeline_cost(dag)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/deliberations/{delib_id}")
async def get_deliberation_endpoint(
    delib_id: str,
    auth: dict = Depends(get_api_auth),
):
    """Récupère une délibération passée par son ID."""
    doc = _get_deliberation(delib_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Délibération introuvable")
    return doc


# ── Gestion des API keys (admin) ───────────────────────────────────────────────

@router.get("/api-keys")
async def list_api_keys_endpoint(admin: dict = Depends(require_admin)):
    """Liste les API keys (valeur masquée)."""
    keys = db.list_api_keys()
    return [
        {**k, "key": k["key"][:12] + "…" + k["key"][-4:]}
        for k in keys
    ]


@router.post("/api-keys", status_code=201)
async def create_api_key_endpoint(
    body: ApiKeyCreate,
    admin: dict = Depends(require_admin),
):
    """Crée une API key. La valeur complète n'est retournée qu'une seule fois."""
    return db.create_api_key(
        label         = body.label,
        created_by    = admin["id"],
        quota_per_day = body.quota_per_day,
    )


@router.delete("/api-keys/{key_id}", status_code=204)
async def delete_api_key_endpoint(
    key_id: str,
    admin: dict = Depends(require_admin),
):
    """Révoque une API key."""
    db.delete_api_key(key_id)
