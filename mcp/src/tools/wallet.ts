import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { walletExists, loadWallet, createWallet, exportWallet, getWalletPath } from "../wallet.js";

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const USDC_MINT =
  process.env.SOLANA_CLUSTER === "mainnet-beta"
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export function registerWalletTools(server: McpServer): void {
  // ── setup_wallet ──
  server.tool(
    "setup_wallet",
    "Create an OWS encrypted wallet for your agent. Multi-chain (Solana + 7 other chains) from one seed phrase. Can be exported to Phantom/Solflare.",
    {},
    async () => {
      try {
        const result = createWallet();
        const pubkey = result.keypair.publicKey.toBase58();

        if (result.isNew) {
          const lines = [`Wallet created with OWS (Open Wallet Standard)!`, ``, `**Solana Address:** \`${pubkey}\``];

          if (result.mnemonic) {
            lines.push(
              ``,
              `**Recovery Phrase (12 words):**`,
              `\`${result.mnemonic}\``,
              ``,
              `> **SAVE THIS NOW.** Import into Phantom: Settings > Manage Accounts > Import via Recovery Phrase.`,
              `> This phrase gives access to wallets on Solana + 7 other chains.`,
            );
          }

          lines.push(
            ``,
            `**Next steps:**`,
            `1. Deposit USDC (Solana) to \`${pubkey}\` to start hiring agents`,
            `2. Deposit SOL for trading (Jupiter swaps need SOL for gas)`,
            `3. Use \`register_agent\` to register your AI agent`,
            ``,
            `Wallet stored at: \`${getWalletPath()}\``,
          );

          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        return {
          content: [
            {
              type: "text",
              text: [
                `Wallet already exists.`,
                ``,
                `**Solana Address:** \`${pubkey}\``,
                ``,
                `Use \`export_wallet\` to see your recovery phrase.`,
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

  // ── export_wallet ──
  server.tool(
    "export_wallet",
    "Export your wallet's recovery phrase and private key for backup or import into Phantom/Solflare.",
    {},
    async () => {
      try {
        const result = exportWallet();
        const lines = [`**Solana Address:** \`${result.publicKey}\``];

        if (result.mnemonic) {
          lines.push(
            ``,
            `**Recovery Phrase (BIP-39):**`,
            `\`${result.mnemonic}\``,
            ``,
            `> Import into Phantom: Settings > Manage Accounts > Import via Recovery Phrase`,
            `> This phrase works across Solana, Ethereum, Bitcoin, and other chains.`,
          );
        }

        lines.push(
          ``,
          `**Private Key (Solana):**`,
          `\`${result.privateKeyBase58}\``,
          ``,
          `> **WARNING:** Anyone with these credentials controls your wallet and funds.`,
        );

        return { content: [{ type: "text", text: lines.join("\n") }] };
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
        usdcBalance = Number(accountData.readBigUInt64LE(64));
      }

      const usdcFormatted = (usdcBalance / 1_000_000).toFixed(2);

      const lines = [`**Wallet:** \`${pubkey}\``, `**SOL:** ${solFormatted} SOL`, `**USDC:** $${usdcFormatted}`];

      if (usdcBalance === 0 && solBalance === 0) {
        lines.push(
          ``,
          `No balance. To get started:`,
          `- Deposit USDC to \`${pubkey}\` for hiring agents`,
          `- Deposit SOL for trading (Jupiter swaps need SOL for gas)`,
        );
      } else if (usdcBalance === 0) {
        lines.push(``, `No USDC. Deposit USDC (Solana) to \`${pubkey}\` to start hiring agents.`);
      } else if (solBalance < 5_000_000) {
        lines.push(``, `Low SOL. Deposit SOL for trading — Jupiter swaps need SOL for gas fees.`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }] };
    }
  });
}
