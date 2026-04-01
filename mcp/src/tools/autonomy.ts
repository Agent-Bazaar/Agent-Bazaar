/**
 * MCP tools for agent autonomy — memory, schedules, subscriptions,
 * messaging, triggers, teams, and trading stats.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletExists, loadWallet, signMessage } from "../wallet.js";
import { api } from "../api.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

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

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
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

/* ------------------------------------------------------------------ */
/*  Registration                                                      */
/* ------------------------------------------------------------------ */

export function registerAutonomyTools(server: McpServer): void {
  const baseUrl = () => api.getBaseUrl();

  /* ================================================================ */
  /*  MEMORY                                                          */
  /* ================================================================ */

  server.tool(
    "agent_memory_set",
    "Store a key-value pair in persistent agent memory. Data survives across sessions.",
    {
      namespace: z.string().min(1).describe("Memory namespace (e.g. 'config', 'state', 'notes')"),
      key: z.string().min(1).describe("Key within the namespace"),
      value: z.string().min(1).describe("Value to store"),
    },
    async ({ namespace, key, value }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(
          `${baseUrl()}/agents/memory/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
          {
            method: "PUT",
            headers: authHeaders(keypair, "memory"),
            body: JSON.stringify({ value }),
          },
        );
        if (!res.ok) return txt(`Failed to set memory: ${await parseError(res)}`);
        return txt(`Stored \`${namespace}/${key}\` successfully.`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool(
    "agent_memory_get",
    "Retrieve a value from persistent agent memory.",
    {
      namespace: z.string().min(1).describe("Memory namespace"),
      key: z.string().min(1).describe("Key to retrieve"),
    },
    async ({ namespace, key }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(
          `${baseUrl()}/agents/memory/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
          {
            headers: authHeaders(keypair, "memory"),
          },
        );
        if (!res.ok) return txt(`Failed to get memory: ${await parseError(res)}`);
        const data = (await res.json()) as { value: string };
        return txt(`**${namespace}/${key}:**\n${data.value}`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool(
    "agent_memory_list",
    "List memory entries, optionally filtered by namespace.",
    {
      namespace: z.string().optional().describe("Filter by namespace (omit to list all)"),
    },
    async ({ namespace }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const url = namespace
          ? `${baseUrl()}/agents/memory/${encodeURIComponent(namespace)}`
          : `${baseUrl()}/agents/memory`;
        const res = await fetch(url, { headers: authHeaders(keypair, "memory") });
        if (!res.ok) return txt(`Failed to list memory: ${await parseError(res)}`);
        const data = (await res.json()) as { entries: { namespace: string; key: string; value: string }[] };
        if (!data.entries?.length) return txt("No memory entries found.");
        const lines = data.entries.map(
          (e) => `- **${e.namespace}/${e.key}:** ${e.value.length > 80 ? e.value.slice(0, 80) + "..." : e.value}`,
        );
        return txt(`**Memory (${data.entries.length} entries)**\n\n${lines.join("\n")}`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool(
    "agent_memory_delete",
    "Delete a memory entry.",
    {
      namespace: z.string().min(1).describe("Memory namespace"),
      key: z.string().min(1).describe("Key to delete"),
    },
    async ({ namespace, key }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(
          `${baseUrl()}/agents/memory/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
          {
            method: "DELETE",
            headers: authHeaders(keypair, "memory"),
          },
        );
        if (!res.ok) return txt(`Failed to delete: ${await parseError(res)}`);
        return txt(`Deleted \`${namespace}/${key}\`.`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool(
    "agent_memory_search",
    "Search across all memory entries by keyword.",
    {
      query: z.string().min(1).describe("Search query"),
    },
    async ({ query }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(`${baseUrl()}/agents/memory/search?q=${encodeURIComponent(query)}`, {
          headers: authHeaders(keypair, "memory"),
        });
        if (!res.ok) return txt(`Search failed: ${await parseError(res)}`);
        const data = (await res.json()) as { results: { namespace: string; key: string; value: string }[] };
        if (!data.results?.length) return txt(`No memory entries matching "${query}".`);
        const lines = data.results.map(
          (r) => `- **${r.namespace}/${r.key}:** ${r.value.length > 80 ? r.value.slice(0, 80) + "..." : r.value}`,
        );
        return txt(`**Search results for "${query}" (${data.results.length})**\n\n${lines.join("\n")}`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  /* ================================================================ */
  /*  SCHEDULES                                                       */
  /* ================================================================ */

  server.tool(
    "create_schedule",
    "Create a scheduled task that runs on a cron schedule. The agent will be hired automatically at each interval.",
    {
      name: z.string().min(1).describe("Schedule name"),
      cronExpr: z.string().min(1).describe("Cron expression (e.g. '0 */6 * * *' for every 6 hours)"),
      taskInput: z.string().min(1).describe("Task input to send to the agent each run"),
      maxRuns: z.number().optional().describe("Max number of runs (omit for unlimited)"),
      costPerRun: z.number().optional().describe("Expected USDC cost per run"),
    },
    async ({ name, cronExpr, taskInput, maxRuns, costPerRun }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const body: Record<string, unknown> = { name, cronExpr, taskInput };
        if (maxRuns !== undefined) body.maxRuns = maxRuns;
        if (costPerRun !== undefined) body.costPerRun = costPerRun;
        const res = await fetch(`${baseUrl()}/agents/schedules`, {
          method: "POST",
          headers: authHeaders(keypair, "schedule"),
          body: JSON.stringify(body),
        });
        if (!res.ok) return txt(`Failed to create schedule: ${await parseError(res)}`);
        const data = (await res.json()) as { id: number; name: string; cronExpr: string };
        return txt(`Schedule created!\n**ID:** ${data.id}\n**Name:** ${data.name}\n**Cron:** ${data.cronExpr}`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool("list_schedules", "List all your scheduled tasks.", {}, async () => {
    try {
      if (!walletExists()) return noWallet();
      const keypair = loadWallet();
      const res = await fetch(`${baseUrl()}/agents/schedules`, {
        headers: authHeaders(keypair, "schedule"),
      });
      if (!res.ok) return txt(`Failed to list schedules: ${await parseError(res)}`);
      const data = (await res.json()) as {
        schedules: { id: number; name: string; cronExpr: string; active: boolean; runCount: number }[];
      };
      if (!data.schedules?.length) return txt("No schedules found.");
      const lines = data.schedules.map(
        (s) =>
          `- **${s.name}** (ID: ${s.id}) — \`${s.cronExpr}\` — ${s.active ? "Active" : "Paused"} — ${s.runCount} runs`,
      );
      return txt(`**Schedules (${data.schedules.length})**\n\n${lines.join("\n")}`);
    } catch (err) {
      return txt(`Error: ${errText(err)}`);
    }
  });

  server.tool(
    "toggle_schedule",
    "Toggle a schedule active or inactive.",
    {
      id: z.number().describe("Schedule ID"),
      active: z.boolean().describe("Set to true to activate, false to pause"),
    },
    async ({ id, active }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(`${baseUrl()}/agents/schedules/${id}/toggle`, {
          method: "POST",
          headers: authHeaders(keypair, "schedule"),
          body: JSON.stringify({ active }),
        });
        if (!res.ok) return txt(`Failed to toggle schedule: ${await parseError(res)}`);
        return txt(`Schedule ${id} is now ${active ? "active" : "paused"}.`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  /* ================================================================ */
  /*  SUBSCRIPTIONS                                                   */
  /* ================================================================ */

  server.tool(
    "subscribe_to_agent",
    "Subscribe to an agent for recurring monthly USDC payments. You'll receive their published outputs automatically.",
    {
      agentAuth: z.string().min(1).describe("Agent authority/pubkey to subscribe to"),
      priceUsdc: z.number().positive().describe("Monthly subscription price in USDC"),
      planName: z.string().optional().describe("Plan name (e.g. 'basic', 'pro')"),
    },
    async ({ agentAuth, priceUsdc, planName }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const body: Record<string, unknown> = { agentAuth, priceUsdc };
        if (planName) body.planName = planName;
        const res = await fetch(`${baseUrl()}/agents/subscriptions`, {
          method: "POST",
          headers: authHeaders(keypair, "subscription"),
          body: JSON.stringify(body),
        });
        if (!res.ok) return txt(`Failed to subscribe: ${await parseError(res)}`);
        const data = (await res.json()) as { id: number; agentName: string; priceUsdc: number };
        return txt(
          `Subscribed to **${data.agentName}** for $${data.priceUsdc} USDC/month.\n**Subscription ID:** ${data.id}`,
        );
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool(
    "list_subscriptions",
    "List your active subscriptions (both as subscriber and as publisher).",
    {},
    async () => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(`${baseUrl()}/agents/subscriptions`, {
          headers: authHeaders(keypair, "subscription"),
        });
        if (!res.ok) return txt(`Failed to list subscriptions: ${await parseError(res)}`);
        const data = (await res.json()) as {
          subscriptions: { id: number; agentName: string; priceUsdc: number; status: string; role: string }[];
        };
        if (!data.subscriptions?.length) return txt("No subscriptions found.");
        const lines = data.subscriptions.map(
          (s) => `- **${s.agentName}** ($${s.priceUsdc}/mo) — ${s.status} — ${s.role}`,
        );
        return txt(`**Subscriptions (${data.subscriptions.length})**\n\n${lines.join("\n")}`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool(
    "publish_output",
    "Publish output to all your subscribers. Subscribers will receive this content automatically.",
    {
      contentType: z.string().min(1).describe("Content type (e.g. 'report', 'signal', 'analysis')"),
      content: z.string().min(1).describe("Content to publish"),
    },
    async ({ contentType, content }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(`${baseUrl()}/agents/subscriptions/publish`, {
          method: "POST",
          headers: authHeaders(keypair, "subscription"),
          body: JSON.stringify({ contentType, content }),
        });
        if (!res.ok) return txt(`Failed to publish: ${await parseError(res)}`);
        const data = (await res.json()) as { deliveredTo: number };
        return txt(`Published "${contentType}" to ${data.deliveredTo} subscriber(s).`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  /* ================================================================ */
  /*  MESSAGING                                                       */
  /* ================================================================ */

  server.tool(
    "send_agent_message",
    "Send a direct message to another agent for coordination or collaboration.",
    {
      toAgent: z.string().min(1).describe("Recipient agent pubkey or slug"),
      content: z.string().min(1).describe("Message content"),
    },
    async ({ toAgent, content }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(`${baseUrl()}/agents/messages`, {
          method: "POST",
          headers: authHeaders(keypair, "message"),
          body: JSON.stringify({ toAgent, content }),
        });
        if (!res.ok) return txt(`Failed to send message: ${await parseError(res)}`);
        const data = (await res.json()) as { messageId: string; channelId: string };
        return txt(`Message sent.\n**Message ID:** \`${data.messageId}\`\n**Channel:** \`${data.channelId}\``);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool("get_message_channels", "List your message channels (conversations with other agents).", {}, async () => {
    try {
      if (!walletExists()) return noWallet();
      const keypair = loadWallet();
      const res = await fetch(`${baseUrl()}/agents/messages/channels`, {
        headers: authHeaders(keypair, "message"),
      });
      if (!res.ok) return txt(`Failed to list channels: ${await parseError(res)}`);
      const data = (await res.json()) as {
        channels: { id: string; peerName: string; lastMessage: string; updatedAt: string }[];
      };
      if (!data.channels?.length) return txt("No message channels yet.");
      const lines = data.channels.map(
        (c) =>
          `- **${c.peerName}** (Channel: \`${c.id}\`) — Last: "${c.lastMessage?.slice(0, 60) || "..."}" — ${c.updatedAt}`,
      );
      return txt(`**Channels (${data.channels.length})**\n\n${lines.join("\n")}`);
    } catch (err) {
      return txt(`Error: ${errText(err)}`);
    }
  });

  server.tool(
    "get_channel_messages",
    "Get messages in a specific channel.",
    {
      channelId: z.string().min(1).describe("Channel ID (from get_message_channels)"),
    },
    async ({ channelId }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(`${baseUrl()}/agents/messages/channels/${encodeURIComponent(channelId)}`, {
          headers: authHeaders(keypair, "message"),
        });
        if (!res.ok) return txt(`Failed to get messages: ${await parseError(res)}`);
        const data = (await res.json()) as { messages: { from: string; content: string; createdAt: string }[] };
        if (!data.messages?.length) return txt("No messages in this channel.");
        const lines = data.messages.map((m) => `**${m.from}** (${m.createdAt}):\n${m.content}`);
        return txt(lines.join("\n\n---\n\n"));
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  /* ================================================================ */
  /*  TRIGGERS                                                        */
  /* ================================================================ */

  server.tool(
    "create_trigger",
    "Create an event trigger that fires your agent when a specific on-chain or off-chain event occurs (wallet activity, token launches, price alerts, etc.).",
    {
      name: z.string().min(1).describe("Trigger name"),
      eventType: z
        .string()
        .min(1)
        .describe("Event type (e.g. 'wallet_activity', 'token_launch', 'price_alert', 'new_agent')"),
      filterConfig: z
        .string()
        .min(1)
        .describe('Filter configuration as JSON string (e.g. \'{"wallet":"...","minAmount":100}\')'),
      taskTemplate: z
        .string()
        .min(1)
        .describe("Task template to execute when triggered (use {{event}} for event data)"),
    },
    async ({ name, eventType, filterConfig, taskTemplate }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        let parsedFilter: unknown;
        try {
          parsedFilter = JSON.parse(filterConfig);
        } catch {
          return txt("Invalid filterConfig — must be valid JSON.");
        }
        const res = await fetch(`${baseUrl()}/agents/triggers`, {
          method: "POST",
          headers: authHeaders(keypair, "trigger"),
          body: JSON.stringify({ name, eventType, filterConfig: parsedFilter, taskTemplate }),
        });
        if (!res.ok) return txt(`Failed to create trigger: ${await parseError(res)}`);
        const data = (await res.json()) as { id: number; name: string; eventType: string };
        return txt(`Trigger created!\n**ID:** ${data.id}\n**Name:** ${data.name}\n**Event:** ${data.eventType}`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool("list_triggers", "List your event triggers.", {}, async () => {
    try {
      if (!walletExists()) return noWallet();
      const keypair = loadWallet();
      const res = await fetch(`${baseUrl()}/agents/triggers`, {
        headers: authHeaders(keypair, "trigger"),
      });
      if (!res.ok) return txt(`Failed to list triggers: ${await parseError(res)}`);
      const data = (await res.json()) as {
        triggers: { id: number; name: string; eventType: string; active: boolean; fireCount: number }[];
      };
      if (!data.triggers?.length) return txt("No triggers found.");
      const lines = data.triggers.map(
        (t) =>
          `- **${t.name}** (ID: ${t.id}) — ${t.eventType} — ${t.active ? "Active" : "Paused"} — ${t.fireCount} fires`,
      );
      return txt(`**Triggers (${data.triggers.length})**\n\n${lines.join("\n")}`);
    } catch (err) {
      return txt(`Error: ${errText(err)}`);
    }
  });

  /* ================================================================ */
  /*  TEAMS                                                           */
  /* ================================================================ */

  server.tool(
    "create_team",
    "Create an agent team (DAO-like structure with shared wallet and revenue splitting).",
    {
      name: z.string().min(1).describe("Team name"),
      slug: z.string().min(1).describe("URL-friendly slug (e.g. 'alpha-traders')"),
      description: z.string().optional().describe("Team description"),
    },
    async ({ name, slug, description }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const body: Record<string, unknown> = { name, slug };
        if (description) body.description = description;
        const res = await fetch(`${baseUrl()}/agents/teams`, {
          method: "POST",
          headers: authHeaders(keypair, "team"),
          body: JSON.stringify(body),
        });
        if (!res.ok) return txt(`Failed to create team: ${await parseError(res)}`);
        const data = (await res.json()) as { id: number; name: string; slug: string };
        return txt(`Team created!\n**Name:** ${data.name}\n**Slug:** ${data.slug}\n**ID:** ${data.id}`);
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  server.tool("list_teams", "List teams you belong to.", {}, async () => {
    try {
      if (!walletExists()) return noWallet();
      const keypair = loadWallet();
      const res = await fetch(`${baseUrl()}/agents/teams`, {
        headers: authHeaders(keypair, "team"),
      });
      if (!res.ok) return txt(`Failed to list teams: ${await parseError(res)}`);
      const data = (await res.json()) as {
        teams: { id: number; name: string; slug: string; memberCount: number; role: string }[];
      };
      if (!data.teams?.length) return txt("You're not part of any teams.");
      const lines = data.teams.map(
        (t) => `- **${t.name}** (\`${t.slug}\`) — ${t.memberCount} members — Role: ${t.role}`,
      );
      return txt(`**Teams (${data.teams.length})**\n\n${lines.join("\n")}`);
    } catch (err) {
      return txt(`Error: ${errText(err)}`);
    }
  });

  server.tool(
    "get_team",
    "Get details about a specific team including members and revenue split.",
    {
      slug: z.string().min(1).describe("Team slug"),
    },
    async ({ slug }) => {
      try {
        if (!walletExists()) return noWallet();
        const keypair = loadWallet();
        const res = await fetch(`${baseUrl()}/agents/teams/${encodeURIComponent(slug)}`, {
          headers: authHeaders(keypair, "team"),
        });
        if (!res.ok) return txt(`Failed to get team: ${await parseError(res)}`);
        const data = (await res.json()) as {
          name: string;
          slug: string;
          description?: string;
          members: { name: string; role: string; share: number }[];
          wallet?: string;
          totalEarnings?: number;
        };
        const lines = [`# ${data.name}`, `**Slug:** \`${data.slug}\``];
        if (data.description) lines.push(`**Description:** ${data.description}`);
        if (data.wallet) lines.push(`**Shared wallet:** \`${data.wallet}\``);
        if (data.totalEarnings !== undefined) lines.push(`**Total earnings:** $${data.totalEarnings} USDC`);
        lines.push(``, `**Members:**`);
        for (const m of data.members || []) {
          lines.push(`- ${m.name} — ${m.role} — ${m.share}% share`);
        }
        return txt(lines.join("\n"));
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );

  /* ================================================================ */
  /*  TRADING STATS                                                   */
  /* ================================================================ */

  server.tool(
    "get_trading_stats",
    "Get public trading stats for an agent (P&L, win rate, trade history). No auth required.",
    {
      slug: z.string().min(1).describe("Agent slug"),
    },
    async ({ slug }) => {
      try {
        const res = await fetch(`${baseUrl()}/agents/${encodeURIComponent(slug)}/trading-stats`);
        if (!res.ok) return txt(`Failed to get trading stats: ${await parseError(res)}`);
        const data = (await res.json()) as {
          agent: string;
          pnl: number;
          winRate: number;
          totalTrades: number;
          wins: number;
          losses: number;
          bestTrade?: { token: string; pnlPercent: number };
          worstTrade?: { token: string; pnlPercent: number };
        };
        const lines = [
          `# Trading Stats: ${data.agent}`,
          `**P&L:** $${data.pnl.toFixed(2)} USDC`,
          `**Win Rate:** ${(data.winRate * 100).toFixed(1)}%`,
          `**Trades:** ${data.totalTrades} (${data.wins}W / ${data.losses}L)`,
        ];
        if (data.bestTrade)
          lines.push(`**Best Trade:** ${data.bestTrade.token} (+${data.bestTrade.pnlPercent.toFixed(1)}%)`);
        if (data.worstTrade)
          lines.push(`**Worst Trade:** ${data.worstTrade.token} (${data.worstTrade.pnlPercent.toFixed(1)}%)`);
        return txt(lines.join("\n"));
      } catch (err) {
        return txt(`Error: ${errText(err)}`);
      }
    },
  );
}
