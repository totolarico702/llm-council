"""Tests CRUD utilisateurs et permissions."""
import pytest
from httpx import AsyncClient


async def _admin_headers(client: AsyncClient) -> dict:
    r = await client.post("/api/v1/auth/login", json={"login": "admin", "password": "admin"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.mark.asyncio
async def test_list_users_admin(client: AsyncClient):
    headers = await _admin_headers(client)
    r = await client.get("/api/v1/admin/users", headers=headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert any(u["login"] == "admin" for u in r.json())


@pytest.mark.asyncio
async def test_list_users_requires_admin(client: AsyncClient):
    r = await client.get("/api/v1/admin/users")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_user(client: AsyncClient):
    headers = await _admin_headers(client)
    r = await client.post(
        "/api/v1/admin/users",
        json={"login": "testuser", "password": "pass123", "role": "user"},
        headers=headers,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["login"] == "testuser"
    assert "password" not in data


@pytest.mark.asyncio
async def test_create_duplicate_user(client: AsyncClient):
    headers = await _admin_headers(client)
    await client.post(
        "/api/v1/admin/users",
        json={"login": "dup", "password": "pass", "role": "user"},
        headers=headers,
    )
    r = await client.post(
        "/api/v1/admin/users",
        json={"login": "dup", "password": "pass", "role": "user"},
        headers=headers,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_update_user(client: AsyncClient):
    headers = await _admin_headers(client)
    create = await client.post(
        "/api/v1/admin/users",
        json={"login": "upd_user", "password": "pass", "role": "user"},
        headers=headers,
    )
    uid = create.json()["id"]
    r = await client.patch(
        f"/api/v1/admin/users/{uid}",
        json={"login": "upd_user_renamed"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["login"] == "upd_user_renamed"


@pytest.mark.asyncio
async def test_delete_user(client: AsyncClient):
    headers = await _admin_headers(client)
    create = await client.post(
        "/api/v1/admin/users",
        json={"login": "del_user", "password": "pass", "role": "user"},
        headers=headers,
    )
    uid = create.json()["id"]
    r = await client.delete(f"/api/v1/admin/users/{uid}", headers=headers)
    assert r.status_code == 204
    users = await client.get("/api/v1/admin/users", headers=headers)
    assert not any(u["id"] == uid for u in users.json())


@pytest.mark.asyncio
async def test_user_isolation(client: AsyncClient):
    """Un user non-admin ne peut pas accéder à /admin/users."""
    headers = await _admin_headers(client)
    await client.post(
        "/api/v1/admin/users",
        json={"login": "regular", "password": "pass123", "role": "user"},
        headers=headers,
    )
    r = await client.post("/api/v1/auth/login", json={"login": "regular", "password": "pass123"})
    user_token = r.json()["token"]
    r2 = await client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert r2.status_code == 403
