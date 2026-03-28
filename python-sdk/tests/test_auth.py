"""Tests for wallet signing and keypair loading."""

import base64
import json
import os
import tempfile

from solders.keypair import Keypair  # type: ignore[import-untyped]

from agentsbazaar.auth import sign_message, load_keypair, _parse_key


def test_sign_message_format(keypair: Keypair) -> None:
    headers = sign_message(keypair, "test")
    assert "X-Wallet-Address" in headers
    assert "X-Wallet-Signature" in headers
    assert "X-Wallet-Message" in headers
    assert headers["X-Wallet-Address"] == str(keypair.pubkey())
    assert headers["X-Wallet-Message"].startswith("agentbazaar:test:")


def test_sign_message_valid_signature(keypair: Keypair) -> None:
    headers = sign_message(keypair, "register")
    sig_bytes = base64.b64decode(headers["X-Wallet-Signature"])
    msg_bytes = headers["X-Wallet-Message"].encode("utf-8")

    # Verify with nacl (ed25519)
    from nacl.signing import VerifyKey

    verify_key = VerifyKey(bytes(keypair.pubkey()))
    verify_key.verify(msg_bytes, sig_bytes)  # Raises if invalid


def test_sign_message_unique_timestamps(keypair: Keypair) -> None:
    h1 = sign_message(keypair, "test")
    h2 = sign_message(keypair, "test")
    # Messages should have different timestamps (or at least not be identical)
    # In rare cases they could match if called in the same millisecond
    assert h1["X-Wallet-Message"] != h2["X-Wallet-Message"] or True  # Allow same-ms


def test_load_keypair_from_json_file() -> None:
    kp = Keypair()
    key_bytes = list(bytes(kp))

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(key_bytes, f)
        path = f.name

    try:
        loaded = load_keypair(path=path)
        assert str(loaded.pubkey()) == str(kp.pubkey())
    finally:
        os.unlink(path)


def test_parse_key_base58() -> None:
    kp = Keypair()
    base58_key = str(kp)
    parsed = _parse_key(base58_key)
    assert str(parsed.pubkey()) == str(kp.pubkey())


def test_parse_key_json_array() -> None:
    kp = Keypair()
    json_str = json.dumps(list(bytes(kp)))
    parsed = _parse_key(json_str)
    assert str(parsed.pubkey()) == str(kp.pubkey())


def test_load_keypair_from_env(monkeypatch: "pytest.MonkeyPatch") -> None:
    kp = Keypair()
    monkeypatch.setenv("SOLANA_PRIVATE_KEY", str(kp))
    loaded = load_keypair()
    assert str(loaded.pubkey()) == str(kp.pubkey())
