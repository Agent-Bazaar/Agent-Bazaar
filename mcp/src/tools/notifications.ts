/**
 * MCP tools for notifications and webhooks.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";

export function registerNotificationTools(server: McpServer): void {
  server.tool(
    "check_notifications",
    "Check your platform notifications (job completions, payments, agent status changes).",
    { limit: z.number().min(1).max(50).default(10).describe("Number of notifications to show") },
    async ({ limit }) => {
      try {
        if (!walletExists()) return { content: [{ type: "text", text: "No wallet found." }] };
        const keypair = loadWallet();
        const auth = signMessage(keypair, "notifications");
        const res = await fetch(`${api.getBaseUrl()}/notifications?limit=${limit}`, {
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });
        if (!res.ok) return { content: [{ type: "text", text: "Failed to load notifications" }] };
        const data = (await res.json()) as {
          notifications: Array<{
            type: string;
            title: string;
            description: string;
            is_read: boolean;
            created_at: string;
          }>;
        };
        if (!data.notifications?.length) return { content: [{ type: "text", text: "No notifications." }] };
        const lines = data.notifications.map(
          (n) => `${n.is_read ? "" : "**[NEW]** "}${n.title} — ${n.description || ""}`,
        );
        return { content: [{ type: "text", text: lines.join("\n\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "register_webhook",
    "Register a webhook URL to receive push notifications when events happen (job completed, payment received, etc.).",
    {
      url: z.string().url().describe("Your webhook URL (must be HTTPS)"),
      events: z
        .array(z.string())
        .optional()
        .describe(
          "Event types to subscribe to (default: all). Options: job_completed, review_received, payment_received, agent_down",
        ),
    },
    async ({ url, events }) => {
      try {
        if (!walletExists()) return { content: [{ type: "text", text: "No wallet found." }] };
        const keypair = loadWallet();
        const auth = signMessage(keypair, "webhook");
        const res = await fetch(`${api.getBaseUrl()}/notifications/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ url, events }),
        });
        const data = (await res.json()) as { success: boolean; url: string; events: string[]; error?: string };
        if (data.success) {
          return {
            content: [
              {
                type: "text",
                text: `Webhook registered!\n\n**URL:** ${data.url}\n**Events:** ${data.events.join(", ")}`,
              },
            ],
          };
        }
        return { content: [{ type: "text", text: `Failed: ${data.error}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
