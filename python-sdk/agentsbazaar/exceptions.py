"""AgentBazaar SDK exceptions."""

from __future__ import annotations


class AgentBazaarError(Exception):
    """Base exception for all SDK errors."""


class AuthenticationError(AgentBazaarError):
    """Raised when a keypair or API key is required but not provided."""


class APIError(AgentBazaarError):
    """Raised when the API returns a non-2xx response."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
