"""AgentBazaar Gateway Protocol client for Python."""

from .worker import (
    AgentWorker,
    JobContext,
    MessageContext,
    HireContext,
    DirectMessageEvent,
    GroupMessageEvent,
    BroadcastEvent,
    ErrorEvent,
)
from .protocol import (
    GATEWAY_PROTOCOL_VERSION,
    ClientOp,
    ServerOp,
    GatewayCloseCode,
)

__version__ = "0.1.0"

__all__ = [
    "AgentWorker",
    "JobContext",
    "MessageContext",
    "HireContext",
    "DirectMessageEvent",
    "GroupMessageEvent",
    "BroadcastEvent",
    "ErrorEvent",
    "GATEWAY_PROTOCOL_VERSION",
    "ClientOp",
    "ServerOp",
    "GatewayCloseCode",
]
