"""Wallet signing and keypair loading for AgentBazaar API authentication."""

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path
from typing import TypedDict

from solders.keypair import Keypair  # type: ignore[import-untyped]


class AuthHeaders(TypedDict):
    """Headers required for wallet-authenticated API requests."""

    X_Wallet_Address: str
    X_Wallet_Signature: str
    X_Wallet_Message: str


def sign_message(keypair: Keypair, action: str) -> dict[str, str]:
    """Sign an authentication message matching the TypeScript SDK format.

    Returns a dict with header names ready for HTTP requests.
    """
    timestamp = int(time.time() * 1000)
    message = f"agentbazaar:{action}:{timestamp}"
    message_bytes = message.encode("utf-8")
    signature = keypair.sign_message(message_bytes)
    signature_b64 = base64.b64encode(bytes(signature)).decode("ascii")

    return {
        "X-Wallet-Address": str(keypair.pubkey()),
        "X-Wallet-Signature": signature_b64,
        "X-Wallet-Message": message,
    }


def load_keypair(
    path: str | None = None,
    private_key: str | None = None,
) -> Keypair:
    """Load a Solana keypair from various sources.

    Priority:
    1. ``private_key`` argument (base58 string or JSON byte array)
    2. ``path`` argument (path to JSON file)
    3. ``SOLANA_PRIVATE_KEY`` env var (base58 or JSON array)
    4. ``ANCHOR_WALLET`` env var (path to JSON file)
    5. ``~/.config/solana/id.json`` (default Solana CLI keypair)
    """
    # Direct private key
    if private_key:
        return _parse_key(private_key)

    # Explicit path
    if path:
        return _load_from_file(path)

    # Environment variables
    env_key = os.environ.get("SOLANA_PRIVATE_KEY")
    if env_key:
        return _parse_key(env_key)

    anchor_path = os.environ.get("ANCHOR_WALLET")
    if anchor_path:
        return _load_from_file(anchor_path)

    # Default Solana CLI location
    default_path = Path.home() / ".config" / "solana" / "id.json"
    if default_path.exists():
        return _load_from_file(str(default_path))

    raise FileNotFoundError(
        "No Solana keypair found. Provide a private key, set SOLANA_PRIVATE_KEY, "
        "or create one with `solana-keygen new`."
    )


def _parse_key(raw: str) -> Keypair:
    """Parse a private key from base58 string or JSON byte array."""
    raw = raw.strip()
    if raw.startswith("["):
        byte_array = json.loads(raw)
        return Keypair.from_bytes(bytes(byte_array))
    return Keypair.from_base58_string(raw)


def _load_from_file(path: str) -> Keypair:
    """Load a keypair from a JSON file (Solana CLI format: array of bytes)."""
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, list):
        return Keypair.from_bytes(bytes(data))
    raise ValueError(f"Unsupported keypair file format at {path}")
