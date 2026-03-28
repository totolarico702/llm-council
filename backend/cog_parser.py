# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
cog_parser.py — Parser et validateur pour le format .cog v1.0
"""
import json
import datetime
from typing import Any
import structlog

log = structlog.get_logger()

SUPPORTED_NODE_TYPES = {
    "input", "output", "llm", "llm_local", "rag_search",
    "tool", "mcp", "condition", "merge",
    "inject", "transform",          # V3 nouveaux types
    "hook", "chairman",             # alias legacy
    "none", "default",              # fallback — ne pas bloquer, juste logger un warning
}

COG_VERSION    = "1.0"
COG_VERSION_V3 = "2.0"
SUPPORTED_COG_VERSIONS = (COG_VERSION, COG_VERSION_V3)


def parse_cog(content: str | dict) -> dict:
    """
    Parse et valide un fichier .cog JSON.
    Supporte les versions 1.0 et 2.0.
    """
    if isinstance(content, str):
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON invalide : {e}")
    else:
        data = dict(content)  # copie pour ne pas muter l'original

    version = data.get("cog_version")
    if version not in SUPPORTED_COG_VERSIONS:
        raise ValueError(
            f"Version {version!r} non supportée "
            f"(versions acceptées : {', '.join(SUPPORTED_COG_VERSIONS)})"
        )

    # ── V2.0 : normalisation du bloc "council" ──────────────────────────────
    if version == COG_VERSION_V3:
        _normalise_v2(data)

    # ── Validation des nœuds ────────────────────────────────────────────────
    nodes = data.get("nodes", [])
    for node in nodes:
        node_type = node.get("type", "none")
        if node_type not in SUPPORTED_NODE_TYPES:
            log.warning("cog_unknown_node_type", type=node_type, id=node.get("id"))
            node["type"] = "llm"  # fallback safe

    types = [n.get("type") for n in nodes]
    if "input" not in types:
        log.warning("cog_no_input_node", name=data.get("name"))
    if "output" not in types:
        log.warning("cog_no_output_node", name=data.get("name"))

    return data


def _normalise_v2(data: dict) -> None:
    """
    Normalise un .cog v2.0 en place.
    - Extrait le bloc "council" pour peupler config.chairman et les nœuds LLM
    - Assure la présence de "metadata"
    """
    council = data.get("council", {})
    config  = data.setdefault("config", {})

    # Propager chairman depuis council → config
    if "chairman" in council and "chairman" not in config:
        config["chairman"] = council["chairman"]

    # Propager language
    if "language" not in config:
        config.setdefault("language", "fr")

    # Si le .cog v2 ne définit pas de nœuds explicites mais définit des modèles
    # dans council.models → générer les nœuds automatiquement
    if not data.get("nodes") and council.get("models"):
        data["nodes"] = []
        data["edges"] = []
        for i, model in enumerate(council["models"]):
            node_id = f"llm_{i+1}"
            data["nodes"].append({
                "id":    node_id,
                "type":  "llm",
                "model": model,
                "role":  "explorer" if i == 0 else "critic",
                "inputs": [],
            })
        # Nœud chairman terminal
        chairman = council.get("chairman", council["models"][0])
        data["nodes"].append({
            "id":    "chairman",
            "type":  "chairman",
            "model": chairman,
            "inputs": [f"llm_{i+1}" for i in range(len(council["models"]))],
        })
        # Edges : chaque llm → chairman
        data["edges"] = [
            {"from": f"llm_{i+1}", "to": "chairman"}
            for i in range(len(council["models"]))
        ]

    # Métadonnées par défaut
    data.setdefault("metadata", {
        "author":     "admin",
        "version":    "1.0",
        "tags":       [],
        "created_at": datetime.datetime.utcnow().isoformat(),
    })


def cog_to_dag(cog: dict) -> dict:
    """Convertit un .cog en format DAG interne pour dag_engine.py"""
    return {
        "nodes":  cog.get("nodes", []),
        "edges":  cog.get("edges", []),
        "config": cog.get("config", {}),
    }


def dag_to_cog(dag: dict, meta: dict, version: str = COG_VERSION) -> dict:
    """Convertit un pipeline DAG existant en format .cog exportable."""
    base = {
        "cog_version": version,
        "name":        meta.get("name", "Pipeline sans nom"),
        "description": meta.get("description", ""),
        "nodes":       dag.get("nodes", []),
        "edges":       dag.get("edges", []),
        "config":      dag.get("config", {}),
    }
    if version == COG_VERSION_V3:
        base["metadata"] = {
            "author":     meta.get("author", "admin"),
            "version":    meta.get("version", "1.0"),
            "tags":       meta.get("tags", []),
            "created_at": meta.get("created_at",
                                   datetime.datetime.utcnow().isoformat()),
        }
    else:
        # v1.0 — champs plats legacy
        base.update({
            "author":     meta.get("author", "admin"),
            "created_at": meta.get("created_at",
                                   datetime.datetime.utcnow().isoformat()),
            "tags":       meta.get("tags", []),
        })
    return base
