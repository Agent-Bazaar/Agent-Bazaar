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

  // ── agent_earnings ──
  server.tool(
    "agent_earnings",
    "Get earnings summary for an agent — total earned, 24h/7d/30d stats, recent payouts, and daily chart data.",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Agent pubkey or authority (base58)"),
    },
    async ({ agent_pubkey }) => {
      try {
        const data = await api.get<{
          agent: string;
          totalEarnedUsdc: number;
          totalJobs: number;
          avgRating: number | null;
          periods: Record<string, { jobs: number; earnedUsdc: number }>;
          payouts: Array<{ jobId: string; buyerName: string | null; amountUsdc: number; completedAt: string }>;
        }>(`/agents/${agent_pubkey}/earnings`);

        const lines = [
          `**${data.agent} — Earnings**`,
          ``,
          `**Total:** $${data.totalEarnedUsdc.toFixed(2)} USDC (${data.totalJobs} jobs)`,
          data.avgRating ? `**Rating:** ${data.avgRating.toFixed(1)}/5` : `**Rating:** Unrated`,
          ``,
          `**24h:** $${data.periods["24h"].earnedUsdc.toFixed(2)} (${data.periods["24h"].jobs} jobs)`,
          `**7d:** $${data.periods["7d"].earnedUsdc.toFixed(2)} (${data.periods["7d"].jobs} jobs)`,
          `**30d:** $${data.periods["30d"].earnedUsdc.toFixed(2)} (${data.periods["30d"].jobs} jobs)`,
        ];

        if (data.payouts.length > 0) {
          lines.push(``, `**Recent Payouts:**`);
          for (const p of data.payouts.slice(0, 10)) {
            const buyer = p.buyerName || "User";
            lines.push(`- $${p.amountUsdc.toFixed(2)} from ${buyer} (Job #${p.jobId})`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── job_chain ──
  server.tool(
    "job_chain",
    "View the composition chain for a job — see which agents hired which agents, with costs at each level.",
    {
      job_id: z.string().describe("Job ID to trace the chain for"),
    },
    async ({ job_id }) => {
      try {
        const data = await api.get<{
          job: { id: string; buyerName: string | null; sellerName: string | null; amountUsdc: number; status: number; buyerType: string };
          parents: Array<{ id: string; buyerName: string | null; sellerName: string | null; amountUsdc: number }>;
          children: Array<{ id: string; buyerName: string | null; sellerName: string | null; amountUsdc: number; status: number }>;
          totalChainCostUsdc: number;
          depth: number;
        }>(`/jobs/${job_id}/chain`);

        const statusMap: Record<number, string> = { 0: "Created", 1: "Completed", 2: "Disputed", 3: "Cancelled", 4: "Input Required" };
        const lines = [`**Job #${data.job.id} — Composition Chain**`, ``];

        if (data.parents.length > 0) {
          for (const p of data.parents) {
            lines.push(`${p.buyerName || "User"} → **${p.sellerName || "Agent"}** ($${p.amountUsdc.toFixed(2)})`);
            lines.push(`  ↓`);
          }
        }

        lines.push(`${data.job.buyerName || "User"} → **${data.job.sellerName || "Agent"}** ($${data.job.amountUsdc.toFixed(2)}) [${statusMap[data.job.status] || "Unknown"}]`);

        if (data.children.length > 0) {
          for (const c of data.children) {
            lines.push(`  ↓`);
            lines.push(`${c.buyerName || "Agent"} → **${c.sellerName || "Agent"}** ($${c.amountUsdc.toFixed(2)}) [${statusMap[c.status] || "Unknown"}]`);
          }
        }

        lines.push(``, `**Total chain cost:** $${data.totalChainCostUsdc.toFixed(2)} USDC | **Depth:** ${data.depth}`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
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
