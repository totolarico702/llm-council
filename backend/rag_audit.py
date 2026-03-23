"""
rag_audit.py — Audit log persistant pour le système RAG
=========================================================
Toutes les opérations sensibles (création/suppression de dossiers,
upload/suppression de documents, modifications ACL) sont tracées ici.

Rétention : RAG_AUDIT_RETENTION_DAYS (défaut 90 jours).
Les logs ne sont jamais modifiables — uniquement supprimés par la purge.
"""

import os, uuid, datetime
from typing import Optional, List, Dict, Any
from .db import _table, Q


RETENTION_DAYS = int(os.getenv("RAG_AUDIT_RETENTION_DAYS", "90"))

# Actions valides
ACTIONS = frozenset({
    "folder_created",
    "folder_deleted",
    "document_uploaded",
    "document_deleted",
    "acl_modified",
})


# ── Helper table ──────────────────────────────────────────────────────────────

def _tbl():
    return _table("rag_audit_log")


# ── Écriture ──────────────────────────────────────────────────────────────────

def log_action(
    actor_id:    str,
    actor_name:  str,
    action:      str,
    target_type: str,
    target_id:   str,
    target_name: str,
    details:     Dict[str, Any] = None,
) -> dict:
    """
    Enregistre une action dans l'audit log.
    Toujours persisté, jamais modifiable.
    """
    entry = {
        "id":          str(uuid.uuid4()),
        "timestamp":   datetime.datetime.utcnow().isoformat(),
        "actor_id":    actor_id,
        "actor_name":  actor_name,
        "action":      action,
        "target_type": target_type,
        "target_id":   target_id,
        "target_name": target_name,
        "details":     details or {},
    }
    _tbl().insert(entry)
    return entry


# ── Lecture ───────────────────────────────────────────────────────────────────

def list_audit(
    limit:     int           = 50,
    offset:    int           = 0,
    folder_id: Optional[str] = None,
    actor_id:  Optional[str] = None,
    action:    Optional[str] = None,
) -> List[dict]:
    """
    Retourne les entrées d'audit (tri anti-chronologique).
    Filtres optionnels : folder_id, actor_id, action.
    """
    logs = _tbl().all()

    if folder_id:
        logs = [
            l for l in logs
            if l.get("target_id") == folder_id
            or l.get("details", {}).get("folder_id") == folder_id
        ]
    if actor_id:
        logs = [l for l in logs if l.get("actor_id") == actor_id]
    if action:
        logs = [l for l in logs if l.get("action") == action]

    logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return logs[offset : offset + limit]


def count_audit(**filters) -> int:
    """Nombre total d'entrées correspondant aux filtres (pour pagination)."""
    return len(list_audit(limit=100_000, offset=0, **filters))


# ── Purge ─────────────────────────────────────────────────────────────────────

def purge_old_logs() -> int:
    """
    Supprime les entrées antérieures à RETENTION_DAYS jours.
    Retourne le nombre de logs supprimés.
    """
    cutoff = (
        datetime.datetime.utcnow() - datetime.timedelta(days=RETENTION_DAYS)
    ).isoformat()

    tbl    = _tbl()
    before = len(tbl)
    tbl.remove(Q.timestamp < cutoff)
    after   = len(tbl)
    removed = before - after

    if removed:
        print(f"[rag_audit] {removed} log(s) purgé(s) (rétention {RETENTION_DAYS}j, cutoff={cutoff[:10]})")
    return removed
