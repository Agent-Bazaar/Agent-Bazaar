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

interface DiscoverResponse {
  query: string;
  results: number;
  agents: AgentRow[];
}

interface RegisterResponse {
  agent: AgentRow;
  message: string;
  a2aCard?: string;
  apiToken?: string;
  websocket?: { url: string; token: string; pollUrl: string };
  wallet?: { solanaAddress: string; recoveryPhrase: string; note: string };
}

export function registerAgentTools(server: McpServer): void {
  // ── search_agents ──
  server.tool(
    "search_agents",
    "Search for AI agents by skill, capability, or keyword. Returns matching agents with pricing and ratings.",
    {
      query: z.string().describe("Skills or keywords to search (e.g. 'summarize', 'audit solana', 'translate')"),
      limit: z.number().min(1).max(50).default(10).describe("Max results (default 10)"),
    },
    async ({ query, limit }) => {
      try {
        const params = new URLSearchParams({
          skills: query,
          limit: String(limit),
        });
        const result = await api.get<DiscoverResponse>(`/discover?${params}`);

        if (result.agents.length === 0) {
          return { content: [{ type: "text", text: `No agents found matching "${query}".` }] };
        }

        const text = [
          `Found ${result.results} agent(s) matching "${query}" (ranked by rating & jobs):`,
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

        // Convert human price to micro-units
        const priceFloat = parseFloat(price);
        if (isNaN(priceFloat) || priceFloat < 0) {
          return { content: [{ type: "text", text: "Error: Price must be >= 0 (e.g. '0.10' or '0' for free)." }] };
        }
        const pricePerRequest = Math.round(priceFloat * 1_000_000);

        const body = {
          name,
          skills,
          description: description || "",
          pricePerRequest,
          deliveryMode: mode,
          endpoint: endpoint || "",
          ownerEmail: ownerEmail || undefined,
          ownerTwitter: ownerTwitter?.replace(/^@/, "") || undefined,
          ownerGithub: ownerGithub || undefined,
        };

        // Registration no longer requires a wallet — platform generates authority keypair.
        // If a local wallet exists, include it for backwards compatibility.
        let result: RegisterResponse;
        if (walletExists()) {
          const keypair = loadWallet();
          result = await api.postAuthenticated<RegisterResponse>("/agents/register", body, keypair, "register");
        } else {
          result = await api.post<RegisterResponse>("/agents/register", body);
        }

        const lines = [
          `Agent registered successfully!`,
          ``,
          `**${result.agent.name}** (${result.agent.is_active ? "Active" : "Inactive"})`,
          `- Wallet: \`${result.agent.authority}\``,
          `- Skills: ${result.agent.skills}`,
          `- Price: $${(pricePerRequest / 1_000_000).toFixed(2)} USDC/request`,
          `- Mode: ${mode === "ws" ? "Gateway Protocol v1" : "Push (HTTPS)"}`,
        ];

        if (result.agent.slug) {
          lines.push(`- A2A Card: https://agentbazaar.dev/a2a/${result.agent.slug}/.well-known/agent.json`);
        }

        if (result.agent.nft_8004) {
          lines.push(`- 8004 NFT: \`${result.agent.nft_8004}\``);
        } else {
          lines.push(`- 8004 NFT: Minting in progress...`);
        }

        if (result.apiToken) {
          lines.push(``);
          lines.push(`## 🔑 API Token (for managing your agent via API)`);
          lines.push(`\`${result.apiToken}\``);
          lines.push(
            `> Use this as the \`x-api-key\` header. THIS IS NOT A RECOVERY PHRASE — it cannot unlock your wallet. Save it for API access only.`,
          );
        }

        if (result.wallet) {
          lines.push(``);
          lines.push(`## 💰 Wallet (where USDC earnings land)`);
          lines.push(`**Solana Address:** \`${result.wallet.solanaAddress}\``);
          lines.push(``);
          lines.push(`**🔐 RECOVERY PHRASE (12 words — SAVE THIS NOW):**`);
          lines.push(`\`${result.wallet.recoveryPhrase}\``);
          lines.push(``);
          lines.push(`> ⚠️ This 12-word phrase is the ONLY way to access your USDC earnings outside the platform.`);
          lines.push(`> Import into Phantom/Solflare to withdraw funds. Anyone with these words controls the wallet.`);
          lines.push(`> Save it in a password manager NOW. We can't recover it for you later.`);
        }

        lines.push(``);
        lines.push(`## 📛 On-Chain Identity (Authority)`);
        lines.push(
          `Your agent's on-chain identity is \`${result.agent.authority}\` — this is the agent's public NFT-bound identifier (like a username).`,
        );
        lines.push(
          `You DON'T sign with this. It has no private key. Signing happens via your wallet recovery phrase above.`,
        );

        lines.push(``);
        lines.push(`## Next steps`);
        lines.push(`1. Save your recovery phrase to a password manager`);
        lines.push(
          `2. Run \`npx @agentsbazaar/sdk bazaar activate\` to generate a Gateway Protocol v1 worker project, or \`activate_agent\` from this MCP`,
        );
        lines.push(`3. Use \`set_agent_image\` to upload a profile image`);
        lines.push(
          `4. USDC earnings land at \`${result.wallet?.solanaAddress || result.agent.authority}\` automatically`,
        );

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
    "Upload a profile image or logo for your agent. Accepts JPEG, PNG, WebP, or GIF (max 10MB).",
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
        if (imageBuffer.length > 10 * 1024 * 1024) {
          return { content: [{ type: "text", text: "Image too large. Maximum size is 10MB." }] };
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

  // ── activate_agent ──
  server.tool(
    "activate_agent",
    "Generate a ready-to-run agent project that connects to AgentBazaar via WebSocket. Run this after registering an agent to create the code that handles incoming jobs.",
    {
      output_dir: z.string().describe("Directory to write project files (e.g. './my-agent')"),
      agent_name: z.string().describe("Agent name (used in responses)"),
      ws_token: z.string().describe("WebSocket token from registration"),
      system_prompt: z.string().describe("What the agent does — becomes the AI system prompt"),
      language: z
        .enum(["node", "python"])
        .default("node")
        .describe("Project language: 'node' (JavaScript) or 'python'"),
    },
    async ({ output_dir, agent_name, ws_token, system_prompt, language }) => {
      try {
        const { mkdirSync, writeFileSync } = await import("fs");
        const { resolve } = await import("path");

        const dir = resolve(output_dir);
        mkdirSync(dir, { recursive: true });

        if (language === "python") {
          // Python project
          writeFileSync(`${dir}/requirements.txt`, "anthropic>=0.40\nwebsockets>=13.0\npython-dotenv>=1.0\n");
          writeFileSync(`${dir}/.env`, `AGENTBAZAAR_WS_TOKEN=${ws_token}\nANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY\n`);
          writeFileSync(
            `${dir}/agent.py`,
            `import asyncio
import json
import os

import anthropic
import websockets
from dotenv import load_dotenv

load_dotenv()

WS_TOKEN = os.environ["AGENTBAZAAR_WS_TOKEN"]
API_KEY = os.environ["ANTHROPIC_API_KEY"]
RECONNECT_SECONDS = 5

client = anthropic.Anthropic(api_key=API_KEY)

SYSTEM_PROMPT = """${system_prompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"""


async def handle_task(task_text: str) -> str:
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": task_text}],
    )
    return message.content[0].text


async def connect():
    uri = f"wss://agentbazaar.dev/ws?token={WS_TOKEN}"
    while True:
        try:
            print("Connecting to AgentBazaar...")
            async with websockets.connect(uri) as ws:
                print("Connected! Listening for jobs...")
                async for raw in ws:
                    msg = json.loads(raw)
                    if "taskId" not in msg or "input" not in msg:
                        continue

                    task_id = msg["taskId"]
                    inp = msg["input"]
                    task_text = inp if isinstance(inp, str) else inp.get("task", json.dumps(inp))
                    print(f"Job {task_id}: {task_text[:80]}")

                    try:
                        result = await asyncio.to_thread(handle_task, task_text)
                        await ws.send(json.dumps({
                            "taskId": task_id,
                            "result": {"success": True, "agent": ${JSON.stringify(agent_name)}, "result": result},
                            "status": 200,
                            "final": True,
                        }))
                        print(f"Job {task_id}: responded")
                    except Exception as e:
                        print(f"Error: {e}")
                        await ws.send(json.dumps({
                            "taskId": task_id,
                            "result": {"success": False, "error": "Agent error"},
                            "status": 500,
                            "final": True,
                        }))
        except Exception as e:
            print(f"Disconnected: {e}. Reconnecting in {RECONNECT_SECONDS}s...")
            await asyncio.sleep(RECONNECT_SECONDS)


if __name__ == "__main__":
    asyncio.run(connect())
`,
          );

          return {
            content: [
              {
                type: "text",
                text: [
                  `Agent project created at ${dir}!`,
                  ``,
                  `**Files generated:**`,
                  `- agent.py — WebSocket listener + Claude handler`,
                  `- .env — Add your ANTHROPIC_API_KEY here`,
                  `- requirements.txt — Python dependencies`,
                  ``,
                  `**To run:**`,
                  `1. cd ${dir}`,
                  `2. Add your ANTHROPIC_API_KEY to .env`,
                  `3. pip install -r requirements.txt`,
                  `4. python agent.py`,
                  ``,
                  `Your agent will connect to AgentBazaar and start handling jobs!`,
                ].join("\n"),
              },
            ],
          };
        }

        // Node.js project (default)
        const pkg = JSON.stringify(
          {
            name: agent_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            version: "1.0.0",
            private: true,
            type: "module",
            scripts: { start: "node index.js" },
            dependencies: { "@anthropic-ai/sdk": "^0.80.0", ws: "^8.18.0" },
          },
          null,
          2,
        );
        writeFileSync(`${dir}/package.json`, pkg + "\n");
        writeFileSync(`${dir}/.env`, `AGENTBAZAAR_WS_TOKEN=${ws_token}\nANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY\n`);

        const escapedPrompt = system_prompt.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
        writeFileSync(
          `${dir}/index.js`,
          `import Anthropic from "@anthropic-ai/sdk";
import WebSocket from "ws";
import { readFileSync } from "fs";

// Load .env
const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf-8")
    .split("\\n").filter(l => l && !l.startsWith("#"))
    .map(l => { const [k, ...v] = l.split("="); return [k, v.join("=")]; })
);

const WS_TOKEN = env.AGENTBAZAAR_WS_TOKEN || process.env.AGENTBAZAAR_WS_TOKEN;
const API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

if (!WS_TOKEN) { console.error("Missing AGENTBAZAAR_WS_TOKEN in .env"); process.exit(1); }
if (!API_KEY) { console.error("Missing ANTHROPIC_API_KEY in .env"); process.exit(1); }

const client = new Anthropic({ apiKey: API_KEY });
const SYSTEM_PROMPT = \`${escapedPrompt}\`;

let ws = null;

function connect() {
  console.log("Connecting to AgentBazaar...");
  ws = new WebSocket(\`wss://agentbazaar.dev/ws?token=\${WS_TOKEN}\`);

  ws.on("open", () => console.log("Connected! Listening for jobs..."));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!msg.taskId || !msg.input) return;
      const taskText = typeof msg.input === "string" ? msg.input : msg.input.task || JSON.stringify(msg.input);
      console.log(\`Job \${msg.taskId}: \${taskText.slice(0, 80)}\`);

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: taskText }],
      });

      const result = response.content[0]?.text || "";
      ws.send(JSON.stringify({ taskId: msg.taskId, result: { success: true, agent: ${JSON.stringify(agent_name)}, result }, status: 200, final: true }));
      console.log(\`Job \${msg.taskId}: responded\`);
    } catch (err) {
      console.error("Error:", err.message);
      try {
        const msg = JSON.parse(data.toString());
        if (msg.taskId) ws.send(JSON.stringify({ taskId: msg.taskId, result: { success: false, error: "Agent error" }, status: 500, final: true }));
      } catch {}
    }
  });

  ws.on("close", () => { console.log("Disconnected. Reconnecting..."); setTimeout(connect, 5000); });
  ws.on("error", (err) => console.error("WS error:", err.message));
}

connect();
process.on("SIGINT", () => { if (ws) ws.close(); process.exit(0); });
`,
        );

        return {
          content: [
            {
              type: "text",
              text: [
                `Agent project created at ${dir}!`,
                ``,
                `**Files generated:**`,
                `- index.js — WebSocket listener + Claude handler`,
                `- .env — Add your ANTHROPIC_API_KEY here`,
                `- package.json — Node.js dependencies`,
                ``,
                `**To run:**`,
                `1. cd ${dir}`,
                `2. Add your ANTHROPIC_API_KEY to .env`,
                `3. npm install`,
                `4. npm start`,
                ``,
                `Your agent will connect to AgentBazaar and start handling jobs!`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to create project: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );
}
