"""
conftest.py — Fixtures partagées pour les tests LLM Council.
"""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

# ── Fixtures DB en mémoire ─────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def use_tmp_db(tmp_path, monkeypatch):
    """Redirige DATA_DIR vers un répertoire temporaire pour chaque test."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # Forcer le rechargement du module db avec le nouveau DATA_DIR
    import importlib
    import backend.db as db_module
    db_module.DATA_DIR = tmp_path
    db_module.DB_PATH  = tmp_path / "db.json"
    db_module._db      = db_module._open_db()
    db_module.init_default_admin()
    yield


@pytest.fixture(autouse=True)
def disable_rate_limit(monkeypatch):
    """Désactive le rate limiter pour tous les tests."""
    from backend.main import _limiter

    def _no_limit(request, endpoint_func=None, in_middleware=True):
        request.state.view_rate_limit = None

    monkeypatch.setattr(_limiter, "_check_request_limit", _no_limit)


@pytest.fixture
def app():
    """Retourne l'application FastAPI."""
    from backend.main import app as _app
    return _app


@pytest_asyncio.fixture
async def client(app):
    """Client HTTP AsyncClient pour les tests."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def admin_token(client):
    """Retourne le token JWT d'un admin de test (via cookie httpOnly)."""
    r = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    # Préférer le cookie httpOnly; fallback sur le corps JSON pour la compat Bearer
    return client.cookies.get("llmc_token") or r.json()["token"]


@pytest.fixture
def mock_openrouter():
    """Mock les appels OpenRouter pour éviter les appels réseau."""
    with patch("backend.openrouter.query_model", new_callable=AsyncMock) as mock:
        mock.return_value = {"content": "Mocked response", "usage": {}}
        yield mock
