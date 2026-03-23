"""
user_archiver.py — LLM Council
================================
Analyse le dossier d'un user avant archivage et produit :

  archive/{login}_{date}/
    synthesis.md        — résumé lisible humain (passation)
    rag_index.json      — chunks structurés pour Qdrant

Flux :
  1. analyze_user(user_id)
       → lit conversations/ + projects/ du user
       → appels LLM (Claude Sonnet) en deux passes :
           a. résumé global + skills détectés
           b. extraction de N chunks thématiques
       → retourne ArchivePreview (affiché à l'admin avant confirmation)

  2. archive_user(user_id, login, preview)
       → appelle rag_store.ingest_chunks(preview.chunks)
       → appelle storage.archive_user(user_id, login)
           → déplace data/users/{id}/ → data/archive/{login}_{date}/
       → dépose synthesis.md + rag_index.json dans l'archive
       → appelle db.delete_user(user_id)
       → retourne le chemin de l'archive

LLM utilisé : claude-sonnet-4-6 (via OpenRouter)
Coût estimé : ~$0.05–0.20 selon le volume de données (4-8k tokens par analyse)
"""

import json
import asyncio
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from .openrouter import query_model
from . import storage, rag_store

# Modèle d'analyse — Claude Sonnet pour la qualité de synthèse
ARCHIVER_MODEL = "anthropic/claude-sonnet-4-6"
# Fallback si Sonnet indisponible
ARCHIVER_FALLBACK = "google/gemini-2.0-flash-001"

# Limites pour éviter les prompts trop longs
MAX_CONV_CHARS   = 3000   # chars max par conversation dans le prompt
MAX_CONVS_ANALYZED = 50   # max conversations analysées
MAX_PROJ_CHARS   = 1000   # chars max par projet


# ── Structures de données ─────────────────────────────────────────────────────

@dataclass
class RagChunk:
    id:          str
    content:     str
    source_type: str          # "conversation" | "project" | "summary"
    source_id:   str
    user_id:     str
    user_login:  str
    date:        str
    tags:        List[str] = field(default_factory=list)
    score:       float = 0.8


@dataclass
class ArchivePreview:
    user_id:     str
    user_login:  str
    summary:     str                     # résumé global Markdown
    skills:      List[str]               # skills identifiés
    topics:      List[str]               # sujets récurrents
    chunks:      List[RagChunk]          # chunks RAG
    stats:       Dict[str, int]          # nb convs, projets, messages
    note_successor: str                  # note de passation
    generated_at: str = ""

    def __post_init__(self):
        if not self.generated_at:
            self.generated_at = datetime.utcnow().isoformat()


# ── Lecture des données user ──────────────────────────────────────────────────

def _load_user_data(user_id: str) -> Dict[str, Any]:
    """Charge toutes les conversations et projets d'un user."""
    convs    = storage.list_conversations(owner_id=user_id)
    projects = storage.list_projects(owner_id=user_id)

    full_convs = []
    total_messages = 0
    for meta in convs[:MAX_CONVS_ANALYZED]:
        conv = storage.get_conversation(meta["id"], owner_id=user_id)
        if not conv:
            continue
        msgs = conv.get("messages", [])
        total_messages += len(msgs)
        # Résumer la conversation : user questions + chairman réponses
        exchanges = []
        for msg in msgs:
            if msg["role"] == "user":
                exchanges.append(f"Q: {msg['content'][:300]}")
            elif msg["role"] == "assistant" and msg.get("stage3"):
                resp = msg["stage3"].get("response", "")
                if resp:
                    exchanges.append(f"A: {resp[:500]}")
        full_convs.append({
            "id":       conv["id"],
            "title":    conv.get("title", "Sans titre"),
            "date":     conv.get("created_at", "")[:10],
            "preview":  "\n".join(exchanges)[:MAX_CONV_CHARS],
            "msg_count": len(msgs),
        })

    full_projs = []
    for meta in projects:
        proj = storage.get_project(meta["id"], owner_id=user_id)
        if not proj:
            continue
        full_projs.append({
            "id":    proj["id"],
            "name":  proj["name"],
            "date":  proj.get("created_at", "")[:10],
            "convs": len(proj.get("conversation_ids", [])),
        })

    return {
        "conversations":    full_convs,
        "projects":         full_projs,
        "stats": {
            "conversations": len(convs),
            "projects":      len(projects),
            "messages":      total_messages,
            "analyzed":      len(full_convs),
        }
    }


# ── Prompts LLM ───────────────────────────────────────────────────────────────

