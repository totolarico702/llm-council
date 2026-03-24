"""FastAPI backend — LLM Council (db.py edition)."""
import sys
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid, json, asyncio, os
from pathlib import Path

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

_limiter = Limiter(key_func=get_remote_address)

RAG_UPLOAD_MAX_BYTES = int(os.getenv("RAG_UPLOAD_MAX_MB", "100")) * 1024 * 1024

from . import storage
from .storage import get_conversation_history, init_data_dirs
from .council import (
    run_full_council, generate_conversation_title,
    stage1_collect_responses, stage2_collect_rankings,
    stage3_synthesize_final, calculate_aggregate_rankings,
)
from . import db
from .db import (
    get_current_user, require_admin,
    login_user, get_user_by_id,
    create_user, update_user, delete_user, list_users,
    create_service, update_service, delete_service, list_services,
    grant_permission, deny_permission, revoke_permission,
    list_permissions, list_permissions_for_subject,
    has_permission, upsert_permission,
    list_groups, get_group, create_group, update_group, delete_group,
    create_rag_document, list_rag_documents, delete_rag_document, get_rag_document, update_rag_document,
)
from .usage_logger import log_usage, get_stats, get_dashboard_data, log_fallback_incident, read_fallback_incidents
from . import user_archiver
from . import rag_store
from . import rag_folders as rag_fld
from . import rag_audit
from .dag_engine import execute_dag
from .fallback_models import PRODUCTION_MODELS, is_production_safe
from .config import DEFAULT_MODEL, DEFAULT_CHAIRMAN, MISTRAL_MODELS, DATA_DIR
from .fs_browser import router as fs_router

# ── App ───────────────────────────────────────────────────────────────────────

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    from .logging_config import configure_logging
    configure_logging(level=os.getenv("LOG_LEVEL", "INFO"))
    # M1 : Avertir si JWT_SECRET par défaut en production
    _jwt     = os.getenv("JWT_SECRET", "")
    _default = "llm-council-dev-secret-CHANGE-IN-PROD"
    if not _jwt or _jwt == _default:
        if os.getenv("PRODUCTION", "").lower() in ("1", "true", "yes"):
            raise RuntimeError(
                "ERREUR SÉCURITÉ : JWT_SECRET non défini ou valeur par défaut en production. "
                "Définissez la variable d'environnement JWT_SECRET."
            )
        else:
            print("[WARN] JWT_SECRET non configuré — valeur par défaut utilisée. "
                  "À changer avant tout déploiement.")
    db.migrate_legacy()
    db.init_default_admin()
    # Initialiser l'arborescence data/ et migrer les fichiers legacy
    init_data_dirs()
    from .storage import migrate_legacy_storage
    users = db.list_users()
    migrate_legacy_storage(users)
    # Détecter Ollama au démarrage (non bloquant)
    from .ollama_client import check_ollama as _check_ollama
    await _check_ollama()
    # Charger data/settings.json (DEFAULT_MODEL / DEFAULT_CHAIRMAN persistés)
    _settings_path = Path(DATA_DIR) / "settings.json"
    if _settings_path.exists():
        try:
            _s = json.loads(_settings_path.read_text(encoding="utf-8"))
            if "default_model" in _s:
                os.environ["DEFAULT_MODEL"] = _s["default_model"]
            if "default_chairman" in _s:
                os.environ["DEFAULT_CHAIRMAN"] = _s["default_chairman"]
            print(f"[settings] DEFAULT_MODEL={os.getenv('DEFAULT_MODEL')}  "
                  f"DEFAULT_CHAIRMAN={os.getenv('DEFAULT_CHAIRMAN')}")
        except Exception as e:
            print(f"[settings] Lecture settings.json échouée : {e}")
    # Print de démarrage : schéma TinyDB
    print("[db] ── Schéma TinyDB ─────────────────────────────────────────────")
    for u in users:
        print(f"[db]   user  id={u['id'][:8]}…  login={u.get('login')!r:12}  role={u.get('role')!r}")
    print(f"[db]   {len(db.list_services())} service(s)  |  "
          f"{len(db.list_permissions())} permission(s)  |  "
          f"{len(db.list_groups())} pipeline(s)")
    print("[db] ────────────────────────────────────────────────────────────────")
    # Purge audit log au démarrage (logs > RAG_AUDIT_RETENTION_DAYS)
    rag_audit.purge_old_logs()
    # Migration rétroactive : créer un dossier RAG racine pour chaque service sans dossier
    try:
        _services        = db.list_services()
        _existing_folders = rag_fld.list_folders()
        for _svc in _services:
            _svc_id   = _svc.get("id", "")
            _svc_name = _svc.get("name", _svc_id)
            _has_folder = any(
                f.get("service") == _svc_id and not f.get("parent_id")
                for f in _existing_folders
            )
            if not _has_folder:
                try:
                    rag_fld.create_folder(
                        name       = _svc_name,
                        parent_id  = None,
                        service    = _svc_id,
                        created_by = "system",
                    )
                    print(f"[rag] Migration : dossier RAG créé pour le service '{_svc_name}'")
                except Exception as _e:
                    print(f"[rag][WARN] Migration dossier RAG pour '{_svc_name}': {_e}")
    except Exception as _e:
        print(f"[rag][WARN] Migration dossiers RAG échouée : {_e}")
    yield  # l'app tourne ici

app = FastAPI(title="LLM Council API", lifespan=lifespan)
app.state.limiter = _limiter
app.add_middleware(SlowAPIMiddleware)

# Toutes les routes métier sont sous /api/v1
from fastapi import APIRouter as _APIRouter
api_v1 = _APIRouter(prefix="/api/v1")

api_v1.include_router(fs_router)

# ── CORS — doit être ajouté AVANT toute route ─────────────────────────────────
_PROD = os.getenv("PRODUCTION", "").lower() in ("1", "true", "yes")

_ORIGINS_DEFAULT = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
_ORIGINS_RAW     = os.getenv("ALLOWED_ORIGINS", _ORIGINS_DEFAULT)
_ORIGINS         = [o.strip() for o in _ORIGINS_RAW.split(",") if o.strip()]
print(f"[CORS] mode={'prod' if _PROD else 'dev'}  origins={_ORIGINS}  credentials=True")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Healthcheck Docker — pas d'auth requise."""
    return {"status": "ok", "version": "1.0.0"}

# ── Schémas ───────────────────────────────────────────────────────────────────

class CreateConversationRequest(BaseModel):
    pass

class SendMessageRequest(BaseModel):
    content: str
    models: List[str] = []
    web_search_mode: str = "none"
    document_content: Optional[str] = None
    pipeline_nodes: Optional[List[Dict[str, Any]]] = None  # nodes DAG si pipeline nodal

class ConversationMetadata(BaseModel):
    id: str
    created_at: str
    title: str
    message_count: int
    owner_id: Optional[str] = None

class Conversation(BaseModel):
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]

class LoginRequest(BaseModel):
    login: str
    password: str

class CreateUserRequest(BaseModel):
    login:      str
    password:   str
    role:       str = "user"
    service_id: Optional[str] = None

class UpdateUserRequest(BaseModel):
    login:      Optional[str] = None
    password:   Optional[str] = None
    role:       Optional[str] = None
    service_id: Optional[str] = None

class UpdateMeRequest(BaseModel):
    language: Optional[str] = None

class CreateServiceRequest(BaseModel):
    name:         str
    pipeline_ids: List[str] = []

class UpdateServiceRequest(BaseModel):
    name:         Optional[str]       = None
    pipeline_ids: Optional[List[str]] = None

class CreateDashboardTokenRequest(BaseModel):
    label:        str
    expires_days: Optional[int] = None

# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return {"status": "ok", "service": "LLM Council API"}

# ── Auth ──────────────────────────────────────────────────────────────────────

@api_v1.post("/auth/login")
@_limiter.limit("5/minute")
async def route_login(request: Request, body: LoginRequest):
    from fastapi.responses import JSONResponse
    from .db import create_refresh_token, COOKIE_SECURE, COOKIE_SAMESITE
    result = login_user(body.login, body.password)
    refresh_token = create_refresh_token(result["user"]["id"])
    resp = JSONResponse(content=result)
    resp.set_cookie("llmc_token", result["token"], httponly=True,
                    samesite=COOKIE_SAMESITE, secure=COOKIE_SECURE, max_age=8*3600)
    resp.set_cookie("llmc_refresh", refresh_token, httponly=True,
                    samesite=COOKIE_SAMESITE, secure=COOKIE_SECURE, max_age=7*24*3600)
    return resp

