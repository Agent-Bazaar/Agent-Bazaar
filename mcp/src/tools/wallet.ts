import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { walletExists, loadWallet, createWallet, importWallet, exportWallet, getWalletPath } from "../wallet.js";

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const USDC_MINT =
  process.env.SOLANA_CLUSTER === "mainnet-beta"
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export function registerWalletTools(server: McpServer): void {
  // ── setup_wallet ──
  server.tool(
    "setup_wallet",
    "Create a new Solana wallet or show existing one. The wallet is stored locally and used for agent registration and hiring.",
    {},
    async () => {
      try {
        const { keypair, privateKeyBase58, isNew } = createWallet();
        const pubkey = keypair.publicKey.toBase58();

        if (isNew) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `Wallet created successfully!`,
                  ``,
                  `**Public Key:** \`${pubkey}\``,
                  `**Private Key:** \`${privateKeyBase58}\``,
                  ``,
                  `> **IMPORTANT:** Save your private key now. It won't be shown again.`,
                  `> You can export it later with the \`export_wallet\` tool.`,
                  ``,
                  `**Next steps:**`,
                  `1. Deposit USDC (Solana) to \`${pubkey}\` to start hiring agents`,
                  `2. Use \`register_agent\` to register your AI agent`,
                  `3. Use \`hire_agent\` to hire other agents`,
                  ``,
                  `Wallet stored at: \`${getWalletPath()}\``,
                ].join("\n"),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: [
                `Wallet already exists.`,
                ``,
                `**Public Key:** \`${pubkey}\``,
                ``,
                `Use \`export_wallet\` to see your private key.`,
                `Use \`check_balance\` to see your USDC balance.`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── import_wallet ──
  server.tool(
    "import_wallet",
    "Import an existing Solana wallet from a private key (base58 or JSON array format).",
    { private_key: z.string().describe("Private key in base58 or JSON array format") },
    async ({ private_key }) => {
      try {
        if (walletExists() && !process.env.SOLANA_PRIVATE_KEY) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `A wallet already exists at \`${getWalletPath()}\`.`,
                  `Importing will **overwrite** the existing wallet.`,
                  ``,
                  `To proceed, delete the existing wallet file first:`,
                  `\`rm ${getWalletPath()}\``,
                  ``,
                  `Then run import_wallet again.`,
                ].join("\n"),
              },
            ],
          };
        }

        const keypair = importWallet(private_key);
        return {
          content: [
            {
              type: "text",
              text: [
                `Wallet imported successfully!`,
                ``,
                `**Public Key:** \`${keypair.publicKey.toBase58()}\``,
                `Stored at: \`${getWalletPath()}\``,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Import failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── export_wallet ──
  server.tool(
    "export_wallet",
    "Show your wallet's private key for backup or import into other wallets (Phantom, Solflare, etc).",
    {},
    async () => {
      try {
        const { publicKey, privateKeyBase58 } = exportWallet();
        return {
          content: [
            {
              type: "text",
              text: [
                `**Public Key:** \`${publicKey}\``,
                `**Private Key:** \`${privateKeyBase58}\``,
                ``,
                `> **WARNING:** Keep this private. Anyone with this key controls your funds.`,
                `> You can import this key into Phantom, Solflare, or any Solana wallet.`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // ── check_balance ──
  server.tool("check_balance", "Check SOL and USDC balance for your wallet on Solana.", {}, async () => {
    try {
      const keypair = loadWallet();
      const pubkey = keypair.publicKey.toBase58();
      const connection = new Connection(SOLANA_RPC, "confirmed");

      // SOL balance
      const solBalance = await connection.getBalance(keypair.publicKey);
      const solFormatted = (solBalance / 1_000_000_000).toFixed(4);

      // USDC balance
      const usdcMint = new PublicKey(USDC_MINT);
      const tokenAccounts = await connection.getTokenAccountsByOwner(keypair.publicKey, {
        mint: usdcMint,
        programId: TOKEN_PROGRAM_ID,
      });

      let usdcBalance = 0;
      if (tokenAccounts.value.length > 0) {
        const accountData = tokenAccounts.value[0].account.data;
        // SPL token account layout: amount is at offset 64, 8 bytes LE
        usdcBalance = Number(accountData.readBigUInt64LE(64));
      }

      const usdcFormatted = (usdcBalance / 1_000_000).toFixed(2);

      const lines = [`**Wallet:** \`${pubkey}\``, `**SOL:** ${solFormatted} SOL`, `**USDC:** $${usdcFormatted}`];

      if (usdcBalance === 0) {
        lines.push(``);
        lines.push(`No USDC balance. Deposit USDC (Solana) to \`${pubkey}\` to start hiring agents.`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
    }
  });
}
