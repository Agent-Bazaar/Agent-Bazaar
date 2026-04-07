/**
 * Unit tests for @agentsbazaar/worker.
 *
 * These tests verify the worker's event handling, reconnect logic, and
 * envelope construction without actually connecting to a real gateway.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { AgentWorker } from "../src/worker.js";
import { ClientOp, ServerOp } from "../src/protocol.js";

describe("AgentWorker construction", () => {
  test("requires a token", () => {
    expect(() => new AgentWorker({ token: "" })).toThrow(/token is required/);
  });

  test("accepts minimal config", () => {
    const w = new AgentWorker({ token: "abc123" });
    expect(w).toBeInstanceOf(AgentWorker);
    expect(w.isReady()).toBe(false);
  });

  test("accepts full config", () => {
    const w = new AgentWorker({
      token: "abc",
      gateway_url: "wss://custom.example.com/ws",
      capacity: 10,
      capabilities: ["jobs", "messages", "streaming"],
      client_info: { framework: "test", version: "1.0" },
      auto_reconnect: false,
      verbose: true,
    });
    expect(w.isReady()).toBe(false);
    expect(w.getCapacityUsed()).toBe(0);
  });
});

describe("AgentWorker event handlers", () => {
  let worker: AgentWorker;

  beforeEach(() => {
    worker = new AgentWorker({ token: "abc" });
  });

  test("onJob is chainable", () => {
    const result = worker.onJob(() => {});
    expect(result).toBe(worker);
  });

  test("all handler registrations are chainable", () => {
    const chained = worker
      .onJob(() => {})
      .onMessage(() => {})
      .onHireRequest(() => {})
      .onDirectMessage(() => {})
      .onError(() => {});
    expect(chained).toBe(worker);
  });
});

describe("AgentWorker message handling (simulated)", () => {
  let worker: AgentWorker;

  beforeEach(() => {
    worker = new AgentWorker({ token: "abc" });
  });

  test("handles JOB_DISPATCH and fires job handler", async () => {
    const jobHandler = vi.fn(async (job) => {
      expect(job.task).toBe("Test task");
      await job.respond("Test result");
    });
    worker.onJob(jobHandler);

    // Mock the WebSocket send method
    const sendSpy = vi.fn();
    // @ts-expect-error — private field access for testing
    worker["ws"] = { readyState: 1, send: sendSpy };

    // Simulate incoming JOB_DISPATCH
    const envelope = {
      op: ServerOp.JOB_DISPATCH,
      s: 1,
      d: {
        job_id: 42,
        task: "Test task",
        payload: {},
        timeout_ms: 60000,
        deadline_ts: Date.now() + 60000,
        streaming: false,
      },
    };
    // @ts-expect-error — private method for testing
    worker["handleEnvelope"](envelope);

    // Wait for async handler
    await new Promise((r) => setTimeout(r, 10));

    expect(jobHandler).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalled();
    const sentEnvelope = JSON.parse(sendSpy.mock.calls[0][0]);
    expect(sentEnvelope.op).toBe(ClientOp.JOB_RESPONSE);
    expect(sentEnvelope.d.job_id).toBe(42);
  });

  test("handles MESSAGE_RECEIVED and fires message handler", async () => {
    const msgHandler = vi.fn(async (msg) => {
      await msg.reply("pong");
    });
    worker.onMessage(msgHandler);

    const sendSpy = vi.fn();
    // @ts-expect-error
    worker["ws"] = { readyState: 1, send: sendSpy };

    const envelope = {
      op: ServerOp.MESSAGE_RECEIVED,
      s: 2,
      d: {
        session_id: "sess_abc",
        message_id: "msg_xyz",
        buyer: "buyer_addr",
        text: "ping",
      },
    };
    // @ts-expect-error
    worker["handleEnvelope"](envelope);

    await new Promise((r) => setTimeout(r, 10));

    expect(msgHandler).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalled();
    const sent = JSON.parse(sendSpy.mock.calls[0][0]);
    expect(sent.op).toBe(ClientOp.MESSAGE_REPLY);
    expect(sent.d.text).toBe("pong");
  });

  test("handles HIRE_REQUEST with custom handler", async () => {
    const hireHandler = vi.fn(async (hire) => {
      if (hire.offered_price_usdc < 1) {
        await hire.counter(2.0, "minimum price");
      } else {
        await hire.accept();
      }
    });
    worker.onHireRequest(hireHandler);

    const sendSpy = vi.fn();
    // @ts-expect-error
    worker["ws"] = { readyState: 1, send: sendSpy };

    const envelope = {
      op: ServerOp.HIRE_REQUEST,
      s: 3,
      d: {
        hire_id: "hire_1",
        buyer: "buyer",
        task_preview: "test",
        offered_price_usdc: 0.5,
        required_by: Date.now() + 60000,
        allow_counter: true,
      },
    };
    // @ts-expect-error
    worker["handleEnvelope"](envelope);

    await new Promise((r) => setTimeout(r, 10));

    expect(hireHandler).toHaveBeenCalledOnce();
    const sent = JSON.parse(sendSpy.mock.calls[0][0]);
    expect(sent.op).toBe(ClientOp.HIRE_COUNTER);
    expect(sent.d.counter_price_usdc).toBe(2.0);
  });

  test("capacity tracking increments and decrements", async () => {
    worker.onJob(async (job) => {
      await job.respond("done");
    });

    const sendSpy = vi.fn();
    // @ts-expect-error
    worker["ws"] = { readyState: 1, send: sendSpy };

    expect(worker.getCapacityUsed()).toBe(0);

    const envelope = {
      op: ServerOp.JOB_DISPATCH,
      s: 1,
      d: { job_id: 1, task: "x", timeout_ms: 60000, deadline_ts: Date.now() + 60000, streaming: false },
    };
    // @ts-expect-error
    worker["handleEnvelope"](envelope);

    await new Promise((r) => setTimeout(r, 10));
    // After respond, capacity should be back to 0
    expect(worker.getCapacityUsed()).toBe(0);
  });
});
