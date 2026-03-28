"""Tests for the async AgentBazaarClient."""

import pytest
import respx
from httpx import Response
from solders.keypair import Keypair  # type: ignore[import-untyped]

from agentsbazaar import AgentBazaarClient, APIError


@pytest.fixture
def client(keypair: Keypair, base_url: str) -> AgentBazaarClient:
    return AgentBazaarClient(base_url=base_url, keypair=keypair)


@respx.mock
@pytest.mark.asyncio
async def test_health(client: AgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/health").mock(
        return_value=Response(200, json={"status": "ok", "timestamp": "2024-01-01"})
    )
    result = await client.health()
    assert result["status"] == "ok"


@respx.mock
@pytest.mark.asyncio
async def test_stats(client: AgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/stats").mock(
        return_value=Response(200, json={
            "total_agents": 5,
            "total_jobs": 100,
            "total_volume_usdc": "50000000",
            "platform_fees_usdc": "2500000",
            "job_counter": 100,
        })
    )
    stats = await client.stats()
    assert stats.total_agents == 5
    assert stats.total_jobs == 100


@respx.mock
@pytest.mark.asyncio
async def test_list_agents(client: AgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/agents").mock(
        return_value=Response(200, json={
            "agents": [{
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
            }],
            "pagination": {"page": 1, "limit": 20, "total": 1, "pages": 1},
        })
    )
    result = await client.list_agents()
    assert len(result["agents"]) == 1
    assert result["agents"][0]["name"] == "TestAgent"


@respx.mock
@pytest.mark.asyncio
async def test_get_agent(client: AgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/agents/abc123").mock(
        return_value=Response(200, json={
            "pubkey": "abc123",
            "authority": "def456",
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
    agent = await client.get_agent("abc123")
    assert agent.pubkey == "abc123"
    assert agent.name == "TestAgent"


@respx.mock
@pytest.mark.asyncio
async def test_call(client: AgentBazaarClient, base_url: str) -> None:
    respx.post(f"{base_url}/call").mock(
        return_value=Response(200, json={
            "result": "Hello world",
            "agent": {"name": "TestAgent", "authority": "abc", "price": 0.05},
            "verification": {"score": 95, "passed": True, "action": "approve"},
            "job": {"id": 1, "status": "completed"},
            "meta": {"totalMs": 1200, "agentLatencyMs": 800},
        })
    )
    result = await client.call(task="say hello")
    assert result.result == "Hello world"
    assert result.agent.price == 0.05
    assert result.verification.passed is True


@respx.mock
@pytest.mark.asyncio
async def test_quote(client: AgentBazaarClient, base_url: str) -> None:
    respx.post(f"{base_url}/quote").mock(
        return_value=Response(200, json={
            "quoteId": "q-123",
            "agent": {"name": "Test", "authority": "abc"},
            "price": 0.10,
            "priceUsdc": 0.10,
            "source": "static",
            "expiresAt": "2024-12-31",
        })
    )
    result = await client.quote(task="test task")
    assert result.quote_id == "q-123"
    assert result.source == "static"


@respx.mock
@pytest.mark.asyncio
async def test_api_error(client: AgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/agents/nonexistent").mock(
        return_value=Response(404, json={"error": "Agent not found"})
    )
    with pytest.raises(APIError, match="Agent not found"):
        await client.get_agent("nonexistent")


@respx.mock
@pytest.mark.asyncio
async def test_register_requires_keypair(base_url: str) -> None:
    client = AgentBazaarClient(base_url=base_url)  # No keypair
    from agentsbazaar import AuthenticationError
    with pytest.raises(AuthenticationError):
        await client.register(name="Test", skills="test", price_per_request=0.05)


@respx.mock
@pytest.mark.asyncio
async def test_register(client: AgentBazaarClient, base_url: str) -> None:
    respx.post(f"{base_url}/agents/register").mock(
        return_value=Response(200, json={
            "agent": {
                "pubkey": "abc",
                "authority": "def",
                "name": "NewAgent",
                "skills": "test",
            },
            "message": "Agent registered",
        })
    )
    result = await client.register(name="NewAgent", skills="test", price_per_request=0.05)
    assert result.agent.name == "NewAgent"
    assert result.message == "Agent registered"


@respx.mock
@pytest.mark.asyncio
async def test_start_session(client: AgentBazaarClient, base_url: str) -> None:
    respx.post(f"{base_url}/chat/start").mock(
        return_value=Response(200, json={
            "sessionId": "sess-1",
            "agent": {"name": "Test", "price": 0.05, "priceUsdc": 0.05},
        })
    )
    result = await client.start_session("abc123")
    assert result["sessionId"] == "sess-1"


@respx.mock
@pytest.mark.asyncio
async def test_a2a_send(client: AgentBazaarClient, base_url: str) -> None:
    respx.post(f"{base_url}/a2a/test-agent/").mock(
        return_value=Response(200, json={
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "id": "task-1",
                "status": {"state": "completed"},
                "artifacts": [{"parts": [{"type": "text", "text": "Done"}]}],
                "final": True,
            },
        })
    )
    result = await client.a2a_send("test-agent", "hello")
    assert result.result is not None
    assert result.result.status.state == "completed"


@respx.mock
@pytest.mark.asyncio
async def test_discover(client: AgentBazaarClient, base_url: str) -> None:
    respx.get(f"{base_url}/discover?skills=python").mock(
        return_value=Response(200, json=[
            {"pubkey": "abc", "authority": "def", "name": "PyAgent", "skills": "python"},
        ])
    )
    agents = await client.discover("python")
    assert len(agents) == 1
    assert agents[0].name == "PyAgent"


@respx.mock
@pytest.mark.asyncio
async def test_hire(client: AgentBazaarClient, base_url: str) -> None:
    respx.post(f"{base_url}/jobs/hire").mock(
        return_value=Response(200, json={
            "result": "Task done",
            "verification": {"score": 85, "passed": True, "action": "approve"},
            "job": {"id": "42", "status": "completed"},
        })
    )
    result = await client.hire(job_id=42, task="do something")
    assert result.result == "Task done"
    assert result.verification.score == 85


@respx.mock
@pytest.mark.asyncio
async def test_context_manager(keypair: Keypair, base_url: str) -> None:
    respx.get(f"{base_url}/health").mock(
        return_value=Response(200, json={"status": "ok"})
    )
    async with AgentBazaarClient(base_url=base_url, keypair=keypair) as client:
        result = await client.health()
        assert result["status"] == "ok"


@respx.mock
@pytest.mark.asyncio
async def test_auth_headers_sent(client: AgentBazaarClient, base_url: str) -> None:
    route = respx.post(f"{base_url}/chat/start").mock(
        return_value=Response(200, json={"sessionId": "s1", "agent": {"name": "T", "price": 0, "priceUsdc": 0}})
    )
    await client.start_session("abc")
    req = route.calls[0].request
    assert "X-Wallet-Address" in req.headers
    assert "X-Wallet-Signature" in req.headers
    assert "X-Wallet-Message" in req.headers
    assert req.headers["X-Wallet-Message"].startswith("agentbazaar:chat:")
