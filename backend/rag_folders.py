"""
rag_folders.py — Arborescence RAG + résolution ACL héritées
============================================================
Gère les dossiers de la base documentaire RAG.

Modèle ACL :
  - Admin → accès "admin" toujours
  - Exception explicite user_id > exception role > héritage service > aucun accès
  - Niveaux : "read" | "write" | "admin" | None (bloqué / pas d'accès)
  - Profondeur max : 2 niveaux (root → enfant → petit-enfant)
"""

import uuid, time
from typing import Optional, List, Dict, Any
from .db import _table, Q


# ── Helpers table ─────────────────────────────────────────────────────────────

def _tbl():
    return _table("rag_folders")


# ── Lecture ───────────────────────────────────────────────────────────────────

def get_folder(folder_id: str) -> Optional[dict]:
    return _tbl().get(Q.id == folder_id)


def list_folders() -> List[dict]:
    return _tbl().all()


# ── Calcul profondeur ─────────────────────────────────────────────────────────

def _folder_level(folder_id: str) -> int:
    """Retourne le niveau de profondeur : 0=racine, 1=enfant, 2=petit-enfant."""
    folder = get_folder(folder_id)
    if not folder or not folder.get("parent_id"):
        return 0
    parent = get_folder(folder["parent_id"])
    if not parent or not parent.get("parent_id"):
        return 1
    return 2


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_folder(
    name: str,
    parent_id: Optional[str],
    service: str,
    created_by: str,
) -> dict:
    """
    Crée un dossier RAG.
    Lève ValueError si la profondeur maximale (2 niveaux) serait dépassée.
    """
    if parent_id:
        if _folder_level(parent_id) >= 2:
            raise ValueError("Profondeur maximale de 2 niveaux atteinte")

    folder = {
        "id":         str(uuid.uuid4()),
        "name":       name,
        "parent_id":  parent_id,
        "service":    service,
        "created_by": created_by,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "acl": {
            "inherit":    True,
            "exceptions": [],
        },
    }
    _tbl().insert(folder)
    return folder


def rename_folder(folder_id: str, name: str) -> Optional[dict]:
    _tbl().update({"name": name}, Q.id == folder_id)
    return get_folder(folder_id)


def update_folder_acl(folder_id: str, acl: dict) -> Optional[dict]:
    """Remplace entièrement la configuration ACL d'un dossier."""
    _tbl().update({"acl": acl}, Q.id == folder_id)
    return get_folder(folder_id)


def remove_folder(folder_id: str) -> bool:
    _tbl().remove(Q.id == folder_id)
    return True


# ── Contrainte : dossier vide avant suppression ───────────────────────────────

def folder_document_count(folder_id: str) -> int:
    """Nombre de documents dans ce dossier (table rag_documents)."""
    return len(_table("rag_documents").search(Q.folder_id == folder_id))


def folder_children_count(folder_id: str) -> int:
    """Nombre de sous-dossiers directs."""
    return len(_tbl().search(Q.parent_id == folder_id))


# ── Résolution ACL ────────────────────────────────────────────────────────────

def check_folder_access(user: dict, folder: dict) -> Optional[str]:
    """
    Résout le niveau d'accès d'un user sur un dossier.
    Retourne "read" | "write" | "admin" | None.

    Priorité :
      1. user.role == "admin" → "admin"
      2. Exception explicite user_id (spécifique à cet utilisateur)
      3. Exception explicite role
      4. Héritage service (inherit=True + même service) → "read"
      5. Pas d'accès → None
    """
    if user.get("role") == "admin":
        return "admin"

    acl        = folder.get("acl") or {}
    exceptions = acl.get("exceptions") or []

    # Priorité 1 : exception sur user_id
    for exc in exceptions:
        if exc.get("user_id") == user.get("id"):
            access = exc.get("access", "none")
            return None if access == "none" else access

    # Priorité 2 : exception sur role
    for exc in exceptions:
        if exc.get("role") and exc.get("role") == user.get("role"):
            access = exc.get("access", "none")
            return None if access == "none" else access

    # Priorité 3 : héritage service
    if acl.get("inherit", True):
        folder_svc = folder.get("service") or folder.get("service_id")
        if folder_svc and folder_svc == user.get("service_id"):
            return "read"

    return None


def can_write(user: dict, folder: dict) -> bool:
    access = check_folder_access(user, folder)
    return access in ("write", "admin")


def can_read(user: dict, folder: dict) -> bool:
    return check_folder_access(user, folder) is not None


def is_folder_admin(user: dict, folder: dict) -> bool:
    return check_folder_access(user, folder) == "admin"


# ── Arborescence filtrée ──────────────────────────────────────────────────────

def get_folder_tree(user: dict) -> List[dict]:
    """
    Retourne tous les dossiers accessibles par l'user, avec leur niveau d'accès.
    Chaque élément est enrichi du champ "_access".
    """
    folders = list_folders()
    result  = []
    for f in folders:
        access = check_folder_access(user, f)
        if access is not None:
            result.append({**f, "_access": access})
    # Tri : racines d'abord, puis enfants
    result.sort(key=lambda x: (x.get("parent_id") or "", x.get("name", "")))
    return result
