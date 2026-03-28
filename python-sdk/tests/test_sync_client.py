"""Tests for the synchronous SyncAgentBazaarClient."""

import respx
from httpx import Response
from solders.keypair import Keypair  # type: ignore[import-untyped]

from agentsbazaar import SyncAgentBazaarClient, APIError

import pytest


@pytest.fixture
def client(keypair: Keypair, base_url: str) -> SyncAgentBazaarClient:
    return SyncAgentBazaarClient(base_url=base_url, keypair=keypair)


@respx.mock
def test_health(client: SyncAgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/health").mock(
        return_value=Response(200, json={"status": "ok", "timestamp": "2024-01-01"})
    )
    result = client.health()
    assert result["status"] == "ok"


@respx.mock
def test_stats(client: SyncAgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/stats").mock(
        return_value=Response(200, json={
            "total_agents": 5,
            "total_jobs": 100,
            "total_volume_usdc": "50000000",
            "platform_fees_usdc": "2500000",
            "job_counter": 100,
        })
    )
    stats = client.stats()
    assert stats.total_agents == 5


@respx.mock
def test_get_agent(client: SyncAgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/agents/abc").mock(
        return_value=Response(200, json={
            "pubkey": "abc",
            "authority": "def",
            "name": "TestAgent",
            "skills": "python",
            "price_per_request": "100000",
            "total_jobs_completed": "10",
            "total_earned": "1000000",
            "rating_sum": "0",
            "rating_count": "0",
            "active_disputes": 0,
            "is_active": True,
            "delivery_mode": "ws",
            "supports_quoting": False,
        })
    )
    agent = client.get_agent("abc")
    assert agent.name == "TestAgent"


@respx.mock
def test_call(client: SyncAgentBazaarClient, base_url: str) -> None:
    respx.post(f"{base_url}/call").mock(
        return_value=Response(200, json={
            "result": "Hello",
            "agent": {"name": "Test", "authority": "abc", "price": 0.05},
            "verification": {"score": 95, "passed": True, "action": "approve"},
            "job": {"id": 1, "status": "completed"},
            "meta": {"totalMs": 1000, "agentLatencyMs": 500},
        })
    )
    result = client.call(task="say hello")
    assert result.result == "Hello"


@respx.mock
def test_api_error(client: SyncAgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/agents/bad").mock(
        return_value=Response(404, json={"error": "Not found"})
    )
    with pytest.raises(APIError, match="Not found"):
        client.get_agent("bad")


@respx.mock
def test_context_manager(keypair: Keypair, base_url: str) -> None:
    respx.get(f"{base_url}/health").mock(
        return_value=Response(200, json={"status": "ok"})
    )
    with SyncAgentBazaarClient(base_url=base_url, keypair=keypair) as client:
        result = client.health()
        assert result["status"] == "ok"
