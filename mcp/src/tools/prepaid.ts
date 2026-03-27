/**
 * MCP tools for MPP prepaid sessions — open, extend, and manage prepaid agent sessions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";
import { formatUsdc } from "../format.js";

export function registerPrepaidTools(server: McpServer): void {
  server.tool(
    "open_prepaid_session",
    "Open a prepaid session with an agent. Pay once up front, then send unlimited messages until the budget runs out. Much faster than per-message payments.",
    {
      agent: z.string().describe("Agent wallet address"),
      budget: z.string().describe("Budget in USDC (e.g. '5.00' for $5)"),
    },
    async ({ agent, budget }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "chat");
        const budgetUsdc = parseFloat(budget);
        if (isNaN(budgetUsdc) || budgetUsdc <= 0) {
          return { content: [{ type: "text", text: "Budget must be a positive number (e.g. '5.00')" }] };
        }

        const res = await fetch(`${api.getBaseUrl()}/sessions/prepaid`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ agent, budgetUsdc }),
        });
        const data = (await res.json()) as Record<string, unknown>;

        if (data.transaction) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `**Prepaid Session Quote**`,
                  `Agent: ${(data.agent as { name: string })?.name || agent}`,
                  `Budget: $${budgetUsdc.toFixed(2)}`,
                  `Est. messages: ${data.estimatedMessages}`,
                  ``,
                  `Sign the transaction to open the session. Use \`confirm_prepaid_session\` with the signed transaction.`,
                ].join("\n"),
              },
            ],
          };
        }

        if (data.sessionId) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `**Prepaid Session Opened!**`,
                  `Session: \`${data.sessionId}\``,
                  `Budget: $${budgetUsdc.toFixed(2)}`,
                  `Est. messages: ${data.estimatedMessages}`,
                  ``,
                  `Use \`send_message\` with this sessionId. Messages are instant — no per-message payment.`,
                ].join("\n"),
              },
            ],
          };
        }

        return { content: [{ type: "text", text: `Error: ${data.error || "Unknown error"}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "extend_session",
    "Add more budget to an existing prepaid session without closing it.",
    {
      sessionId: z.string().describe("Session ID to extend"),
      additionalUsdc: z.string().describe("Additional budget in USDC (e.g. '2.00')"),
    },
    async ({ sessionId, additionalUsdc }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "chat");
        const amount = parseFloat(additionalUsdc);

        const res = await fetch(`${api.getBaseUrl()}/sessions/${sessionId}/extend`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ additionalUsdc: amount }),
        });
        const data = (await res.json()) as Record<string, unknown>;

        if (data.sessionId) {
          return {
            content: [
              {
                type: "text",
                text: `Session extended! Budget: $${data.budgetUsdc} | Spent: $${data.spentUsdc} | Remaining: $${data.remainingUsdc}`,
              },
            ],
          };
        }
        return { content: [{ type: "text", text: `Error: ${data.error || "Failed to extend"}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
