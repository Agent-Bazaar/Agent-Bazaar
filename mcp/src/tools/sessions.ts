import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";
import { postWithPayment } from "../payment.js";
import { formatUsdc } from "../format.js";

interface SessionInfo {
  id: string;
  buyer: string;
  agent_auth: string;
  status: "active" | "closed" | "expired";
  budget_limit: string | null;
  total_spent: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface SessionMessage {
  id: number;
  session_id: string;
  turn: number;
  role: "user" | "agent";
  content: string;
  created_at: string;
}

interface CallResult {
  result: unknown;
  agent: { name: string; authority: string; price: number };
  verification: { score: number; passed: boolean; action: string };
  job: { id: number; status: string };
  sessionId?: string;
  meta: { totalMs: number; agentLatencyMs: number };
}

export function registerSessionTools(server: McpServer): void {
  // ── start_session ──
  server.tool(
    "start_session",
    "Start a multi-turn conversation with an agent. Returns a sessionId for subsequent messages.",
    {
      task: z.string().min(1).describe("Initial message/task for the agent"),
      agent: z.string().optional().describe("Target agent by wallet address"),
      skills: z.string().optional().describe("Filter agents by skills"),
      budgetLimit: z.number().optional().describe("Max spend in USDC micro-units for this session"),
    },
    async ({ task, agent, skills, budgetLimit }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const baseUrl = api.getBaseUrl();

        const body: Record<string, unknown> = { task, createSession: true };
        if (agent) body.agent = agent;
        if (skills) body.skills = skills;
        if (budgetLimit) body.budgetLimit = budgetLimit;

        const result = await postWithPayment<CallResult>(`${baseUrl}/call`, body, keypair);
        const output = typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);

        const priceStr = result.agent.price > 0 ? `$${result.agent.price} USDC` : "Free (greeting)";

        const lines = [
          `**Session started:** \`${result.sessionId}\``,
          `**Agent:** ${result.agent.name} (\`${result.agent.authority}\`)`,
          `**Paid:** ${priceStr}`,
          `**Verification:** ${result.verification.score}/100`,
          ``,
          `---`,
          `**Agent response:**`,
          output,
          ``,
          `_Continue with: send_message sessionId: "${result.sessionId}" message: "..."_`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Session start failed: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  // ── send_message ──
  server.tool(
    "send_message",
    "Send a follow-up message in an existing session. The agent receives full conversation history.",
    {
      sessionId: z.string().min(1).describe("Session ID from start_session"),
      message: z.string().min(1).describe("Message to send to the agent"),
      file_url: z
        .string()
        .optional()
        .describe("URL of an uploaded file to include with the message (from upload_file)"),
    },
    async ({ sessionId, message, file_url }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const baseUrl = api.getBaseUrl();

        const body: Record<string, unknown> = { task: message, sessionId };
        if (file_url) body.file_url = file_url;

        const result = await postWithPayment<CallResult>(`${baseUrl}/call`, body, keypair);
        const output = typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);

        const priceStr = result.agent.price > 0 ? `$${result.agent.price} USDC` : "Free (greeting)";

        const lines = [
          `**Session:** \`${sessionId}\``,
          `**Paid:** ${priceStr}`,
          `**Verification:** ${result.verification.score}/100`,
          ``,
          `---`,
          `**Agent response:**`,
          output,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Message failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── close_session ──
  server.tool(
    "close_session",
    "Close an active session. No more messages can be sent after closing.",
    {
      sessionId: z.string().min(1).describe("Session ID to close"),
    },
    async ({ sessionId }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "session");
        const baseUrl = api.getBaseUrl();
        const res = await fetch(`${baseUrl}/sessions/${sessionId}/close`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
        });
        const data = (await res.json()) as {
          success: boolean;
          totalSpent: number;
          messageCount: number;
          error?: string;
        };

        if (!res.ok) {
          return { content: [{ type: "text", text: `Close failed: ${data.error || `HTTP ${res.status}`}` }] };
        }

        return {
          content: [
            {
              type: "text",
              text: [
                `Session \`${sessionId}\` closed.`,
                `Total spent: $${data.totalSpent} USDC`,
                `Messages: ${data.messageCount}`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Close failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── resume_session ──
  server.tool(
    "resume_session",
    "Resume a previous session by ID. Shows session status, spending summary, and recent conversation history so you can continue where you left off.",
    {
      sessionId: z.string().min(1).describe("Session ID to resume (from start_session or list_sessions)"),
      historyLimit: z.number().min(1).max(50).default(10).describe("Number of recent messages to show (default 10)"),
    },
    async ({ sessionId, historyLimit }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const auth = signMessage(keypair, "session");
        const baseUrl = api.getBaseUrl();
        const headers = {
          "X-Wallet-Address": auth.address,
          "X-Wallet-Signature": auth.signature,
          "X-Wallet-Message": auth.message,
        };

        // Fetch session info
        const sessionRes = await fetch(`${baseUrl}/sessions/${sessionId}`, { headers });
        const sessionData = (await sessionRes.json()) as SessionInfo & { error?: string };

        if (!sessionRes.ok) {
          return {
            content: [{ type: "text", text: `Session not found: ${sessionData.error || `HTTP ${sessionRes.status}`}` }],
          };
        }

        if (sessionData.status === "expired") {
          return {
            content: [
              {
                type: "text",
                text: `Session \`${sessionId}\` has expired (${sessionData.expires_at}). Start a new session with \`start_session\`.`,
              },
            ],
          };
        }

        if (sessionData.status === "closed") {
          return {
            content: [
              {
                type: "text",
                text: [
                  `Session \`${sessionId}\` is closed.`,
                  `Total spent: $${formatUsdc(sessionData.total_spent)} USDC | Messages: ${sessionData.message_count}`,
                  ``,
                  `Start a new session with \`start_session\`.`,
                ].join("\n"),
              },
            ],
          };
        }

        // Fetch recent messages
        const msgRes = await fetch(`${baseUrl}/sessions/${sessionId}/messages?limit=${historyLimit}`, { headers });
        const msgData = (await msgRes.json()) as { messages: SessionMessage[] };
        const messages = msgData.messages || [];

        const lines = [
          `**Session resumed:** \`${sessionId}\``,
          `**Status:** ${sessionData.status}`,
          `**Agent:** \`${sessionData.agent_auth}\``,
          `**Messages:** ${sessionData.message_count} | **Spent:** $${formatUsdc(sessionData.total_spent)} USDC`,
        ];

        if (sessionData.budget_limit) {
          const remaining = (Number(sessionData.budget_limit) - Number(sessionData.total_spent)) / 1_000_000;
          lines.push(
            `**Budget:** $${formatUsdc(sessionData.budget_limit)} USDC | **Remaining:** $${remaining.toFixed(2)} USDC`,
          );
        }

        lines.push(`**Expires:** ${sessionData.expires_at}`);

        if (messages.length > 0) {
          lines.push(``, `---`, `**Recent conversation:**`);
          for (const msg of messages) {
            const role = msg.role === "user" ? "You" : "Agent";
            const preview = msg.content.length > 300 ? msg.content.slice(0, 300) + "..." : msg.content;
            lines.push(`**${role}** (turn ${msg.turn}): ${preview}`);
          }
        }

        lines.push(``, `_Continue with: send_message sessionId: "${sessionId}" message: "..."_`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Resume failed: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  // ── list_sessions ──
  server.tool(
    "list_sessions",
    "List your active, closed, or expired sessions.",
    {
      status: z.enum(["active", "closed", "expired"]).optional().describe("Filter by session status"),
    },
    async ({ status }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const buyer = keypair.publicKey.toBase58();
        const baseUrl = api.getBaseUrl();

        const params = new URLSearchParams({ buyer });
        if (status) params.set("status", status);

        const res = await fetch(`${baseUrl}/sessions?${params.toString()}`);
        const data = (await res.json()) as { sessions: SessionInfo[]; error?: string };

        if (!res.ok) {
          return { content: [{ type: "text", text: `Failed: ${data.error || `HTTP ${res.status}`}` }] };
        }

        if (data.sessions.length === 0) {
          return { content: [{ type: "text", text: "No sessions found." }] };
        }

        const lines = data.sessions.map((s) =>
          [
            `**${s.id}** [${s.status}]`,
            `  Agent: \`${s.agent_auth}\``,
            `  Messages: ${s.message_count} | Spent: $${formatUsdc(s.total_spent)} USDC`,
          ].join("\n"),
        );

        return { content: [{ type: "text", text: lines.join("\n\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
