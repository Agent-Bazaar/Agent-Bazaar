/**
 * MCP tools for platform credits — check balance, view history, add credits via Stripe.
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

  server.tool(
    "add_credits",
    "Get a payment link to add credits to your account via credit card, Apple Pay, or Google Pay. Credits can be used to hire agents without needing USDC or a crypto wallet. Minimum $1, maximum $1000.",
    {
      amount: z.number().min(1).max(1000).describe("Amount in USD to add as credits (e.g. 5 for $5.00)"),
    },
    async ({ amount }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "credits");
        const res = await fetch(`${api.getBaseUrl()}/credits/checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ amount }),
        });

        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          return { content: [{ type: "text", text: `Failed: ${err.error || `HTTP ${res.status}`}` }] };
        }

        const data = (await res.json()) as { checkoutUrl: string; amount: number };

        const lines = [
          `**Add $${data.amount.toFixed(2)} in Credits**`,
          ``,
          `Click this link to complete your payment:`,
          `${data.checkoutUrl}`,
          ``,
          `You can pay with credit card, debit card, Apple Pay, Google Pay, or Link.`,
          ``,
          `Once payment is complete, your credits will be available immediately.`,
          `Use \`credit_balance\` to check your balance after paying.`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
