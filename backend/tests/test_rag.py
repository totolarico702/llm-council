"""Tests RAG — score threshold, chunking, extraction."""
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

from backend.rag_store import chunk_text, _extract_text_sync


# ── Tests unitaires purs (pas de LanceDB) ────────────────────────────────────

def test_chunk_text_basic():
    text = " ".join(["word"] * 600)
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) >= 2
    for c in chunks:
        words = c.split()
        assert len(words) <= 500


def test_chunk_text_overlap():
    words = [str(i) for i in range(200)]
    text  = " ".join(words)
    chunks = chunk_text(text, chunk_size=100, overlap=20)
    # Le début du 2e chunk doit recouper la fin du 1er
    first_end  = chunks[0].split()[-20:]
    second_start = chunks[1].split()[:20]
    assert first_end == second_start


def test_chunk_text_small_input():
    text   = "short text"
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) == 1
    assert chunks[0] == "short text"


def test_extract_text_txt(tmp_path):
    f = tmp_path / "test.txt"
    f.write_text("Hello World", encoding="utf-8")
    result = _extract_text_sync(f, "test.txt")
    assert result == "Hello World"


def test_extract_text_md(tmp_path):
    f = tmp_path / "test.md"
    f.write_text("# Title\nContent here", encoding="utf-8")
    result = _extract_text_sync(f, "test.md")
    assert "Title" in result
    assert "Content here" in result


def test_extract_text_html(tmp_path):
    f = tmp_path / "test.html"
    f.write_text("<html><body><p>Hello HTML</p></body></html>", encoding="utf-8")
    result = _extract_text_sync(f, "test.html")
    assert "Hello HTML" in result


# ── Test score threshold ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_score_threshold():
    """Les résultats avec distance > (1 - threshold) doivent être filtrés."""
    mock_results = [
        {"content": "good", "filename": "a.txt", "doc_id": "1", "folder_id": "f",
         "service_id": "s", "_distance": 0.1, "chunk_index": 0},
        {"content": "bad",  "filename": "b.txt", "doc_id": "2", "folder_id": "f",
         "service_id": "s", "_distance": 0.9, "chunk_index": 0},
    ]

    async def mock_embed(text):
        return [0.0] * 1536

    mock_table = MagicMock()
    mock_table.search.return_value.limit.return_value.to_list.return_value = mock_results

    with patch("backend.rag_store.embed_text", side_effect=mock_embed):
        with patch("backend.rag_store.get_table", return_value=mock_table):
            from backend.rag_store import search
            # threshold=0.5 → max distance = 0.5 → seul "good" (dist=0.1) passe
            results = await search("query", score_threshold=0.5)
            assert len(results) == 1
            assert results[0]["content"] == "good"


@pytest.mark.asyncio
async def test_search_no_threshold():
    """Sans threshold (0.0), tous les résultats sont retournés."""
    mock_results = [
        {"content": "a", "filename": "a.txt", "doc_id": "1", "folder_id": "f",
         "service_id": "s", "_distance": 0.95, "chunk_index": 0},
        {"content": "b", "filename": "b.txt", "doc_id": "2", "folder_id": "f",
         "service_id": "s", "_distance": 0.05, "chunk_index": 0},
    ]

    async def mock_embed(text):
        return [0.0] * 1536

    mock_table = MagicMock()
    mock_table.search.return_value.limit.return_value.to_list.return_value = mock_results

    with patch("backend.rag_store.embed_text", side_effect=mock_embed):
        with patch("backend.rag_store.get_table", return_value=mock_table):
            from backend.rag_store import search
            results = await search("query", score_threshold=0.0)
            assert len(results) == 2
