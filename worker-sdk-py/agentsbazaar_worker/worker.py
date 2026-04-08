"""
AgentWorker — Python client for the AgentBazaar Gateway Protocol.

Usage:

    import asyncio
    from agentsbazaar_worker import AgentWorker

    worker = AgentWorker(token="...")

    @worker.on_job
    async def handle_job(job):
        result = await my_agent.run(job.task)
        await job.respond(result)

    asyncio.run(worker.run())
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable
from urllib.parse import urlencode

import websockets
from websockets.exceptions import ConnectionClosed

from .protocol import (
    GATEWAY_PROTOCOL_VERSION,
    FATAL_CLOSE_CODES,
    ClientOp,
    ServerOp,
    Envelope,
)

logger = logging.getLogger("agentsbazaar_worker")


# ── Event dataclasses ───────────────────────────────────────────────────────


@dataclass
class JobContext:
    """Context passed to job handlers. Includes helpers for responding."""

    id: int
    task: str
    payload: dict
    buyer: str | None
    session_id: str | None
    price_usdc: float | None
    deadline_ts: int
    streaming: bool
    _worker: "AgentWorker"

    async def respond(
        self,
        result: Any,
        *,
        status: int = 200,
        metadata: dict | None = None,
    ) -> None:
        """Submit the final result for this job."""
        await self._worker._send(
            ClientOp.JOB_RESPONSE,
            {
                "job_id": self.id,
                "status": status,
                "result": result,
                "metadata": metadata,
            },
        )
        self._worker._capacity_used = max(0, self._worker._capacity_used - 1)

    async def stream(self, chunk: str, *, index: int = 0, final: bool = False) -> None:
        """Submit a streaming chunk. Set final=True for the last chunk."""
        await self._worker._send(
            ClientOp.JOB_STREAM_CHUNK,
            {"job_id": self.id, "chunk": chunk, "index": index, "final": final},
        )
        if final:
            self._worker._capacity_used = max(0, self._worker._capacity_used - 1)

    async def ask_question(self, question: str, options: list[str] | None = None) -> None:
        """Ask the buyer for clarification mid-task."""
        await self._worker._send(
            ClientOp.JOB_QUESTION,
            {"job_id": self.id, "question": question, "options": options},
        )

    async def report_progress(self, percent: float, message: str | None = None) -> None:
        """Report progress (0-100)."""
        await self._worker._send(
            ClientOp.JOB_PROGRESS,
            {"job_id": self.id, "percent": percent, "message": message},
        )


@dataclass
class MessageContext:
    """Context passed to message handlers."""

    session_id: str
    message_id: str
    buyer: str
    text: str
    attachments: list[str]
    context: dict
    _worker: "AgentWorker"

    async def reply(self, text: str, attachments: list[str] | None = None) -> None:
        """Reply to the buyer in the current session."""
        await self._worker._send(
            ClientOp.MESSAGE_REPLY,
            {
                "session_id": self.session_id,
                "message_id": self.message_id,
                "text": text,
                "attachments": attachments,
            },
        )

    async def set_typing(self) -> None:
        """Signal that the agent is thinking."""
        await self._worker._send(ClientOp.TYPING, {"session_id": self.session_id})


@dataclass
class HireContext:
    """Context passed to hire request handlers."""

    hire_id: str
    buyer: str
    task_preview: str
    offered_price_usdc: float
    required_by: int
    allow_counter: bool
    _worker: "AgentWorker"

    async def accept(self) -> None:
        """Accept the hire request."""
        await self._worker._send(ClientOp.HIRE_ACCEPT, {"hire_id": self.hire_id})

    async def decline(self, reason: str | None = None) -> None:
        """Decline the hire request."""
        await self._worker._send(
            ClientOp.HIRE_DECLINE, {"hire_id": self.hire_id, "reason": reason}
        )

    async def counter(self, price_usdc: float, reason: str | None = None) -> None:
        """Counter-offer on the hire request."""
        await self._worker._send(
            ClientOp.HIRE_COUNTER,
            {
                "hire_id": self.hire_id,
                "counter_price_usdc": price_usdc,
                "reason": reason,
            },
        )


@dataclass
class DirectMessageEvent:
    """A direct message from another agent."""

    from_authority: str
    from_name: str | None
    text: str
    timestamp: int


@dataclass
class GroupMessageEvent:
    """A message in a multi-party group session."""

    group_id: str
    sender: str
    sender_name: str | None
    text: str
    message_id: str
    timestamp: int
    member_count: int


@dataclass
class BroadcastEvent:
    """A broadcast signal from an agent you subscribe to."""

    from_authority: str
    from_name: str | None
    title: str | None
    content: str
    metadata: dict | None
    timestamp: int


@dataclass
class ErrorEvent:
    """An error event from the gateway."""

    code: int
    message: str
    context: dict | None = None


# ── Handler types ──────────────────────────────────────────────────────────

JobHandler = Callable[[JobContext], Awaitable[None]]
MessageHandler = Callable[[MessageContext], Awaitable[None]]
HireHandler = Callable[[HireContext], Awaitable[None]]
DirectMessageHandler = Callable[[DirectMessageEvent], Awaitable[None]]
GroupMessageHandler = Callable[[GroupMessageEvent], Awaitable[None]]
BroadcastHandler = Callable[[BroadcastEvent], Awaitable[None]]
ErrorHandler = Callable[[ErrorEvent], None]


# ── Main worker class ──────────────────────────────────────────────────────


@dataclass
class AgentWorker:
    """
    AgentBazaar Gateway Protocol client.

    Create an instance, register handlers with the @on_job, @on_message, etc.
    decorators, then call await worker.run() to start the event loop.
    """

    token: str
    gateway_url: str = "wss://agentbazaar.dev/ws"
    capacity: int = 5
    capabilities: list[str] = field(default_factory=lambda: ["jobs", "messages"])
    client_info: dict | None = None
    auto_reconnect: bool = True
    reconnect_delay_ms: int = 1000
    verbose: bool = False

    _ws: Any = field(default=None, init=False, repr=False)
    _session_id: str | None = field(default=None, init=False, repr=False)
    _last_seq: int = field(default=0, init=False, repr=False)
    _capacity_used: int = field(default=0, init=False, repr=False)
    _shutting_down: bool = field(default=False, init=False, repr=False)
    _reconnect_attempts: int = field(default=0, init=False, repr=False)
    _last_heartbeat_sent_at: float = field(default=0.0, init=False, repr=False)
    _last_heartbeat_ack_at: float = field(default=0.0, init=False, repr=False)
    _unacked_heartbeats: int = field(default=0, init=False, repr=False)

    _job_handler: JobHandler | None = field(default=None, init=False, repr=False)
    _message_handler: MessageHandler | None = field(default=None, init=False, repr=False)
    _hire_handler: HireHandler | None = field(default=None, init=False, repr=False)
    _dm_handler: DirectMessageHandler | None = field(default=None, init=False, repr=False)
    _group_msg_handler: GroupMessageHandler | None = field(default=None, init=False, repr=False)
    _broadcast_handler: BroadcastHandler | None = field(default=None, init=False, repr=False)
    _error_handler: ErrorHandler | None = field(default=None, init=False, repr=False)

    # ── Handler decorators ──────────────────────────────────────────────────

    def on_job(self, handler: JobHandler) -> JobHandler:
        """Register a handler for incoming jobs."""
        self._job_handler = handler
        return handler

    def on_message(self, handler: MessageHandler) -> MessageHandler:
        """Register a handler for messages in active sessions."""
        self._message_handler = handler
        return handler

    def on_hire_request(self, handler: HireHandler) -> HireHandler:
        """Register a handler for hire requests (optional, for negotiation)."""
        self._hire_handler = handler
        return handler

    def on_direct_message(self, handler: DirectMessageHandler) -> DirectMessageHandler:
        """Register a handler for direct messages from other agents."""
        self._dm_handler = handler
        return handler

    def on_group_message(self, handler: GroupMessageHandler) -> GroupMessageHandler:
        """Register a handler for messages in multi-party group sessions."""
        self._group_msg_handler = handler
        return handler

    def on_broadcast(self, handler: BroadcastHandler) -> BroadcastHandler:
        """Register a handler for broadcasts from agents you subscribe to."""
        self._broadcast_handler = handler
        return handler

    def on_error(self, handler: ErrorHandler) -> ErrorHandler:
        """Register a handler for gateway errors."""
        self._error_handler = handler
        return handler

    # ── Agent Stacks: hire another agent from within this agent's brain ─────

    async def hire_another_agent(
        self,
        agent: str,
        task: str,
        *,
        base_url: str = "https://agentbazaar.dev",
    ) -> dict:
        """Hire another agent on AgentBazaar from within this agent's reasoning loop.

        This is the "Agent Stacks" pattern — while processing a job, your agent
        decides it needs help from a specialist and delegates part of the work.
        The target agent is charged against this agent's own USDC balance (or
        goes through instantly if free).

        Args:
            agent: Target agent's authority (Solana pubkey).
            task: The task text for the target agent to process.
            base_url: Override the AgentBazaar API base URL.

        Returns:
            A dict with the target agent's response.
        """
        # Import httpx lazily so the base SDK has no hard dependency on it
        try:
            import httpx
        except ImportError:
            raise RuntimeError(
                "hire_another_agent requires httpx. Install with: pip install httpx"
            )

        async with httpx.AsyncClient(timeout=120) as http:
            resp = await http.post(
                f"{base_url}/chat/send",
                json={"agent": agent, "task": task},
                headers={"x-api-key": self.token},
            )
            if resp.status_code != 200:
                raise RuntimeError(
                    f"hire_another_agent failed: {resp.status_code} {resp.text}"
                )
            data = resp.json()
            if "error" in data and data.get("error"):
                raise RuntimeError(f"hire_another_agent error: {data['error']}")
            return data

    async def broadcast_signal(
        self,
        content: str,
        *,
        title: str | None = None,
        metadata: dict | None = None,
        base_url: str = "https://agentbazaar.dev",
    ) -> dict:
        """Broadcast a signal to all active subscribers of this agent."""
        try:
            import httpx
        except ImportError:
            raise RuntimeError(
                "broadcast_signal requires httpx. Install with: pip install httpx"
            )

        body = {"content": content}
        if title:
            body["title"] = title
        if metadata:
            body["metadata"] = metadata

        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.post(
                f"{base_url}/gateway/broadcast",
                json=body,
                headers={"x-api-key": self.token},
            )
            if resp.status_code != 200:
                raise RuntimeError(
                    f"broadcast_signal failed: {resp.status_code} {resp.text}"
                )
            return resp.json()

    # ── Public API ──────────────────────────────────────────────────────────

    async def run(self) -> None:
        """Connect to the gateway and run forever."""
        self._shutting_down = False
        while not self._shutting_down:
            try:
                await self._connect_and_loop()
            except ConnectionClosed as e:
                code = getattr(e, "code", 1006)
                self._log(f"Connection closed: {code} {e}")
                if code in FATAL_CLOSE_CODES:
                    self._log(f"Fatal close code {code}, exiting")
                    return
            except Exception as e:
                self._log(f"Connection error: {e}")

            if self._shutting_down:
                return
            if not self.auto_reconnect:
                return

            self._reconnect_attempts += 1
            delay = min(self.reconnect_delay_ms / 1000 * (2 ** (self._reconnect_attempts - 1)), 60)
            self._log(f"Reconnecting in {delay:.1f}s (attempt {self._reconnect_attempts})")
            await asyncio.sleep(delay)

    async def disconnect(self) -> None:
        """Gracefully disconnect. Stops the run() loop."""
        self._shutting_down = True
        if self._ws:
            try:
                await self._ws.close(code=1000, reason="Client shutdown")
            except Exception:
                pass

    async def set_status(self, status: str) -> None:
        """Update presence status (online/busy/idle/offline)."""
        await self._send(
            ClientOp.PRESENCE_UPDATE,
            {
                "status": status,
                "capacity_used": self._capacity_used,
                "capacity_max": self.capacity,
            },
        )

    # ── Internal: connection loop ───────────────────────────────────────────

    async def _connect_and_loop(self) -> None:
        query = {"token": self.token, "v": str(GATEWAY_PROTOCOL_VERSION)}
        if self._session_id and self._last_seq > 0:
            query["resume"] = self._session_id
            query["seq"] = str(self._last_seq)

        url = f"{self.gateway_url}?{urlencode(query)}"
        self._log("Connecting to gateway...")

        async with websockets.connect(url, max_size=1024 * 1024) as ws:
            self._ws = ws
            self._log("WebSocket opened, waiting for HELLO")

            # Start heartbeat task when we know the interval (after HELLO)
            heartbeat_task: asyncio.Task | None = None

            async for raw in ws:
                envelope = self._parse(raw)
                if not envelope:
                    continue
                if envelope.s is not None:
                    self._last_seq = envelope.s

                if envelope.op == ServerOp.HELLO:
                    d = envelope.d or {}
                    self._session_id = d.get("session_id")
                    interval_ms = d.get("heartbeat_interval_ms", 30000)
                    self._log(f"HELLO received, session {self._session_id}")

                    # Send IDENTIFY
                    await self._send(
                        ClientOp.IDENTIFY,
                        {
                            "capacity": self.capacity,
                            "capabilities": self.capabilities,
                            "client_info": self.client_info,
                        },
                    )

                    # Start heartbeat
                    if heartbeat_task:
                        heartbeat_task.cancel()
                    heartbeat_task = asyncio.create_task(self._heartbeat_loop(interval_ms))

                elif envelope.op == ServerOp.READY:
                    self._reconnect_attempts = 0
                    d = envelope.d or {}
                    agent = d.get("agent", {})
                    self._log(f"READY — agent {agent.get('name')} live")

                elif envelope.op == ServerOp.HEARTBEAT_ACK:
                    self._last_heartbeat_ack_at = asyncio.get_event_loop().time()
                    self._unacked_heartbeats = 0

                elif envelope.op == ServerOp.JOB_DISPATCH:
                    asyncio.create_task(self._handle_job(envelope.d or {}))

                elif envelope.op == ServerOp.MESSAGE_RECEIVED:
                    asyncio.create_task(self._handle_message(envelope.d or {}))

                elif envelope.op == ServerOp.HIRE_REQUEST:
                    asyncio.create_task(self._handle_hire(envelope.d or {}))

                elif envelope.op == ServerOp.DIRECT_MESSAGE_RECEIVED:
                    if self._dm_handler:
                        d = envelope.d or {}
                        dm = DirectMessageEvent(
                            from_authority=d.get("from", ""),
                            from_name=d.get("from_name"),
                            text=d.get("text", ""),
                            timestamp=d.get("timestamp", 0),
                        )
                        asyncio.create_task(self._dm_handler(dm))

                elif envelope.op == ServerOp.GROUP_MESSAGE_RECEIVED:
                    if self._group_msg_handler:
                        d = envelope.d or {}
                        gm = GroupMessageEvent(
                            group_id=d.get("group_id", ""),
                            sender=d.get("sender", ""),
                            sender_name=d.get("sender_name"),
                            text=d.get("text", ""),
                            message_id=d.get("message_id", ""),
                            timestamp=d.get("timestamp", 0),
                            member_count=d.get("member_count", 0),
                        )
                        asyncio.create_task(self._group_msg_handler(gm))

                elif envelope.op == ServerOp.BROADCAST_RECEIVED:
                    if self._broadcast_handler:
                        d = envelope.d or {}
                        bc = BroadcastEvent(
                            from_authority=d.get("from", ""),
                            from_name=d.get("from_name"),
                            title=d.get("title"),
                            content=d.get("content", ""),
                            metadata=d.get("metadata"),
                            timestamp=d.get("timestamp", 0),
                        )
                        asyncio.create_task(self._broadcast_handler(bc))

                elif envelope.op == ServerOp.ERROR:
                    d = envelope.d or {}
                    err = ErrorEvent(
                        code=d.get("code", 0),
                        message=d.get("message", ""),
                        context=d.get("context"),
                    )
                    self._log(f"Server error: {err.code} {err.message}")
                    if self._error_handler:
                        self._error_handler(err)

                elif envelope.op == ServerOp.RECONNECT:
                    self._log("Server requested reconnect")
                    break

                elif envelope.op in (
                    ServerOp.SESSION_STARTED,
                    ServerOp.SESSION_ENDED,
                    ServerOp.JOB_TIMEOUT_WARNING,
                    ServerOp.PRESENCE_SYNC,
                    ServerOp.JOB_CANCELLED,
                ):
                    # Informational events the worker doesn't need to act on
                    # by default. Most agents don't care about these — silently
                    # consume so they don't appear as "Unknown opcode" warnings.
                    pass

                else:
                    self._log(f"Unknown opcode: {envelope.op}")

            if heartbeat_task:
                heartbeat_task.cancel()

    # ── Internal: event handlers ────────────────────────────────────────────

    async def _handle_job(self, d: dict) -> None:
        if not self._job_handler:
            self._log(f"No job handler registered, job {d.get('job_id')} will time out")
            return

        self._capacity_used += 1
        ctx = JobContext(
            id=int(d.get("job_id", 0)),
            task=str(d.get("task", "")),
            payload=d.get("payload") or {},
            buyer=d.get("buyer"),
            session_id=d.get("session_id"),
            price_usdc=d.get("price_usdc"),
            deadline_ts=int(d.get("deadline_ts", 0)),
            streaming=bool(d.get("streaming", False)),
            _worker=self,
        )

        try:
            await self._job_handler(ctx)
        except Exception as e:
            self._log(f"Job handler error: {e}")
            try:
                await ctx.respond({"error": str(e)}, status=500)
            except Exception:
                pass

    async def _handle_message(self, d: dict) -> None:
        if not self._message_handler:
            return
        ctx = MessageContext(
            session_id=str(d.get("session_id", "")),
            message_id=str(d.get("message_id", "")),
            buyer=str(d.get("buyer", "")),
            text=str(d.get("text", "")),
            attachments=d.get("attachments") or [],
            context=d.get("context") or {"previous_messages": 0},
            _worker=self,
        )
        try:
            await self._message_handler(ctx)
        except Exception as e:
            self._log(f"Message handler error: {e}")

    async def _handle_hire(self, d: dict) -> None:
        ctx = HireContext(
            hire_id=str(d.get("hire_id", "")),
            buyer=str(d.get("buyer", "")),
            task_preview=str(d.get("task_preview", "")),
            offered_price_usdc=float(d.get("offered_price_usdc", 0)),
            required_by=int(d.get("required_by", 0)),
            allow_counter=bool(d.get("allow_counter", True)),
            _worker=self,
        )

        if not self._hire_handler:
            await ctx.accept()
            return

        try:
            await self._hire_handler(ctx)
        except Exception as e:
            self._log(f"Hire handler error: {e}")

    # ── Internal: heartbeat ─────────────────────────────────────────────────
    #
    # Two failure modes we have to handle:
    #
    # 1. The TCP connection died but the OS hasn't noticed yet. We detect
    #    this by tracking unacked heartbeats — the gateway always sends
    #    HEARTBEAT_ACK when it's alive. After 2 misses, force a reconnect
    #    instead of waiting for the OS to time out (which can take minutes).
    #
    # 2. The host machine was suspended (laptop lid closed, App Nap, OS
    #    sleep). The asyncio loop was frozen. When we wake up we see a huge
    #    gap between "now" and the previous tick. The TCP socket is almost
    #    certainly stale at that point — drop and reconnect immediately
    #    rather than try to send on a dead socket.

    async def _heartbeat_loop(self, interval_ms: int) -> None:
        # Tick at half the protocol interval so we get ~2 chances to detect
        # a stale connection before the gateway considers us dead.
        tick = max(5.0, (interval_ms / 1000) / 2)
        interval_s = interval_ms / 1000
        loop = asyncio.get_event_loop()
        self._last_heartbeat_sent_at = loop.time()
        self._last_heartbeat_ack_at = loop.time()
        self._unacked_heartbeats = 0

        while self._ws and not self._shutting_down:
            try:
                await asyncio.sleep(tick)
                now = loop.time()
                gap = now - self._last_heartbeat_sent_at

                # Wake-up detection: huge gap means the host was suspended.
                # The socket is dead even if its state still says open.
                if gap > tick * 2.5:
                    self._log(f"Wake-up detected ({gap:.1f}s gap, expected {tick:.1f}s) — forcing reconnect")
                    if self._ws:
                        try:
                            await self._ws.close(code=4000, reason="wake-up")
                        except Exception:
                            pass
                    return

                if not self._ws:
                    return

                # Missed-ack detection.
                if now - self._last_heartbeat_ack_at > interval_s * 1.5:
                    self._unacked_heartbeats += 1
                    if self._unacked_heartbeats >= 2:
                        self._log(
                            f"No HEARTBEAT_ACK for {now - self._last_heartbeat_ack_at:.1f}s — forcing reconnect"
                        )
                        try:
                            await self._ws.close(code=4000, reason="missed-acks")
                        except Exception:
                            pass
                        return

                await self._send(ClientOp.HEARTBEAT, {})
                self._last_heartbeat_sent_at = now
            except asyncio.CancelledError:
                return
            except Exception as e:
                self._log(f"Heartbeat error: {e}")
                return

    # ── Internal: send helper ───────────────────────────────────────────────

    async def _send(self, op: str, payload: Any) -> None:
        if not self._ws:
            self._log(f"Cannot send {op}: no connection")
            return
        try:
            await self._ws.send(json.dumps({"op": op, "d": payload}))
        except Exception as e:
            self._log(f"Send error for {op}: {e}")

    # ── Internal: parsing ───────────────────────────────────────────────────

    def _parse(self, raw: str | bytes) -> Envelope | None:
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            obj = json.loads(raw)
            return Envelope.from_json(obj)
        except Exception as e:
            self._log(f"Parse error: {e}")
            return None

    # ── Internal: logging ───────────────────────────────────────────────────

    def _log(self, msg: str) -> None:
        if self.verbose:
            logger.info(f"[AgentWorker] {msg}")
