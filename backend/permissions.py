"""
Permissions — LLM Council
==========================
Table de droits stockée dans data/permissions.json

Format d'une entrée :
  {
    "id":       "<uuid>",
    "subject":  "role:admin" | "service:<id>" | "user:<id>",
    "resource": "pipeline:<id>" | "pipeline:*"
                "conversation:*" | "conversation:<id>"
                "image:*"        | "image:<id>"
                "*",
    "action":   "use" | "edit" | "*",
    "granted":  true | false      # false = deny explicite (prioritaire)
  }

Résolution :
  1. Deny explicite > tout
  2. Règle spécifique (user:) > règle générale (service: > role:)
  3. Wildcard resource/action matchent tout
  4. Absence de règle = DENY par défaut

Règles built-in (non stockées, toujours vraies) :
  - role:admin  resource:*  action:*  → ALLOW

API publique :
  has_permission(user, resource, action) -> bool
  grant(subject, resource, action)
  revoke(subject, resource, action)
  list_permissions() -> list
  list_for_subject(subject) -> list
"""

import uuid, json, os
from pathlib import Path
from typing import Optional

DATA_DIR      = Path(os.getenv("DATA_DIR", "data"))
PERMS_FILE    = DATA_DIR / "permissions.json"

# ── Types de sujets, ressources et actions connus ────────────────────────────

SUBJECT_TYPES  = ("role", "service", "user")
RESOURCE_TYPES = ("pipeline", "conversation", "image")  # extensible
ACTIONS        = ("use", "edit", "*")

# ── Storage ───────────────────────────────────────────────────────────────────

def _load() -> list:
    if not PERMS_FILE.exists():
        return []
    with open(PERMS_FILE, encoding="utf-8") as f:
        return json.load(f)

def _save(perms: list):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(PERMS_FILE, "w", encoding="utf-8") as f:
        json.dump(perms, f, ensure_ascii=False, indent=2)

# ── Matching helpers ──────────────────────────────────────────────────────────

def _match(pattern: str, value: str) -> bool:
    """Vérifie si un pattern (avec wildcard *) correspond à une valeur."""
    if pattern == "*":
        return True
    # "pipeline:*" matche "pipeline:abc"
    if pattern.endswith(":*"):
        prefix = pattern[:-1]  # "pipeline:"
        return value.startswith(prefix)
    return pattern == value

# ── Résolution des droits ─────────────────────────────────────────────────────

def has_permission(user: dict, resource: str, action: str) -> bool:
    """
    Retourne True si l'utilisateur a le droit action sur resource.

    Ordre de résolution :
      1. Admins → ALLOW immédiat (built-in, non overridable)
      2. Deny explicite → DENY immédiat
      3. Allow explicite → ALLOW
      4. Absence → DENY
    """
    # 1. Built-in : admin → tout
    if user.get("role") == "admin":
        return True

    perms = _load()

    # Construire les sujets applicables à cet utilisateur
    # Priorité : user > service > role
    subjects = [
        f"user:{user['id']}",
        f"service:{user['service_id']}" if user.get("service_id") else None,
        f"role:{user.get('role', 'user')}",
    ]
    subjects = [s for s in subjects if s]

    # Collecter toutes les règles qui matchent, avec leur niveau de spécificité
    # Spécificité : user(2) > service(1) > role(0)
    specificity_map = {"user": 2, "service": 1, "role": 0}

    matched = []
    for perm in perms:
        subj = perm.get("subject", "")
        res  = perm.get("resource", "")
        act  = perm.get("action", "")
        if subj in subjects and _match(res, resource) and _match(act, action):
            spec = specificity_map.get(subj.split(":")[0], 0)
            matched.append((spec, perm))

    if not matched:
        return False  # pas de règle = DENY

    # Trier par spécificité décroissante
    matched.sort(key=lambda x: x[0], reverse=True)

    # 2. Deny explicite le plus spécifique
    for _, perm in matched:
        if not perm.get("granted", True):
            return False  # deny explicite

    # 3. Allow explicite
    for _, perm in matched:
        if perm.get("granted", True):
            return True

    return False

# ── CRUD ──────────────────────────────────────────────────────────────────────

def list_permissions() -> list:
    return _load()

def list_for_subject(subject: str) -> list:
    return [p for p in _load() if p.get("subject") == subject]

def grant(subject: str, resource: str, action: str = "use") -> dict:
    """Ajoute ou met à jour une règle ALLOW."""
    perms = _load()
    # Éviter les doublons exacts
    existing = next(
        (p for p in perms
         if p["subject"] == subject and p["resource"] == resource and p["action"] == action),
        None,
    )
    if existing:
        existing["granted"] = True
        _save(perms)
        return existing

    entry = {
        "id":       str(uuid.uuid4()),
        "subject":  subject,
        "resource": resource,
        "action":   action,
        "granted":  True,
    }
    perms.append(entry)
    _save(perms)
    return entry

def revoke(subject: str, resource: str, action: str = "use"):
    """Supprime une règle (ou passe granted=False si deny explicite souhaité)."""
    perms = [
        p for p in _load()
        if not (p["subject"] == subject and p["resource"] == resource and p["action"] == action)
    ]
    _save(perms)

def deny(subject: str, resource: str, action: str = "*") -> dict:
    """Ajoute un deny explicite (prioritaire sur tout ALLOW de niveau inférieur)."""
    perms = _load()
    existing = next(
        (p for p in perms
         if p["subject"] == subject and p["resource"] == resource and p["action"] == action),
        None,
    )
    if existing:
        existing["granted"] = False
        _save(perms)
        return existing

    entry = {
        "id":       str(uuid.uuid4()),
        "subject":  subject,
        "resource": resource,
        "action":   action,
        "granted":  False,
    }
    perms.append(entry)
    _save(perms)
    return entry

def delete_permission(perm_id: str):
    perms = [p for p in _load() if p["id"] != perm_id]
    _save(perms)

# ── Migration depuis l'ancien modèle services.pipeline_ids ───────────────────

def migrate_from_services(services: list):
    """
    Importe les pipeline_ids des services existants vers permissions.json.
    Idempotent — ne crée pas de doublons.
    Appelé au démarrage si permissions.json est vide.
    """
    perms = _load()
    if perms:
        return  # déjà migré

    for svc in services:
        for pid in svc.get("pipeline_ids", []):
            grant(f"service:{svc['id']}", f"pipeline:{pid}", "use")

    print(f"[permissions] Migration effectuée depuis {len(services)} service(s).")
