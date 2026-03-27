import { describe, it, expect } from "vitest";
import { formatUsdc, formatAgent, formatAgentShort, formatJob, formatRating } from "../src/format.js";
import type { AgentRow, JobRow, RatingRow } from "../src/format.js";

const mockAgent: AgentRow = {
  pubkey: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  authority: "auth123",
  name: "TestBot",
  description: "A test agent",
  skills: "testing,coding",
  endpoint: "https://test.example.com",
  price_per_request: "100000",
  total_jobs_completed: "5",
  total_earned: "500000",
  rating_sum: "20",
  rating_count: "5",
  active_disputes: 0,
  is_active: true,
  nft_8004: null,
  image_url: null,
  delivery_mode: "ws",
  api_token: null,
  slug: "testbot",
  created_at: "1710000000000",
  updated_at: "1710000000000",
};

describe("formatUsdc", () => {
  it("converts micro-units to USDC string", () => {
    expect(formatUsdc("1000000")).toBe("1.00");
    expect(formatUsdc("100000")).toBe("0.10");
    expect(formatUsdc("0")).toBe("0.00");
    expect(formatUsdc("500000")).toBe("0.50");
  });

  it("handles numeric input", () => {
    expect(formatUsdc(1000000)).toBe("1.00");
    expect(formatUsdc(250000)).toBe("0.25");
  });

  it("handles large amounts", () => {
    expect(formatUsdc("1000000000")).toBe("1000.00");
  });
});

describe("formatAgent", () => {
  it("formats active agent with ratings", () => {
    const result = formatAgent(mockAgent);
    expect(result).toContain("**TestBot** (Active)");
    expect(result).toContain("Pubkey: `7xKXtg");
    expect(result).toContain("Skills: testing,coding");
    expect(result).toContain("Price: $0.10 USDC/request");
    expect(result).toContain("Mode: WebSocket");
    expect(result).toContain("Rating: 4.0/5 (5 reviews)");
    expect(result).toContain("Total Earned: $0.50 USDC");
    expect(result).toContain("Endpoint: https://test.example.com");
    expect(result).toContain("A2A Card: https://agentbazaar.dev/a2a/testbot/.well-known/agent.json");
  });

  it("shows inactive status", () => {
    const inactive = { ...mockAgent, is_active: false };
    expect(formatAgent(inactive)).toContain("(Inactive)");
  });

  it("shows 'No ratings' for unrated agents", () => {
    const unrated = { ...mockAgent, rating_sum: "0", rating_count: "0" };
    expect(formatAgent(unrated)).toContain("No ratings");
  });

  it("shows push mode", () => {
    const push = { ...mockAgent, delivery_mode: "push" as const };
    expect(formatAgent(push)).toContain("Push (HTTPS)");
  });

  it("shows 8004 NFT when present", () => {
    const withNft = { ...mockAgent, nft_8004: "nft123" };
    expect(formatAgent(withNft)).toContain("8004 NFT: `nft123`");
  });

  it("shows image URL when present", () => {
    const withImg = { ...mockAgent, image_url: "https://example.com/img.png" };
    expect(formatAgent(withImg)).toContain("Avatar: https://example.com/img.png");
  });

  it("omits optional fields when null", () => {
    const minimal = { ...mockAgent, endpoint: "", slug: null, nft_8004: null, image_url: null };
    const result = formatAgent(minimal);
    expect(result).not.toContain("Endpoint:");
    expect(result).not.toContain("A2A Card:");
    expect(result).not.toContain("8004 NFT:");
    expect(result).not.toContain("Avatar:");
  });
});

describe("formatAgentShort", () => {
  it("formats agent in short form", () => {
    const result = formatAgentShort(mockAgent);
    expect(result).toContain("**TestBot** — $0.10 USDC");
    expect(result).toContain("Skills: testing,coding");
    expect(result).toContain("Rating: 4.0/5");
    expect(result).toContain("Jobs: 5");
    expect(result).toContain("Pubkey: `7xKXtg");
  });

  it("shows N/A for unrated agents", () => {
    const unrated = { ...mockAgent, rating_sum: "0", rating_count: "0" };
    expect(formatAgentShort(unrated)).toContain("Rating: N/A");
  });
});

describe("formatJob", () => {
  const mockJob: JobRow = {
    id: "42",
    buyer: "buyer-wallet",
    seller: "seller-wallet",
    amount: "100000",
    status: 1,
    metadata: "{}",
    created_at: "2024-01-01",
    completed_at: "2024-01-02",
  };

  it("formats completed job", () => {
    const result = formatJob(mockJob);
    expect(result).toContain("**Job #42** — Completed");
    expect(result).toContain("Amount: $0.10 USDC");
    expect(result).toContain("Buyer: `buyer-wallet`");
    expect(result).toContain("Seller: `seller-wallet`");
    expect(result).toContain("Created: 2024-01-01");
    expect(result).toContain("Completed: 2024-01-02");
  });

  it("formats different statuses", () => {
    expect(formatJob({ ...mockJob, status: 0 })).toContain("Created");
    expect(formatJob({ ...mockJob, status: 2 })).toContain("Disputed");
    expect(formatJob({ ...mockJob, status: 3 })).toContain("Cancelled");
    expect(formatJob({ ...mockJob, status: 99 })).toContain("Unknown");
  });

  it("omits completed_at when null", () => {
    const pending = { ...mockJob, completed_at: null };
    expect(formatJob(pending)).not.toContain("Completed:");
  });
});

describe("formatRating", () => {
  const mockRating: RatingRow = {
    pubkey: "r1",
    job_id: "42",
    buyer: "buyer1",
    seller: "seller1",
    rater: "rater1",
    score: 4,
    comment: "Great work!",
    created_at: "2024-01-01",
  };

  it("formats rating with stars", () => {
    const result = formatRating(mockRating);
    expect(result).toContain("★★★★☆ (4/5)");
    expect(result).toContain("Job #42");
    expect(result).toContain('"Great work!"');
    expect(result).toContain("By: `rater1`");
  });

  it("shows all stars for perfect rating", () => {
    const perfect = { ...mockRating, score: 5 };
    expect(formatRating(perfect)).toContain("★★★★★");
    expect(formatRating(perfect)).not.toContain("☆");
  });

  it("shows all empty stars for 0 rating", () => {
    const zero = { ...mockRating, score: 0 };
    expect(formatRating(zero)).toContain("☆☆☆☆☆");
  });

  it("omits comment when empty", () => {
    const noComment = { ...mockRating, comment: "" };
    const result = formatRating(noComment);
    expect(result).not.toContain('""');
  });
});
