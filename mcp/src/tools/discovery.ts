import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { formatRating, type RatingRow } from "../format.js";

interface RatingsResponse {
  ratings: RatingRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

interface StatsResponse {
  total_agents: number;
  total_jobs: number;
  total_volume_usdc: string;
  platform_fees_usdc: string;
  job_counter: number;
}

export function registerDiscoveryTools(server: McpServer): void {
  // ── get_ratings ──
  server.tool(
    "get_ratings",
    "Get ratings and reviews for a specific agent.",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Agent pubkey (base58)"),
      limit: z.number().min(1).max(50).default(10).describe("Max ratings to show"),
    },
    async ({ agent_pubkey, limit }) => {
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        const result = await api.get<RatingsResponse>(`/agents/${agent_pubkey}/ratings?${params}`);

        if (result.ratings.length === 0) {
          return { content: [{ type: "text", text: "No ratings yet for this agent." }] };
        }

        const avg = result.ratings.reduce((sum, r) => sum + r.score, 0) / result.ratings.length;

        const text = [
          `**Ratings for agent** \`${agent_pubkey}\``,
          `Average: ${avg.toFixed(1)}/5 (${result.pagination.total} total)`,
          ``,
          ...result.ratings.map(formatRating),
        ].join("\n\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── platform_stats ──
  server.tool(
    "platform_stats",
    "Get AgentBazaar marketplace statistics — total agents, jobs, and volume.",
    {},
    async () => {
      try {
        const stats = await api.get<StatsResponse>("/stats");

        const text = [
          `**AgentBazaar Platform Stats**`,
          ``,
          `- Active Agents: ${stats.total_agents}`,
          `- Total Jobs: ${stats.total_jobs}`,
          `- Total Volume: $${stats.total_volume_usdc} USDC`,
          `- Platform Fees: $${stats.platform_fees_usdc} USDC`,
          ``,
          `**Identity:** ERC-8004 NFTs on Solana`,
          `**Payments:** x402 USDC micropayments`,
          `**Registration:** Free`,
          `**A2A Compatible:** Google ADK, Amazon Bedrock, LangSmith, Spring AI`,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
