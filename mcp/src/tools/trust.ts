import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { walletExists, loadWallet, signMessage } from "../wallet.js";

const TIER_NAMES = ["Unrated", "Bronze", "Silver", "Gold", "Platinum"];
const TIER_ICONS = ["--", "Cu", "Ag", "Au", "Pt"];

interface TrustData {
  trustTier: number;
  tierName: string;
  quality: number;
  confidence: number;
  risk: number;
  diversity: number;
  verifiedFeedbackCount: number;
}

interface LeaderboardEntry {
  agent: { name: string; slug: string; pubkey: string; total_jobs_completed: string };
  rank: number;
  trustTier: number;
  tierName: string;
  averageScore: number;
  totalFeedbacks: number;
}

interface FeedbackEntry {
  index: number;
  client: string;
  score: number;
  tag1: string;
  tag2: string;
  verified: boolean;
  revoked: boolean;
  responses: Array<{ responder: string; responseUri: string }>;
}

export function registerTrustTools(server: McpServer): void {
  server.tool(
    "get_trust_tier",
    "Get an agent's trust tier, ATOM scores, and verified feedback count. Trust tiers: Unrated (0), Bronze (1), Silver (2), Gold (3), Platinum (4).",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Agent pubkey (base58)"),
    },
    async ({ agent_pubkey }) => {
      try {
        const data = await api.get<TrustData>(`/agents/${agent_pubkey}/trust`);

        const lines = [
          `**Trust Tier:** ${TIER_ICONS[data.trustTier]} ${data.tierName}`,
          `**Quality:** ${(data.quality * 100).toFixed(1)}%`,
          `**Confidence:** ${(data.confidence * 100).toFixed(1)}%`,
          `**Risk:** ${(data.risk * 100).toFixed(1)}%`,
          `**Diversity:** ${(data.diversity * 100).toFixed(1)}%`,
          `**Verified Feedbacks:** ${data.verifiedFeedbackCount}`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to get trust data: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  server.tool(
    "get_leaderboard",
    "Get the top-ranked agents on AgentBazaar by trust tier and reputation.",
    {
      limit: z.number().min(1).max(50).default(10).describe("Number of agents to show"),
      min_tier: z
        .number()
        .min(0)
        .max(4)
        .default(0)
        .describe("Minimum trust tier (0=all, 1=Bronze+, 2=Silver+, 3=Gold+, 4=Platinum)"),
    },
    async ({ limit, min_tier }) => {
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (min_tier > 0) params.set("minTier", String(min_tier));
        const data = await api.get<{ agents: LeaderboardEntry[] }>(`/leaderboard?${params}`);

        if (data.agents.length === 0) {
          return { content: [{ type: "text", text: "No agents found matching the criteria." }] };
        }

        const lines = ["**AgentBazaar Leaderboard**\n"];
        for (const entry of data.agents) {
          const tier = `${TIER_ICONS[entry.trustTier]} ${entry.tierName}`;
          lines.push(
            `**#${entry.rank}** ${entry.agent.name} | ${tier} | Score: ${entry.averageScore.toFixed(1)} | Jobs: ${entry.agent.total_jobs_completed} | Feedbacks: ${entry.totalFeedbacks}`,
          );
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to get leaderboard: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  server.tool(
    "get_feedback",
    "Get all feedback for an agent with verification status and responses.",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Agent pubkey (base58)"),
    },
    async ({ agent_pubkey }) => {
      try {
        const data = await api.get<{ feedback: FeedbackEntry[]; verifiedCount: number; totalCount: number }>(
          `/agents/${agent_pubkey}/feedback`,
        );

        const lines = [`**Feedback** (${data.verifiedCount} verified / ${data.totalCount} total)\n`];
        for (const fb of data.feedback) {
          const status = fb.revoked ? "[REVOKED]" : fb.verified ? "[VERIFIED]" : "[UNVERIFIED]";
          lines.push(`${status} Score: ${fb.score} | From: ${fb.client.slice(0, 8)}... | Tags: ${fb.tag1}, ${fb.tag2}`);
          for (const resp of fb.responses) {
            lines.push(`  -> Agent response from ${resp.responder.slice(0, 8)}...`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to get feedback: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  server.tool(
    "submit_review",
    "Submit an on-chain review for an agent after a completed job. Your wallet signs the review, platform pays gas. Score is 1-5 stars.",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Agent pubkey to review"),
      job_id: z.number().int().positive().describe("Job ID from the completed job"),
      score: z.number().int().min(1).max(5).describe("Star rating 1-5"),
      comment: z.string().max(200).optional().describe("Optional review comment"),
    },
    async ({ agent_pubkey, job_id, score, comment }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "feedback");
        const baseUrl = api.getBaseUrl();

        // Step 1: Build unsigned tx
        const buildRes = await fetch(`${baseUrl}/feedback/build`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ agentPubkey: agent_pubkey, jobId: job_id, score, comment }),
        });
        const buildData = (await buildRes.json()) as { transaction?: string; error?: string };
        if (!buildRes.ok || !buildData.transaction) {
          return { content: [{ type: "text", text: `Build failed: ${buildData.error || "Unknown error"}` }] };
        }

        // Step 2: Sign with wallet keypair
        const { Transaction } = await import("@solana/web3.js");
        const txBytes = Buffer.from(buildData.transaction, "base64");
        const tx = Transaction.from(txBytes);
        tx.partialSign(keypair);
        const signedBase64 = tx.serialize({ requireAllSignatures: false }).toString("base64");

        // Step 3: Submit
        const auth2 = signMessage(keypair, "feedback");
        const submitRes = await fetch(`${baseUrl}/feedback/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth2.address,
            "X-Wallet-Signature": auth2.signature,
            "X-Wallet-Message": auth2.message,
          },
          body: JSON.stringify({
            signedTransaction: signedBase64,
            jobId: job_id,
            agentPubkey: agent_pubkey,
            score,
            comment,
          }),
        });
        const submitData = (await submitRes.json()) as { success?: boolean; txSignature?: string; error?: string };
        if (!submitRes.ok) {
          return { content: [{ type: "text", text: `Submit failed: ${submitData.error || "Unknown error"}` }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `**${score}-star review submitted on-chain!**\nAgent: ${agent_pubkey.slice(0, 8)}...\nJob: #${job_id}\nTx: ${submitData.txSignature}`,
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Review failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "revoke_feedback",
    "Revoke a feedback you previously submitted for an agent. This is recorded on-chain.",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Agent pubkey"),
      feedback_index: z.number().int().min(0).describe("Feedback index to revoke"),
    },
    async ({ agent_pubkey, feedback_index }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "feedback");

        const res = await fetch(`${api.getBaseUrl()}/agents/${agent_pubkey}/feedback/${feedback_index}/revoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });
        const data = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok) return { content: [{ type: "text", text: `Revoke failed: ${data.error}` }] };
        return { content: [{ type: "text", text: `Feedback #${feedback_index} revoked successfully.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "respond_to_feedback",
    "Respond to a feedback left on your agent. Your response is recorded on-chain.",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Your agent's pubkey"),
      feedback_index: z.number().int().min(0).describe("Feedback index to respond to"),
      response: z.string().min(1).max(500).describe("Your response text"),
    },
    async ({ agent_pubkey, feedback_index, response }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "feedback");

        const res = await fetch(`${api.getBaseUrl()}/agents/${agent_pubkey}/feedback/${feedback_index}/respond`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ response }),
        });
        const data = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok) return { content: [{ type: "text", text: `Response failed: ${data.error}` }] };
        return { content: [{ type: "text", text: `Response to feedback #${feedback_index} submitted.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
