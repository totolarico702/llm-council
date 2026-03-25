"""
storage.py — LLM Council
========================
Architecture par utilisateur :

  data/
    users/
      {user_id}/
        profile.json              metadata user
        conversations/
          {conv_id}.json
        projects/
          {project_id}.json
    archive/
      {login}_{date}/             dossier archivé (départ employé)
        profile.json
        conversations/
        projects/
        synthesis.md              generé par user_archiver
        rag_index.json            chunks RAG générés par user_archiver
    shared/
      preferences.json

Règles :
- Chaque user est isolé dans son dossier → suppression/archivage = une opération
- storage.py ne connaît pas Qdrant ni le RAG (séparation des responsabilités)
- Compatibilité legacy : data/conversations/*.json + data/projects/*.json
  migrés automatiquement au démarrage via migrate_legacy_storage()
"""

import json
import os
import shutil
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR

# ── Racines ───────────────────────────────────────────────────────────────────

_ROOT        = Path(DATA_DIR)                  # data/
_USERS_ROOT  = _ROOT / "users"                 # data/users/
_ARCHIVE_ROOT = _ROOT / "archive"              # data/archive/
_SHARED_DIR  = _ROOT / "shared"               # data/shared/

# Legacy (migration one-shot)
_LEGACY_CONV = _ROOT / "conversations"         # data/conversations/
_LEGACY_PROJ = _ROOT / "projects"             # data/projects/

PREFERENCES_FILE = str(_SHARED_DIR / "preferences.json")


# ── Helpers dossiers ──────────────────────────────────────────────────────────

def _user_root(user_id: str) -> Path:
    return _USERS_ROOT / user_id

def _conv_dir(user_id: str) -> Path:
    return _user_root(user_id) / "conversations"

def _proj_dir(user_id: str) -> Path:
    return _user_root(user_id) / "projects"

def _ensure_user(user_id: str):
    """Crée l'arborescence d'un user si elle n'existe pas."""
    _conv_dir(user_id).mkdir(parents=True, exist_ok=True)
    _proj_dir(user_id).mkdir(parents=True, exist_ok=True)

def _ensure_shared():
    _SHARED_DIR.mkdir(parents=True, exist_ok=True)

def init_data_dirs():
    """Appelé au démarrage — crée les dossiers racines."""
    _USERS_ROOT.mkdir(parents=True, exist_ok=True)
    _ARCHIVE_ROOT.mkdir(parents=True, exist_ok=True)
    _SHARED_DIR.mkdir(parents=True, exist_ok=True)


# ── Recherche fichier (nouveau + legacy) ─────────────────────────────────────

def _find_conv(conv_id: str, user_id: Optional[str] = None) -> Optional[Path]:
    """Cherche une conversation.

    Si user_id est fourni : cherche UNIQUEMENT dans data/users/{user_id}/conversations/.
    Si user_id est None (appels admin/migration explicites) : cherche partout.
    """
    if user_id:
        p = _conv_dir(user_id) / f"{conv_id}.json"
        return p if p.exists() else None
    # Appel sans user_id : legacy puis scan complet (admin/migration uniquement)
    p = _LEGACY_CONV / f"{conv_id}.json"
    if p.exists():
        return p
    if _USERS_ROOT.exists():
        for up in _USERS_ROOT.iterdir():
            p = up / "conversations" / f"{conv_id}.json"
            if p.exists():
                return p
    return None


def _find_proj(proj_id: str, user_id: Optional[str] = None) -> Optional[Path]:
    """Cherche un projet.

    Si user_id est fourni : cherche UNIQUEMENT dans data/users/{user_id}/projects/.
    Si user_id est None : cherche partout (admin/migration uniquement).
    """
    if user_id:
        p = _proj_dir(user_id) / f"{proj_id}.json"
        return p if p.exists() else None
    p = _LEGACY_PROJ / f"{proj_id}.json"
    if p.exists():
        return p
    if _USERS_ROOT.exists():
        for up in _USERS_ROOT.iterdir():
            p = up / "projects" / f"{proj_id}.json"
            if p.exists():
                return p
    return None


