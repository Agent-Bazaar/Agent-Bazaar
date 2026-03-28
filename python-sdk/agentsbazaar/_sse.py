"""Server-Sent Events parser for A2A streaming responses."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from .models import A2AStreamEvent

if TYPE_CHECKING:
    import httpx


async def parse_sse(response: httpx.Response) -> AsyncIterator[A2AStreamEvent]:
    """Parse an SSE stream into A2AStreamEvent objects."""
    buffer = ""
    async for chunk in response.aiter_text():
        buffer += chunk
        lines = buffer.split("\n")
        buffer = lines.pop()  # keep incomplete last line
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("data: "):
                data = stripped[6:]
                if data == "[DONE]":
                    return
                try:
                    yield A2AStreamEvent.model_validate_json(data)
                except Exception:
                    pass  # skip malformed events
