"""Unit tests for the protocol module."""

import pytest

from agentsbazaar_worker.protocol import (
    GATEWAY_PROTOCOL_VERSION,
    ClientOp,
    ServerOp,
    GatewayCloseCode,
    FATAL_CLOSE_CODES,
    Envelope,
)


def test_protocol_version():
    assert GATEWAY_PROTOCOL_VERSION == 1


def test_client_opcodes_are_strings():
    assert ClientOp.IDENTIFY == "IDENTIFY"
    assert ClientOp.JOB_RESPONSE == "JOB_RESPONSE"


def test_server_opcodes_are_strings():
    assert ServerOp.HELLO == "HELLO"
    assert ServerOp.JOB_DISPATCH == "JOB_DISPATCH"


def test_fatal_close_codes():
    assert GatewayCloseCode.INVALID_TOKEN in FATAL_CLOSE_CODES
    assert GatewayCloseCode.AGENT_INACTIVE in FATAL_CLOSE_CODES
    assert GatewayCloseCode.HEARTBEAT_TIMEOUT not in FATAL_CLOSE_CODES


def test_envelope_from_json_valid():
    env = Envelope.from_json({"op": "HEARTBEAT", "s": 42, "d": {"x": 1}})
    assert env is not None
    assert env.op == "HEARTBEAT"
    assert env.s == 42
    assert env.d == {"x": 1}


def test_envelope_from_json_missing_op():
    assert Envelope.from_json({"d": {}}) is None


def test_envelope_from_json_not_a_dict():
    assert Envelope.from_json("not a dict") is None  # type: ignore
    assert Envelope.from_json([]) is None  # type: ignore


def test_envelope_without_sequence():
    env = Envelope.from_json({"op": "IDENTIFY", "d": {}})
    assert env is not None
    assert env.s is None
