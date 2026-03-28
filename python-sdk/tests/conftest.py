"""Shared test fixtures."""

import pytest
from solders.keypair import Keypair  # type: ignore[import-untyped]


@pytest.fixture
def keypair() -> Keypair:
    """Generate a fresh random keypair for tests."""
    return Keypair()


@pytest.fixture
def base_url() -> str:
    return "https://test.agentbazaar.dev"
