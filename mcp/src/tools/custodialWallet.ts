import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";

export function registerCustodialWalletTools(server: McpServer): void {
  server.tool(
    "create_custodial_wallet",
    "Create a new Solana wallet managed by AgentBazaar. Returns an API key — save it, it cannot be recovered. Fund the wallet with USDC to start using agents. You can export the private key anytime.",
    {
      label: z.string().max(50).optional().describe("Optional label for the wallet (e.g. 'My Trading Agent')"),
    },
    async ({ label }) => {
      try {
        const baseUrl = api.getBaseUrl();
        const res = await fetch(`${baseUrl}/wallets/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        });
        const data = (await res.json()) as {
          apiKey?: string;
          publicKey?: string;
          message?: string;
          error?: string;
        };
        if (!res.ok) return { content: [{ type: "text", text: `Failed: ${data.error}` }] };

        const lines = [
          "**Wallet Created**",
          "",
          `**Public Key:** ${data.publicKey}`,
          `**API Key:** ${data.apiKey}`,
          "",
          "Save your API key now — it cannot be recovered.",
          "Fund this wallet with USDC on Solana to start hiring agents.",
          "Use `export_custodial_key` anytime to get your private key for Phantom/Solflare.",
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "check_custodial_wallet",
    "Check your custodial wallet balance and public key. Requires the API key from create_custodial_wallet.",
    {
      api_key: z.string().min(10).describe("Your API key (starts with abz_)"),
    },
    async ({ api_key }) => {
      try {
        const baseUrl = api.getBaseUrl();
        const res = await fetch(`${baseUrl}/wallets/me`, {
          headers: { Authorization: `Bearer ${api_key}` },
        });
        const data = (await res.json()) as {
          publicKey?: string;
          balances?: { sol: string; usdc: string };
          error?: string;
        };
        if (!res.ok) return { content: [{ type: "text", text: `Failed: ${data.error}` }] };

        const lines = [
          `**Wallet:** ${data.publicKey}`,
          `**SOL:** ${data.balances?.sol}`,
          `**USDC:** ${data.balances?.usdc}`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.tool(
    "export_custodial_key",
    "Export your custodial wallet's private key. Returns the full 64-byte keypair that you can import into Phantom, Solflare, or any Solana wallet. This is YOUR key — save it securely.",
    {
      api_key: z.string().min(10).describe("Your API key (starts with abz_)"),
    },
    async ({ api_key }) => {
      try {
        const baseUrl = api.getBaseUrl();
        const res = await fetch(`${baseUrl}/wallets/me/export`, {
          headers: { Authorization: `Bearer ${api_key}` },
        });
        const data = (await res.json()) as {
          publicKey?: string;
          privateKey?: number[];
          format?: string;
          error?: string;
        };
        if (!res.ok) return { content: [{ type: "text", text: `Failed: ${data.error}` }] };

        const lines = [
          "**Private Key Exported**",
          "",
          `**Public Key:** ${data.publicKey}`,
          `**Format:** ${data.format}`,
          `**Key:** [${data.privateKey?.join(",")}]`,
          "",
          "Import this into Phantom: Settings → Manage Accounts → Import Private Key",
          "Or save as a JSON file for the Solana CLI.",
          "",
          "**WARNING:** Anyone with this key controls your wallet and funds.",
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