def _read_json(path: Path) -> Optional[Dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[storage] Lecture échouée {path.name}: {e}")
        return None


def _write_json(path: Path, data: Dict):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Migration legacy → par user ───────────────────────────────────────────────

def migrate_legacy_storage(users: List[Dict[str, Any]]):
    """
    Migration one-shot des fichiers legacy vers data/users/{id}/.
    Idempotent — ignore les fichiers déjà migrés.
    Appeler au démarrage avec db.list_users().
    """
    init_data_dirs()
    admin_id = next((u["id"] for u in users if u.get("role") == "admin"), None)
    if not admin_id:
        return

    user_ids = {u["id"] for u in users}
    migrated = 0

    # Conversations legacy
    if _LEGACY_CONV.exists():
        for p in sorted(_LEGACY_CONV.glob("*.json")):
            data = _read_json(p)
            if not data or "messages" not in data or "id" not in data:
                continue
            owner = data.get("owner_id") or admin_id
            if owner not in user_ids:
                owner = admin_id
            dest = _conv_dir(owner) / p.name
            if dest.exists():
                continue
            _ensure_user(owner)
            data["owner_id"] = owner
            _write_json(dest, data)
            migrated += 1

    # Projets legacy
    if _LEGACY_PROJ.exists():
        for p in sorted(_LEGACY_PROJ.glob("*.json")):
            data = _read_json(p)
            if not data or "id" not in data or "name" not in data:
                continue
            owner = data.get("owner_id") or admin_id
            if owner not in user_ids:
                owner = admin_id
            dest = _proj_dir(owner) / p.name
            if dest.exists():
                continue
            _ensure_user(owner)
            data["owner_id"] = owner
            _write_json(dest, data)
            migrated += 1

    if migrated:
        print(f"[storage] Migration : {migrated} fichiers → data/users/")

    # ── Print de démarrage : inventaire par user ───────────────────────────
    print("[storage] -- Inventaire des donnees utilisateur ------------------")
    if _USERS_ROOT.exists():
        user_login = {u["id"]: u.get("login", "?") for u in users}
        for d in sorted(_USERS_ROOT.iterdir()):
            if not d.is_dir():
                continue
            n_convs = len(list((d / "conversations").glob("*.json"))) \
                      if (d / "conversations").exists() else 0
            n_projs = len(list((d / "projects").glob("*.json"))) \
                      if (d / "projects").exists() else 0
            login = user_login.get(d.name, "inconnu")
            print(f"[storage]   {d.name[:8]}…  login={login!r:12}  "
                  f"convs={n_convs}  projets={n_projs}")
    else:
        print("[storage]   (aucun dossier users)")
    n_legacy = len(list(_LEGACY_CONV.glob("*.json"))) if _LEGACY_CONV.exists() else 0
    if n_legacy:
        print(f"[storage]   legacy/conversations : {n_legacy} fichiers non migrés")
    print("[storage] ─────────────────────────────────────────────────────────")


# ── Profil user ───────────────────────────────────────────────────────────────

def save_user_profile(user_id: str, profile: Dict[str, Any]):
    """Sauvegarde le profil dans data/users/{id}/profile.json"""
    _ensure_user(user_id)
    _write_json(_user_root(user_id) / "profile.json", profile)


def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    p = _user_root(user_id) / "profile.json"
    return _read_json(p) if p.exists() else None


def get_user_data_summary(user_id: str) -> Dict[str, int]:
    """Compte conversations et projets d'un user (pour admin)."""
    return {
        "conversations": len(list(_conv_dir(user_id).glob("*.json"))) if _conv_dir(user_id).exists() else 0,
        "projects":      len(list(_proj_dir(user_id).glob("*.json"))) if _proj_dir(user_id).exists() else 0,
    }


# ── Archivage / Suppression user ──────────────────────────────────────────────

def archive_user(user_id: str, login: str) -> Path:
    """
    Archive le dossier d'un user (départ entreprise).
    Déplace data/users/{id}/ → data/archive/{login}_{YYYYMMDD}/
    Retourne le chemin de l'archive (pour user_archiver qui y dépose synthesis.md).
    """
    src = _user_root(user_id)
    if not src.exists():
        _ensure_user(user_id)  # créer dossier vide si jamais

    from time import strftime
    dest = _ARCHIVE_ROOT / f"{login}_{strftime('%Y%m%d_%H%M%S')}"
    _ARCHIVE_ROOT.mkdir(exist_ok=True)
    shutil.move(str(src), str(dest))
    print(f"[storage] {login} archivé → {dest}")
    return dest


def delete_user_data(user_id: str):
    """Supprime définitivement les données d'un user (après archivage)."""
    src = _user_root(user_id)
    if src.exists():
        shutil.rmtree(str(src))
        print(f"[storage] Données user {user_id} supprimées")


# ── Conversations ─────────────────────────────────────────────────────────────

def create_conversation(conv_id: str,
                        owner_id: Optional[str] = None) -> Dict[str, Any]:
    if owner_id:
        _ensure_user(owner_id)
    else:
        _LEGACY_CONV.mkdir(parents=True, exist_ok=True)

    conv = {
        "id":         conv_id,
        "owner_id":   owner_id,
        "created_at": datetime.utcnow().isoformat(),
        "title":      "New Conversation",
        "messages":   []
    }
    dest = (_conv_dir(owner_id) if owner_id else _LEGACY_CONV) / f"{conv_id}.json"
    _write_json(dest, conv)
    return conv


def get_conversation(conv_id: str,
                     owner_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    path = _find_conv(conv_id, owner_id)
    return _read_json(path) if path else None


def save_conversation(conv: Dict[str, Any]):
    owner_id = conv.get("owner_id")
    path = _find_conv(conv["id"], owner_id)
    if path is None:
        if owner_id:
            _ensure_user(owner_id)
            path = _conv_dir(owner_id) / f"{conv['id']}.json"
        else:
            _LEGACY_CONV.mkdir(parents=True, exist_ok=True)
            path = _LEGACY_CONV / f"{conv['id']}.json"
    _write_json(path, conv)


def delete_conversation(conv_id: str, owner_id: Optional[str] = None):
    path = _find_conv(conv_id, owner_id)
    if path and path.exists():
        path.unlink()
    # Nettoyer les refs dans les projets du même user
    for pd in [_proj_dir(owner_id) if owner_id else None, _LEGACY_PROJ]:
        if pd and pd.exists():
            for pf in pd.glob("*.json"):
                try:
                    _remove_conv_ref(pf, conv_id)
                except Exception:
                    pass


def list_conversations(owner_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """owner_id=None → toutes (admin). Sinon → seulement ce user."""
    result = []
    seen   = set()

    def _scan(directory: Path):
        if not directory.exists():
            return
        for p in directory.glob("*.json"):
            data = _read_json(p)
            if not data or "messages" not in data or "id" not in data:
                continue
            if data["id"] in seen:
                continue
            seen.add(data["id"])
            result.append({
                "id":            data["id"],
                "owner_id":      data.get("owner_id"),
                "created_at":    data.get("created_at", ""),
                "title":         data.get("title", "New Conversation"),
                "message_count": len(data["messages"])
            })

    if owner_id:
        _scan(_conv_dir(owner_id))
    else:
        # Admin : tous les users + legacy
        if _USERS_ROOT.exists():
            for up in sorted(_USERS_ROOT.iterdir()):
                if up.is_dir():
                    _scan(up / "conversations")
        _scan(_LEGACY_CONV)

    result.sort(key=lambda x: x["created_at"], reverse=True)
    return result


def add_user_message(conv_id: str, content: str,
                     owner_id: Optional[str] = None):
    conv = get_conversation(conv_id, owner_id)
    if conv is None:
        raise ValueError(f"Conversation {conv_id} not found")
    conv["messages"].append({"role": "user", "content": content})
    save_conversation(conv)


def add_assistant_message(conv_id: str, stage1, stage2, stage3,
                          owner_id: Optional[str] = None):
    conv = get_conversation(conv_id, owner_id)
    if conv is None:
        raise ValueError(f"Conversation {conv_id} not found")
    conv["messages"].append({
        "role": "assistant",
        "stage1": stage1, "stage2": stage2, "stage3": stage3,
    })
    save_conversation(conv)


def update_conversation_title(conv_id: str, title: str,
                               owner_id: Optional[str] = None):
    conv = get_conversation(conv_id, owner_id)
    if conv is None:
        raise ValueError(f"Conversation {conv_id} not found")
    conv["title"] = title
    save_conversation(conv)


def get_conversation_history(conv_id: str,
                              owner_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Historique condensé user + chairman pour le contexte modèles."""
    conv = get_conversation(conv_id, owner_id)
    if not conv:
        return []
    history = []
    for msg in conv["messages"]:
        if msg["role"] == "user":
            history.append({"role": "user", "content": msg["content"]})
        elif msg["role"] == "assistant" and msg.get("stage3"):
            resp = msg["stage3"].get("response", "")
            if resp:
                history.append({"role": "assistant", "content": resp})
    return history


# ── Projets ───────────────────────────────────────────────────────────────────

def _remove_conv_ref(project_path: Path, conv_id: str):
    data = _read_json(project_path)
    if not data:
        return
    ids = data.get("conversation_ids", [])
    if conv_id in ids:
        data["conversation_ids"] = [i for i in ids if i != conv_id]
        _write_json(project_path, data)


def create_project(proj_id: str, name: str,
                   owner_id: Optional[str] = None) -> Dict[str, Any]:
    if owner_id:
        _ensure_user(owner_id)
    else:
        _LEGACY_PROJ.mkdir(parents=True, exist_ok=True)

    project = {
        "id": proj_id, "name": name, "owner_id": owner_id,
        "created_at": datetime.utcnow().isoformat(),
        "conversation_ids": []
    }
    dest = (_proj_dir(owner_id) if owner_id else _LEGACY_PROJ) / f"{proj_id}.json"
    _write_json(dest, project)
    return project


def get_project(proj_id: str,
                owner_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    path = _find_proj(proj_id, owner_id)
    return _read_json(path) if path else None


def list_projects(owner_id: Optional[str] = None) -> List[Dict[str, Any]]:
    result = []
    seen   = set()

    def _scan(directory: Path):
        if not directory.exists():
            return
        for p in directory.glob("*.json"):
            data = _read_json(p)
            if not data or "id" not in data or "name" not in data:
                continue
            if data["id"] in seen:
                continue
            seen.add(data["id"])
            result.append({
                "id":               data["id"],
                "name":             data["name"],
                "owner_id":         data.get("owner_id"),
                "created_at":       data.get("created_at", ""),
                "conversation_ids": data.get("conversation_ids", [])
            })

    if owner_id:
        _scan(_proj_dir(owner_id))
    else:
        if _USERS_ROOT.exists():
            for up in sorted(_USERS_ROOT.iterdir()):
                if up.is_dir():
                    _scan(up / "projects")
        _scan(_LEGACY_PROJ)

    result.sort(key=lambda x: x["created_at"], reverse=True)
    return result


def delete_project(proj_id: str, owner_id: Optional[str] = None):
    path = _find_proj(proj_id, owner_id)
    if path and path.exists():
        path.unlink()


def rename_project(proj_id: str, name: str,
                   owner_id: Optional[str] = None):
    path = _find_proj(proj_id, owner_id)
    if path is None:
        raise ValueError(f"Project {proj_id} not found")
    data = _read_json(path)
    if not data:
        raise ValueError(f"Project {proj_id} unreadable")
    data["name"] = name
    _write_json(path, data)


def add_conversation_to_project(proj_id: str, conv_id: str,
                                 owner_id: Optional[str] = None):
    path = _find_proj(proj_id, owner_id)
    if path is None:
        raise ValueError(f"Project {proj_id} not found")
    data = _read_json(path)
    if not data:
        raise ValueError(f"Project {proj_id} unreadable")
    ids = data.get("conversation_ids", [])
    if conv_id not in ids:
        ids.append(conv_id)
    data["conversation_ids"] = ids
    _write_json(path, data)


def remove_conversation_from_project(proj_id: str, conv_id: str,
                                      owner_id: Optional[str] = None):
    path = _find_proj(proj_id, owner_id)
    if path is None:
        raise ValueError(f"Project {proj_id} not found")
    _remove_conv_ref(path, conv_id)


# ── Préférences (shared) ──────────────────────────────────────────────────────

DEFAULT_PREFERENCES = {
    "username": "", "openrouter_key": "",
    "default_group": "general",
    "onboarding_done": False, "language": "fr",
}


def get_preferences() -> Dict[str, Any]:
    _ensure_shared()
    p = Path(PREFERENCES_FILE)
    if not p.exists():
        return dict(DEFAULT_PREFERENCES)
    try:
        saved = json.loads(p.read_text(encoding="utf-8"))
        prefs = dict(DEFAULT_PREFERENCES)
        prefs.update(saved)
        return prefs
    except Exception:
        return dict(DEFAULT_PREFERENCES)


def save_preferences(prefs: Dict[str, Any]):
    _ensure_shared()
    current = get_preferences()
    current.update(prefs)
    _write_json(Path(PREFERENCES_FILE), current)


# ── Pending validations (Mode Caféine) ────────────────────────────────────────

def save_pending_validation(
    conversation_id: str,
    user_id: str,
    chairman_output: str,
    stage3_result: Optional[Dict] = None,
    stage1_results: Optional[list] = None,
    stage2_results: Optional[list] = None,
    user_query: str = "",
    models: Optional[list] = None,
) -> str:
    """Sauvegarde une réponse Chairman en attente de validation humaine."""
    import uuid as _uuid
    from . import db as _db_module
    vid = str(_uuid.uuid4())
    _db_module._table("pending_validations").insert({
        "id": vid,
        "conversation_id": conversation_id,
        "user_id": user_id,
        "chairman_output": chairman_output,
        "stage3_result": stage3_result,
        "stage1_results": stage1_results or [],
        "stage2_results": stage2_results or [],
        "user_query": user_query,
        "models": models or [],
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "resolved_at": None,
        "resolution": None,
    })
    return vid


def get_pending_validation_by_conv(conversation_id: str) -> Optional[Dict]:
    """Récupère la validation en attente pour une conversation (expire > 30 min)."""
    from datetime import timedelta
    from . import db as _db_module
    tbl = _db_module._table("pending_validations")
    Q   = _db_module.Q
    cutoff = (datetime.utcnow() - timedelta(minutes=30)).isoformat()
    # Expirer les anciennes
    tbl.update({"status": "expired"}, (Q.status == "pending") & (Q.created_at < cutoff))
    results = tbl.search((Q.conversation_id == conversation_id) & (Q.status == "pending"))
    return results[0] if results else None


def resolve_pending_validation(
    validation_id: str,
    action: str,
    modified_text: Optional[str] = None,
    relaunch_instructions: Optional[str] = None,
):
    """Résout une validation (approve/modify/relaunch/reject)."""
    from . import db as _db_module
    tbl = _db_module._table("pending_validations")
    Q   = _db_module.Q
    tbl.update({
        "status": action,
        "resolved_at": datetime.utcnow().isoformat(),
        "resolution": {
            "action": action,
            "modified_text": modified_text,
            "relaunch_instructions": relaunch_instructions,
        },
    }, Q.id == validation_id)
