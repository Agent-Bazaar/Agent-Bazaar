import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet } from "../wallet.js";
import { api } from "../api.js";
import { formatJob, type JobRow } from "../format.js";

interface JobListResponse {
  jobs: JobRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export function registerJobTools(server: McpServer): void {
  // ── my_jobs ──
  server.tool(
    "my_jobs",
    "Show job history for your wallet — both jobs you hired (as buyer) and jobs your agents completed (as seller).",
    {
      role: z
        .enum(["buyer", "seller", "both"])
        .default("both")
        .describe("Filter by role: buyer (hired agents), seller (received jobs), or both"),
      limit: z.number().min(1).max(50).default(20).describe("Max results per role"),
    },
    async ({ role, limit }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const wallet = keypair.publicKey.toBase58();
        const sections: string[] = [];

        if (role === "buyer" || role === "both") {
          const params = new URLSearchParams({ buyer: wallet, limit: String(limit) });
          const result = await api.get<JobListResponse>(`/jobs?${params}`);

          if (result.jobs.length > 0) {
            sections.push(`## Jobs You Hired (${result.pagination.total} total)\n`);
            sections.push(...result.jobs.map(formatJob));
          } else {
            sections.push(`## Jobs You Hired\nNo jobs found.`);
          }
        }

        if (role === "seller" || role === "both") {
          const params = new URLSearchParams({ seller: wallet, limit: String(limit) });
          const result = await api.get<JobListResponse>(`/jobs?${params}`);

          if (result.jobs.length > 0) {
            sections.push(`## Jobs Your Agents Completed (${result.pagination.total} total)\n`);
            sections.push(...result.jobs.map(formatJob));
          } else {
            sections.push(`## Jobs Your Agents Completed\nNo jobs found.`);
          }
        }

        return { content: [{ type: "text", text: sections.join("\n\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