@api_v1.post("/auth/refresh")
async def route_refresh(request: Request):
    """Émet un nouvel access token à partir du refresh cookie."""
    from fastapi.responses import JSONResponse
    from .db import verify_refresh_token, create_refresh_token, get_user_by_id, COOKIE_SECURE, COOKIE_SAMESITE
    refresh_cookie = request.cookies.get("llmc_refresh")
    if not refresh_cookie:
        raise HTTPException(status_code=401, detail="Refresh token manquant")
    user_id = verify_refresh_token(refresh_cookie)
    user    = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    from .db import create_token
    token         = create_token({"sub": user["id"], "role": user["role"], "login": user["login"]})
    refresh_token = create_refresh_token(user["id"])
    resp = JSONResponse(content={"token": token, "user": {k: v for k, v in user.items() if k != "password"}})
    resp.set_cookie("llmc_token", token, httponly=True,
                    samesite=COOKIE_SAMESITE, secure=COOKIE_SECURE, max_age=8*3600)
    resp.set_cookie("llmc_refresh", refresh_token, httponly=True,
                    samesite=COOKIE_SAMESITE, secure=COOKIE_SECURE, max_age=7*24*3600)
    return resp

@api_v1.post("/auth/logout")
async def route_logout():
    from fastapi.responses import JSONResponse
    resp = JSONResponse(content={"status": "logged_out"})
    resp.delete_cookie("llmc_token")
    resp.delete_cookie("llmc_refresh")
    return resp

@api_v1.post("/auth/change-password")
async def route_change_password(body: dict, user: dict = Depends(get_current_user)):
    """Change le mot de passe de l'utilisateur connecté et remet must_change_password à False."""
    new_password = (body.get("new_password") or "").strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Mot de passe trop court (min 6 caractères)")
    from .db import hash_password as _hash
    update_user(user["id"], {"password": new_password, "must_change_password": False})
    return {"status": "password_changed"}

@api_v1.get("/auth/me")
async def route_me(user: dict = Depends(get_current_user)):
    return {k: v for k, v in user.items() if k != "password"}

