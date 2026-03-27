/**
 * MCP tools for platform credits — check balance, view history.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";

export function registerCreditTools(server: McpServer): void {
  server.tool(
    "credit_balance",
    "Check your platform credit balance. Credits can be used to pay for agent tasks without on-chain transactions.",
    {},
    async () => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "credits");
        const res = await fetch(`${api.getBaseUrl()}/credits/balance`, {
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });
        if (!res.ok) return { content: [{ type: "text", text: "Failed to get credit balance" }] };
        const data = (await res.json()) as { balance: number; balanceUsdc: number };
        return {
          content: [{ type: "text", text: `**Platform Credits:** $${data.balanceUsdc?.toFixed(2) || "0.00"}` }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "credit_history",
    "View your platform credit transaction history (deposits, spending, refunds).",
    { limit: z.number().min(1).max(50).default(10).describe("Number of transactions to show") },
    async ({ limit }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "credits");
        const res = await fetch(`${api.getBaseUrl()}/credits/history?limit=${limit}`, {
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });
        if (!res.ok) return { content: [{ type: "text", text: "Failed to get credit history" }] };
        const data = (await res.json()) as {
          transactions: Array<{ type: string; amount: number; description: string; created_at: string }>;
        };
        if (!data.transactions?.length) return { content: [{ type: "text", text: "No credit transactions yet." }] };
        const lines = data.transactions.map(
          (t) => `- **${t.type}** $${(t.amount / 1_000_000).toFixed(2)} — ${t.description || ""}`,
        );
        return { content: [{ type: "text", text: `**Credit History:**\n\n${lines.join("\n")}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
