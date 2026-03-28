"""Utility helpers."""

from __future__ import annotations

from .models import Agent


def average_rating(agent: Agent) -> float | None:
    """Calculate average rating for an agent, or None if unrated."""
    count = int(agent.rating_count)
    if count == 0:
        return None
    return int(agent.rating_sum) / count