def _prompt_summary(login: str, data: Dict) -> str:
    convs_text = "\n\n".join([
        f"[{c['date']}] {c['title']} ({c['msg_count']} messages)\n{c['preview']}"
        for c in data["conversations"]
    ])
    projs_text = "\n".join([
        f"- {p['name']} ({p['convs']} conversations, créé {p['date']})"
        for p in data["projects"]
    ]) or "Aucun projet"

    return f"""Tu es un assistant RH spécialisé dans la capitalisation des connaissances.

Analyse l'historique de travail de {login} et produis une synthèse structurée.

PROJETS :
{projs_text}

CONVERSATIONS (extrait des {len(data['conversations'])} plus récentes) :
{convs_text[:8000]}

Réponds UNIQUEMENT en JSON valide avec cette structure exacte :
{{
  "summary": "Paragraphe de 150-200 mots décrivant le profil, les missions et la valeur apportée",
  "skills": ["skill1", "skill2", ...],
  "topics": ["sujet récurrent 1", "sujet récurrent 2", ...],
  "note_successor": "Conseils et points clés à transmettre au successeur (100-150 mots)"
}}

Règles :
- skills : compétences métier spécifiques identifiées dans les conversations (8-15 items)
- topics : sujets abordés de façon récurrente (5-10 items)
- Rester factuel, basé uniquement sur les conversations fournies
- Ne pas inventer de compétences non démontrées"""


def _prompt_chunks(login: str, user_id: str, data: Dict) -> str:
    convs_text = "\n\n---\n".join([
        f"ID: {c['id']}\nTitre: {c['title']}\nDate: {c['date']}\n{c['preview']}"
        for c in data["conversations"]
    ])

    return f"""Tu es un assistant spécialisé dans la création d'une base de connaissances RAG.

Extrait les passages les plus utiles et réutilisables des conversations de {login}.

CONVERSATIONS :
{convs_text[:10000]}

Produis UNIQUEMENT un JSON valide avec cette structure :
{{
  "chunks": [
    {{
      "content": "Passage ou synthèse thématique autonome et réutilisable (100-300 mots)",
      "source_id": "id_de_la_conversation_source",
      "source_type": "conversation",
      "date": "YYYY-MM-DD",
      "tags": ["tag1", "tag2", "tag3"],
      "score": 0.85
    }}
  ]
}}

Règles :
- Extraire 5 à 15 chunks selon le volume
- Chaque chunk doit être autonome et compréhensible sans contexte
- Privilégier les passages avec des décisions, analyses, ou raisonnements clés
- Les chunks de type "summary" peuvent synthétiser plusieurs échanges sur un même thème
- score : évaluer la pertinence RAG de 0.5 (contexte général) à 1.0 (insight clé unique)
- tags : 2-5 mots-clés thématiques par chunk"""


# ── Appels LLM ────────────────────────────────────────────────────────────────

async def _call_llm(prompt: str) -> Optional[str]:
    """Appelle Claude Sonnet avec fallback Gemini."""
    for model in [ARCHIVER_MODEL, ARCHIVER_FALLBACK]:
        resp = await query_model(
            model,
            [{"role": "user", "content": prompt}],
            timeout=120.0,
        )
        if resp and resp.get("content"):
            return resp["content"]
    return None


def _parse_json_response(text: str) -> Optional[Dict]:
    """Extrait et parse le JSON de la réponse LLM."""
    import re
    # Chercher un bloc JSON (entre ```json ... ``` ou directement)
    patterns = [
        r"```json\s*([\s\S]+?)```",
        r"```\s*([\s\S]+?)```",
        r"(\{[\s\S]+\})",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1).strip())
            except json.JSONDecodeError:
                continue
    # Dernier recours : parser directement
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return None


# ── Interface publique ────────────────────────────────────────────────────────

