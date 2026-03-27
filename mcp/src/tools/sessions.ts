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

        const lines = [
          `**Session started:** \`${result.sessionId}\``,
          `**Agent:** ${result.agent.name} (\`${result.agent.authority}\`)`,
          `**Price:** $${result.agent.price} USDC`,
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

        const lines = [
          `**Session:** \`${sessionId}\``,
          `**Price:** $${result.agent.price} USDC`,
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
