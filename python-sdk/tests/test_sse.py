"""Tests for SSE stream parsing."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from agentsbazaar._sse import parse_sse


class MockResponse:
    """Mock httpx response with aiter_text."""

    def __init__(self, chunks: list[str]) -> None:
        self._chunks = chunks

    async def aiter_text(self):
        for chunk in self._chunks:
            yield chunk


@pytest.mark.asyncio
async def test_parse_single_event() -> None:
    resp = MockResponse(['data: {"jsonrpc":"2.0","id":1,"result":{"id":"t1","status":{"state":"completed"},"final":true}}\n'])
    events = [e async for e in parse_sse(resp)]
    assert len(events) == 1
    assert events[0].result is not None
    assert events[0].result.status.state == "completed"


@pytest.mark.asyncio
async def test_parse_multiple_events() -> None:
    resp = MockResponse([
        'data: {"jsonrpc":"2.0","id":1,"result":{"id":"t1","status":{"state":"working"}}}\n',
        'data: {"jsonrpc":"2.0","id":1,"result":{"id":"t1","status":{"state":"completed"},"final":true}}\n',
    ])
    events = [e async for e in parse_sse(resp)]
    assert len(events) == 2
    assert events[0].result.status.state == "working"
    assert events[1].result.status.state == "completed"


@pytest.mark.asyncio
async def test_parse_done_signal() -> None:
    resp = MockResponse([
        'data: {"jsonrpc":"2.0","id":1,"result":{"id":"t1","status":{"state":"completed"}}}\n',
        'data: [DONE]\n',
        'data: {"jsonrpc":"2.0","id":1,"result":{"id":"t2","status":{"state":"completed"}}}\n',
    ])
    events = [e async for e in parse_sse(resp)]
    assert len(events) == 1  # Stops at [DONE]


@pytest.mark.asyncio
async def test_parse_malformed_skipped() -> None:
    resp = MockResponse([
        'data: not-json\n',
        'data: {"jsonrpc":"2.0","id":1,"result":{"id":"t1","status":{"state":"done"}}}\n',
    ])
    events = [e async for e in parse_sse(resp)]
    assert len(events) == 1  # Skips malformed


@pytest.mark.asyncio
async def test_parse_chunked_data() -> None:
    resp = MockResponse([
        'data: {"jsonrpc":"2.0","id":1,',  # partial
        '"result":{"id":"t1","status":{"state":"done"}}}\n',
    ])
    events = [e async for e in parse_sse(resp)]
    assert len(events) == 1
