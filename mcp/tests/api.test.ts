import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock wallet module to avoid fs dependency
vi.mock("../src/wallet.js", () => ({
  signMessage: vi.fn().mockReturnValue({
    address: "wallet-address",
    signature: "base64sig",
    message: "agentbazaar:test:123",
  }),
}));

import { ApiClient } from "../src/api.js";

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

let client: ApiClient;

beforeEach(() => {
  client = new ApiClient("https://test.agentbazaar.dev");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApiClient constructor", () => {
  it("uses provided base URL", () => {
    expect(client.getBaseUrl()).toBe("https://test.agentbazaar.dev");
  });

  it("defaults to AGENTBAZAAR_API env or agentbazaar.dev", () => {
    const defaultClient = new ApiClient();
    // Since env isn't set, falls back to default
    expect(defaultClient.getBaseUrl()).toBeTruthy();
  });
});

describe("get", () => {
  it("sends GET request and returns data", async () => {
    const spy = mockFetch({ agents: [] });
    vi.stubGlobal("fetch", spy);

    const result = await client.get<{ agents: unknown[] }>("/agents");

    expect(result.agents).toEqual([]);
    expect(spy).toHaveBeenCalledWith("https://test.agentbazaar.dev/agents");
  });

  it("throws on non-ok response with error field", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "Not found" }, 404));

    await expect(client.get("/missing")).rejects.toThrow("Not found");
  });

  it("throws generic HTTP error when no error field", async () => {
    vi.stubGlobal("fetch", mockFetch({}, 500));

    await expect(client.get("/fail")).rejects.toThrow("HTTP 500");
  });
});

describe("post", () => {
  it("sends POST with JSON body", async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal("fetch", spy);

    const result = await client.post<{ success: boolean }>("/test", { key: "val" });

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith("https://test.agentbazaar.dev/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "val" }),
    });
  });

  it("throws on error response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "Bad request" }, 400));

    await expect(client.post("/test", {})).rejects.toThrow("Bad request");
  });
});

describe("postAuthenticated", () => {
  it("sends POST with wallet auth headers", async () => {
    const { Keypair } = await import("@solana/web3.js");
    const kp = Keypair.generate();
    const spy = mockFetch({ success: true });
    vi.stubGlobal("fetch", spy);

    await client.postAuthenticated("/agents/register", { name: "Bot" }, kp, "register");

    const callArgs = spy.mock.calls[0];
    const opts = callArgs[1] as RequestInit;
    const headers = opts.headers as Record<string, string>;

    expect(headers["X-Wallet-Address"]).toBe("wallet-address");
    expect(headers["X-Wallet-Signature"]).toBe("base64sig");
    expect(headers["X-Wallet-Message"]).toBe("agentbazaar:test:123");
    expect(opts.method).toBe("POST");
  });

  it("throws on error response", async () => {
    const { Keypair } = await import("@solana/web3.js");
    vi.stubGlobal("fetch", mockFetch({ error: "Unauthorized" }, 401));

    await expect(client.postAuthenticated("/test", {}, Keypair.generate(), "test")).rejects.toThrow("Unauthorized");
  });
});

describe("postWithPayment", () => {
  it("returns data when no payment needed (non-402)", async () => {
    vi.stubGlobal("fetch", mockFetch({ result: "done" }));

    const result = await client.postWithPayment<{ result: string }>(
      "/call",
      { task: "test" },
      async () => "payment-header",
    );

    expect(result.result).toBe("done");
  });

  it("retries with payment header on 402", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 402,
            json: () => Promise.resolve({ error: "Payment required" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ result: "paid-result" }),
        });
      }),
    );

    const paymentFn = vi.fn().mockResolvedValue("x402-payment-header");

    const result = await client.postWithPayment<{ result: string }>("/call", { task: "test" }, paymentFn);

    expect(result.result).toBe("paid-result");
    expect(paymentFn).toHaveBeenCalledTimes(1);

    // Verify retry had X-Payment header
    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    const retryHeaders = (retryCall[1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders["X-Payment"]).toBe("x402-payment-header");
  });

  it("throws when retry after payment fails", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 402,
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Payment failed" }),
        });
      }),
    );

    await expect(client.postWithPayment("/call", {}, async () => "header")).rejects.toThrow("Payment failed");
  });
});
