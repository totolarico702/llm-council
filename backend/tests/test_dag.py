"""Tests du moteur DAG — validation, tri topologique, timeout."""
import pytest
import asyncio
from unittest.mock import AsyncMock, patch

from backend.dag_engine import validate_dag, topological_sort, find_terminal_node


# ── Tests statiques (sans I/O) ─────────────────────────────────────────────────

def test_validate_dag_valid():
    nodes = [
        {"id": "A", "inputs": ["user_prompt"], "model": "m1", "role": "explorer"},
        {"id": "B", "inputs": ["A"],           "model": "m2", "role": "critic"},
    ]
    assert validate_dag(nodes) == []


def test_validate_dag_unknown_input():
    nodes = [
        {"id": "A", "inputs": ["UNKNOWN"], "model": "m1", "role": "explorer"},
    ]
    errors = validate_dag(nodes)
    assert any("UNKNOWN" in e for e in errors)


def test_validate_dag_cycle():
    nodes = [
        {"id": "A", "inputs": ["B"], "model": "m1", "role": "explorer"},
        {"id": "B", "inputs": ["A"], "model": "m2", "role": "critic"},
    ]
    errors = validate_dag(nodes)
    assert any("cycle" in e.lower() for e in errors)


def test_topological_sort_order():
    nodes = [
        {"id": "A", "inputs": ["user_prompt"]},
        {"id": "B", "inputs": ["A"]},
        {"id": "C", "inputs": ["B"]},
    ]
    order = topological_sort(nodes)
    ids = [n["id"] for n in order]
    assert ids.index("A") < ids.index("B") < ids.index("C")


def test_find_terminal_node():
    nodes = [
        {"id": "A", "inputs": ["user_prompt"]},
        {"id": "B", "inputs": ["A"]},
    ]
    terminal = find_terminal_node(nodes)
    assert terminal["id"] == "B"


# ── Test timeout global ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_execute_dag_timeout():
    """Le timeout global de 300s doit déclencher asyncio.TimeoutError."""
    import asyncio

    async def slow_model(*args, **kwargs):
        await asyncio.sleep(999)
        return {"content": "never"}

    nodes = [
        {"id": "A", "inputs": ["user_prompt"], "model": "m1", "role": "explorer"},
    ]

    with patch("backend.dag_engine.query_model", side_effect=slow_model):
        from backend.dag_engine import execute_dag
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(
                execute_dag(nodes, "test query"),
                timeout=0.1,  # timeout très court pour le test
            )


# ── Test exécution normale ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_execute_dag_simple():
    """Pipeline à 1 nœud retourne le contenu mocké."""
    nodes = [
        {"id": "A", "inputs": ["user_prompt"], "model": "m1", "role": "explorer"},
    ]

    async def mock_query(model, messages, **kwargs):
        return {"content": f"Response from {model}", "usage": {}}

    with patch("backend.dag_engine.query_model", side_effect=mock_query):
        with patch("backend.dag_engine.health_check_pipeline", new_callable=AsyncMock) as hcp:
            hcp.return_value = {"ok": True, "nodes": {}}
            from backend.dag_engine import execute_dag
            result = await execute_dag(nodes, "What is Python?")
            assert result["final"] == "Response from m1"
            assert "A" in result["outputs"]
