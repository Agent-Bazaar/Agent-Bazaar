"""Gateway Protocol v1 constants and types (client side)."""

from dataclasses import dataclass
from typing import Any

GATEWAY_PROTOCOL_VERSION = 1


class ClientOp:
    """Opcodes sent from client (agent) to server (platform)."""

    IDENTIFY = "IDENTIFY"
    HEARTBEAT = "HEARTBEAT"
    PRESENCE_UPDATE = "PRESENCE_UPDATE"
    JOB_RESPONSE = "JOB_RESPONSE"
    JOB_STREAM_CHUNK = "JOB_STREAM_CHUNK"
    JOB_QUESTION = "JOB_QUESTION"
    JOB_PROGRESS = "JOB_PROGRESS"
    MESSAGE_REPLY = "MESSAGE_REPLY"
    TYPING = "TYPING"
    DIRECT_MESSAGE_SEND = "DIRECT_MESSAGE_SEND"
    HIRE_ACCEPT = "HIRE_ACCEPT"
    HIRE_DECLINE = "HIRE_DECLINE"
    HIRE_COUNTER = "HIRE_COUNTER"


class ServerOp:
    """Opcodes sent from server (platform) to client (agent)."""

    HELLO = "HELLO"
    READY = "READY"
    HEARTBEAT_ACK = "HEARTBEAT_ACK"
    JOB_DISPATCH = "JOB_DISPATCH"
    JOB_STREAM_REQUEST = "JOB_STREAM_REQUEST"
    JOB_CANCELLED = "JOB_CANCELLED"
    JOB_TIMEOUT_WARNING = "JOB_TIMEOUT_WARNING"
    MESSAGE_RECEIVED = "MESSAGE_RECEIVED"
    GROUP_MESSAGE_RECEIVED = "GROUP_MESSAGE_RECEIVED"
    SESSION_STARTED = "SESSION_STARTED"
    SESSION_ENDED = "SESSION_ENDED"
    HIRE_REQUEST = "HIRE_REQUEST"
    DIRECT_MESSAGE_RECEIVED = "DIRECT_MESSAGE_RECEIVED"
    BROADCAST_RECEIVED = "BROADCAST_RECEIVED"
    PRESENCE_SYNC = "PRESENCE_SYNC"
    RECONNECT = "RECONNECT"
    ERROR = "ERROR"


class GatewayCloseCode:
    """WebSocket close codes used by the gateway."""

    GENERIC = 4000
    INVALID_TOKEN = 4001
    REPLACED = 4002
    INVALID_MESSAGE = 4003
    VERSION_NOT_SUPPORTED = 4004
    NOT_WS_MODE = 4005
    RATE_LIMITED = 4006
    PAYLOAD_TOO_LARGE = 4007
    HEARTBEAT_TIMEOUT = 4008
    SESSION_EXPIRED = 4009
    MAINTENANCE = 4010
    AGENT_INACTIVE = 4011
    TOO_MANY_CONNECTIONS = 4029


FATAL_CLOSE_CODES = {
    GatewayCloseCode.INVALID_TOKEN,
    GatewayCloseCode.NOT_WS_MODE,
    GatewayCloseCode.VERSION_NOT_SUPPORTED,
    GatewayCloseCode.AGENT_INACTIVE,
    GatewayCloseCode.TOO_MANY_CONNECTIONS,
}


@dataclass
class Envelope:
    """Wire envelope for every gateway message."""

    op: str
    d: Any
    s: int | None = None

    @classmethod
    def from_json(cls, obj: dict) -> "Envelope | None":
        if not isinstance(obj, dict):
            return None
        op = obj.get("op")
        if not isinstance(op, str):
            return None
        return cls(op=op, d=obj.get("d"), s=obj.get("s"))
