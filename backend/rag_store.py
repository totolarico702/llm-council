"""
rag_store.py — LLM Council RAAD
================================
Base de connaissance vectorielle via LanceDB.
Embeddings : OpenRouter text-embedding-3-small
Storage    : data/lancedb/ (local, sans serveur)
Scope      : Global entreprise (partagé entre tous les users)
"""

import os
import json
import hashlib
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Optional
import lancedb
import pyarrow as pa

# ── Config ────────────────────────────────────────────────────────────────────
DATA_DIR       = Path(os.getenv("DATA_DIR", "data"))
LANCEDB_PATH   = DATA_DIR / "lancedb"
EMBED_MODEL    = "openai/text-embedding-3-small"
EMBED_DIM      = 1536
CHUNK_SIZE     = 500   # tokens approximatifs (mots)
CHUNK_OVERLAP  = 50

# ── Schéma LanceDB ────────────────────────────────────────────────────────────
SCHEMA = pa.schema([
    pa.field("id",          pa.string()),
    pa.field("doc_id",      pa.string()),
    pa.field("folder_id",   pa.string()),
    pa.field("service_id",  pa.string()),
    pa.field("user_id",     pa.string()),
    pa.field("filename",    pa.string()),
    pa.field("content",     pa.string()),
    pa.field("chunk_index", pa.int32()),
    pa.field("metadata",    pa.string()),  # JSON string
    pa.field("vector",      pa.list_(pa.float32(), EMBED_DIM)),
])

# ── Client LanceDB ────────────────────────────────────────────────────────────
_db    = None
_table = None

def _get_db():
    global _db, _table
    if _db is None:
        LANCEDB_PATH.mkdir(parents=True, exist_ok=True)
        _db = lancedb.connect(str(LANCEDB_PATH))
        if "chunks" in _db.table_names():
            _table = _db.open_table("chunks")
        else:
            _table = _db.create_table("chunks", schema=SCHEMA)
            print(f"[rag] Table 'chunks' créée dans {LANCEDB_PATH}")
    return _db, _table

def get_table():
    _, table = _get_db()
    return table

# ── Embeddings ────────────────────────────────────────────────────────────────
async def embed_text(text: str) -> Optional[List[float]]:
    """Génère un embedding via OpenRouter."""
    from .openrouter import OPENROUTER_API_KEY
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/embeddings",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                json={"model": EMBED_MODEL, "input": text[:8000]},
            )
            r.raise_for_status()
            return r.json()["data"][0]["embedding"]
    except Exception as e:
        print(f"[rag] Embedding error: {e}")
        return None

async def embed_batch(texts: List[str]) -> List[Optional[List[float]]]:
    """Embeddings en batch (max 10 en parallèle)."""
    sem = asyncio.Semaphore(10)
    async def _embed(t):
        async with sem:
            return await embed_text(t)
    return await asyncio.gather(*[_embed(t) for t in texts])

