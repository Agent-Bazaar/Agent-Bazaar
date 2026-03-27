/**
 * MCP tools for agent email — check inbox, read emails, send emails.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";

interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  created_at: string;
}

export function registerEmailTools(server: McpServer): void {
  // ── check_inbox ──
  server.tool(
    "check_inbox",
    "List emails in your agent's inbox. Shows recent messages received by your registered agent.",
    {},
    async () => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const auth = signMessage(keypair, "inbox");
        const baseUrl = api.getBaseUrl();

        const res = await fetch(`${baseUrl}/agents/me/inbox`, {
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          return {
            content: [{ type: "text", text: `Failed to check inbox: ${(err as { error: string }).error}` }],
          };
        }

        const data = (await res.json()) as { messages?: EmailMessage[] };
        const messages = data.messages || [];

        if (messages.length === 0) {
          return { content: [{ type: "text", text: "Inbox is empty — no messages received yet." }] };
        }

        const lines = messages.map(
          (m: EmailMessage, i: number) =>
            `${i + 1}. **From:** ${m.from}\n   **Subject:** ${m.subject}\n   **Date:** ${m.created_at}\n   **ID:** \`${m.id}\``,
        );

        return {
          content: [
            {
              type: "text",
              text: `**Inbox (${messages.length} messages)**\n\n${lines.join("\n\n")}\n\n_Use read_email with a message ID to read the full content._`,
            },
          ],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // ── read_email ──
  server.tool(
    "read_email",
    "Read a specific email from your agent's inbox.",
    {
      messageId: z.string().min(1).describe("The message ID to read (from check_inbox)"),
    },
    async ({ messageId }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const auth = signMessage(keypair, "inbox");
        const baseUrl = api.getBaseUrl();

        const res = await fetch(`${baseUrl}/agents/me/inbox/${encodeURIComponent(messageId)}`, {
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          return {
            content: [{ type: "text", text: `Failed to read email: ${(err as { error: string }).error}` }],
          };
        }

        const msg = (await res.json()) as EmailMessage;

        const lines = [
          `**From:** ${msg.from}`,
          `**To:** ${msg.to}`,
          `**Subject:** ${msg.subject}`,
          `**Date:** ${msg.created_at}`,
          ``,
          `---`,
          ``,
          msg.text || "(no text content)",
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // ── send_email ──
  server.tool(
    "send_email",
    "Send an email from your agent's inbox to any email address.",
    {
      to: z.string().email().describe("Recipient email address"),
      subject: z.string().min(1).describe("Email subject"),
      body: z.string().min(1).describe("Email body (plain text)"),
    },
    async ({ to, subject, body }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const auth = signMessage(keypair, "inbox");
        const baseUrl = api.getBaseUrl();

        const res = await fetch(`${baseUrl}/agents/me/inbox/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ to, subject, text: body }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          return {
            content: [{ type: "text", text: `Failed to send email: ${(err as { error: string }).error}` }],
          };
        }

        return { content: [{ type: "text", text: `Email sent to ${to}: "${subject}"` }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // ── compose_reply ──
  server.tool(
    "compose_reply",
    "Reply to an email in your agent's inbox.",
    {
      messageId: z.string().min(1).describe("The message ID to reply to"),
      body: z.string().min(1).describe("Reply body (plain text)"),
    },
    async ({ messageId, body }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const auth = signMessage(keypair, "inbox");
        const baseUrl = api.getBaseUrl();

        // First read the original message to get sender and subject
        const readRes = await fetch(`${baseUrl}/agents/me/inbox/${encodeURIComponent(messageId)}`, {
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });

        if (!readRes.ok) {
          return { content: [{ type: "text", text: "Failed to read original message for reply" }] };
        }

        const original = (await readRes.json()) as EmailMessage;

        // Send reply
        const sendRes = await fetch(`${baseUrl}/agents/me/inbox/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({
            to: original.from,
            subject: `Re: ${original.subject}`,
            text: body,
          }),
        });

        if (!sendRes.ok) {
          const err = await sendRes.json().catch(() => ({ error: `HTTP ${sendRes.status}` }));
          return {
            content: [{ type: "text", text: `Failed to send reply: ${(err as { error: string }).error}` }],
          };
        }

        return {
          content: [{ type: "text", text: `Reply sent to ${original.from}: "Re: ${original.subject}"` }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );
}
