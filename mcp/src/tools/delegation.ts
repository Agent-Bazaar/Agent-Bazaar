/**
 * MCP tools for cross-agent delegation, spend limits, and session keys.
 *
 * OWS hackathon features — agents grant trading rights to other agents
 * with configurable limits and safety guardrails.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";

function noWallet() {
  return { content: [{ type: "text" as const, text: "No wallet found. Use `setup_wallet` first." }] };
}

function authHeaders(keypair: ReturnType<typeof loadWallet>, action: string) {
  const auth = signMessage(keypair, action);
  return {
    "Content-Type": "application/json",
    "X-Wallet-Address": auth.address,
    "X-Wallet-Signature": auth.signature,
    "X-Wallet-Message": auth.message,
  };
}

function txt(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function registerDelegationTools(server: McpServer): void {
  const baseUrl = () => api.getBaseUrl();

  /* ================================================================ */
  /*  DELEGATION                                                       */
  /* ================================================================ */

  server.tool(
    "delegate_trading",
    "Grant another agent permission to trade from your wallet. Set budget, token whitelist, take-profit, and stop-loss.",
    {
      grantee: z.string().describe("Agent authority or pubkey of the trader"),
      maxAmountUsdc: z.number().describe("Maximum USDC per trade"),
      allowedTokens: z.array(z.string()).optional().describe("Token mint whitelist (empty = any)"),
      rolling: z.boolean().optional().describe("Reinvest profits back into delegation budget"),
      takeProfitPct: z.number().optional().describe("Auto-sell at +X% profit (0 = disabled)"),
      stopLossPct: z.number().optional().describe("Auto-sell at -X% loss (0 = disabled)"),
      lifetimeCapUsdc: z.number().optional().describe("Total USDC ever delegated (0 = unlimited)"),
      expiresInHours: z.number().optional().describe("Delegation expiry in hours"),
    },
    async (params) => {
      if (!walletExists()) return noWallet();
      const kp = loadWallet();
      const res = await fetch(`${baseUrl()}/delegation/grant`, {
        method: "POST",
        headers: authHeaders(kp, "delegation"),
        body: JSON.stringify(params),
      });
      if (!res.ok) return txt(`Error: ${await parseError(res)}`);
      const data = (await res.json()) as { delegation: Record<string, unknown> };
      return txt(
        `Delegation created: #${data.delegation.id}\nGrantee: ${params.grantee}\nMax: $${params.maxAmountUsdc}\n${params.takeProfitPct ? `Take profit: +${params.takeProfitPct}%` : ""}${params.stopLossPct ? `\nStop loss: -${params.stopLossPct}%` : ""}${params.rolling ? "\nRolling: profits reinvested" : ""}`,
      );
    },
  );

  server.tool(
    "revoke_delegation",
    "Revoke a delegation you granted.",
    {
      delegationId: z.number().describe("Delegation ID to revoke"),
    },
    async ({ delegationId }) => {
      if (!walletExists()) return noWallet();
      const kp = loadWallet();
      const res = await fetch(`${baseUrl()}/delegation/${delegationId}`, {
        method: "DELETE",
        headers: authHeaders(kp, "delegation"),
      });
      if (!res.ok) return txt(`Error: ${await parseError(res)}`);
      return txt(`Delegation #${delegationId} revoked. Active triggers cancelled.`);
    },
  );

  server.tool(
    "list_delegations",
    "List delegations you've granted or received.",
    {
      type: z.enum(["granted", "received"]).describe("granted = your wallet, received = trading for others"),
    },
    async ({ type }) => {
      if (!walletExists()) return noWallet();
      const kp = loadWallet();
      const res = await fetch(`${baseUrl()}/delegation/${type}`, {
        headers: authHeaders(kp, "delegation"),
      });
      if (!res.ok) return txt(`Error: ${await parseError(res)}`);
      const data = (await res.json()) as { delegations: Array<Record<string, unknown>> };
      if (data.delegations.length === 0) return txt(`No ${type} delegations found.`);
      const lines = data.delegations.map(
        (d) =>
          `#${d.id}: ${type === "granted" ? `→ ${String(d.grantee).slice(0, 12)}...` : `← ${String(d.grantor).slice(0, 12)}...`} | $${d.remainingUsdc}/$${d.maxAmountUsdc} | ${d.status}`,
      );
      return txt(`${type.charAt(0).toUpperCase() + type.slice(1)} delegations:\n${lines.join("\n")}`);
    },
  );

  server.tool(
    "delegated_trade",
    "Execute a trade using delegation rights — trade from another agent's wallet.",
    {
      delegator: z.string().describe("Wallet owner (grantor) authority"),
      action: z.enum(["buy", "sell"]).describe("Trade action"),
      tokenMint: z.string().describe("Token mint address"),
      amountUsdc: z.number().describe("USDC amount"),
      sessionKey: z.string().optional().describe("One-time session key for extra security"),
      slippage: z.number().optional().describe("Slippage tolerance in bps"),
    },
    async (params) => {
      if (!walletExists()) return noWallet();
      const kp = loadWallet();
      const res = await fetch(`${baseUrl()}/delegation/trade`, {
        method: "POST",
        headers: authHeaders(kp, "delegation"),
        body: JSON.stringify(params),
      });
      if (!res.ok) return txt(`Error: ${await parseError(res)}`);
      const data = (await res.json()) as { trade: Record<string, unknown>; remainingUsdc: number };
      return txt(
        `Delegated trade executed!\nRemaining budget: $${data.remainingUsdc}\n${JSON.stringify(data.trade, null, 2)}`,
      );
    },
  );

  /* ================================================================ */
  /*  SPEND LIMITS                                                     */
  /* ================================================================ */

  server.tool(
    "set_spend_policy",
    "Set spending limits for your agent — per-trade cap, daily limit, token whitelist.",
    {
      maxPerTradeUsdc: z.number().optional().describe("Max USDC per single trade (default $100)"),
      dailyLimitUsdc: z.number().optional().describe("Max USDC per day (default $500)"),
      allowedTokens: z.array(z.string()).optional().describe("Token whitelist (empty = any token)"),
    },
    async (params) => {
      if (!walletExists()) return noWallet();
      const kp = loadWallet();
      const res = await fetch(`${baseUrl()}/delegation/policy`, {
        method: "POST",
        headers: authHeaders(kp, "policy"),
        body: JSON.stringify(params),
      });
      if (!res.ok) return txt(`Error: ${await parseError(res)}`);
      const data = (await res.json()) as { policy: Record<string, unknown> };
      return txt(
        `Spend policy set:\n• Per trade: $${data.policy.maxPerTradeUsdc}\n• Daily: $${data.policy.dailyLimitUsdc}\n• Tokens: ${(data.policy.allowedTokens as string[])?.length || "any"}`,
      );
    },
  );

  server.tool("get_spend_policy", "View current spending limits.", {}, async () => {
    if (!walletExists()) return noWallet();
    const kp = loadWallet();
    const res = await fetch(`${baseUrl()}/delegation/policy`, {
      headers: authHeaders(kp, "policy"),
    });
    if (!res.ok) return txt(`Error: ${await parseError(res)}`);
    const data = (await res.json()) as { policy: Record<string, unknown> | null; message?: string };
    if (!data.policy) return txt(data.message || "No spend limits set (unlimited trading).");
    return txt(
      `Spend policy:\n• Per trade: $${data.policy.maxPerTradeUsdc}\n• Daily: $${data.policy.dailyLimitUsdc} (spent: $${data.policy.dailySpentUsdc})\n• Remaining today: $${data.policy.remainingTodayUsdc}`,
    );
  });

  server.tool("remove_spend_policy", "Remove spending limits (unlimited trading).", {}, async () => {
    if (!walletExists()) return noWallet();
    const kp = loadWallet();
    const res = await fetch(`${baseUrl()}/delegation/policy`, {
      method: "DELETE",
      headers: authHeaders(kp, "policy"),
    });
    if (!res.ok) return txt(`Error: ${await parseError(res)}`);
    return txt("Spend limits removed. Trading is now unlimited.");
  });

  /* ================================================================ */
  /*  SESSION KEYS                                                     */
  /* ================================================================ */

  server.tool(
    "create_session_key",
    "Create a one-time ephemeral key for a specific trade. Burns after use. 60-second TTL.",
    {
      allowedAction: z.enum(["buy", "sell", "batch"]).describe("Action this key permits"),
      maxAmountUsdc: z.number().describe("Maximum USDC for this key"),
      tokenMint: z.string().optional().describe("Specific token (omit for any)"),
      delegator: z.string().optional().describe("If used under delegation, the grantor's authority"),
      ttlSeconds: z.number().optional().describe("Time-to-live in seconds (default 60)"),
    },
    async (params) => {
      if (!walletExists()) return noWallet();
      const kp = loadWallet();
      const res = await fetch(`${baseUrl()}/delegation/session-key`, {
        method: "POST",
        headers: authHeaders(kp, "session-key"),
        body: JSON.stringify(params),
      });
      if (!res.ok) return txt(`Error: ${await parseError(res)}`);
      const data = (await res.json()) as { sessionKey: string; expiresAt: number; ttlSeconds: number };
      return txt(`Session key created:\n${data.sessionKey}\n\nExpires in ${data.ttlSeconds}s. One-time use only.`);
    },
  );

  server.tool("list_session_keys", "List active (unused, unexpired) session keys.", {}, async () => {
    if (!walletExists()) return noWallet();
    const kp = loadWallet();
    const res = await fetch(`${baseUrl()}/delegation/session-keys`, {
      headers: authHeaders(kp, "session-key"),
    });
    if (!res.ok) return txt(`Error: ${await parseError(res)}`);
    const data = (await res.json()) as { keys: Array<Record<string, unknown>> };
    if (data.keys.length === 0) return txt("No active session keys.");
    const lines = data.keys.map(
      (k) =>
        `• ${k.allowedAction} $${k.maxAmountUsdc} | ${k.allowedToken || "any token"} | ${Math.round((k.remainingMs as number) / 1000)}s left`,
    );
    return txt(`Active session keys:\n${lines.join("\n")}`);
  });
}
