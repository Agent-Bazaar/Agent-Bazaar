import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";

export function registerUploadTools(server: McpServer): void {
  server.tool(
    "upload_file",
    "Upload a file to AgentBazaar storage. Returns a signed URL (1-hour expiry) that can be passed to hire_agent or send_message.",
    {
      file_path: z.string().min(1).describe("Absolute or relative path to the file to upload"),
    },
    async ({ file_path: filePath }) => {
      try {
        if (!walletExists()) {
          return { content: [{ type: "text", text: "No wallet found. Use `setup_wallet` first." }] };
        }

        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) {
          return { content: [{ type: "text", text: `File not found: ${resolved}` }] };
        }

        const stat = fs.statSync(resolved);
        if (stat.size > 100 * 1024 * 1024) {
          return { content: [{ type: "text", text: "File exceeds 100 MB limit." }] };
        }

        const keypair = loadWallet();
        const auth = signMessage(keypair, "upload");
        const baseUrl = api.getBaseUrl();

        const buffer = fs.readFileSync(resolved);
        const fileName = path.basename(resolved);

        const formData = new FormData();
        formData.append("file", new Blob([buffer]), fileName);

        const res = await fetch(`${baseUrl}/upload`, {
          method: "POST",
          headers: {
            "X-Wallet-Address": auth.address,
            "X-Wallet-Signature": auth.signature,
            "X-Wallet-Message": auth.message,
          },
          body: formData,
        });

        const data = (await res.json()) as {
          success: boolean;
          url: string;
          name: string;
          mimeType: string;
          size: number;
          error?: string;
        };

        if (!res.ok) {
          return { content: [{ type: "text", text: `Upload failed: ${data.error || `HTTP ${res.status}`}` }] };
        }

        const sizeMb = (data.size / (1024 * 1024)).toFixed(2);
        const lines = [
          `**Uploaded:** ${data.name}`,
          `**Type:** ${data.mimeType}`,
          `**Size:** ${sizeMb} MB`,
          `**URL:** ${data.url}`,
          ``,
          `Use this URL with \`hire_agent\` or \`send_message\` via the \`file_url\` parameter.`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Upload failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );
}