# ── Chunking ──────────────────────────────────────────────────────────────────
def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Découpe le texte en chunks avec overlap."""
    words  = text.split()
    chunks = []
    i      = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return [c for c in chunks if c.strip()]

def chunk_id(doc_id: str, chunk_index: int) -> str:
    return hashlib.sha256(f"{doc_id}:{chunk_index}".encode()).hexdigest()[:16]

# ── Extraction texte ──────────────────────────────────────────────────────────
def _extract_text_sync(file_path: Path, filename: str) -> str:
    """Extrait le texte de façon synchrone (pour asyncio.to_thread)."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    try:
        if ext == "pdf":
            import pypdf
            reader = pypdf.PdfReader(str(file_path))
            return "\n".join(p.extract_text() or "" for p in reader.pages)

        elif ext in ("docx",):
            import docx
            doc = docx.Document(str(file_path))
            return "\n".join(p.text for p in doc.paragraphs)

        elif ext in ("txt", "md", "markdown", "rst"):
            return file_path.read_text(encoding="utf-8", errors="ignore")

        elif ext == "rtf":
            import re
            raw  = file_path.read_text(encoding="utf-8", errors="ignore")
            text = re.sub(r'\{[^}]*\}|\\[a-z]+\d*\s?', ' ', raw)
            return re.sub(r'\s+', ' ', text).strip()

        elif ext == "html":
            from html.parser import HTMLParser
            class _P(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.parts = []
                def handle_data(self, d):
                    self.parts.append(d)
            p = _P()
            p.feed(file_path.read_text(encoding="utf-8", errors="ignore"))
            return " ".join(p.parts)

        else:
            return file_path.read_text(encoding="utf-8", errors="ignore")

    except Exception as e:
        print(f"[rag] Extraction error ({filename}): {e}")
        return ""


async def extract_text(file_path: Path, filename: str) -> str:
    """Extrait le texte sans bloquer l'event loop."""
    return await asyncio.to_thread(_extract_text_sync, file_path, filename)

# ── Ingestion ─────────────────────────────────────────────────────────────────
async def ingest_document(
    file_path: Path,
    filename: str,
    doc_id: str,
    folder_id: str   = "global",
    service_id: str  = "global",
    user_id: str     = "system",
    metadata: dict   = None,
) -> dict:
    """
    Ingère un document dans LanceDB.
    Retourne {"doc_id", "chunks_count", "status"}.
    """
    table = get_table()

    # Supprimer les chunks existants de ce doc (réindexation)
    try:
        table.delete(f"doc_id = '{doc_id}'")
    except Exception:
        pass

    # Extraire le texte
    text = await extract_text(file_path, filename)
    if not text.strip():
        return {"doc_id": doc_id, "chunks_count": 0, "status": "empty"}

    # Chunking
    chunks = chunk_text(text)
    if not chunks:
        return {"doc_id": doc_id, "chunks_count": 0, "status": "empty"}

    # Embeddings en batch
    vectors = await embed_batch(chunks)

    # Insérer dans LanceDB
    rows = []
    for i, (chunk, vector) in enumerate(zip(chunks, vectors)):
        if vector is None:
            continue
        rows.append({
            "id":          chunk_id(doc_id, i),
            "doc_id":      doc_id,
            "folder_id":   folder_id,
            "service_id":  service_id,
            "user_id":     user_id,
            "filename":    filename,
            "content":     chunk,
            "chunk_index": i,
            "metadata":    json.dumps(metadata or {}),
            "vector":      vector,
        })

    if rows:
        table.add(rows)

    print(f"[rag] {len(rows)} chunks indexés pour {filename}")
    return {"doc_id": doc_id, "chunks_count": len(rows), "status": "ok"}

# ── Recherche ─────────────────────────────────────────────────────────────────
async def search(
    query: str,
    limit: int = 5,
    service_id: Optional[str] = None,
    folder_id:  Optional[str] = None,
    doc_id:     Optional[str] = None,
    score_threshold: float = 0.0,
    # Compat ancien code
    filters: Optional[Dict] = None,
) -> List[Dict[str, Any]]:
    """
    Recherche sémantique dans LanceDB.
    Filtres optionnels : service_id, folder_id, doc_id.
    """
    table  = get_table()
    vector = await embed_text(query)
    if vector is None:
        return []

    # Construire le filtre SQL LanceDB
    filter_parts = []
    if service_id: filter_parts.append(f"service_id = '{service_id}'")
    if folder_id:  filter_parts.append(f"folder_id = '{folder_id}'")
    if doc_id:     filter_parts.append(f"doc_id = '{doc_id}'")
    # Compat ancien code (filters dict)
    if filters:
        for k, v in filters.items():
            if k in ("service_id", "folder_id", "doc_id", "user_id"):
                filter_parts.append(f"{k} = '{v}'")

    query_builder = table.search(vector).limit(limit)
    if filter_parts:
        query_builder = query_builder.where(" AND ".join(filter_parts))

    results = query_builder.to_list()
    if score_threshold > 0.0:
        results = [r for r in results if float(r.get("_distance", 1.0)) <= (1.0 - score_threshold)]
    return [
        {
            "content":     r["content"],
            "filename":    r["filename"],
            "doc_id":      r["doc_id"],
            "folder_id":   r["folder_id"],
            "service_id":  r["service_id"],
            "score":       float(r.get("_distance", 0)),
            "chunk_index": r["chunk_index"],
        }
        for r in results
    ]

# ── Preview & résolution @mentions ───────────────────────────────────────────

async def preview_document(doc_id: str, max_chars: int = 200) -> Optional[str]:
    """
    Retourne un extrait du premier chunk d'un document (pour tooltip).
    Utilise un scan pandas (pas de vecteur requis).
    """
    try:
        import pandas as pd
        table = get_table()
        df    = table.to_pandas()
        rows  = df[df["doc_id"] == doc_id].sort_values("chunk_index")
        if rows.empty:
            return None
        return str(rows.iloc[0]["content"])[:max_chars]
    except Exception as e:
        print(f"[rag] preview_document error: {e}")
        return None


async def resolve_mentions(
    mentions: List[str],
    max_chars_per_doc: int = 3000,
) -> Dict[str, str]:
    """
    Résout une liste de noms de fichiers en contenu textuel.
    Utilisé pour l'injection des @mentions dans le contexte LLM.
    Retourne {filename: "contenu concaténé des chunks"}.
    """
    if not mentions:
        return {}
    try:
        import pandas as pd
        table = get_table()
        df    = table.to_pandas()
        result: Dict[str, str] = {}
        for filename in mentions:
            rows = df[df["filename"] == filename].sort_values("chunk_index")
            if rows.empty:
                continue
            content = "\n".join(rows["content"].tolist())
            result[filename] = content[:max_chars_per_doc]
        return result
    except Exception as e:
        print(f"[rag] resolve_mentions error: {e}")
        return {}


# ── Réindexation ──────────────────────────────────────────────────────────────

async def reindex_document(doc_id: str) -> Optional[dict]:
    """
    Réindexe un document en re-embeddant les chunks déjà stockés dans LanceDB.
    Utile quand le modèle d'embedding a changé ou si les vecteurs sont corrompus.
    """
    try:
        import pandas as pd
        table = get_table()
        df    = table.to_pandas()
        rows  = df[df["doc_id"] == doc_id].sort_values("chunk_index")
        if rows.empty:
            return None

        chunks  = rows["content"].tolist()
        vectors = await embed_batch(chunks)

        # Supprimer les anciens chunks puis réinsérer
        table.delete(f"doc_id = '{doc_id}'")

        new_rows = []
        for i, (_, row) in enumerate(rows.iterrows()):
            vector = vectors[i]
            if vector is None:
                continue
            new_rows.append({
                "id":          chunk_id(doc_id, int(row["chunk_index"])),
                "doc_id":      doc_id,
                "folder_id":   str(row["folder_id"]),
                "service_id":  str(row["service_id"]),
                "user_id":     str(row["user_id"]),
                "filename":    str(row["filename"]),
                "content":     str(row["content"]),
                "chunk_index": int(row["chunk_index"]),
                "metadata":    str(row["metadata"]),
                "vector":      vector,
            })

        if new_rows:
            table.add(new_rows)

        print(f"[rag] Réindexation : {len(new_rows)} chunks pour {doc_id}")
        return {"doc_id": doc_id, "chunks_count": len(new_rows), "status": "ok"}
    except Exception as e:
        print(f"[rag] reindex_document error: {e}")
        return None


# ── Suppression ───────────────────────────────────────────────────────────────
async def delete_document(doc_id: str) -> int:
    """Supprime tous les chunks d'un document."""
    table  = get_table()
    before = table.count_rows()
    table.delete(f"doc_id = '{doc_id}'")
    after  = table.count_rows()
    removed = before - after
    print(f"[rag] {removed} chunks supprimés pour doc {doc_id}")
    return removed

async def move_document(doc_id: str, new_folder_id: str) -> int:
    """Met à jour folder_id de tous les chunks d'un document dans LanceDB."""
    try:
        import pandas as pd
        table = get_table()
        df    = table.to_pandas()
        rows  = df[df["doc_id"] == doc_id]
        if rows.empty:
            return 0
        # Supprimer les anciens chunks puis réinsérer avec le nouveau folder_id
        table.delete(f"doc_id = '{doc_id}'")
        new_rows = []
        for _, row in rows.iterrows():
            new_rows.append({
                "id":          str(row["id"]),
                "doc_id":      doc_id,
                "folder_id":   new_folder_id,
                "service_id":  str(row["service_id"]),
                "user_id":     str(row["user_id"]),
                "filename":    str(row["filename"]),
                "content":     str(row["content"]),
                "chunk_index": int(row["chunk_index"]),
                "metadata":    str(row["metadata"]),
                "vector":      row["vector"].tolist() if hasattr(row["vector"], "tolist") else list(row["vector"]),
            })
        if new_rows:
            table.add(new_rows)
        print(f"[rag] move_document: {len(new_rows)} chunks déplacés vers {new_folder_id}")
        return len(new_rows)
    except Exception as e:
        print(f"[rag] move_document error: {e}")
        return 0


async def delete_folder(folder_id: str) -> int:
    """Supprime tous les chunks d'un dossier."""
    table  = get_table()
    before = table.count_rows()
    table.delete(f"folder_id = '{folder_id}'")
    after  = table.count_rows()
    return before - after

# ── Stats ──────────────────────────────────────────────────────────────────────
def get_stats() -> Dict[str, Any]:
    """Statistiques RAG pour l'AdminPanel."""
    try:
        table = get_table()
        total = table.count_rows()
        return {
            "backend":     "lancedb",
            "path":        str(LANCEDB_PATH),
            "chunks":      total,
            "status":      "ok",
            "embed_model": EMBED_MODEL,
        }
    except Exception as e:
        return {"backend": "lancedb", "status": "error", "error": str(e)}

# ── Format contexte pour prompt ───────────────────────────────────────────────
def format_chunks_for_context(chunks: List[Dict], max_chars: int = 4000) -> str:
    """Formate les chunks RAG pour injection dans un prompt LLM."""
    if not chunks:
        return ""
    parts = ["[CONTEXTE DOCUMENTAIRE]"]
    total = 0
    for c in chunks:
        block = f"\n--- {c['filename']} ---\n{c['content']}"
        if total + len(block) > max_chars:
            break
        parts.append(block)
        total += len(block)
    parts.append("[FIN CONTEXTE]")
    return "\n".join(parts)

# ── Compatibilité ancien code ─────────────────────────────────────────────────
def qdrant_available() -> bool:
    return False  # On utilise LanceDB

async def ingest_chunks(chunks, **kwargs) -> int:
    """Compatibilité avec l'ancien code (user_archiver)."""
    return 0

async def delete_user_chunks(user_id: str) -> int:
    """Compatibilité — supprime les chunks d'un user (via user_id)."""
    table  = get_table()
    before = table.count_rows()
    try:
        table.delete(f"user_id = '{user_id}'")
    except Exception:
        pass
    after = table.count_rows()
    return before - after
