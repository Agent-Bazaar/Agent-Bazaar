import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { AgentBazaarClient } from "../src/client.js";

const mockAgent = {
  pubkey: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  authority: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  name: "TestBot",
  description: "A test agent",
  skills: "testing",
  endpoint: "https://test.example.com",
  price_per_request: "100000",
  total_jobs_completed: "5",
  total_earned: "500000",
  rating_sum: "20",
  rating_count: "5",
  active_disputes: 0,
  is_active: true,
  nft_8004: null,
  token_id_8004: null,
  image_url: null,
  delivery_mode: "ws",
  slug: "testbot",
  created_at: "1710000000000",
  updated_at: "1710000000000",
};

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

let client: AgentBazaarClient;
let keypair: Keypair;

beforeEach(() => {
  keypair = Keypair.generate();
  client = new AgentBazaarClient({ baseUrl: "https://test.agentbazaar.dev", keypair });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentBazaarClient constructor", () => {
  it("strips trailing slash from baseUrl", () => {
    const c = new AgentBazaarClient({ baseUrl: "https://example.com/" });
    // Verify by making a request and checking the URL
    const spy = mockFetch({ status: "ok" });
    vi.stubGlobal("fetch", spy);
    c.health();
    expect(spy).toHaveBeenCalledWith("https://example.com/health", expect.objectContaining({}));
  });

  it("defaults to agentbazaar.dev", () => {
    const c = new AgentBazaarClient({});
    const spy = mockFetch({ status: "ok" });
    vi.stubGlobal("fetch", spy);
    c.health();
    expect(spy).toHaveBeenCalledWith("https://agentbazaar.dev/health", expect.objectContaining({}));
  });
});

describe("request error handling", () => {
  it("throws on non-ok response with error field", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "Not found" }, 404));

    await expect(client.health()).rejects.toThrow("Not found");
  });

  it("throws generic HTTP error when no error field", async () => {
    vi.stubGlobal("fetch", mockFetch({}, 500));

    await expect(client.health()).rejects.toThrow("HTTP 500");
  });
});

describe("health", () => {
  it("calls GET /health", async () => {
    const spy = mockFetch({ status: "ok", timestamp: "123" });
    vi.stubGlobal("fetch", spy);

    const result = await client.health();

    expect(result).toEqual({ status: "ok", timestamp: "123" });
    expect(spy).toHaveBeenCalledWith("https://test.agentbazaar.dev/health", expect.objectContaining({}));
  });
});

describe("stats", () => {
  it("calls GET /stats", async () => {
    const stats = { total_agents: 10, total_jobs: 50 };
    vi.stubGlobal("fetch", mockFetch(stats));

    const result = await client.stats();

    expect(result).toEqual(stats);
  });
});

describe("listAgents", () => {
  it("calls GET /agents with no params", async () => {
    const data = { agents: [mockAgent], pagination: { page: 1, limit: 20, total: 1, pages: 1 } };
    const spy = mockFetch(data);
    vi.stubGlobal("fetch", spy);

    const result = await client.listAgents();

    expect(result.agents).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith("https://test.agentbazaar.dev/agents", expect.objectContaining({}));
  });

  it("builds query string from options", async () => {
    const spy = mockFetch({ agents: [], pagination: { page: 2, limit: 10, total: 0, pages: 0 } });
    vi.stubGlobal("fetch", spy);

    await client.listAgents({ page: 2, limit: 10, skills: "coding", active_only: true, min_rating: 4 });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("page=2");
    expect(url).toContain("limit=10");
    expect(url).toContain("skills=coding");
    expect(url).toContain("active_only=true");
    expect(url).toContain("min_rating=4");
  });
});

describe("getAgent", () => {
  it("calls GET /agents/:pubkey", async () => {
    const spy = mockFetch(mockAgent);
    vi.stubGlobal("fetch", spy);

    const result = await client.getAgent("7xKXtg");

    expect(result.name).toBe("TestBot");
    expect(spy).toHaveBeenCalledWith("https://test.agentbazaar.dev/agents/7xKXtg", expect.objectContaining({}));
  });
});

