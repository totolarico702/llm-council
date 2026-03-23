"""
fs_browser.py — LLM Council
============================
Endpoint pour naviguer dans le système de fichiers local (panneau PC de l'admin RAG).
Expose uniquement les fichiers PDF, DOCX, TXT, MD sous FS_BROWSER_ROOT.
"""

import os
import pathlib
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from .db import get_current_user

router = APIRouter()

DEFAULT_ROOT       = str(pathlib.Path.home())
ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.txt', '.md'}


def is_safe_path(root: str, path: str) -> bool:
    """Vérifie que le path demandé est bien sous le root autorisé (anti path-traversal)."""
    real_root = os.path.realpath(root)
    real_path = os.path.realpath(path)
    return real_path.startswith(real_root)


def _human_size(size: int) -> str:
    for unit in ['o', 'Ko', 'Mo', 'Go']:
        if size < 1024:
            return f"{size:.0f} {unit}"
        size /= 1024
    return f"{size:.1f} Go"


@router.get("/fs/browse")
async def browse(
    path: str = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Liste le contenu d'un dossier local.
    Sans paramètre → retourne FS_BROWSER_ROOT.
    Nécessite d'être authentifié (admin ou user).
    """
    root   = os.environ.get("FS_BROWSER_ROOT", DEFAULT_ROOT)
    target = path if path else root

    if not is_safe_path(root, target):
        raise HTTPException(status_code=403, detail="Accès refusé : chemin hors du répertoire autorisé")

    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    items = []
    try:
        with os.scandir(target) as entries:
            for entry in sorted(entries, key=lambda e: (not e.is_dir(), e.name.lower())):
                if entry.name.startswith('.'):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    items.append({
                        "id":       entry.path,
                        "name":     entry.name,
                        "type":     "folder",
                        "path":     entry.path,
                        "children": [],          # lazy loading côté frontend
                    })
                elif entry.is_file(follow_symlinks=False):
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext in ALLOWED_EXTENSIONS:
                        try:
                            size = entry.stat().st_size
                        except OSError:
                            size = 0
                        items.append({
                            "id":         entry.path,
                            "name":       entry.name,
                            "type":       "file",
                            "path":       entry.path,
                            "ext":        ext,
                            "size":       size,
                            "size_human": _human_size(size),
                            "children":   None,   # leaf
                        })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission refusée sur ce dossier")

    parent = str(pathlib.Path(target).parent) if os.path.realpath(target) != os.path.realpath(root) else None

    return {
        "path":   target,
        "parent": parent,
        "items":  items,
    }


# ── Upload depuis path local ──────────────────────────────────────────────────

class FromPathBody(BaseModel):
    file_path: str
    folder_id: str


@router.post("/rag/documents/from-path")
async def upload_from_path(
    body:         FromPathBody,
    current_user: dict = Depends(get_current_user),
):
    """
    Indexe un fichier local (déjà sur le disque du serveur) dans le RAG.
    Le backend lit le fichier directement — pas de transfert réseau.
    """
    from . import rag_store, rag_audit
    from .db import create_rag_document
    import uuid, datetime

    root = os.environ.get("FS_BROWSER_ROOT", DEFAULT_ROOT)

    if not is_safe_path(root, body.file_path):
        raise HTTPException(status_code=403, detail="Accès refusé : chemin hors du répertoire autorisé")

    file_path = pathlib.Path(body.file_path)
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    ext = file_path.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Type de fichier non supporté : {ext}")

    doc_id = str(uuid.uuid4())
    result = await rag_store.ingest_document(
        file_path  = file_path,
        filename   = file_path.name,
        doc_id     = doc_id,
        folder_id  = body.folder_id,
        service_id = "global",
        user_id    = current_user["id"],
    )

    doc_meta = {
        "id":         doc_id,
        "filename":   file_path.name,
        "folder_id":  body.folder_id,
        "service_id": "global",
        "user_id":    current_user["id"],
        "user_login": current_user.get("login", ""),
        "size_bytes": file_path.stat().st_size,
        "chunks":     result.get("chunks_count", 0),
        "source":     "local_path",
    }
    create_rag_document(doc_meta)

    rag_audit.log_action(
        actor_id    = current_user["id"],
        actor_name  = current_user.get("login", ""),
        action      = "document_uploaded",
        target_type = "document",
        target_id   = doc_id,
        target_name = file_path.name,
        details     = {"folder_id": body.folder_id, "source": "local_path", "chunks": result.get("chunks_count", 0)},
    )

    return {**doc_meta, **result}
