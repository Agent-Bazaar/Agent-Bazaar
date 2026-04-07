"""Unit tests for the AgentWorker class."""

import json

import pytest

from agentsbazaar_worker import AgentWorker
from agentsbazaar_worker.protocol import ClientOp, ServerOp
from agentsbazaar_worker.worker import JobContext, MessageContext, HireContext


class FakeWebSocket:
    """Captures send() calls for assertion in tests."""

    def __init__(self):
        self.sent = []

    async def send(self, msg):
        self.sent.append(json.loads(msg))

    async def close(self, code=1000, reason=""):
        pass


@pytest.mark.asyncio
async def test_job_context_respond():
    worker = AgentWorker(token="abc")
    worker._ws = FakeWebSocket()
    worker._capacity_used = 1

    ctx = JobContext(
        id=42,
        task="Test",
        payload={},
        buyer=None,
        session_id=None,
        price_usdc=None,
        deadline_ts=0,
        streaming=False,
        _worker=worker,
    )

    await ctx.respond("Done", metadata={"tokens": 100})

    assert len(worker._ws.sent) == 1
    sent = worker._ws.sent[0]
    assert sent["op"] == ClientOp.JOB_RESPONSE
    assert sent["d"]["job_id"] == 42
    assert sent["d"]["result"] == "Done"
    assert sent["d"]["metadata"]["tokens"] == 100
    assert worker._capacity_used == 0


@pytest.mark.asyncio
async def test_job_context_stream():
    worker = AgentWorker(token="abc")
    worker._ws = FakeWebSocket()

    ctx = JobContext(
        id=1,
        task="x",
        payload={},
        buyer=None,
        session_id=None,
        price_usdc=None,
        deadline_ts=0,
        streaming=True,
        _worker=worker,
    )

    await ctx.stream("chunk1")
    await ctx.stream("chunk2", index=1, final=True)

    assert len(worker._ws.sent) == 2
    assert worker._ws.sent[0]["d"]["chunk"] == "chunk1"
    assert worker._ws.sent[0]["d"]["final"] is False
    assert worker._ws.sent[1]["d"]["chunk"] == "chunk2"
    assert worker._ws.sent[1]["d"]["final"] is True


@pytest.mark.asyncio
async def test_message_context_reply():
    worker = AgentWorker(token="abc")
    worker._ws = FakeWebSocket()

    ctx = MessageContext(
        session_id="sess_1",
        message_id="msg_1",
        buyer="buyer",
        text="ping",
        attachments=[],
        context={},
        _worker=worker,
    )
    await ctx.reply("pong")

    assert len(worker._ws.sent) == 1
    assert worker._ws.sent[0]["op"] == ClientOp.MESSAGE_REPLY
    assert worker._ws.sent[0]["d"]["text"] == "pong"


@pytest.mark.asyncio
async def test_hire_context_counter():
    worker = AgentWorker(token="abc")
    worker._ws = FakeWebSocket()

    ctx = HireContext(
        hire_id="hire_1",
        buyer="buyer",
        task_preview="preview",
        offered_price_usdc=0.1,
        required_by=0,
        allow_counter=True,
        _worker=worker,
    )
    await ctx.counter(1.0, "min price")

    assert worker._ws.sent[0]["op"] == ClientOp.HIRE_COUNTER
    assert worker._ws.sent[0]["d"]["counter_price_usdc"] == 1.0


@pytest.mark.asyncio
async def test_handler_registration():
    worker = AgentWorker(token="abc")

    @worker.on_job
    async def job_h(job):
        pass

    @worker.on_message
    async def msg_h(msg):
        pass

    @worker.on_hire_request
    async def hire_h(hire):
        pass

    assert worker._job_handler is not None
    assert worker._message_handler is not None
    assert worker._hire_handler is not None


@pytest.mark.asyncio
async def test_handle_job_invokes_handler():
    worker = AgentWorker(token="abc")
    worker._ws = FakeWebSocket()

    handled = []

    @worker.on_job
    async def handler(job):
        handled.append(job.id)
        await job.respond(f"handled {job.id}")

    await worker._handle_job(
        {"job_id": 123, "task": "test", "deadline_ts": 0, "streaming": False}
    )

    assert handled == [123]
    assert len(worker._ws.sent) == 1
    assert worker._ws.sent[0]["d"]["job_id"] == 123
