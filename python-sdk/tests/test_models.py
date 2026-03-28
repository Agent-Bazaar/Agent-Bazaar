"""Tests for Pydantic model serialization/deserialization."""

from agentsbazaar.models import (
    Agent,
    CallResult,
    PlatformStats,
    QuoteResponse,
    SessionInfo,
    TrustData,
    A2ATaskResult,
    RegisterResult,
    HireResult,
)
from agentsbazaar._utils import average_rating


def test_agent_from_api_response() -> None:
    data = {
        "pubkey": "abc123",
        "authority": "def456",
        "name": "TestAgent",
        "description": "A test agent",
        "skills": "python,testing",
        "endpoint": "https://example.com",
        "price_per_request": "100000",
        "total_jobs_completed": "42",
        "total_earned": "5000000",
        "rating_sum": "20",
        "rating_count": "5",
        "active_disputes": 0,
        "is_active": True,
        "nft_8004": None,
        "token_id_8004": None,
        "image_url": "https://example.com/img.png",
        "delivery_mode": "ws",
        "slug": "test-agent",
        "supports_quoting": True,
        "created_at": "2024-01-01",
        "updated_at": "2024-06-01",
    }
    agent = Agent.model_validate(data)
    assert agent.name == "TestAgent"
    assert agent.supports_quoting is True
    assert agent.delivery_mode == "ws"


def test_average_rating_with_reviews() -> None:
    agent = Agent(pubkey="a", authority="b", name="Test", rating_sum="20", rating_count="5")
    assert average_rating(agent) == 4.0


def test_average_rating_no_reviews() -> None:
    agent = Agent(pubkey="a", authority="b", name="Test", rating_sum="0", rating_count="0")
    assert average_rating(agent) is None


def test_platform_stats() -> None:
    data = {
        "total_agents": 10,
        "total_jobs": 100,
        "total_volume_usdc": "50000000",
        "platform_fees_usdc": "2500000",
        "job_counter": 100,
    }
    stats = PlatformStats.model_validate(data)
    assert stats.total_agents == 10
    assert stats.total_volume_usdc == "50000000"


def test_quote_response_camel_case() -> None:
    data = {
        "quoteId": "q-123",
        "agent": {"name": "Test", "authority": "abc"},
        "price": 0.05,
        "priceUsdc": 0.05,
        "source": "static",
        "expiresAt": "2024-12-31",
    }
    quote = QuoteResponse.model_validate(data)
    assert quote.quote_id == "q-123"
    assert quote.price_usdc == 0.05
    assert quote.expires_at == "2024-12-31"


def test_session_info() -> None:
    data = {
        "id": "sess-1",
        "buyer": "wallet1",
        "agent_auth": "wallet2",
        "status": "active",
        "budget_limit": "1000000",
        "total_spent": "500000",
        "message_count": 3,
        "created_at": "2024-01-01",
        "updated_at": "2024-01-01",
        "expires_at": "2024-01-08",
    }
    session = SessionInfo.model_validate(data)
    assert session.status == "active"
    assert session.message_count == 3


def test_trust_data_camel_case() -> None:
    data = {
        "trustTier": 3,
        "tierName": "Gold",
        "quality": 0.95,
        "confidence": 0.8,
        "risk": 0.1,
        "diversity": 0.7,
        "verifiedFeedbackCount": 12,
    }
    trust = TrustData.model_validate(data)
    assert trust.trust_tier == 3
    assert trust.tier_name == "Gold"
    assert trust.verified_feedback_count == 12


def test_a2a_task_result() -> None:
    data = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "id": "task-1",
            "status": {"state": "completed"},
            "artifacts": [{"parts": [{"type": "text", "text": "Hello"}]}],
            "final": True,
        },
    }
    result = A2ATaskResult.model_validate(data)
    assert result.result is not None
    assert result.result.status.state == "completed"
    assert result.result.artifacts[0].parts[0].text == "Hello"


def test_call_result_camel_case() -> None:
    data = {
        "result": "done",
        "agent": {"name": "Test", "authority": "abc", "price": 0.05},
        "verification": {"score": 95, "passed": True, "action": "approve"},
        "job": {"id": 1, "status": "completed"},
        "sessionId": "sess-1",
        "meta": {"totalMs": 1200, "agentLatencyMs": 800},
    }
    result = CallResult.model_validate(data)
    assert result.session_id == "sess-1"
    assert result.meta.total_ms == 1200


def test_register_result() -> None:
    data = {
        "agent": {
            "pubkey": "abc",
            "authority": "def",
            "name": "New",
            "skills": "test",
        },
        "message": "Agent registered",
        "a2aCard": "https://agentbazaar.dev/a2a/new/.well-known/agent.json",
    }
    result = RegisterResult.model_validate(data)
    assert result.a2a_card is not None
    assert "agent.json" in result.a2a_card


def test_hire_result() -> None:
    data = {
        "result": "Task completed",
        "verification": {"score": 90, "passed": True, "action": "approve"},
        "job": {"id": "42", "status": "completed"},
    }
    result = HireResult.model_validate(data)
    assert result.result == "Task completed"
    assert result.verification.passed is True
