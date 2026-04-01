import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet } from "../wallet.js";
import { api } from "../api.js";
import { postWithPayment } from "../payment.js";
import { formatUsdc, type AgentRow } from "../format.js";

interface CallResult {
  result: unknown;
  agent: { name: string; authority: string; price: number };
  verification: {
    score: number;
    passed: boolean;
    action: string;
    structural?: Record<string, unknown>;
    quality?: { score: number; reasoning: string };
  };
  job: { id: number; status: string };
  sessionId?: string;
  quoteId?: string;
  meta: { totalMs: number; agentLatencyMs: number };
}

interface QuoteResult {
  quoteId: string;
  agent: { name: string; authority: string };
  price: number;
  priceUsdc: number;
  source: "agent" | "static";
  expiresAt: string;
  estimate?: string;
  breakdown?: string;
}

export function registerHiringTools(server: McpServer): void {
  // ── quote_agent ──
  server.tool(
    "quote_agent",
    "Get a price quote from an agent before paying. Returns a quoteId you can pass to hire_agent.",
    {
      task: z.string().min(1).describe("Task to get a quote for"),
      agent: z.string().optional().describe("Target specific agent by wallet address"),
      skills: z.string().optional().describe("Filter agents by skills"),
    },
    async ({ task, agent, skills }) => {
      try {
        const baseUrl = api.getBaseUrl();
        const body: Record<string, unknown> = { task };
        if (agent) body.agent = agent;
        if (skills) body.skills = skills;

        const res = await fetch(`${baseUrl}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as QuoteResult & { error?: string };
        if (!res.ok) {
          return { content: [{ type: "text", text: `Quote failed: ${data.error || `HTTP ${res.status}`}` }] };
        }

        const lines = [
          `**Agent:** ${data.agent.name} (\`${data.agent.authority}\`)`,
          `**Price:** $${data.priceUsdc} USDC (${data.source} pricing)`,
          `**Quote ID:** \`${data.quoteId}\``,
          `**Expires:** ${new Date(Number(data.expiresAt)).toLocaleString()}`,
        ];
        if (data.estimate) lines.push(`**Estimate:** ${data.estimate}`);
        if (data.breakdown) lines.push(`**Breakdown:** ${data.breakdown}`);
        lines.push(``, `Use with: hire_agent with quoteId: "${data.quoteId}"`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Quote failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── hire_agent ──
  server.tool(
    "hire_agent",
    "Hire an AI agent to perform a task. Finds the best agent, pays via x402, and returns the result with verification score.",
    {
      task: z.string().min(1).describe("Task for the agent to perform"),
      skills: z.string().optional().describe("Filter agents by skills (e.g. 'summarization, research')"),
      agent: z.string().optional().describe("Target specific agent by wallet address (bypasses discovery)"),
      quoteId: z.string().optional().describe("Use a previously obtained quote ID for dynamic pricing"),
      sessionId: z.string().optional().describe("Continue an existing multi-turn session"),
      createSession: z.boolean().optional().describe("Set true to create a new multi-turn session"),
      file_url: z.string().optional().describe("URL of an uploaded file to include with the task (from upload_file)"),
    },
    async ({ task, skills, agent, quoteId, sessionId, createSession, file_url }) => {
      try {
        if (!walletExists()) {
          return {
            content: [
              {
                type: "text",
                text: "No wallet found. Use `setup_wallet` to create one and deposit USDC before hiring agents.",
              },
            ],
          };
        }

        const keypair = loadWallet();
        const baseUrl = api.getBaseUrl();

        const body: Record<string, unknown> = { task };
        if (skills) body.skills = skills;
        if (agent) body.agent = agent;
        if (quoteId) body.quoteId = quoteId;
        if (sessionId) body.sessionId = sessionId;
        if (createSession) body.createSession = true;
        if (file_url) body.file_url = file_url;

        const result = await postWithPayment<CallResult>(`${baseUrl}/call`, body, keypair);

        const output = typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);

        const lines = [
          `**Agent:** ${result.agent.name} (\`${result.agent.authority}\`)`,
          `**Price:** $${result.agent.price} USDC`,
          `**Verification:** ${result.verification.score}/100 — ${result.verification.action}`,
          `**Job:** #${result.job.id} (${result.job.status})`,
          `**Latency:** ${result.meta.agentLatencyMs}ms (total: ${result.meta.totalMs}ms)`,
        ];

        if (result.sessionId) lines.push(`**Session:** \`${result.sessionId}\``);
        if (result.quoteId) lines.push(`**Quote:** \`${result.quoteId}\``);

        if (result.verification.quality?.reasoning) {
          lines.push(`**Quality:** ${result.verification.quality.reasoning}`);
        }

        lines.push(``);
        lines.push(`---`);
        lines.push(`**Result:**`);
        lines.push(output);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("insufficient") || msg.includes("balance")) {
          const keypair = loadWallet();
          return {
            content: [
              {
                type: "text",
                text: [
                  `Insufficient USDC balance to hire an agent.`,
                  ``,
                  `Deposit USDC (Solana) to: \`${keypair.publicKey.toBase58()}\``,
                  `Use \`check_balance\` to see your current balance.`,
                ].join("\n"),
              },
            ],
          };
        }

        return { content: [{ type: "text", text: `Hiring failed: ${msg}` }] };
      }
    },
  );

  // ── get_hire_instructions ──
  server.tool(
    "get_hire_instructions",
    "Get code examples and instructions for hiring a specific agent via x402, A2A, or direct call.",
    {
      agent_pubkey: z.string().min(32).max(44).describe("Agent pubkey (base58)"),
    },
    async ({ agent_pubkey }) => {
      try {
        const agent = await api.get<AgentRow>(`/agents/${agent_pubkey}`);
        const baseUrl = api.getBaseUrl();
        const price = formatUsdc(agent.price_per_request);

        const text = [
          `# How to hire **${agent.name}**`,
          ``,
          `**Price:** $${price} USDC/request`,
          ``,
          `## Option 1: Use this MCP (simplest)`,
          ``,
          "```",
          `hire_agent with task: "your task here" and agent: "${agent_pubkey}"`,
          "```",
          ``,
          `## Option 2: One-Call via x402`,
          ``,
          "```bash",
          `curl -X POST ${baseUrl}/call \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -H "X-Payment: <x402-payment-header>" \\`,
          `  -d '{"task": "your task", "agent": "${agent.authority}"}'`,
          "```",
          ``,
          `## Option 3: A2A Protocol`,
          ``,
        ];

        if (agent.slug) {
          text.push("```bash");
          text.push(`curl -X POST ${baseUrl}/a2a/${agent.slug}/ \\`);
          text.push(`  -H "Content-Type: application/json" \\`);
          text.push(
            `  -d '{"jsonrpc":"2.0","id":1,"method":"tasks/send","params":{"message":{"parts":[{"type":"text","text":"your task"}]}}}'`,
          );
          text.push("```");
          text.push(``);
          text.push(`**A2A Agent Card:** ${baseUrl}/a2a/${agent.slug}/.well-known/agent.json`);
        } else {
          text.push(`This agent does not have an A2A slug configured.`);
        }

        return { content: [{ type: "text", text: text.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── review_agent ──
  server.tool(
    "review_agent",
    "Leave a review for an agent (1-5 stars). Reviews are submitted on-chain via 8004-solana and show up on 8004market. Both humans and agents can leave reviews.",
    {
      agentPubkey: z.string().describe("The agent's pubkey/authority to review"),
      stars: z.number().min(1).max(5).describe("Rating from 1 to 5 stars"),
      comment: z.string().optional().describe("Optional review comment"),
    },
    async ({ agentPubkey, stars, comment }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const { signMessage } = await import("../wallet.js");
        const auth = signMessage(keypair, "review");

        // Step 1: Build review
        const buildRes = await fetch(`${process.env.AGENTBAZAAR_API || "https://agentbazaar.dev"}/feedback/build`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ agentPubkey, score: stars, comment }),
        });

        if (!buildRes.ok) {
          const err = await buildRes.json();
          return {
            content: [
              { type: "text", text: `Failed to build review: ${(err as { error?: string }).error || buildRes.status}` },
            ],
          };
        }

        const buildData = (await buildRes.json()) as { reviewMessage: string; agentMint: string; agentName: string };

        // Step 2: Sign the review message
        const nacl = (await import("tweetnacl")).default;
        const msgBytes = new TextEncoder().encode(buildData.reviewMessage);
        const reviewSig = nacl.sign.detached(msgBytes, keypair.secretKey);
        const sigBase64 = Buffer.from(reviewSig).toString("base64");

        // Step 3: Submit
        const auth2 = signMessage(keypair, "review");
        const submitRes = await fetch(`${process.env.AGENTBAZAAR_API || "https://agentbazaar.dev"}/feedback/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth2.address,
            "X-Wallet-Signature": auth2.signature,
            "X-Wallet-Message": auth2.message,
          },
          body: JSON.stringify({
            agentPubkey,
            agentMint: buildData.agentMint,
            score: stars,
            comment,
            reviewSignature: sigBase64,
            reviewMessage: buildData.reviewMessage,
          }),
        });

        const result = (await submitRes.json()) as { success: boolean; verified: boolean; message: string };

        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `**${stars}-star review submitted for ${buildData.agentName}!**`,
                  result.verified ? `Wallet verified ✓` : "",
                  comment ? `Comment: "${comment}"` : "",
                  ``,
                  `Your review is on-chain and visible on 8004market.`,
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          };
        }

        return { content: [{ type: "text", text: `Review failed: ${result.message}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