describe("getAgentByWallet", () => {
  it("calls GET /agents/authority/:wallet", async () => {
    const data = { agent: mockAgent, recentJobs: [] };
    const spy = mockFetch(data);
    vi.stubGlobal("fetch", spy);

    const result = await client.getAgentByWallet("wallet123");

    expect(result.agent.name).toBe("TestBot");
    expect(spy).toHaveBeenCalledWith(
      "https://test.agentbazaar.dev/agents/authority/wallet123",
      expect.objectContaining({}),
    );
  });
});

describe("getRatings", () => {
  it("calls GET /agents/:pubkey/ratings", async () => {
    const data = { ratings: [{ score: 5 }], pagination: { page: 1, limit: 20, total: 1, pages: 1 } };
    const spy = mockFetch(data);
    vi.stubGlobal("fetch", spy);

    const result = await client.getRatings("pk1");

    expect(result.ratings).toHaveLength(1);
  });

  it("passes pagination options", async () => {
    const spy = mockFetch({ ratings: [], pagination: { page: 2, limit: 5, total: 0, pages: 0 } });
    vi.stubGlobal("fetch", spy);

    await client.getRatings("pk1", { page: 2, limit: 5 });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("page=2");
    expect(url).toContain("limit=5");
  });
});

describe("listJobs", () => {
  it("calls GET /jobs with filters", async () => {
    const spy = mockFetch({ jobs: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
    vi.stubGlobal("fetch", spy);

    await client.listJobs({ buyer: "b1", seller: "s1", status: 1 });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("buyer=b1");
    expect(url).toContain("seller=s1");
    expect(url).toContain("status=1");
  });
});

describe("call", () => {
  it("sends POST to /call", async () => {
    const callResult = { result: "done", agent: {}, verification: {}, job: {}, meta: {} };
    const spy = mockFetch(callResult);
    vi.stubGlobal("fetch", spy);

    await client.call({ task: "test task", skills: "coding" });

    expect(spy).toHaveBeenCalledWith(
      "https://test.agentbazaar.dev/call",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ task: "test task", skills: "coding" }),
      }),
    );
  });
});

describe("hire", () => {
  it("sends POST to /jobs/hire", async () => {
    const hireResult = { result: "done", verification: {}, job: {} };
    const spy = mockFetch(hireResult);
    vi.stubGlobal("fetch", spy);

    await client.hire({ jobId: "42", task: "audit code" });

    expect(spy).toHaveBeenCalledWith(
      "https://test.agentbazaar.dev/jobs/hire",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jobId: "42", task: "audit code" }),
      }),
    );
  });
});

describe("register", () => {
  it("sends POST to /agents/register with wallet auth headers", async () => {
    const regResult = { agent: mockAgent, message: "ok" };
    const spy = mockFetch(regResult);
    vi.stubGlobal("fetch", spy);

    await client.register({ name: "Bot", skills: "test", pricePerRequest: 100000 });

    const callArgs = spy.mock.calls[0];
    const url = callArgs[0] as string;
    const opts = callArgs[1] as RequestInit;

    expect(url).toBe("https://test.agentbazaar.dev/agents/register");
    expect(opts.method).toBe("POST");

    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Wallet-Address"]).toBe(keypair.publicKey.toBase58());
    expect(headers["X-Wallet-Signature"]).toBeTruthy();
    expect(headers["X-Wallet-Message"]).toMatch(/^agentbazaar:register:\d+$/);
  });

  it("throws without keypair", async () => {
    const noKeyClient = new AgentBazaarClient({ baseUrl: "https://test.agentbazaar.dev" });

    await expect(noKeyClient.register({ name: "Bot", skills: "test", pricePerRequest: 100000 })).rejects.toThrow(
      "Keypair required",
    );
  });

  it("produces valid Ed25519 signatures", async () => {
    const spy = mockFetch({ agent: mockAgent, message: "ok" });
    vi.stubGlobal("fetch", spy);

    await client.register({ name: "Bot", skills: "test", pricePerRequest: 100000 });

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const message = headers["X-Wallet-Message"];
    const signature = Buffer.from(headers["X-Wallet-Signature"], "base64");
    const messageBytes = new TextEncoder().encode(message);

    const valid = nacl.sign.detached.verify(messageBytes, signature, keypair.publicKey.toBytes());
    expect(valid).toBe(true);
  });
});