@api_v1.patch("/auth/me")
async def route_update_me(body: UpdateMeRequest, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        return {k: v for k, v in user.items() if k != "password"}
    if "language" in data and data["language"] not in ("fr", "en"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Langue non supportée. Valeurs acceptées : fr, en")
    return update_user(user["id"], data)

# ── Admin — Users ─────────────────────────────────────────────────────────────

@api_v1.get("/admin/users")
async def route_list_users(_: dict = Depends(require_admin)):
    return list_users()

@api_v1.post("/admin/users", status_code=201)
async def route_create_user(body: CreateUserRequest, _: dict = Depends(require_admin)):
    return create_user(body.login, body.password, body.role, body.service_id)

@api_v1.patch("/admin/users/{user_id}")
async def route_update_user(user_id: str, body: UpdateUserRequest,
                            _: dict = Depends(require_admin)):
    return update_user(user_id, body.model_dump(exclude_none=True))

@api_v1.delete("/admin/users/{user_id}", status_code=204)
async def route_delete_user(user_id: str, _: dict = Depends(require_admin)):
    delete_user(user_id)

# ── Admin — Services ──────────────────────────────────────────────────────────

@api_v1.get("/admin/services")
async def route_list_services(_: dict = Depends(require_admin)):
    return list_services()

@api_v1.post("/admin/services", status_code=201)
async def route_create_service(body: CreateServiceRequest,
                               _: dict = Depends(require_admin)):
    service = create_service(body.name, body.pipeline_ids)
    # Auto-créer un dossier RAG racine pour ce service
    try:
        rag_fld.create_folder(
            name       = body.name,
            parent_id  = None,
            service    = service["id"],
            created_by = "system",
        )
        print(f"[rag] Dossier RAG créé automatiquement pour le service '{body.name}'")
    except Exception as _e:
        print(f"[rag][WARN] Impossible de créer le dossier RAG pour '{body.name}': {_e}")
    return service

@api_v1.patch("/admin/services/{service_id}")
async def route_update_service(service_id: str, body: UpdateServiceRequest,
                               _: dict = Depends(require_admin)):
    return update_service(service_id, body.model_dump(exclude_none=True))

@api_v1.delete("/admin/services/{service_id}", status_code=204)
async def route_delete_service(service_id: str, _: dict = Depends(require_admin)):
    delete_service(service_id)

# ── Admin — Permissions ───────────────────────────────────────────────────────

@api_v1.get("/admin/permissions")
async def route_list_permissions(_: dict = Depends(require_admin)):
    return list_permissions()

@api_v1.get("/admin/permissions/subject/{subject}")
async def route_list_for_subject(subject: str,
                                 user: dict = Depends(get_current_user)):
    own = {f"user:{user['id']}", f"role:{user.get('role','user')}"}
    if user.get("service_id"):
        own.add(f"service:{user['service_id']}")
    if user.get("role") != "admin" and subject not in own:
        raise HTTPException(status_code=403, detail="Accès refusé")
    return list_permissions_for_subject(subject)

@api_v1.post("/admin/permissions", status_code=201)
async def route_grant(body: dict, _: dict = Depends(require_admin)):
    fn = grant_permission if body.get("granted", True) else deny_permission
    return fn(body["subject"], body["resource"], body.get("action", "use"))

@api_v1.delete("/admin/permissions/{perm_id}", status_code=204)
async def route_delete_permission(perm_id: str, _: dict = Depends(require_admin)):
    revoke_permission(perm_id)

# ── Admin — Stats ─────────────────────────────────────────────────────────────

@api_v1.get("/admin/stats")
async def route_stats(period: str = "day", limit: int = 30,
                      _: dict = Depends(require_admin)):
    return get_stats(period=period, limit_periods=limit)


# ── Incidents de fallback ─────────────────────────────────────────────────────

@api_v1.get("/admin/incidents")
async def route_incidents(
    model: str = None,
    since: str = None,
    _: dict = Depends(require_admin),
):
    return read_fallback_incidents(model=model, since=since, limit=50)


# ── État modèles production ───────────────────────────────────────────────────

_models_status_cache: dict = {"data": None, "at": 0.0}

@api_v1.get("/admin/models/status")
async def route_models_status(_: dict = Depends(require_admin)):
    """
    Pour chaque modèle de PRODUCTION_MODELS, vérifie disponibilité via OpenRouter.
    Cache 5 minutes.
    """
    import time as _t
    from .openrouter import check_model_availability
    import asyncio

    now = _t.monotonic()
    if _models_status_cache["data"] and (now - _models_status_cache["at"]) < 300:
        return _models_status_cache["data"]

    models = list(PRODUCTION_MODELS.keys())
    results = await asyncio.gather(
        *[check_model_availability(m) for m in models],
        return_exceptions=True,
    )

    import time as _t2
    checked_at = _t2.strftime("%Y-%m-%dT%H:%M:%S", _t2.gmtime())
    status = []
    for m, res in zip(models, results):
        info   = PRODUCTION_MODELS[m]
        avail  = True
        count  = -1
        if not isinstance(res, Exception):
            avail = res.get("available", True)
            count = res.get("endpoints_count", -1)
        status.append({
            "model":           m,
            "available":       avail,
            "endpoints_count": count,
            "cost_tier":       info["cost"],
            "tags":            info["tags"],
            "last_checked":    checked_at,
        })

    _models_status_cache["data"] = status
    _models_status_cache["at"]   = now
    return status


# ── Dashboard Comex (token read-only) ─────────────────────────────────────────

@api_v1.get("/dashboard/{token}")
async def route_dashboard(token: str):
    return get_dashboard_data(token)


@api_v1.post("/admin/dashboard/token", status_code=201)
async def route_create_dashboard_token(body: CreateDashboardTokenRequest,
                                       _: dict = Depends(require_admin)):
    entry = db.create_dashboard_token(body.label, body.expires_days)
    return {
        "token":      entry["token"],
        "url":        f"/dashboard/{entry['token']}",
        "label":      entry["label"],
        "created_at": entry["created_at"],
        "expires_at": entry["expires_at"],
    }


@api_v1.get("/admin/dashboard/tokens")
async def route_list_dashboard_tokens(_: dict = Depends(require_admin)):
    return db.list_dashboard_tokens()


@api_v1.delete("/admin/dashboard/tokens/{token}", status_code=204)
async def route_revoke_dashboard_token(token: str, _: dict = Depends(require_admin)):
    db.revoke_dashboard_token(token)


# ── Archivage user ────────────────────────────────────────────────────────────

@api_v1.get("/admin/users/{user_id}/archive/preview")
async def route_archive_preview(user_id: str, _: dict = Depends(require_admin)):
    """
    Analyse le dossier d'un user et retourne un aperçu avant archivage.
    Affiché à l'admin pour confirmation.
    """
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    preview = await user_archiver.analyze_user(user_id, user["login"])
    # Sérialiser dataclasses
    from dataclasses import asdict
    return asdict(preview)


@api_v1.post("/admin/users/{user_id}/archive")
async def route_archive_user(user_id: str, _: dict = Depends(require_admin)):
    """
    Finalise l'archivage : génère synthesis.md + rag_index.json,
    ingère dans Qdrant, déplace le dossier, supprime le user de TinyDB.
    """
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Impossible d'archiver un admin")

    # Analyser + archiver
    preview      = await user_archiver.analyze_user(user_id, user["login"])
    archive_path = await user_archiver.finalize_archive(preview)

    # Supprimer le user de TinyDB
    db.delete_user(user_id)

    return {
        "status":       "archived",
        "archive_path": archive_path,
        "chunks":       len(preview.chunks),
        "login":        user["login"],
    }


@api_v1.get("/admin/rag/stats")
async def route_rag_stats(_: dict = Depends(require_admin)):
    """Statistiques du RAG."""
    return rag_store.get_stats()

# ── RAG — Upload & indexation ─────────────────────────────────────────────────

@api_v1.post("/rag/upload")
async def rag_upload(
    file:       UploadFile = File(...),
    folder_id:  str        = Form("global"),
    service_id: str        = Form("global"),
    current_user: dict     = Depends(get_current_user),
):
    """Upload et indexe un document dans le RAG."""
    from .rag_store import ingest_document
    import tempfile

    # Vérifier permission rag_write (admin toujours autorisé)
    if current_user["role"] != "admin":
        if not has_permission(current_user, "rag", "write"):
            raise HTTPException(status_code=403, detail="Permission rag_write requise")

    file_bytes = await file.read()
    if len(file_bytes) > RAG_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Fichier trop volumineux (max {RAG_UPLOAD_MAX_BYTES // (1024*1024)} Mo)")

    doc_id = str(uuid.uuid4())
    suffix = Path(file.filename).suffix if file.filename else ".bin"
    tmp    = Path(tempfile.mktemp(suffix=suffix))
    tmp.write_bytes(file_bytes)

    try:
        result = await ingest_document(
            file_path  = tmp,
            filename   = file.filename or "document",
            doc_id     = doc_id,
            folder_id  = folder_id,
            service_id = service_id,
            user_id    = current_user["id"],
            metadata   = {
                "uploaded_by":   current_user["login"],
                "original_name": file.filename,
                "content_type":  file.content_type,
            },
        )
        create_rag_document({
            "id":         doc_id,
            "filename":   file.filename or "document",
            "folder_id":  folder_id,
            "service_id": service_id,
            "user_id":    current_user["id"],
            "user_login": current_user["login"],
            "chunks":     result["chunks_count"],
            "status":     result["status"],
            "size_bytes": tmp.stat().st_size if tmp.exists() else 0,
        })
        return result
    finally:
        tmp.unlink(missing_ok=True)


@api_v1.get("/rag/search")
async def rag_search(
    q:          str,
    service_id: Optional[str] = None,
    folder_id:  Optional[str] = None,
    doc_id:     Optional[str] = None,
    limit:      int           = 5,
    _: dict = Depends(get_current_user),
):
    """Recherche sémantique dans le RAG."""
    from .rag_store import search
    results = await search(q, limit=limit, service_id=service_id,
                           folder_id=folder_id, doc_id=doc_id)
    return {"results": results, "count": len(results)}


@api_v1.get("/rag/documents")
async def rag_documents(
    folder_id:    Optional[str] = None,
    service_id:   Optional[str] = None,
    current_user: dict          = Depends(get_current_user),
):
    """Liste les documents indexés (filtrés par service si non-admin)."""
    docs = list_rag_documents()
    if current_user["role"] != "admin":
        user_service = current_user.get("service_id")
        docs = [d for d in docs if d.get("service_id") == user_service]
    if folder_id:
        docs = [d for d in docs if d.get("folder_id") == folder_id]
    if service_id and current_user["role"] == "admin":
        docs = [d for d in docs if d.get("service_id") == service_id]
    return docs


@api_v1.delete("/rag/documents/{doc_id}")
async def rag_delete_document(
    doc_id:       str,
    current_user: dict = Depends(get_current_user),
):
    """Supprime un document : auteur ou admin."""
    doc = get_rag_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")
    is_author = doc.get("user_id") == current_user["id"]
    is_admin  = current_user["role"] == "admin"
    if not is_author and not is_admin:
        raise HTTPException(status_code=403, detail="Réservé à l'auteur ou un admin")
    removed = await rag_store.delete_document(doc_id)
    delete_rag_document(doc_id)
    rag_audit.log_action(
        actor_id    = current_user["id"],
        actor_name  = current_user["login"],
        action      = "document_deleted",
        target_type = "document",
        target_id   = doc_id,
        target_name = doc.get("filename", doc_id),
        details     = {"folder_id": doc.get("folder_id"), "chunks_removed": removed},
    )
    return {"status": "deleted", "chunks_removed": removed}


@api_v1.patch("/rag/documents/{doc_id}/move")
async def rag_move_document(
    doc_id:       str,
    body:         dict,
    current_user: dict = Depends(get_current_user),
):
    """Déplace un document vers un autre dossier. Vérifie can_write sur le dossier cible."""
    doc = get_rag_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")

    new_folder_id = body.get("folder_id")
    if not new_folder_id:
        raise HTTPException(status_code=422, detail="folder_id requis")

    target_folder = rag_fld.get_folder(new_folder_id)
    if not target_folder:
        raise HTTPException(status_code=404, detail="Dossier cible introuvable")

    if current_user["role"] != "admin" and not rag_fld.can_write(current_user, target_folder):
        raise HTTPException(status_code=403, detail="Accès en écriture refusé sur ce dossier")

    old_folder_id = doc.get("folder_id")

    # Mettre à jour TinyDB
    update_rag_document(doc_id, {"folder_id": new_folder_id})

    # Mettre à jour les chunks dans LanceDB
    await rag_store.move_document(doc_id, new_folder_id)

    rag_audit.log_action(
        actor_id    = current_user["id"],
        actor_name  = current_user["login"],
        action      = "document_moved",
        target_type = "document",
        target_id   = doc_id,
        target_name = doc.get("filename", doc_id),
        details     = {"from": old_folder_id, "to": new_folder_id},
    )
    return {"status": "moved", "doc_id": doc_id, "folder_id": new_folder_id}


@api_v1.get("/rag/stats")
async def rag_stats_public(_: dict = Depends(require_admin)):
    """Statistiques RAG."""
    return rag_store.get_stats()


@api_v1.get("/rag/documents/{doc_id}/preview")
async def rag_preview_document(
    doc_id: str,
    max_chars: int = 200,
    _: dict = Depends(get_current_user),
):
    """Extrait les premiers caractères du premier chunk (tooltip hover)."""
    preview = await rag_store.preview_document(doc_id, max_chars=max_chars)
    if preview is None:
        raise HTTPException(status_code=404, detail="Document introuvable dans LanceDB")
    return {"doc_id": doc_id, "preview": preview}


@api_v1.post("/rag/resolve-mentions")
async def rag_resolve_mentions(
    body: dict,
    _: dict = Depends(get_current_user),
):
    """
    Résout une liste de noms de fichiers (@mentions) en contenu textuel.
    Body : { "mentions": ["rapport.pdf", "budget.docx"] }
    Retourne : { "resolved": { "rapport.pdf": "contenu...", ... } }
    """
    mentions = body.get("mentions") or []
    if not isinstance(mentions, list):
        raise HTTPException(status_code=422, detail="'mentions' doit être une liste")
    resolved = await rag_store.resolve_mentions(mentions)
    return {"resolved": resolved}


# ── RAG — Upload via nouveau endpoint (Session 2) ────────────────────────────

@api_v1.post("/rag/documents")
async def rag_upload_document(
    file:         UploadFile = File(...),
    folder_id:    str        = Form(...),          # obligatoire en Session 2
    current_user: dict       = Depends(get_current_user),
):
    """
    Upload et indexe un document (folder_id obligatoire).
    Requiert : permission rag_write ET accès write/admin sur le dossier.
    """
    import tempfile

    # Permission globale rag_write
    if current_user["role"] != "admin":
        if not has_permission(current_user, "rag", "write"):
            raise HTTPException(status_code=403, detail="Permission rag_write requise")

    # ACL dossier
    folder = rag_fld.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")
    if not rag_fld.can_write(current_user, folder):
        raise HTTPException(status_code=403, detail="Accès write requis sur ce dossier")

    file_bytes = await file.read()
    if len(file_bytes) > RAG_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Fichier trop volumineux (max {RAG_UPLOAD_MAX_BYTES // (1024*1024)} Mo)")

    doc_id = str(uuid.uuid4())
    suffix = Path(file.filename).suffix if file.filename else ".bin"
    tmp    = Path(tempfile.mktemp(suffix=suffix))
    tmp.write_bytes(file_bytes)

    try:
        result = await rag_store.ingest_document(
            file_path  = tmp,
            filename   = file.filename or "document",
            doc_id     = doc_id,
            folder_id  = folder_id,
            service_id = folder.get("service", "global"),
            user_id    = current_user["id"],
            metadata   = {
                "uploaded_by":   current_user["login"],
                "original_name": file.filename,
                "content_type":  file.content_type,
            },
        )
        create_rag_document({
            "id":          doc_id,
            "filename":    file.filename or "document",
            "folder_id":   folder_id,
            "service_id":  folder.get("service", "global"),
            "user_id":     current_user["id"],
            "uploaded_by": current_user["id"],
            "user_login":  current_user["login"],
            "chunks":      result["chunks_count"],
            "status":      result["status"],
            "size_bytes":  tmp.stat().st_size if tmp.exists() else 0,
            "uploaded_at": __import__("datetime").datetime.utcnow().isoformat(),
        })
        rag_audit.log_action(
            actor_id    = current_user["id"],
            actor_name  = current_user["login"],
            action      = "document_uploaded",
            target_type = "document",
            target_id   = doc_id,
            target_name = file.filename or "document",
            details     = {"folder_id": folder_id, "chunks": result["chunks_count"]},
        )
        return result
    finally:
        tmp.unlink(missing_ok=True)


# ── RAG — Dossiers ────────────────────────────────────────────────────────────

@api_v1.get("/rag/folders")
async def rag_list_folders(current_user: dict = Depends(get_current_user)):
    """Arborescence des dossiers filtrée par ACL."""
    return rag_fld.get_folder_tree(current_user)


@api_v1.post("/rag/folders", status_code=201)
async def rag_create_folder(body: dict, current_user: dict = Depends(get_current_user)):
    """
    Crée un dossier RAG.
    Réservé : admin ou user avec rôle manager.
    """
    if current_user["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Réservé aux admins et managers")

    name      = (body.get("name") or "").strip()
    parent_id = body.get("parent_id")
    service   = body.get("service") or current_user.get("service_id") or "global"

    if not name:
        raise HTTPException(status_code=422, detail="Le nom du dossier est requis")

    try:
        folder = rag_fld.create_folder(
            name       = name,
            parent_id  = parent_id,
            service    = service,
            created_by = current_user["id"],
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    rag_audit.log_action(
        actor_id    = current_user["id"],
        actor_name  = current_user["login"],
        action      = "folder_created",
        target_type = "folder",
        target_id   = folder["id"],
        target_name = folder["name"],
        details     = {"parent_id": parent_id, "service": service},
    )
    return folder


@api_v1.patch("/rag/folders/{folder_id}")
async def rag_rename_folder(
    folder_id:    str,
    body:         dict,
    current_user: dict = Depends(get_current_user),
):
    """Renomme un dossier (admin ou manager)."""
    if current_user["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Réservé aux admins et managers")

    folder = rag_fld.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Le nom est requis")

    return rag_fld.rename_folder(folder_id, name)


@api_v1.delete("/rag/folders/{folder_id}")
async def rag_delete_folder(
    folder_id:    str,
    current_user: dict = Depends(get_current_user),
):
    """
    Supprime un dossier vide (admin ou manager).
    Retourne 409 si le dossier contient encore des documents ou des sous-dossiers.
    """
    if current_user["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Réservé aux admins et managers")

    folder = rag_fld.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    doc_count   = rag_fld.folder_document_count(folder_id)
    child_count = rag_fld.folder_children_count(folder_id)
    if doc_count > 0 or child_count > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Impossible de supprimer : le dossier contient "
                f"{doc_count} document(s) et {child_count} sous-dossier(s)."
            ),
        )

    rag_fld.remove_folder(folder_id)
    rag_audit.log_action(
        actor_id    = current_user["id"],
        actor_name  = current_user["login"],
        action      = "folder_deleted",
        target_type = "folder",
        target_id   = folder_id,
        target_name = folder.get("name", folder_id),
        details     = {},
    )
    return {"status": "deleted", "folder_id": folder_id}


@api_v1.patch("/rag/folders/{folder_id}/acl")
async def rag_update_folder_acl(
    folder_id:    str,
    body:         dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Modifie les règles ACL d'un dossier (admin uniquement).
    Body : { "inherit": bool, "exceptions": [...] }
    """
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Réservé aux admins")

    folder = rag_fld.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    # Valider la structure minimale
    acl = {
        "inherit":    bool(body.get("inherit", True)),
        "exceptions": list(body.get("exceptions", [])),
    }
    updated = rag_fld.update_folder_acl(folder_id, acl)
    rag_audit.log_action(
        actor_id    = current_user["id"],
        actor_name  = current_user["login"],
        action      = "acl_modified",
        target_type = "folder",
        target_id   = folder_id,
        target_name = folder.get("name", folder_id),
        details     = {"acl": acl},
    )
    return updated


@api_v1.get("/rag/folders/{folder_id}/acl")
async def rag_get_folder_acl(
    folder_id:    str,
    current_user: dict = Depends(get_current_user),
):
    """Retourne l'ACL d'un dossier (admin uniquement)."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Réservé aux admins")
    folder = rag_fld.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")
    return folder.get("acl") or {"inherit": True, "exceptions": []}


@api_v1.delete("/rag/folders/{folder_id}/acl/{acl_id}", status_code=200)
async def rag_delete_folder_acl_exception(
    folder_id:    str,
    acl_id:       str,
    current_user: dict = Depends(get_current_user),
):
    """Supprime une exception ACL par son id (admin uniquement)."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Réservé aux admins")
    folder = rag_fld.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    acl        = folder.get("acl") or {"inherit": True, "exceptions": []}
    exceptions = [e for e in acl.get("exceptions", []) if e.get("id") != acl_id]
    acl["exceptions"] = exceptions

    updated = rag_fld.update_folder_acl(folder_id, acl)
    rag_audit.log_action(
        actor_id    = current_user["id"],
        actor_name  = current_user["login"],
        action      = "acl_modified",
        target_type = "folder",
        target_id   = folder_id,
        target_name = folder.get("name", folder_id),
        details     = {"deleted_exception_id": acl_id},
    )
    return updated.get("acl") or acl


@api_v1.post("/rag/documents/{doc_id}/reindex")
async def rag_reindex_document(
    doc_id:       str,
    current_user: dict = Depends(get_current_user),
):
    """Réindexe un document (re-embed les chunks existants). Admin uniquement."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Réservé aux admins")
    doc = get_rag_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")

    result = await rag_store.reindex_document(doc_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Aucun chunk trouvé pour ce document dans LanceDB")

    from .db import _table as _dbtable, Q as _Q
    _dbtable("rag_documents").update({"chunks": result["chunks_count"]}, _Q.id == doc_id)
    return result


# ── RAG — Audit Log ───────────────────────────────────────────────────────────

@api_v1.get("/rag/audit")
async def rag_audit_list(
    limit:     int           = 50,
    offset:    int           = 0,
    folder_id: Optional[str] = None,
    actor_id:  Optional[str] = None,
    action:    Optional[str] = None,
    _: dict = Depends(require_admin),
):
    """Consulte l'audit log RAG (admin uniquement)."""
    logs = rag_audit.list_audit(
        limit=limit, offset=offset,
        folder_id=folder_id, actor_id=actor_id, action=action,
    )
    return {"logs": logs, "count": len(logs), "offset": offset}


@api_v1.get("/admin/archive/list")
async def route_archive_list(_: dict = Depends(require_admin)):
    """Liste les dossiers d'archive avec metadata."""
    from pathlib import Path as _Path
    from .config import DATA_DIR as _DATA_DIR
    archive_root = _Path(_DATA_DIR) / "archive"
    if not archive_root.exists():
        return []
    result = []
    for folder in sorted(archive_root.iterdir(), reverse=True):
        if not folder.is_dir():
            continue
        # Parser {login}_{date}
        parts = folder.name.rsplit("_", 2)
        login = parts[0] if len(parts) >= 1 else folder.name
        date  = "_".join(parts[1:]) if len(parts) > 1 else ""
        # Compter les chunks dans rag_index.json
        chunks = None
        rag_file = folder / "rag_index.json"
        if rag_file.exists():
            try:
                data   = json.loads(rag_file.read_text(encoding="utf-8"))
                chunks = len(data.get("chunks", []))
            except Exception:
                pass
        result.append({
            "folder": folder.name,
            "login":  login,
            "date":   date,
            "chunks": chunks,
            "has_synthesis": (folder / "synthesis.md").exists(),
        })
    return result


@api_v1.get("/admin/users/{user_id}/data-summary")
async def route_user_data_summary(user_id: str, _: dict = Depends(require_admin)):
    """Résumé des données d'un user (nb convs, projets)."""
    return storage.get_user_data_summary(user_id)


@api_v1.get("/admin/settings")
async def get_admin_settings(_: dict = Depends(require_admin)):
    """Retourne les paramètres globaux (modèle par défaut, catalogue disponible)."""
    available = list(MISTRAL_MODELS.keys()) + [
        m for m in PRODUCTION_MODELS.keys() if m not in MISTRAL_MODELS
    ]
    return {
        "default_model":     os.getenv("DEFAULT_MODEL",    DEFAULT_MODEL),
        "default_chairman":  os.getenv("DEFAULT_CHAIRMAN", DEFAULT_CHAIRMAN),
        "available_defaults": available,
    }

@api_v1.put("/admin/settings")
async def update_admin_settings(body: dict, _: dict = Depends(require_admin)):
    """Met à jour DEFAULT_MODEL / DEFAULT_CHAIRMAN et les persiste dans data/settings.json."""
    settings_path = Path(DATA_DIR) / "settings.json"
    settings = {}
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if "default_model" in body:
        settings["default_model"] = body["default_model"]
        os.environ["DEFAULT_MODEL"] = body["default_model"]
    if "default_chairman" in body:
        settings["default_chairman"] = body["default_chairman"]
        os.environ["DEFAULT_CHAIRMAN"] = body["default_chairman"]
    settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False),
                             encoding="utf-8")
    print(f"[settings] Mise à jour : {settings}")
    return {"status": "ok", "settings": settings}


@api_v1.get("/local/status")
async def local_status(_: dict = Depends(get_current_user)):
    """État d'Ollama (disponible / nb modèles)."""
    from .ollama_client import ollama_available as _oa, _ollama_models
    return {
        "ollama": {
            "available":    _oa(),
            "url":          os.getenv("OLLAMA_URL", "http://localhost:11434"),
            "models_count": len(_ollama_models),
        }
    }

@api_v1.get("/local/models")
async def local_models(_: dict = Depends(get_current_user)):
    """Liste les modèles Ollama disponibles (rafraîchit la détection)."""
    from .ollama_client import list_ollama_models, ollama_available, check_ollama
    await check_ollama()
    return {
        "available": ollama_available(),
        "url":       os.getenv("OLLAMA_URL", "http://localhost:11434"),
        "models":    list_ollama_models(),
    }


@api_v1.get("/local/catalog")
async def ollama_catalog(_: dict = Depends(get_current_user)):
    """Catalogue de modèles Ollama recommandés, avec flag installed."""
    from .ollama_client import get_catalog, list_ollama_models, check_ollama
    await check_ollama()
    installed_names = {m["name"] for m in list_ollama_models()}
    catalog = get_catalog()
    for m in catalog:
        m["installed"] = any(
            m["id"] == name or m["id"].split(":")[0] == name.split(":")[0]
            for name in installed_names
        )
    return catalog


@api_v1.post("/local/pull")
async def pull_ollama_model(body: dict, _: dict = Depends(require_admin)):
    """Lance ollama pull <model> et streame la progression via SSE."""
    import httpx as _httpx
    model = (body.get("model") or "").strip()
    if not model:
        raise HTTPException(400, "model requis")

    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")

    async def generate():
        try:
            async with _httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{ollama_url}/api/pull",
                    json={"model": model, "stream": True},
                ) as r:
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        print(f"[ollama pull] {line}")
                        try:
                            data      = json.loads(line)
                            status    = data.get("status", "pulling")
                            completed = data.get("completed")  # absent hors downloading
                            total     = data.get("total")      # absent hors downloading

                            if status == "success":
                                from .ollama_client import check_ollama as _co
                                await _co()
                                evt = {"status": "done", "model": model}
                                print(f"[ollama pull SSE] {evt}")
                                yield f"data: {json.dumps(evt)}\n\n"
                                return

                            if completed is not None and total:
                                progress     = round(completed / total * 100, 1)
                                downloaded_gb = round(completed / 1e9, 2)
                                total_gb      = round(total / 1e9, 2)
                            else:
                                progress      = 0
                                downloaded_gb = 0.0
                                total_gb      = 0.0

                            evt = {
                                "status":        status,
                                "model":         model,
                                "progress":      progress,
                                "downloaded_gb": downloaded_gb,
                                "total_gb":      total_gb,
                            }
                            print(f"[ollama pull SSE] {evt}")
                            yield f"data: {json.dumps(evt)}\n\n"
                        except Exception as ex:
                            print(f"[ollama pull] parse error: {ex}")
                            continue
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'model': model, 'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@api_v1.delete("/local/models/{model_name:path}")
async def delete_ollama_model(model_name: str, _: dict = Depends(require_admin)):
    """Supprime un modèle Ollama installé (équivalent ollama rm)."""
    import httpx as _httpx
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    async with _httpx.AsyncClient(timeout=30) as client:
        r = await client.request(
            "DELETE",
            f"{ollama_url}/api/delete",
            json={"model": model_name},
        )
    if r.status_code in (200, 204):
        from .ollama_client import check_ollama as _co
        await _co()
        return {"status": "deleted", "model": model_name}
    raise HTTPException(r.status_code, f"Erreur Ollama : {r.text}")


@api_v1.get("/admin/conversations/all")
async def route_all_conversations(_: dict = Depends(require_admin)):
    """Diagnostic admin : toutes les conversations avec leur owner_id."""
    all_convs = storage.list_conversations()
    users     = {u["id"]: u["login"] for u in db.list_users()}
    return [
        {**c, "owner_login": users.get(c.get("owner_id"), "?")}
        for c in all_convs
    ]

# ── Pipelines ─────────────────────────────────────────────────────────────────

@api_v1.get("/groups")
async def route_list_groups(request: Request):
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        return list_groups()
    try:
        user = db.get_current_user_from_token(token)
        return list_groups(user)
    except Exception:
        return list_groups()

def _pipeline_warnings(nodes: list) -> list[str]:
    """Retourne des warnings si des nodes utilisent des modèles non-production."""
    warnings = []
    for n in nodes or []:
        if n.get("node_type", "llm") != "llm":
            continue
        m = n.get("model", "")
        if not m:
            continue
        if m.endswith(":free"):
            warnings.append(
                f"Node '{n.get('id', '?')}' utilise {m.split('/')[-1]} — "
                f"modèle :free non recommandé en production"
            )
        elif not is_production_safe(m):
            warnings.append(
                f"Node '{n.get('id', '?')}' utilise {m.split('/')[-1]} — "
                f"modèle absent de la liste de production"
            )
    return warnings


@api_v1.post("/groups")
async def route_create_group(body: dict, _: dict = Depends(require_admin)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    group    = create_group(name, body.get("nodes", []),
                            body.get("edges", []), body.get("models", []))
    warnings = _pipeline_warnings(body.get("nodes", []))
    if warnings:
        return {"status": "saved_with_warnings", "warnings": warnings, **group}
    return group

@api_v1.put("/groups/{group_id}")
async def route_update_group(group_id: str, body: dict,
                             _: dict = Depends(require_admin)):
    data     = {k: body[k] for k in ("name", "nodes", "edges", "models") if k in body}
    group    = update_group(group_id, data)
    warnings = _pipeline_warnings(data.get("nodes", []))
    if warnings:
        return {"status": "saved_with_warnings", "warnings": warnings, **group}
    return group

@api_v1.delete("/groups/{group_id}")
async def route_delete_group(group_id: str, _: dict = Depends(require_admin)):
    delete_group(group_id)
    return {"status": "deleted"}

@api_v1.get("/pipelines/allowed")
async def route_allowed_pipelines(user: dict = Depends(get_current_user)):
    if user.get("role") == "admin":
        return {"allowed": None, "all": True}
    return {"allowed": [g["id"] for g in list_groups(user)], "all": False}

# ── Catalogue modèles OpenRouter ─────────────────────────────────────────────

@api_v1.get("/models")
async def route_get_models(request: Request):
    """
    Retourne la liste des modèles disponibles.
    - Sans auth  → modèles autorisés par l'admin (allowed_models)
    - Admin      → tous les modèles OpenRouter avec metadata complète
    """
    import httpx
    from .config import OPENROUTER_API_KEY

    # Déterminer si l'utilisateur est admin
    is_admin_user = False
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            user = db.get_current_user_from_token(auth_header[7:])
            is_admin_user = user.get("role") == "admin"
        except Exception:
            pass

    # Charger la liste autorisée depuis TinyDB
    allowed_tbl = db._table("allowed_models")
    allowed_rows = allowed_tbl.all()
    allowed_ids  = {r["model_id"] for r in allowed_rows}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            )
        if r.status_code != 200:
            raise ValueError(f"OpenRouter {r.status_code}")

        raw_models = r.json().get("data", [])

        def enrich(m):
            mid   = m.get("id", "")
            price = m.get("pricing", {})
            try:
                cost_in  = float(price.get("prompt", 0) or 0) * 1_000_000
                cost_out = float(price.get("completion", 0) or 0) * 1_000_000
                avg_cost = (cost_in + cost_out) / 2
                if avg_cost == 0:     stars = 0
                elif avg_cost < 0.5:  stars = 1
                elif avg_cost < 2.0:  stars = 2
                else:                 stars = 3
            except Exception:
                stars, cost_in, cost_out = 0, 0, 0

            # Spécialités deduites du nom/description
            name  = (m.get("name") or mid).lower()
            desc  = (m.get("description") or "").lower()
            tags  = []
            if any(k in name+desc for k in ["code","coder","coding","dev"]):
                tags.append("code")
            if any(k in name+desc for k in ["vision","image","visual","multimodal"]):
                tags.append("vision")
            if any(k in name+desc for k in ["math","reasoning","think","r1"]):
                tags.append("reasoning")
            if any(k in name+desc for k in ["fast","flash","mini","haiku","small"]):
                tags.append("fast")
            if any(k in name+desc for k in ["instruct","chat","assistant"]):
                tags.append("chat")
            if "free" in mid:
                tags.append("free")

            return {
                "id":          mid,
                "name":        m.get("name") or mid,
                "description": (m.get("description") or "")[:200],
                "context_length": m.get("context_length", 0),
                "cost_stars":  stars,
                "cost_in":     round(cost_in, 4),
                "cost_out":    round(cost_out, 4),
                "tags":        tags,
                "is_free":     "free" in mid,
                "allowed":     mid in allowed_ids,
            }

        enriched = [enrich(m) for m in raw_models]

        if is_admin_user:
            # Admin → tous les modèles avec flag allowed (voit aussi les :free, avec badge)
            return {"models": enriched, "allowed_ids": list(allowed_ids)}
        else:
            # User → seulement les modèles autorisés, jamais les :free
            if allowed_ids:
                filtered = [m for m in enriched if m["allowed"] and not m["id"].endswith(":free")]
            else:
                # Aucune liste configurée → retourner PRODUCTION_MODELS uniquement
                prod_ids = set(PRODUCTION_MODELS.keys())
                filtered = [m for m in enriched
                            if m["id"] in prod_ids and not m["id"].endswith(":free")]
            return {"models": filtered}

    except Exception as e:
        # Fallback : retourner les modèles autorisés depuis TinyDB sans metadata
        fallback = [{"id": r["model_id"], "name": r.get("name", r["model_id"]),
                     "cost_stars": r.get("cost_stars", 0), "tags": r.get("tags", []),
                     "is_free": ":free" in r["model_id"], "allowed": True}
                    for r in allowed_rows]
        return {"models": fallback, "error": str(e)}


@api_v1.get("/admin/allowed-models")
async def route_list_allowed_models(_: dict = Depends(require_admin)):
    tbl = db._table("allowed_models")
    return tbl.all()


@api_v1.post("/admin/allowed-models", status_code=201)
async def route_add_allowed_model(body: dict, _: dict = Depends(require_admin)):
    """Autoriser un modèle dans l'éditeur de pipelines."""
    model_id = (body.get("model_id") or "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id requis")
    tbl = db._table("allowed_models")
    from tinydb import Query
    Q2 = Query()
    if tbl.get(Q2.model_id == model_id):
        return tbl.get(Q2.model_id == model_id)  # déjà présent
    row = {
        "model_id":   model_id,
        "name":       body.get("name", model_id),
        "cost_stars": body.get("cost_stars", 0),
        "tags":       body.get("tags", []),
        "added_at":   __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
    }
    tbl.insert(row)
    return row


@api_v1.delete("/admin/allowed-models/{model_id:path}", status_code=204)
async def route_remove_allowed_model(model_id: str, _: dict = Depends(require_admin)):
    """
    Révoquer un modèle — refusé si utilisé dans un pipeline actif.
    """
    from tinydb import Query
    Q2 = Query()

    # Vérifier si utilisé dans un pipeline
    all_groups = db.list_groups()
    used_in = []
    for g in all_groups:
        for node in g.get("nodes", []):
            if node.get("model") == model_id or node.get("model", "").endswith("/" + model_id.split("/")[-1]):
                used_in.append(g.get("name", g.get("id")))
    if used_in:
        raise HTTPException(
            status_code=409,
            detail=f"Modèle utilisé dans les pipelines : {', '.join(used_in)}. "
                   f"Retirez-le de ces pipelines avant de le révoquer."
        )

    db._table("allowed_models").remove(Q2.model_id == model_id)


# ── Health modèles ────────────────────────────────────────────────────────────

@api_v1.get("/health/models")
async def health_models(models: str = ""):
    from .config import OPENROUTER_API_KEY
    import httpx
    model_list = [m.strip() for m in models.split(",") if m.strip()]
    if not model_list:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get("https://openrouter.ai/api/v1/models",
                                 headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"})
        if r.status_code != 200:
            return {m: True for m in model_list}
        available = {m["id"] for m in r.json().get("data", [])}
        return {m: (m in available) for m in model_list}
    except Exception:
        return {m: True for m in model_list}

# ── Conversations ─────────────────────────────────────────────────────────────

@api_v1.get("/conversations", response_model=List[ConversationMetadata])
async def list_conversations_route(user: dict = Depends(get_current_user)):
    return storage.list_conversations(user["id"])

@api_v1.post("/conversations", response_model=Conversation)
async def create_conversation_route(request: CreateConversationRequest,
                                    user: dict = Depends(get_current_user)):
    return storage.create_conversation(str(uuid.uuid4()), owner_id=user["id"])

@api_v1.get("/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation_route(conversation_id: str,
                                 user: dict = Depends(get_current_user)):
    conv = storage.get_conversation(conversation_id, owner_id=user["id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.get("owner_id") and conv["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Accès refusé")
    return conv

@api_v1.patch("/conversations/{conversation_id}/title")
async def rename_conversation_route(conversation_id: str, body: dict,
                                    user: dict = Depends(get_current_user)):
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title requis")
    conv = storage.get_conversation(conversation_id, owner_id=user["id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.get("owner_id") and conv["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Accès refusé")
    storage.update_conversation_title(conversation_id, title, owner_id=user["id"])
    return {"status": "ok", "title": title}


@api_v1.delete("/conversations/{conversation_id}")
async def delete_conversation_route(conversation_id: str,
                                    user: dict = Depends(get_current_user)):
    conv = storage.get_conversation(conversation_id, owner_id=user["id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.get("owner_id") and conv["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Accès refusé")
    storage.delete_conversation(conversation_id, owner_id=user["id"])
    return {"status": "deleted"}

# ── Message (non-stream) ──────────────────────────────────────────────────────

@api_v1.post("/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest,
                       user: dict = Depends(get_current_user)):
    """Endpoint non-streaming — même logique que le stream mais retourne tout d'un coup."""
    conv = storage.get_conversation(conversation_id, owner_id=user["id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.get("owner_id") and conv["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Accès refusé")

    is_first = len(conv["messages"]) == 0
    history  = get_conversation_history(conversation_id, owner_id=user["id"])
    storage.add_user_message(conversation_id, request.content, owner_id=user["id"])

    if is_first:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title, owner_id=user["id"])

    if request.pipeline_nodes:
        # Mode DAG non-stream
        try:
            result = await asyncio.wait_for(execute_dag(
                nodes            = request.pipeline_nodes,
                user_query       = request.content,
                history          = history,
                document_content = request.document_content,
                web_search_mode  = request.web_search_mode,
                user_id          = user["id"],
                user_language    = user.get("language", "fr"),
                service_id       = user.get("service_id"),
            ), timeout=300)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Pipeline timeout après 5 minutes")
        final_output  = result.get("final", "")
        terminal      = result.get("terminal_node", {})
        stage3_result = {"model": terminal.get("model", "dag"), "response": final_output}
        storage.add_assistant_message(conversation_id, {}, {}, stage3_result, owner_id=user["id"])
        return {"dag": True, "final": final_output, "outputs": result.get("outputs", {}),
                "execution_order": result.get("execution_order", [])}
    else:
        # Mode council classique non-stream
        from .config import COUNCIL_MODELS
        council_models = request.models if request.models else COUNCIL_MODELS
        chairman_model = council_models[0]

        stage1_results = await stage1_collect_responses(
            request.content, council_models, request.web_search_mode, history)
        stage2_results, label_to_model = await stage2_collect_rankings(
            request.content, stage1_results, council_models, history)
        aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
        stage3_result = await stage3_synthesize_final(
            request.content, stage1_results, stage2_results,
            chairman_model, request.web_search_mode, history)

        storage.add_assistant_message(conversation_id, stage1_results, stage2_results, stage3_result, owner_id=user["id"])
        for result in (stage1_results or []):
            if result and isinstance(result, dict):
                log_usage(user_id=user["id"], user_login=user["login"],
                          service_id=user.get("service_id"), model=result.get("model",""),
                          conversation_id=conversation_id,
                          prompt_tokens=0, completion_tokens=0, native_cost=None)
        return {"stage1": stage1_results, "stage2": stage2_results,
                "stage3": stage3_result,
                "metadata": {"label_to_model": label_to_model,
                             "aggregate_rankings": aggregate_rankings}}

# ── Message stream ────────────────────────────────────────────────────────────

@api_v1.post("/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest,
                              user: dict = Depends(get_current_user)):
    conv = storage.get_conversation(conversation_id, owner_id=user["id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.get("owner_id") and conv["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Accès refusé")
    is_first  = len(conv["messages"]) == 0
    user_ctx  = {"id": user["id"], "login": user["login"],
                 "service_id": user.get("service_id"),
                 "language": user.get("language", "fr")}

    async def event_generator():
        try:
            from .config import COUNCIL_MODELS
            history      = get_conversation_history(conversation_id, owner_id=user_ctx.get("id"))
            user_content = request.content
            storage.add_user_message(conversation_id, request.content, owner_id=user_ctx.get("id"))
            title_task = asyncio.create_task(
                generate_conversation_title(request.content)) if is_first else None

            # ── Bifurcation : pipeline nodal vs council classique ──────────────
            if request.pipeline_nodes:
                # ── Mode DAG — streaming réel via asyncio.Queue ───────────────
                nodes     = request.pipeline_nodes
                evt_queue = asyncio.Queue()
                _SENTINEL = object()  # marqueur de fin

                async def on_node_start(node_id, model, role):
                    await evt_queue.put(json.dumps({
                        "type": "node_start", "node_id": node_id,
                        "model": model, "role": role,
                    }))

                async def on_node_done(node_id, model, role, output, used_model=None,
                                       fallback=False, duration_s=None,
                                       tokens_in=0, tokens_out=0, cost=0.0):
                    await evt_queue.put(json.dumps({
                        "type":       "node_done",
                        "node_id":    node_id,
                        "model":      model,
                        "used_model": used_model or model,
                        "role":       role,
                        "output":     output,
                        "fallback":   fallback,
                        "duration_s": duration_s,
                        "tokens_in":  tokens_in,
                        "tokens_out": tokens_out,
                        "cost":       cost,
                    }))

                async def on_node_error(node_id, error_msg, model=None, duration_s=None):
                    await evt_queue.put(json.dumps({
                        "type":       "node_error",
                        "node_id":    node_id,
                        "error":      error_msg,
                        "model":      model,
                        "duration_s": duration_s,
                    }))

                async def run_dag():
                    try:
                        return await asyncio.wait_for(execute_dag(
                            nodes            = nodes,
                            user_query       = user_content,
                            history          = history,
                            document_content = request.document_content,
                            web_search_mode  = request.web_search_mode,
                            on_node_start    = on_node_start,
                            on_node_done     = on_node_done,
                            on_node_error    = on_node_error,
                            user_id          = user_ctx["id"],
                            user_language    = user_ctx.get("language", "fr"),
                            service_id       = user_ctx.get("service_id"),
                        ), timeout=300)
                    except asyncio.TimeoutError:
                        await evt_queue.put(json.dumps({"type": "error", "error": "Pipeline timeout après 5 minutes"}))
                        return None
                    finally:
                        await evt_queue.put(_SENTINEL)  # signaler la fin

                yield f"data: {json.dumps({'type': 'dag_start', 'node_count': len(nodes), 'nodes': [{'id': n['id'], 'role': n.get('role', ''), 'model': n.get('model', '')} for n in nodes]})}\n\n"

                # Lancer le DAG en tâche de fond
                dag_task = asyncio.create_task(run_dag())

                # Consommer la queue en temps réel et yield chaque event immédiatement
                while True:
                    evt = await evt_queue.get()
                    if evt is _SENTINEL:
                        break
                    yield f"data: {evt}\n\n"

                # Récupérer le résultat final
                result = await dag_task

                # Log usage pour chaque node LLM
                for node in nodes:
                    if node.get("node_type", "llm") == "llm":
                        model = node.get("model", "")
                        log_usage(user_id=user_ctx["id"], user_login=user_ctx["login"],
                                  service_id=user_ctx["service_id"], model=model,
                                  conversation_id=conversation_id,
                                  prompt_tokens=0, completion_tokens=0, native_cost=None)

                final_output = result.get("final", "")
                terminal     = result.get("terminal_node", {})
                dag_outputs  = result.get("outputs", {})

                yield f"data: {json.dumps({'type': 'dag_complete', 'final': final_output, 'outputs': dag_outputs, 'terminal_node': terminal.get('id'), 'execution_order': result.get('execution_order', [])})}\n\n"

                # Stocker comme stage3 pour rétrocompat avec storage/export
                stage3_result = {"model": terminal.get("model", "dag"), "response": final_output}
                storage.add_assistant_message(conversation_id, {}, {}, stage3_result,
                                              owner_id=user_ctx.get("id"))

            else:
                # ── Mode council classique (stage1/2/3) ───────────────────────
                council_models = request.models if request.models else COUNCIL_MODELS
                chairman_model = council_models[0]

                yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
                stage1_results = await stage1_collect_responses(
                    user_content, council_models, request.web_search_mode, history)
                yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"
                for result in (stage1_results or []):
                    if result and isinstance(result, dict):
                        model = result.get("model", "")
                        log_usage(user_id=user_ctx["id"], user_login=user_ctx["login"],
                                  service_id=user_ctx["service_id"], model=model,
                                  conversation_id=conversation_id,
                                  prompt_tokens=0, completion_tokens=0, native_cost=None)

                yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
                stage2_results, label_to_model = await stage2_collect_rankings(
                    user_content, stage1_results, council_models, history)
                aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
                yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"
                for result in (stage2_results or []):
                    if result and isinstance(result, dict):
                        model = result.get("model", "")
                        log_usage(user_id=user_ctx["id"], user_login=user_ctx["login"],
                                  service_id=user_ctx["service_id"], model=model,
                                  conversation_id=conversation_id,
                                  prompt_tokens=0, completion_tokens=0, native_cost=None)

                yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
                stage3_result = await stage3_synthesize_final(
                    user_content, stage1_results, stage2_results,
                    chairman_model, request.web_search_mode, history)
                yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"
                if stage3_result:
                    u = stage3_result.get("usage") or {}
                    log_usage(user_id=user_ctx["id"], user_login=user_ctx["login"],
                              service_id=user_ctx["service_id"], model=chairman_model,
                              conversation_id=conversation_id,
                              prompt_tokens=u.get("prompt_tokens", 0),
                              completion_tokens=u.get("completion_tokens", 0),
                              native_cost=u.get("cost"))

                storage.add_assistant_message(
                    conversation_id, stage1_results, stage2_results, stage3_result,
                    owner_id=user_ctx.get("id"))

            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title, owner_id=user_ctx.get("id"))
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})

# ── Projects ──────────────────────────────────────────────────────────────────

@api_v1.get("/projects")
async def list_projects_route(user: dict = Depends(get_current_user)):
    return storage.list_projects(user["id"])

@api_v1.post("/projects")
async def create_project_route(body: dict, user: dict = Depends(get_current_user)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    return storage.create_project(str(uuid.uuid4()), name, owner_id=user["id"])

@api_v1.delete("/projects/{project_id}")
async def delete_project_route(project_id: str,
                               user: dict = Depends(get_current_user)):
    proj = storage.get_project(project_id, owner_id=user["id"])
    if proj is None:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    if proj.get("owner_id") and proj["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Accès refusé")
    storage.delete_project(project_id, owner_id=user["id"])
    return {"status": "deleted"}

@api_v1.patch("/projects/{project_id}")
async def rename_project_route(project_id: str, body: dict,
                               user: dict = Depends(get_current_user)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    proj = storage.get_project(project_id, owner_id=user["id"])
    if proj is None:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    if proj.get("owner_id") and proj["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Accès refusé")
    try:
        storage.rename_project(project_id, name, owner_id=user["id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok"}

@api_v1.patch("/conversations/{conversation_id}/project")
async def assign_to_project_route(conversation_id: str, body: dict,
                                  user: dict = Depends(get_current_user)):
    project_id = body.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id required")
    # Vérifier ownership de la conversation ET du projet
    conv = storage.get_conversation(conversation_id, owner_id=user["id"])
    if conv is None or (conv.get("owner_id") and conv["owner_id"] != user["id"]):
        raise HTTPException(status_code=403, detail="Accès refusé")
    proj = storage.get_project(project_id, owner_id=user["id"])
    if proj is None or (proj.get("owner_id") and proj["owner_id"] != user["id"]):
        raise HTTPException(status_code=403, detail="Accès refusé")
    try:
        storage.add_conversation_to_project(project_id, conversation_id, owner_id=user["id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok"}

# ── Credits ───────────────────────────────────────────────────────────────────

@api_v1.get("/credits")
async def get_credits():
    import httpx
    from .config import OPENROUTER_API_KEY
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://openrouter.ai/api/v1/credits",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                timeout=10.0)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="OpenRouter error")
        d = r.json().get("data", {})
        return {"balance": round(d.get("total_credits", 0) - d.get("total_usage", 0), 6),
                "usage":   round(d.get("total_usage", 0), 6)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

# ── Upload ────────────────────────────────────────────────────────────────────

@api_v1.post("/upload")
async def upload_file(file: UploadFile = File(...),
                      user: dict = Depends(get_current_user)):
    # M2 : limite de taille 20 Mo
    MAX_SIZE = 20 * 1024 * 1024
    file_bytes = await file.read()
    if len(file_bytes) > MAX_SIZE:
        raise HTTPException(status_code=413,
                            detail=f"Fichier trop volumineux (max 20 Mo, reçu {len(file_bytes)//1024//1024} Mo)")
    import tempfile, shutil, io
    suffix = ("." + file.filename.rsplit(".", 1)[-1].lower()) if "." in file.filename else ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        if suffix == ".pdf":
            import pypdf
            content = "\n".join(p.extract_text() or "" for p in pypdf.PdfReader(tmp_path).pages)
        elif suffix == ".docx":
            import docx
            content = "\n".join(p.text for p in docx.Document(tmp_path).paragraphs)
        elif suffix == ".doc":
            import mammoth
            with open(tmp_path, "rb") as f:
                content = mammoth.extract_raw_text(f).value
        else:
            with open(tmp_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
    finally:
        os.unlink(tmp_path)
    return {"content": content, "filename": file.filename}

# ── Export ZIP ────────────────────────────────────────────────────────────────

@api_v1.post("/projects/{project_id}/export")
async def export_project(project_id: str, body: dict,
                         user: dict = Depends(get_current_user)):
    import zipfile, io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for conv_id in body.get("conversation_ids", []):
            conv = storage.get_conversation(conv_id)  # admin export, pas de filtre owner
            if not conv:
                continue
            title = conv.get("title", conv_id).replace("/", "-")[:50]
            lines = []
            for msg in conv.get("messages", []):
                if msg["role"] == "user":
                    lines.append(f"# Question\n{msg['content']}")
                elif msg.get("stage3"):
                    lines.append(f"# Synthèse ({msg['stage3'].get('model','Chairman')})\n{msg['stage3'].get('response','')}")
            zf.writestr(f"{title}.md", "\n\n---\n\n".join(lines))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=export.zip"})

# ── COG — Import/Export/Validate/Assistant ─────────────────────────────────────

@api_v1.post("/pipelines/import-cog")
async def import_cog(body: dict, _: dict = Depends(require_admin)):
    """Importe un .cog JSON → crée ou met à jour un pipeline (groupe)."""
    from .cog_parser import parse_cog, cog_to_dag
    try:
        cog = parse_cog(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dag = cog_to_dag(cog)
    # Créer un groupe avec le DAG
    from .db import _table, Q as _Q
    import uuid, datetime as _dt
    groups = _table("groups")
    existing = groups.get(_Q.name == cog["name"])
    now = _dt.datetime.utcnow().isoformat()
    if existing:
        groups.update({
            "nodes": dag["nodes"], "edges": dag["edges"],
            "config": dag.get("config", {}), "updated_at": now,
            "description": cog.get("description", ""),
        }, _Q.name == cog["name"])
        return {**existing, "nodes": dag["nodes"], "edges": dag["edges"], "updated": True}
    else:
        group = {
            "id": str(uuid.uuid4()), "name": cog["name"],
            "description": cog.get("description", ""),
            "nodes": dag["nodes"], "edges": dag["edges"],
            "config": dag.get("config", {}),
            "created_at": now, "updated_at": now,
        }
        groups.insert(group)
        return {**group, "updated": False}


@api_v1.get("/pipelines/{pipeline_id}/export-cog")
async def export_cog(pipeline_id: str, _: dict = Depends(require_admin)):
    """Exporte un pipeline existant au format .cog JSON."""
    from .cog_parser import dag_to_cog
    from .db import _table, Q as _Q
    from fastapi.responses import JSONResponse
    group = _table("groups").get(_Q.id == pipeline_id)
    if not group:
        raise HTTPException(status_code=404, detail="Pipeline introuvable")
    cog = dag_to_cog(group, {
        "name": group.get("name", "pipeline"),
        "description": group.get("description", ""),
        "author": "admin",
        "created_at": group.get("created_at", ""),
        "tags": group.get("tags", []),
    })
    filename = group.get("name", "pipeline").lower().replace(" ", "-")
    return JSONResponse(
        content=cog,
        headers={"Content-Disposition": f'attachment; filename="{filename}.cog.json"'}
    )


@api_v1.post("/pipelines/validate-cog")
async def validate_cog(body: dict, _: dict = Depends(require_admin)):
    """Valide un .cog sans l'importer."""
    from .cog_parser import parse_cog
    try:
        cog = parse_cog(body)
        return {
            "valid": True,
            "name": cog.get("name"),
            "node_count": len(cog.get("nodes", [])),
            "edge_count": len(cog.get("edges", [])),
        }
    except ValueError as e:
        return {"valid": False, "error": str(e)}


@api_v1.post("/pipelines/assistant")
async def pipeline_assistant(body: dict, _: dict = Depends(require_admin)):
    """Assistant LLM pour générer des pipelines .cog en langage naturel."""
    import pathlib, json as _json
    from .openrouter import query_model
    from .config import DEFAULT_CHAIRMAN

    message = body.get("message", "")
    history = body.get("conversation_history", [])
    current = body.get("current_pipeline")

    # Charger les exemples few-shot
    examples_dir = pathlib.Path(__file__).parent / "cog_examples"
    examples_text = ""
    if examples_dir.exists():
        for f in sorted(examples_dir.glob("*.cog.json")):
            try:
                examples_text += f"\n### Exemple : {f.stem}\n```json\n{f.read_text(encoding='utf-8')}\n```\n"
            except Exception:
                pass

    system_prompt = f"""Tu es un expert en construction de pipelines LLM Council.
Tu aides l'utilisateur à créer des pipelines DAG en générant du JSON au format .cog v1.0.

Grammaire .cog disponible :
- type "llm" : nœud LLM cloud (OpenRouter)
- type "llm_local" : nœud LLM local (Ollama)
- type "rag_search" : recherche dans la mémoire RAG
- type "tool" : outil (tool_type: "web_search" ou "fact_check")
- type "mcp" : appel serveur MCP externe
- type "condition" : branchement conditionnel
- type "merge" : fusion de plusieurs sorties
- type "input" : point d'entrée (obligatoire, id: "input")
- type "output" : point de sortie (obligatoire, id: "output")

Variables disponibles dans les prompts : {{{{user_input}}}}, {{{{context}}}}, {{{{previous_output}}}}

Règles :
1. Toujours inclure un nœud "input" et un nœud "output"
2. Les edges connectent les nœuds dans l'ordre d'exécution
3. Répondre UNIQUEMENT avec un JSON valide entre balises ```json et ```, sans texte avant ni après
4. Utiliser des id courts et descriptifs (ex: "rag_docs", "llm_analyse")
5. cog_version doit être "1.0"

Exemples de pipelines :
{examples_text}"""

    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-10:]:
        messages.append({"role": h["role"], "content": h["content"]})

    if current:
        message = f"Pipeline actuel :\n```json\n{_json.dumps(current, ensure_ascii=False, indent=2)}\n```\n\nDemande : {message}"

    messages.append({"role": "user", "content": message})

    result = await query_model(
        model=DEFAULT_CHAIRMAN,
        messages=messages,
    )

    if not result or not result.get("content"):
        raise HTTPException(status_code=500, detail="L'assistant n'a pas répondu")

    raw = result["content"]

    # Extraire le JSON de la réponse
    cog = None
    import re
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if match:
        try:
            from .cog_parser import parse_cog
            cog = parse_cog(match.group(1))
        except Exception:
            cog = None
    if cog is None:
        try:
            from .cog_parser import parse_cog
            cog = parse_cog(raw.strip())
        except Exception:
            pass

    return {"message": raw, "cog": cog}


# Enregistrer toutes les routes v1
app.include_router(api_v1)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
