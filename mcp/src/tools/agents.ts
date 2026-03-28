import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { api } from "../api.js";
import { walletExists, loadWallet, createWallet, signMessage } from "../wallet.js";
import { formatAgent, formatAgentShort, type AgentRow } from "../format.js";

interface AgentListResponse {
  agents: AgentRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

interface AgentDetailResponse {
  agent: AgentRow;
  recentJobs: unknown[];
}

interface RegisterResponse {
  agent: AgentRow;
  message: string;
  a2aCard?: string;
  websocket?: { url: string; token: string; pollUrl: string };
}

export function registerAgentTools(server: McpServer): void {
  // ── search_agents ──
  server.tool(
    "search_agents",
    "Search for AI agents by skill, capability, or keyword. Returns matching agents with pricing and ratings.",
    {
      query: z.string().describe("Skills or keywords to search (e.g. 'summarize', 'audit solana', 'translate')"),
      limit: z.number().min(1).max(50).default(10).describe("Max results (default 10)"),
      active_only: z.boolean().default(true).describe("Only show active agents"),
    },
    async ({ query, limit, active_only }) => {
      try {
        const params = new URLSearchParams({
          skills: query,
          limit: String(limit),
          active_only: String(active_only),
        });
        const result = await api.get<AgentListResponse>(`/agents?${params}`);

        if (result.agents.length === 0) {
          return { content: [{ type: "text", text: `No agents found matching "${query}".` }] };
        }

        const text = [
          `Found ${result.pagination.total} agent(s) matching "${query}":`,
          ``,
          ...result.agents.map(formatAgentShort),
        ].join("\n\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Search failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── list_agents ──
  server.tool(
    "list_agents",
    "List all registered AI agents sorted by popularity (jobs completed).",
    {
      limit: z.number().min(1).max(100).default(20).describe("Max results (default 20)"),
      active_only: z.boolean().default(true).describe("Only show active agents"),
    },
    async ({ limit, active_only }) => {
      try {
        const params = new URLSearchParams({
          limit: String(limit),
          active_only: String(active_only),
        });
        const result = await api.get<AgentListResponse>(`/agents?${params}`);

        if (result.agents.length === 0) {
          return { content: [{ type: "text", text: "No agents registered yet." }] };
        }

        const text = [`${result.pagination.total} agent(s) total:`, ``, ...result.agents.map(formatAgentShort)].join(
          "\n\n",
        );

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── get_agent ──
  server.tool(
    "get_agent",
    "Get detailed information about a specific agent by pubkey, slug, or exact name.",
    {
      identifier: z.string().describe("Agent pubkey (base58), slug, or exact name"),
    },
    async ({ identifier }) => {
      try {
        // Try pubkey first (32-44 chars, base58)
        if (identifier.length >= 32 && identifier.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(identifier)) {
          try {
            const agent = await api.get<AgentRow>(`/agents/${identifier}`);
            return { content: [{ type: "text", text: formatAgent(agent) }] };
          } catch {
            // Not a pubkey, try other methods
          }
        }

        // Try as slug or name via search
        const result = await api.get<AgentListResponse>(`/agents?skills=${encodeURIComponent(identifier)}&limit=5`);
        const exact = result.agents.find(
          (a) => a.slug === identifier.toLowerCase() || a.name.toLowerCase() === identifier.toLowerCase(),
        );

        if (exact) {
          return { content: [{ type: "text", text: formatAgent(exact) }] };
        }

        if (result.agents.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `No exact match for "${identifier}". Did you mean:`,
                  ``,
                  ...result.agents.map(formatAgentShort),
                ].join("\n\n"),
              },
            ],
          };
        }

        return { content: [{ type: "text", text: `Agent "${identifier}" not found.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── register_agent ──
  server.tool(
    "register_agent",
    "Register a new AI agent on AgentBazaar. Creates a wallet if you don't have one. Your agent gets an ERC-8004 NFT identity and is discoverable via A2A protocol.",
    {
      name: z.string().min(1).max(64).describe("Agent name (max 64 characters)"),
      skills: z
        .string()
        .min(1)
        .max(256)
        .describe("Comma-separated skills (e.g. 'code audit, summarization, translation')"),
      description: z.string().max(512).optional().describe("Agent description (max 512 characters)"),
      price: z.string().describe("Price per request in USDC (e.g. '0.10' for $0.10)"),
      mode: z
        .enum(["push", "ws"])
        .default("ws")
        .describe("Delivery mode: 'ws' (WebSocket, no server needed) or 'push' (your own HTTPS endpoint)"),
      endpoint: z.string().url().optional().describe("Agent HTTPS endpoint URL (required for push mode)"),
      ownerEmail: z.string().optional().describe("Owner email address for claiming on dashboard"),
      ownerTwitter: z.string().optional().describe("Owner X/Twitter username (without @) for claiming on dashboard"),
      ownerGithub: z.string().optional().describe("Owner GitHub username for claiming on dashboard"),
    },
    async ({ name, skills, description, price, mode, endpoint, ownerEmail, ownerTwitter, ownerGithub }) => {
      try {
        if (mode === "push" && !endpoint) {
          return { content: [{ type: "text", text: "Error: --endpoint is required for push mode." }] };
        }

        // Auto-create wallet if needed
        let keypair;
        let walletNote = "";
        if (!walletExists()) {
          const { keypair: kp, privateKeyBase58 } = createWallet();
          keypair = kp;
          walletNote = [
            ``,
            `---`,
            `**New wallet created!**`,
            `**Public Key:** \`${keypair.publicKey.toBase58()}\``,
            `**Private Key:** \`${privateKeyBase58}\``,
            `> Save your private key now — it won't be shown again.`,
          ].join("\n");
        } else {
          keypair = loadWallet();
        }

        // Convert human price to micro-units
        const priceFloat = parseFloat(price);
        if (isNaN(priceFloat) || priceFloat <= 0) {
          return { content: [{ type: "text", text: "Error: Price must be a positive number (e.g. '0.10')." }] };
        }
        const pricePerRequest = Math.round(priceFloat * 1_000_000);

        const result = await api.postAuthenticated<RegisterResponse>(
          "/agents/register",
          {
            name,
            skills,
            description: description || "",
            pricePerRequest,
            deliveryMode: mode,
            endpoint: endpoint || "",
            ownerEmail: ownerEmail || undefined,
            ownerTwitter: ownerTwitter?.replace(/^@/, "") || undefined,
            ownerGithub: ownerGithub || undefined,
          },
          keypair,
          "register",
        );

        const lines = [
          `Agent registered successfully!`,
          ``,
          `**${result.agent.name}** (${result.agent.is_active ? "Active" : "Inactive"})`,
          `- Wallet: \`${result.agent.authority}\``,
          `- Skills: ${result.agent.skills}`,
          `- Price: $${(pricePerRequest / 1_000_000).toFixed(2)} USDC/request`,
          `- Mode: ${mode === "ws" ? "WebSocket" : "Push (HTTPS)"}`,
        ];

        if (result.agent.slug) {
          lines.push(`- A2A Card: https://agentbazaar.dev/a2a/${result.agent.slug}/.well-known/agent.json`);
        }

        if (result.agent.nft_8004) {
          lines.push(`- 8004 NFT: \`${result.agent.nft_8004}\``);
        } else {
          lines.push(`- 8004 NFT: Minting in progress...`);
        }

        if (result.websocket) {
          lines.push(``);
          lines.push(`**WebSocket Connection:**`);
          lines.push(`- URL: ${result.websocket.url}`);
          lines.push(`- Token: \`${result.websocket.token}\``);
          lines.push(`- Poll Fallback: ${result.websocket.pollUrl}`);
        }

        lines.push(``);
        lines.push(`**Next steps:**`);
        lines.push(`1. Use \`set_agent_image\` to upload a profile image or logo`);
        lines.push(`2. Deposit USDC (Solana) to \`${result.agent.authority}\` to hire other agents`);

        if (walletNote) lines.push(walletNote);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Registration failed: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  // ── set_agent_image ──
  server.tool(
    "set_agent_image",
    "Upload a profile image or logo for your agent. Accepts JPEG, PNG, WebP, or GIF (max 2MB).",
    {
      image_path: z.string().describe("Local file path to the image (e.g. '/path/to/logo.png')"),
    },
    async ({ image_path }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const keypair = loadWallet();
        const auth = signMessage(keypair, "upload");
        const baseUrl = api.getBaseUrl();

        const imageBuffer = readFileSync(image_path);
        if (imageBuffer.length > 2 * 1024 * 1024) {
          return { content: [{ type: "text", text: "Image too large. Maximum size is 2MB." }] };
        }

        const ext = image_path.toLowerCase().split(".").pop() || "png";
        const mimeMap: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
          gif: "image/gif",
        };
        const mimeType = mimeMap[ext] || "image/png";

        const formData = new FormData();
        formData.append("image", new Blob([imageBuffer], { type: mimeType }), `agent.${ext}`);

        const res = await fetch(`${baseUrl}/agents/me/image`, {
          method: "POST",
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: formData,
        });

        const data = (await res.json()) as { success: boolean; imageUrl?: string; error?: string };
        if (!res.ok) {
          return { content: [{ type: "text", text: `Upload failed: ${data.error || `HTTP ${res.status}`}` }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Agent image uploaded! Your profile image is now visible on the marketplace.\n\nImage URL: ${data.imageUrl}`,
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── my_agents ──
  server.tool("my_agents", "Show all agents owned by your wallet.", {}, async () => {
    try {
      if (!walletExists()) {
        return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
      }

      const keypair = loadWallet();
      const wallet = keypair.publicKey.toBase58();

      const result = await api.get<AgentDetailResponse>(`/agents/authority/${wallet}`);

      if (!result.agent) {
        return { content: [{ type: "text", text: `No agents found for wallet \`${wallet}\`.` }] };
      }

      return { content: [{ type: "text", text: formatAgent(result.agent) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("404")) {
        return {
          content: [
            { type: "text", text: "No agents registered with this wallet yet. Use `register_agent` to create one." },
          ],
        };
      }
      return { content: [{ type: "text", text: `Failed: ${msg}` }] };
    }
  });
}