describe("getAgentCard", () => {
  it("calls GET /a2a/:slug/.well-known/agent.json", async () => {
    const card = { name: "TestBot", description: "test", url: "http://test.com", version: "1.0" };
    const spy = mockFetch(card);
    vi.stubGlobal("fetch", spy);

    const result = await client.getAgentCard("testbot");

    expect(result.name).toBe("TestBot");
    expect(spy).toHaveBeenCalledWith(
      "https://test.agentbazaar.dev/a2a/testbot/.well-known/agent.json",
      expect.objectContaining({}),
    );
  });
});

describe("A2A protocol", () => {
  it("a2aSend sends JSON-RPC tasks/send", async () => {
    const a2aResult = { jsonrpc: "2.0", id: 1, result: { id: "t1", status: { state: "completed" } } };
    const spy = mockFetch(a2aResult);
    vi.stubGlobal("fetch", spy);

    const result = await client.a2aSend("testbot", "do something");

    expect(result.result?.status.state).toBe("completed");

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.method).toBe("tasks/send");
    expect(body.params.message.parts[0].text).toBe("do something");
  });

  it("a2aGet sends JSON-RPC tasks/get", async () => {
    const a2aResult = { jsonrpc: "2.0", id: 1, result: { id: "t1", status: { state: "completed" } } };
    const spy = mockFetch(a2aResult);
    vi.stubGlobal("fetch", spy);

    await client.a2aGet("testbot", "t1");

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.method).toBe("tasks/get");
    expect(body.params.id).toBe("t1");
  });

  it("a2aCancel sends JSON-RPC tasks/cancel", async () => {
    const a2aResult = { jsonrpc: "2.0", id: 1, result: { id: "t1", status: { state: "canceled" } } };
    const spy = mockFetch(a2aResult);
    vi.stubGlobal("fetch", spy);

    await client.a2aCancel("testbot", "t1");

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.method).toBe("tasks/cancel");
    expect(body.params.id).toBe("t1");
  });

  it("a2aStream parses SSE events", async () => {
    const encoder = new TextEncoder();
    const events = [
      'data: {"jsonrpc":"2.0","id":1,"result":{"id":"t1","status":{"state":"working"}}}\n\n',
      'data: {"jsonrpc":"2.0","id":1,"result":{"id":"t1","status":{"state":"completed"},"final":true}}\n\n',
    ];

    let pushIndex = 0;
    const readable = new ReadableStream({
      pull(controller) {
        if (pushIndex < events.length) {
          controller.enqueue(encoder.encode(events[pushIndex++]));
        } else {
          controller.close();
        }
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: readable,
      }),
    );

    const collected: unknown[] = [];
    for await (const event of client.a2aStream("testbot", "do something")) {
      collected.push(event);
    }

    expect(collected).toHaveLength(2);
    expect((collected[0] as { result: { status: { state: string } } }).result.status.state).toBe("working");
    expect((collected[1] as { result: { status: { state: string } } }).result.status.state).toBe("completed");
  });

  it("a2aStream throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
      }),
    );

    await expect(async () => {
      for await (const _ of client.a2aStream("testbot", "test")) {
        // consume
      }
    }).rejects.toThrow("A2A stream failed: HTTP 500");
  });
});

describe("uploadImage", () => {
  it("sends POST with FormData and auth headers", async () => {
    const spy = mockFetch({ success: true, imageUrl: "https://example.com/img.webp" });
    vi.stubGlobal("fetch", spy);

    // Mock fs.readFileSync
    vi.mock("fs", () => ({
      readFileSync: vi.fn().mockReturnValue(Buffer.from("fake-image")),
    }));

    const result = await client.uploadImage("/path/to/image.webp");

    expect(result.success).toBe(true);
    const callArgs = spy.mock.calls[0];
    const opts = callArgs[1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Wallet-Address"]).toBe(keypair.publicKey.toBase58());
    expect(headers["X-Wallet-Message"]).toMatch(/^agentbazaar:upload:\d+$/);
  });
});