async def analyze_user(user_id: str, user_login: str) -> ArchivePreview:
    """
    Analyse complète d'un user avant archivage.
    Retourne un ArchivePreview montré à l'admin pour confirmation.
    """
    print(f"[user_archiver] Analyse de {user_login} ({user_id})...")

    # 1. Charger les données
    data = _load_user_data(user_id)
    stats = data["stats"]

    if stats["conversations"] == 0:
        # Rien à analyser
        return ArchivePreview(
            user_id=user_id, user_login=user_login,
            summary=f"{user_login} n'a aucune conversation enregistrée.",
            skills=[], topics=[], chunks=[],
            stats=stats,
            note_successor="Aucune donnée à transmettre.",
        )

    # 2. Passe 1 : résumé global + skills (en parallèle avec passe 2)
    # 3. Passe 2 : extraction des chunks RAG
    prompt_summary = _prompt_summary(user_login, data)
    prompt_chunks  = _prompt_chunks(user_login, user_id, data)

    print(f"[user_archiver] {stats['analyzed']} conversations analysées, "
          f"{stats['messages']} messages total")

    # Appels en parallèle
    results = await asyncio.gather(
        _call_llm(prompt_summary),
        _call_llm(prompt_chunks),
        return_exceptions=True,
    )

    raw_summary, raw_chunks = results

    # Parser résumé
    summary_data = {}
    if isinstance(raw_summary, str):
        parsed = _parse_json_response(raw_summary)
        if parsed:
            summary_data = parsed
        else:
            print(f"[user_archiver] Impossible de parser le résumé")

    # Parser chunks
    chunks_list: List[RagChunk] = []
    if isinstance(raw_chunks, str):
        parsed = _parse_json_response(raw_chunks)
        if parsed and "chunks" in parsed:
            import hashlib
            for i, c in enumerate(parsed["chunks"]):
                content = c.get("content", "").strip()
                if not content:
                    continue
                chunk_id = hashlib.sha256(
                    f"{user_id}:{content}".encode()
                ).hexdigest()[:16]
                chunks_list.append(RagChunk(
                    id          = chunk_id,
                    content     = content,
                    source_type = c.get("source_type", "conversation"),
                    source_id   = c.get("source_id", ""),
                    user_id     = user_id,
                    user_login  = user_login,
                    date        = c.get("date", "")[:10],
                    tags        = c.get("tags", []),
                    score       = float(c.get("score", 0.8)),
                ))

    print(f"[user_archiver] {len(chunks_list)} chunks RAG extraits")

    return ArchivePreview(
        user_id        = user_id,
        user_login     = user_login,
        summary        = summary_data.get("summary", "Analyse non disponible."),
        skills         = summary_data.get("skills", []),
        topics         = summary_data.get("topics", []),
        note_successor = summary_data.get("note_successor", ""),
        chunks         = chunks_list,
        stats          = stats,
    )


def _build_synthesis_md(preview: ArchivePreview) -> str:
    """Génère le fichier synthesis.md lisible humain."""
    skills_md = "\n".join(f"- {s}" for s in preview.skills)
    topics_md = "\n".join(f"- {t}" for t in preview.topics)
    chunks_md = "\n\n".join([
        f"### Chunk {i+1} — {', '.join(c.tags)}\n"
        f"*Source : {c.source_type} {c.source_id} | {c.date} | score : {c.score}*\n\n"
        f"{c.content}"
        for i, c in enumerate(preview.chunks)
    ])

    return f"""# Archive — {preview.user_login}
Généré le {preview.generated_at[:10]}

## Profil et missions
{preview.summary}

## Compétences identifiées
{skills_md}

## Sujets récurrents
{topics_md}

## Note de passation
{preview.note_successor}

## Statistiques
- Conversations : {preview.stats.get('conversations', 0)}
- Projets : {preview.stats.get('projects', 0)}
- Messages échangés : {preview.stats.get('messages', 0)}
- Conversations analysées : {preview.stats.get('analyzed', 0)}
- Chunks RAG extraits : {len(preview.chunks)}

## Chunks RAG
{chunks_md}
"""


async def finalize_archive(preview: ArchivePreview) -> str:
    """
    Finalise l'archivage après confirmation de l'admin :
    1. Ingère les chunks dans Qdrant/stub
    2. Archive le dossier user (mv)
    3. Dépose synthesis.md + rag_index.json dans l'archive
    4. Retourne le chemin de l'archive
    
    Note : la suppression du user dans TinyDB est faite par la route admin
    après appel de cette fonction.
    """
    print(f"[user_archiver] Archivage de {preview.user_login}...")

    # 1. Ingérer les chunks RAG
    if preview.chunks:
        chunks_dicts = [asdict(c) for c in preview.chunks]
        ingested = await rag_store.ingest_chunks(chunks_dicts)
        print(f"[user_archiver] {ingested} chunks RAG ingérés")

    # 2. Archiver le dossier user
    archive_path = storage.archive_user(preview.user_id, preview.user_login)

    # 3. Déposer les fichiers de synthèse dans l'archive
    if archive_path and archive_path.exists():
        # synthesis.md
        synthesis_md = _build_synthesis_md(preview)
        (archive_path / "synthesis.md").write_text(
            synthesis_md, encoding="utf-8"
        )

        # rag_index.json
        rag_index = {
            "user_id":       preview.user_id,
            "user_login":    preview.user_login,
            "archived_at":   preview.generated_at,
            "summary":       preview.summary,
            "skills":        preview.skills,
            "topics":        preview.topics,
            "note_successor": preview.note_successor,
            "stats":         preview.stats,
            "chunks":        [asdict(c) for c in preview.chunks],
        }
        (archive_path / "rag_index.json").write_text(
            json.dumps(rag_index, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        print(f"[user_archiver] synthesis.md + rag_index.json → {archive_path}")

    return str(archive_path)
