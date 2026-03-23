"""Tests d'authentification — login, token, refresh, change-password."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert data["user"]["login"] == "admin"
    assert data["user"]["role"] == "admin"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "wrong"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={"login": "nobody", "password": "pass"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_with_token(client: AsyncClient):
    login = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    token = login.json()["token"]
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["login"] == "admin"
    assert "password" not in r.json()


@pytest.mark.asyncio
async def test_me_without_token(client: AsyncClient):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    # Le refresh token est set dans un cookie httpOnly lors du login
    r = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    assert r.status_code == 200
    # Le cookie llmc_refresh doit être présent
    assert "llmc_refresh" in r.cookies or "llmc_token" in r.cookies


@pytest.mark.asyncio
async def test_must_change_password_flag(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    user = r.json()["user"]
    assert user.get("must_change_password") is True


@pytest.mark.asyncio
async def test_change_password(client: AsyncClient):
    login = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    token = login.json()["token"]
    r = await client.post(
        "/api/v1/auth/change-password",
        json={"new_password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    # Vérifier que le nouveau mot de passe fonctionne
    r2 = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "newpass123"})
    assert r2.status_code == 200
    assert r2.json()["user"].get("must_change_password") is False


@pytest.mark.asyncio
async def test_change_password_too_short(client: AsyncClient):
    login = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    token = login.json()["token"]
    r = await client.post(
        "/api/v1/auth/change-password",
        json={"new_password": "abc"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_logout(client: AsyncClient):
    r = await client.post("/api/v1/auth/logout")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_token_invalid(client: AsyncClient):
    r = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
    assert r.status_code == 401
