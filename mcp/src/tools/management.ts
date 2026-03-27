import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { walletExists, loadWallet, signMessage } from "../wallet.js";

export function registerManagementTools(server: McpServer): void {
  server.tool(
    "update_agent",
    "Update your agent's metadata (name, description, skills, price). Updates both database and on-chain ERC-8004 metadata.",
    {
      name: z.string().min(1).max(50).optional().describe("New agent name"),
      description: z.string().max(500).optional().describe("New description"),
      skills: z.string().optional().describe("New skills (comma-separated)"),
      price_usdc: z.number().positive().optional().describe("New price in USDC (e.g. 0.50)"),
    },
    async ({ name, description, skills, price_usdc }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "update");

        const body: Record<string, unknown> = {};
        if (name) body.name = name;
        if (description) body.description = description;
        if (skills) body.skills = skills;
        if (price_usdc) body.pricePerRequest = Math.round(price_usdc * 1_000_000);

        const res = await fetch(`${api.getBaseUrl()}/agents/me/metadata`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { success?: boolean; error?: string; agent?: Record<string, unknown> };
        if (!res.ok) return { content: [{ type: "text", text: `Update failed: ${data.error}` }] };

        const lines = ["**Agent updated successfully**"];
        if (name) lines.push(`Name: ${name}`);
        if (description) lines.push(`Description: ${description.slice(0, 100)}...`);
        if (skills) lines.push(`Skills: ${skills}`);
        if (price_usdc) lines.push(`Price: $${price_usdc.toFixed(2)} USDC`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "transfer_agent",
    "Transfer ownership of your agent to another wallet. This is IRREVERSIBLE — the new owner gets the agent NFT, reputation, and marketplace listing.",
    {
      new_owner: z.string().min(32).max(44).describe("New owner's wallet address (base58)"),
    },
    async ({ new_owner }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }
        const keypair = loadWallet();
        const auth = signMessage(keypair, "transfer");

        const res = await fetch(`${api.getBaseUrl()}/agents/me/transfer`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: JSON.stringify({ newOwner: new_owner, confirm: true }),
        });
        const data = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok) return { content: [{ type: "text", text: `Transfer failed: ${data.error}` }] };

        return {
          content: [
            {
              type: "text",
              text: `**Agent transferred successfully**\nNew owner: ${new_owner}\n\nThe agent's NFT identity, reputation, and marketplace listing now belong to the new owner.`,
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "crawl_endpoint",
    "Auto-discover an agent's skills by probing its A2A or MCP endpoint. Useful before registering to auto-populate skills.",
    {
      endpoint: z.string().url().describe("The agent's endpoint URL to crawl"),
    },
    async ({ endpoint }) => {
      try {
        const res = await fetch(`${api.getBaseUrl()}/agents/crawl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        const data = (await res.json()) as { skills?: string[]; tools?: string[]; error?: string };
        if (!res.ok) return { content: [{ type: "text", text: `Crawl failed: ${data.error}` }] };

        const lines = ["**Discovered capabilities:**"];
        if (data.skills?.length) lines.push(`Skills: ${data.skills.join(", ")}`);
        if (data.tools?.length) lines.push(`Tools: ${data.tools.join(", ")}`);
        if (!data.skills?.length && !data.tools?.length) lines.push("No capabilities discovered.");

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
