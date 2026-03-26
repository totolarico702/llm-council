# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
cog_parser.py — Parser et validateur pour le format .cog v1.0
"""
import json
import datetime
from typing import Any

SUPPORTED_NODE_TYPES = {
    "input", "output", "llm", "llm_local", "rag_search",
    "tool", "mcp", "condition", "merge"
}

COG_VERSION = "1.0"


def parse_cog(content: str | dict) -> dict:
    """Parse et valide un fichier .cog JSON."""
    if isinstance(content, str):
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON invalide : {e}")
    else:
        data = content

    if data.get("cog_version") not in (COG_VERSION,):
        raise ValueError(f"Version {data.get('cog_version')!r} non supportée (attendu: {COG_VERSION!r})")

    nodes = data.get("nodes", [])
    for node in nodes:
        if node.get("type") not in SUPPORTED_NODE_TYPES:
            raise ValueError(f"Type de nœud inconnu : {node.get('type')!r}")

    types = [n["type"] for n in nodes]
    if "input" not in types:
        raise ValueError("Le pipeline doit avoir un nœud 'input'")
    if "output" not in types:
        raise ValueError("Le pipeline doit avoir un nœud 'output'")

    return data


def cog_to_dag(cog: dict) -> dict:
    """Convertit un .cog en format DAG interne pour dag_engine.py"""
    return {
        "nodes": cog["nodes"],
        "edges": cog["edges"],
        "config": cog.get("config", {}),
    }


def dag_to_cog(dag: dict, meta: dict) -> dict:
    """Convertit un pipeline DAG existant en format .cog exportable"""
    return {
        "cog_version": COG_VERSION,
        "name": meta.get("name", "Pipeline sans nom"),
        "description": meta.get("description", ""),
        "author": meta.get("author", "admin"),
        "created_at": meta.get("created_at", datetime.datetime.utcnow().isoformat()),
        "tags": meta.get("tags", []),
        "nodes": dag.get("nodes", []),
        "edges": dag.get("edges", []),
        "config": dag.get("config", {}),
    }
