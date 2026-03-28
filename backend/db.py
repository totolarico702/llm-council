# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
db.py — LLM Council · Couche de persistance TinyDB
====================================================
Remplace auth.py (users/services) et permissions.py (RBAC).
Gère aussi les groups/pipelines (anciennement data/groups.json).

Tables :
  users        — {id, login, password, role, service_id, created_at}
  services     — {id, name, pipeline_ids, created_at}
  permissions  — {id, subject, resource, action, granted}
  groups       — {id, name, nodes, edges, models, created_at}

Fichier unique : data/db.json
Les conversations/images/projets restent en fichiers individuels (données volumineuses).
"""

import uuid, json, os, time, base64, hmac, hashlib, threading
from pathlib import Path
from typing import Optional

import bcrypt
from tinydb import TinyDB, Query
from tinydb.operations import set as tdb_set
from tinydb.storages import JSONStorage
from fastapi import HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# ── Chemins ───────────────────────────────────────────────────────────────────

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH  = DATA_DIR / "db.json"

# ── Thread-safety ─────────────────────────────────────────────────────────────
# FastAPI exécute les Depends() dans un threadpool : plusieurs threads peuvent
# lire/écrire db.json simultanément → fichier tronqué (JSONDecodeError vide).
# Solution : locker AU NIVEAU DU STORAGE pour que chaque read+write soit atomique.

_db_lock = threading.Lock()


class _LockedUTF8JSONStorage(JSONStorage):
    """JSONStorage avec :
    - Encodage UTF-8 explicite (évite CP1252 sur Windows)
    - Lock threading sur read() ET write() (thread-safety FastAPI threadpool)
    - Récupération silencieuse sur fichier vide/corrompu → None (DB vide)
    """

    def __init__(self, path, **kwargs):
        kwargs.pop('encoding', None)
        super().__init__(path, encoding='utf-8', **kwargs)

    def read(self):
        with _db_lock:
            try:
                return super().read()
            except (ValueError, OSError) as e:
                # Fichier vide ou corrompu : TinyDB traite None comme DB vide
                print(f"[db] ⚠ read() échec ({e}) → DB réinitialisée en mémoire")
                return None

    def write(self, data):
        with _db_lock:
            try:
                super().write(data)
            except OSError as e:
                print(f"[db] ✗ write() échec ({e})")
                raise


def _open_db() -> TinyDB:
    """Ouvre TinyDB. Sauvegarde db.json si corrompu avant ouverture."""
    if DB_PATH.exists():
        try:
            raw = DB_PATH.read_text(encoding='utf-8').strip()
            if raw:
                json.loads(raw)   # valide le JSON
        except (UnicodeDecodeError, ValueError) as e:
            bak = DB_PATH.with_suffix('.bak')
            try:
                DB_PATH.rename(bak)
                print(f"[db] ⚠ db.json corrompu ({e}) → sauvegardé en {bak.name}")
            except OSError:
                DB_PATH.unlink(missing_ok=True)
                print(f"[db] ⚠ db.json corrompu ({e}) → supprimé")
        except OSError as e:
            print(f"[db] ⚠ db.json illisible ({e}) → recréation")

    return TinyDB(DB_PATH, storage=_LockedUTF8JSONStorage, indent=2, ensure_ascii=False)


_db = _open_db()


def _table(name: str):
    return _db.table(name)

Q = Query()

# ── JWT ───────────────────────────────────────────────────────────────────────

JWT_SECRET      = os.getenv("JWT_SECRET", "llm-council-dev-secret-CHANGE-IN-PROD")
JWT_TTL         = int(os.getenv("JWT_TTL_SECONDS", str(8 * 3600)))
REFRESH_TTL     = int(os.getenv("JWT_REFRESH_TTL_SECONDS", str(7 * 24 * 3600)))
COOKIE_SECURE   = os.getenv("PRODUCTION", "").lower() in ("1", "true", "yes")
COOKIE_SAMESITE = "lax"

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * (pad % 4))

def _make_token(payload: dict, ttl: int) -> str:
    header = _b64url(b'{"alg":"HS256","typ":"JWT"}')
    body   = _b64url(json.dumps({**payload, "exp": int(time.time()) + ttl},
                                separators=(",", ":")).encode())
    sig    = _b64url(hmac.new(JWT_SECRET.encode(), f"{header}.{body}".encode(),
                              hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"

def create_token(payload: dict) -> str:
    return _make_token(payload, JWT_TTL)

def create_refresh_token(user_id: str) -> str:
    return _make_token({"sub": user_id, "type": "refresh"}, REFRESH_TTL)

def verify_refresh_token(token: str) -> str:
    """Vérifie un refresh token et retourne l'user_id, ou lève HTTPException."""
    payload = verify_token(token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token de rafraîchissement invalide")
    return payload["sub"]

def verify_token(token: str) -> dict:
    try:
        header, body, sig = token.split(".")
        expected = _b64url(hmac.new(JWT_SECRET.encode(),
                                    f"{header}.{body}".encode(),
                                    hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("signature invalide")
        payload = json.loads(_b64url_decode(body))
        if payload.get("exp", 0) < time.time():
            raise ValueError("token expiré")
        return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token invalide : {e}")

def get_current_user_from_token(token: str) -> dict:
    """Résout un token JWT en user dict — pour les routes sans Depends."""
    payload = verify_token(token)
    row     = _table("users").get(Q.id == payload.get("sub"))
    if not row:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    return row

# ── Password ──────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False

# ── FastAPI auth dependencies ─────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)

def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    # Priority: httpOnly cookie > Authorization header
    token = request.cookies.get("llmc_token")
    if not token:
        if not creds:
            raise HTTPException(status_code=401, detail="Token manquant")
        token = creds.credentials
    payload = verify_token(token)
    row     = _table("users").get(Q.id == payload.get("sub"))
    if not row:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    return row

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès admin requis")
    return user

# ── Init admin par défaut ─────────────────────────────────────────────────────

def init_default_admin():
    users = _table("users")
    if not users.search(Q.role == "admin"):
        users.insert({
            "id":                  str(uuid.uuid4()),
            "login":               "admin",
            "password":            hash_password("admin"),
            "role":                "admin",
            "service_id":          None,
            "must_change_password": True,
            "created_at":          time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "first_name":          "",
            "last_name":           "",
            "email":               "",
            "departments":         [],
            "is_archived":         False,
            "archived_at":         None,
            "last_login":          None,
        })
        print("[db] ⚠ Admin par défaut créé — login: admin / mdp: admin — CHANGEZ-LE !")

# ── Migration one-shot depuis les anciens JSON ────────────────────────────────

def migrate_legacy():
    """
    Importe users.json, services.json, permissions.json, groups.json
    dans TinyDB si les tables sont vides. Idempotent.
    """
    legacy_dir = DATA_DIR

    # Users
    users_tbl = _table("users")
    if not users_tbl.all():
        p = legacy_dir / "users.json"
        if p.exists():
            for u in json.loads(p.read_text(encoding="utf-8")):
                users_tbl.insert(u)
            print(f"[db] Migration users : {len(users_tbl.all())} entrées")

    # Services
    svc_tbl = _table("services")
    if not svc_tbl.all():
        p = legacy_dir / "services.json"
        if p.exists():
            for s in json.loads(p.read_text(encoding="utf-8")):
                svc_tbl.insert(s)
            print(f"[db] Migration services : {len(svc_tbl.all())} entrées")

    # Permissions
    perms_tbl = _table("permissions")
    if not perms_tbl.all():
        p = legacy_dir / "permissions.json"
        if p.exists():
            for perm in json.loads(p.read_text(encoding="utf-8")):
                perms_tbl.insert(perm)
            print(f"[db] Migration permissions : {len(perms_tbl.all())} entrées")
        else:
            # Migration depuis pipeline_ids dans les services
            for svc in svc_tbl.all():
                for pid in svc.get("pipeline_ids", []):
                    _grant(f"service:{svc['id']}", f"pipeline:{pid}", "use")
            if svc_tbl.all():
                print(f"[db] Migration permissions depuis services")

    # Groups / Pipelines
    groups_tbl = _table("groups")
    if not groups_tbl.all():
        p = legacy_dir / "groups.json"
        if p.exists():
            for g in json.loads(p.read_text(encoding="utf-8")):
                groups_tbl.insert(g)
            print(f"[db] Migration groups : {len(groups_tbl.all())} entrées")



# ══════════════════════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════════════════════

def login_user(login: str, password: str) -> dict:
    row = _table("users").get(Q.login == login)
    if not row or not verify_password(password, row["password"]):
        raise HTTPException(status_code=401, detail="Login ou mot de passe incorrect")
    if row.get("is_archived"):
        raise HTTPException(status_code=403, detail="Ce compte a été archivé. Contactez votre administrateur.")
    # Mettre à jour last_login
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _table("users").update({"last_login": now_iso}, Q.id == row["id"])
    row = _table("users").get(Q.id == row["id"])
    token = create_token({"sub": row["id"], "role": row["role"], "login": row["login"]})
    return {
        "token": token,
        "user":  {k: v for k, v in row.items() if k != "password"},
    }

def list_users() -> list:
    return [{k: v for k, v in u.items() if k != "password"}
            for u in _table("users").all()]

def create_user(login: str, password: str, role: str,
                service_id: Optional[str],
                first_name: str = "",
                last_name: str = "",
                email: str = "",
                departments: list = None) -> dict:
    tbl = _table("users")
    if tbl.get(Q.login == login):
        raise HTTPException(status_code=409, detail=f"Login '{login}' déjà utilisé")
    user = {
        "id":           str(uuid.uuid4()),
        "login":        login,
        "password":     hash_password(password),
        "role":         role,
        "service_id":   service_id,
        "first_name":   first_name,
        "last_name":    last_name,
        "email":        email,
        "departments":  departments or [],
        "is_archived":  False,
        "archived_at":  None,
        "last_login":   None,
        "created_at":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tbl.insert(user)
    return {k: v for k, v in user.items() if k != "password"}

def update_user(user_id: str, data: dict) -> dict:
    tbl  = _table("users")
    row  = tbl.get(Q.id == user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if "password" in data:
        if data["password"]:
            data["password"] = hash_password(data["password"])
        else:
            del data["password"]
    tbl.update(data, Q.id == user_id)
    updated = tbl.get(Q.id == user_id)
    return {k: v for k, v in updated.items() if k != "password"}

def delete_user(user_id: str):
    _table("users").remove(Q.id == user_id)

def archive_user(user_id: str, archived_by: str) -> dict:
    """Désactive un compte sans supprimer les données (soft-archive)."""
    tbl = _table("users")
    row = tbl.get(Q.id == user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    tbl.update({
        "is_archived": True,
        "archived_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "archived_by": archived_by,
    }, Q.id == user_id)
    updated = tbl.get(Q.id == user_id)
    return {k: v for k, v in updated.items() if k != "password"}

def reactivate_user(user_id: str) -> dict:
    """Réactive un compte archivé."""
    tbl = _table("users")
    row = tbl.get(Q.id == user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    tbl.update({
        "is_archived": False,
        "archived_at": None,
        "archived_by": None,
    }, Q.id == user_id)
    updated = tbl.get(Q.id == user_id)
    return {k: v for k, v in updated.items() if k != "password"}

def get_user_by_id(user_id: str) -> Optional[dict]:
    return _table("users").get(Q.id == user_id)

def get_users_by_service(service_id: str) -> list:
    """Retourne les users actifs rattachés à un service."""
    rows = _table("users").search(Q.service_id == service_id)
    return [{k: v for k, v in u.items() if k != "password"} for u in rows]


# ══════════════════════════════════════════════════════════════════════════════
# SERVICES
# ══════════════════════════════════════════════════════════════════════════════

def list_services() -> list:
    return _table("services").all()

def create_service(name: str, pipeline_ids: list) -> dict:
    tbl = _table("services")
    if tbl.get(Q.name == name):
        raise HTTPException(status_code=409, detail=f"Service '{name}' déjà existant")
    svc = {
        "id":           str(uuid.uuid4()),
        "name":         name,
        "pipeline_ids": pipeline_ids,
        "created_at":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tbl.insert(svc)
    return svc

def update_service(service_id: str, data: dict) -> dict:
    tbl = _table("services")
    if not tbl.get(Q.id == service_id):
        raise HTTPException(status_code=404, detail="Service introuvable")
    tbl.update(data, Q.id == service_id)
    return tbl.get(Q.id == service_id)

def delete_service(service_id: str):
    _table("services").remove(Q.id == service_id)


# ══════════════════════════════════════════════════════════════════════════════
# PERMISSIONS (RBAC)
# ══════════════════════════════════════════════════════════════════════════════

def _match(pattern: str, value: str) -> bool:
    if pattern == "*":
        return True
    if pattern.endswith(":*"):
        return value.startswith(pattern[:-1])
    return pattern == value

def has_permission(user: dict, resource: str, action: str) -> bool:
    """Résolution RBAC : admin built-in > deny explicite > allow > absence = deny."""
    if user.get("role") == "admin":
        return True

    tbl = _table("permissions")

    subjects = [f"user:{user['id']}"]
    if user.get("service_id"):
        subjects.append(f"service:{user['service_id']}")
    subjects.append(f"role:{user.get('role', 'user')}")

    specificity = {"user": 2, "service": 1, "role": 0}
    matched = []

    for perm in tbl.all():
        subj = perm.get("subject", "")
        if (subj in subjects
                and _match(perm.get("resource", ""), resource)
                and _match(perm.get("action", ""), action)):
            spec = specificity.get(subj.split(":")[0], 0)
            matched.append((spec, perm))

    if not matched:
        return False

    # H5 : résolution correcte — le niveau le plus spécifique prime
    # user (2) > service (1) > role (0)
    # Au sein du même niveau, deny > allow
    matched.sort(key=lambda x: x[0], reverse=True)

    # Grouper par niveau de spécificité
    from itertools import groupby
    for spec_level, group in groupby(matched, key=lambda x: x[0]):
        perms_at_level = [p for _, p in group]
        # Deny explicite à ce niveau → refus immédiat (priorité dans le niveau)
        if any(not p.get("granted", True) for p in perms_at_level):
            return False
        # Allow à ce niveau → accordé
        if any(p.get("granted", True) for p in perms_at_level):
            return True
        # Ni allow ni deny explicite à ce niveau → descendre au niveau suivant

    return False

def list_permissions() -> list:
    return _table("permissions").all()

def list_permissions_for_subject(subject: str) -> list:
    return _table("permissions").search(Q.subject == subject)

def _grant(subject: str, resource: str, action: str, granted: bool = True) -> dict:
    tbl = _table("permissions")
    existing = tbl.get((Q.subject == subject) & (Q.resource == resource) & (Q.action == action))
    if existing:
        tbl.update({"granted": granted}, (Q.subject == subject) & (Q.resource == resource) & (Q.action == action))
        return tbl.get((Q.subject == subject) & (Q.resource == resource) & (Q.action == action))
    entry = {
        "id":       str(uuid.uuid4()),
        "subject":  subject,
        "resource": resource,
        "action":   action,
        "granted":  granted,
    }
    tbl.insert(entry)
    return entry

def grant_permission(subject: str, resource: str, action: str = "use") -> dict:
    return _grant(subject, resource, action, granted=True)

def deny_permission(subject: str, resource: str, action: str = "*") -> dict:
    return _grant(subject, resource, action, granted=False)

def revoke_permission(perm_id: str):
    _table("permissions").remove(Q.id == perm_id)

def upsert_permission(subject: str, resource: str, action: str, granted: bool) -> dict:
    return _grant(subject, resource, action, granted)


# ══════════════════════════════════════════════════════════════════════════════
# GROUPS / PIPELINES
# ══════════════════════════════════════════════════════════════════════════════

def list_groups(user: Optional[dict] = None) -> list:
    """
    Retourne les pipelines filtrés selon les permissions de l'user.
    user=None ou admin → tous.
    """
    all_groups = _table("groups").all()
    if user is None or user.get("role") == "admin":
        return all_groups
    return [g for g in all_groups if has_permission(user, f"pipeline:{g['id']}", "use")]

def get_group(group_id: str) -> Optional[dict]:
    return _table("groups").get(Q.id == group_id)

def create_group(name: str, nodes: list = None, edges: list = None,
                 models: list = None) -> dict:
    group = {
        "id":         str(uuid.uuid4()),
        "name":       name,
        "nodes":      nodes or [],
        "edges":      edges or [],
        "models":     models or [],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _table("groups").insert(group)
    return group

def update_group(group_id: str, data: dict) -> dict:
    tbl = _table("groups")
    if not tbl.get(Q.id == group_id):
        raise HTTPException(status_code=404, detail="Group not found")
    tbl.update(data, Q.id == group_id)
    return tbl.get(Q.id == group_id)

def delete_group(group_id: str):
    _table("groups").remove(Q.id == group_id)
    # Nettoyer les permissions associées
    _table("permissions").remove(Q.resource == f"pipeline:{group_id}")


# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD TOKENS
# ══════════════════════════════════════════════════════════════════════════════

def create_dashboard_token(label: str, expires_days: Optional[int]) -> dict:
    import datetime
    token_id   = str(uuid.uuid4())
    expires_at = None
    if expires_days is not None:
        expires_at = (
            datetime.datetime.utcnow() + datetime.timedelta(days=expires_days)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry = {
        "token":      token_id,
        "label":      label,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expires_at": expires_at,
    }
    _table("dashboard_tokens").insert(entry)
    return entry


def list_dashboard_tokens() -> list:
    return _table("dashboard_tokens").all()


def verify_dashboard_token(token: str) -> dict:
    import datetime
    row = _table("dashboard_tokens").get(Q.token == token)
    if not row:
        raise HTTPException(status_code=404, detail="Token invalide ou introuvable")
    if row.get("expires_at"):
        exp = datetime.datetime.strptime(row["expires_at"], "%Y-%m-%dT%H:%M:%SZ")
        if exp < datetime.datetime.utcnow():
            raise HTTPException(status_code=403, detail="Token expiré")
    return row


def revoke_dashboard_token(token: str):
    _table("dashboard_tokens").remove(Q.token == token)


# ══════════════════════════════════════════════════════════════════════════════
# RAG DOCUMENTS
# ══════════════════════════════════════════════════════════════════════════════

def create_rag_document(doc: dict) -> dict:
    """Enregistre les métadonnées d'un document RAG indexé."""
    import datetime
    doc["created_at"] = datetime.datetime.utcnow().isoformat()
    _table("rag_documents").insert(doc)
    return doc

def list_rag_documents(folder_id: Optional[str] = None, service_id: Optional[str] = None) -> list:
    """Liste les documents RAG (avec filtres optionnels)."""
    docs = _table("rag_documents").all()
    if folder_id:
        docs = [d for d in docs if d.get("folder_id") == folder_id]
    if service_id:
        docs = [d for d in docs if d.get("service_id") == service_id]
    return docs

def delete_rag_document(doc_id: str) -> bool:
    """Supprime les métadonnées d'un document RAG."""
    _table("rag_documents").remove(Q.id == doc_id)
    return True

def get_rag_document(doc_id: str) -> Optional[dict]:
    """Récupère les métadonnées d'un document RAG par son id."""
    return _table("rag_documents").get(Q.id == doc_id)

def update_rag_document(doc_id: str, updates: dict) -> Optional[dict]:
    """Met à jour les métadonnées d'un document RAG."""
    tbl = _table("rag_documents")
    if not tbl.get(Q.id == doc_id):
        return None
    tbl.update(updates, Q.id == doc_id)
    return tbl.get(Q.id == doc_id)


# ══════════════════════════════════════════════════════════════════════════════
# API KEYS  (V3 — authentification externe)
# ══════════════════════════════════════════════════════════════════════════════

import secrets as _secrets
import datetime as _dt


def create_api_key(label: str, created_by: str, quota_per_day: int = 1000) -> dict:
    """Crée une nouvelle API key et la stocke. Retourne le doc complet (clé en clair une seule fois)."""
    key = {
        "id":            str(uuid.uuid4()),
        "key":           f"llmc_{_secrets.token_urlsafe(32)}",
        "label":         label,
        "created_by":    created_by,
        "quota_per_day": quota_per_day,
        "usage_total":   0,
        "last_used_at":  None,
        "created_at":    _dt.datetime.utcnow().isoformat(),
        "is_active":     True,
    }
    _table("api_keys").insert(key)
    return key


def list_api_keys() -> list:
    return _table("api_keys").all()


def get_api_key(key_value: str) -> Optional[dict]:
    return _table("api_keys").get(Q.key == key_value)


def delete_api_key(key_id: str):
    _table("api_keys").remove(Q.id == key_id)


def increment_api_key_usage(key_id: str):
    def _inc(doc):
        doc["usage_total"] = doc.get("usage_total", 0) + 1
        doc["last_used_at"] = _dt.datetime.utcnow().isoformat()
    _table("api_keys").update(_inc, Q.id == key_id)


def verify_api_key(key_value: str) -> dict:
    """Vérifie une API key Bearer et retourne son document, ou lève HTTPException."""
    row = get_api_key(key_value)
    if not row:
        raise HTTPException(status_code=401, detail="API key invalide")
    if not row.get("is_active"):
        raise HTTPException(status_code=403, detail="API key désactivée")
    return row
