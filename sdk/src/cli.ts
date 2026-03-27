#!/usr/bin/env node

import { Command } from "commander";
import { Keypair } from "@solana/web3.js";
import { AgentBazaarClient } from "./client.js";
import { averageRating } from "./types.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function loadWallet(): Keypair {
  const walletPath =
    process.env.SOLANA_KEYPAIR || process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");

  if (!fs.existsSync(walletPath)) {
    console.error(`Wallet not found at ${walletPath}`);
    console.error("Set SOLANA_KEYPAIR or use the default Solana CLI keypair location.");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function createClient(options: { api?: string; wallet?: boolean }): AgentBazaarClient {
  const baseUrl = options.api || process.env.AGENTBAZAAR_API || "https://agentbazaar.dev";
  const keypair = options.wallet !== false ? loadWallet() : undefined;
  return new AgentBazaarClient({ baseUrl, keypair });
}

function formatUsdc(raw: string | number): string {
  return (Number(raw) / 1_000_000).toFixed(2);
}

const program = new Command();

program
  .name("bazaar")
  .description("AgentBazaar CLI — register, discover, and hire AI agents on Solana")
  .version("0.3.0");

// ── register ──
program
  .command("register")
  .description("Register a new AI agent")
  .requiredOption("--name <name>", "Agent name (max 64 chars)")
  .requiredOption("--skills <skills>", "Comma-separated skills (max 256 chars)")
  .option("--endpoint <url>", "Agent HTTPS endpoint URL (required for push mode)")
  .requiredOption("--price <amount>", "Price per request in USDC micro-units")
  .option("--mode <mode>", "Delivery mode: push (own server) or ws (WebSocket)", "ws")
  .option("--description <text>", "Agent description (max 512 chars)")
  .option("--api <url>", "API base URL")
  .action(async (opts) => {
    try {
      const mode = opts.mode === "push" ? ("push" as const) : ("ws" as const);
      if (mode === "push" && !opts.endpoint) {
        console.error("--endpoint is required for push mode");
        process.exit(1);
      }

      const client = createClient({ api: opts.api });
      console.log(`Registering agent (${mode} mode)...`);

      const result = await client.register({
        name: opts.name,
        skills: opts.skills,
        endpoint: opts.endpoint || "",
        pricePerRequest: parseInt(opts.price, 10),
        description: opts.description,
        deliveryMode: mode,
      });

      console.log("\nAgent registered successfully!");
      console.log(`  Name: ${result.agent.name}`);
      console.log(`  Wallet: ${result.agent.authority}`);
      console.log(`  Skills: ${result.agent.skills}`);
      console.log(`  Price: ${formatUsdc(result.agent.price_per_request)} USDC`);
      console.log(`  Mode: ${result.agent.delivery_mode}`);
      if (result.agent.endpoint) console.log(`  Endpoint: ${result.agent.endpoint}`);
      if (result.agent.slug)
        console.log(`  A2A Card: https://agentbazaar.dev/a2a/${result.agent.slug}/.well-known/agent.json`);
      if (result.agent.nft_8004) {
        console.log(`  8004 NFT: ${result.agent.nft_8004}`);
      } else {
        console.log("  8004 NFT: Minting in progress...");
      }

      if (result.websocket) {
        console.log("\n  WebSocket Connection:");
        console.log(`    URL: ${result.websocket.url}`);
        console.log(`    Token: ${result.websocket.token}`);
        console.log(`    Poll Fallback: ${result.websocket.pollUrl}`);
        console.log("\n  Run your agent: bazaar run --token <your-token>");
      }
    } catch (err) {
      console.error(`Registration failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── agents ──
program
  .command("agents")
  .description("List registered agents")
  .option("--active", "Only show active agents", true)
  .option("--skill <skill>", "Filter by skill")
  .option("--limit <n>", "Max results", "20")
  .option("--api <url>", "API base URL")
  .action(async (opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });
      const result = await client.listAgents({
        skills: opts.skill,
        active_only: opts.active,
        limit: parseInt(opts.limit, 10),
      });

      if (result.agents.length === 0) {
        console.log("No agents found.");
        return;
      }

      console.log(`${result.pagination.total} agent(s) total:\n`);
      for (const agent of result.agents) {
        const rating = averageRating(agent);
        console.log(`  ${agent.name} ${agent.is_active ? "(Active)" : "(Inactive)"}`);
        console.log(`    Wallet: ${agent.authority}`);
        console.log(`    Skills: ${agent.skills}`);
        console.log(`    Price: ${formatUsdc(agent.price_per_request)} USDC`);
        console.log(
          `    Jobs: ${agent.total_jobs_completed} | Rating: ${rating !== null ? rating.toFixed(1) + "/5" : "N/A"}`,
        );
        if (agent.nft_8004) console.log(`    8004: ${agent.nft_8004}`);
        console.log();
      }
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── agent ──
program
  .command("agent <pubkey>")
  .description("Get details for a specific agent")
  .option("--api <url>", "API base URL")
  .action(async (pubkey, opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });
      const agent = await client.getAgent(pubkey);

      const rating = averageRating(agent);
      console.log(`${agent.name} ${agent.is_active ? "(Active)" : "(Inactive)"}`);
      console.log(`  Wallet: ${agent.authority}`);
      if (agent.description) console.log(`  Description: ${agent.description}`);
      console.log(`  Skills: ${agent.skills}`);
      console.log(`  Endpoint: ${agent.endpoint}`);
      console.log(`  Price: ${formatUsdc(agent.price_per_request)} USDC`);
      console.log(`  Jobs Completed: ${agent.total_jobs_completed}`);
      console.log(`  Total Earned: ${formatUsdc(agent.total_earned)} USDC`);
      console.log(`  Rating: ${rating !== null ? rating.toFixed(1) + "/5" : "N/A"} (${agent.rating_count} reviews)`);
      if (agent.nft_8004) console.log(`  8004 NFT: ${agent.nft_8004}`);
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── jobs ──
program
  .command("jobs")
  .description("List jobs")
  .option("--buyer <wallet>", "Filter by buyer")
  .option("--seller <wallet>", "Filter by seller")
  .option("--limit <n>", "Max results", "20")
  .option("--api <url>", "API base URL")
  .action(async (opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });
      const result = await client.listJobs({
        buyer: opts.buyer,
        seller: opts.seller,
        limit: parseInt(opts.limit, 10),
      });

      if (result.jobs.length === 0) {
        console.log("No jobs found.");
        return;
      }

      const statusMap: Record<number, string> = { 0: "Created", 1: "Completed", 2: "Disputed", 3: "Cancelled" };
      console.log(`${result.pagination.total} job(s) total:\n`);
      for (const job of result.jobs) {
        console.log(`  Job #${job.id} — ${statusMap[job.status] || "Unknown"}`);
        console.log(`    Amount: ${formatUsdc(job.amount)} USDC`);
        console.log(`    Buyer: ${job.buyer}`);
        console.log(`    Seller: ${job.seller}`);
        console.log();
      }
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── quote ──
program
  .command("quote")
  .description("Get a price quote from an agent before paying")
  .requiredOption("--task <text>", "Task to get a quote for")
  .option("--agent <wallet>", "Target specific agent by wallet address")
  .option("--skills <skills>", "Filter agents by skills")
  .option("--api <url>", "API base URL")
  .action(async (opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });
      console.log("Requesting quote...\n");

      const quote = await client.quote({
        task: opts.task,
        agent: opts.agent,
        skills: opts.skills,
      });

      console.log(`Agent: ${quote.agent.name} (${quote.agent.authority})`);
      console.log(`Price: ${quote.priceUsdc} USDC (${quote.source} pricing)`);
      console.log(`Quote ID: ${quote.quoteId}`);
      console.log(`Expires: ${new Date(Number(quote.expiresAt)).toLocaleString()}`);
      if (quote.estimate) console.log(`Estimate: ${quote.estimate}`);
      if (quote.breakdown) console.log(`Breakdown: ${quote.breakdown}`);
      console.log(`\nUse with: bazaar call --task "..." --quote ${quote.quoteId}`);
    } catch (err) {
      console.error(`Quote failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── call ──
program
  .command("call")
  .description("One-call agent hiring: discover, execute, verify, settle")
  .requiredOption("--task <text>", "Task for the agent to perform")
  .option("--skills <skills>", "Filter agents by skills")
  .option("--agent <wallet>", "Target specific agent by wallet address")
  .option("--quote <id>", "Use a previously obtained quote ID")
  .option("--session <id>", "Continue an existing session")
  .option("--new-session", "Create a new multi-turn session")
  .option("--api <url>", "API base URL")
  .action(async (opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });
      console.log("Sending task...\n");

      const result = await client.call({
        task: opts.task,
        skills: opts.skills,
        agent: opts.agent,
        quoteId: opts.quote,
        sessionId: opts.session,
        createSession: opts.newSession || false,
      });

      console.log(`Agent: ${result.agent.name} (${result.agent.authority})`);
      console.log(`Price: ${result.agent.price} USDC`);
      console.log(`Score: ${result.verification.score}/100 — ${result.verification.action}`);
      console.log(`Job: #${result.job.id} (${result.job.status})`);
      if (result.sessionId) console.log(`Session: ${result.sessionId}`);
      if (result.quoteId) console.log(`Quote: ${result.quoteId}`);
      console.log(`Latency: ${result.meta.agentLatencyMs}ms (total: ${result.meta.totalMs}ms)`);
      console.log(`\nResult:`);
      console.log(typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2));
    } catch (err) {
      console.error(`Call failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── a2a ──
program
  .command("a2a <slug>")
  .description("Send a task via A2A protocol")
  .requiredOption("--task <text>", "Task for the agent")
  .option("--stream", "Use SSE streaming (tasks/sendSubscribe)")
  .option("--api <url>", "API base URL")
  .action(async (slug, opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });

      if (opts.stream) {
        console.log(`Streaming A2A task to ${slug}...\n`);
        for await (const event of client.a2aStream(slug, opts.task)) {
          const state = event.result?.status?.state || "unknown";
          const isFinal = event.result?.final;

          if (isFinal && event.result?.artifacts) {
            const text = event.result.artifacts[0]?.parts[0]?.text || "";
            const score = (event.result.metadata?.verification as Record<string, unknown>)?.score;
            console.log(`[${state}] score=${score}`);
            console.log(`\nResult:\n${text}`);
          } else {
            console.log(`[${state}]`);
          }
        }
      } else {
        console.log(`Sending A2A task to ${slug}...\n`);
        const result = await client.a2aSend(slug, opts.task);

        if (result.error) {
          console.error(`Error: ${result.error.message}`);
          process.exit(1);
        }

        const r = result.result!;
        const text = r.artifacts?.[0]?.parts?.[0]?.text || "";
        const score = (r.metadata?.verification as Record<string, unknown>)?.score;
        console.log(`Status: ${r.status.state}`);
        console.log(`Score: ${score}/100`);
        console.log(`Task ID: ${r.id}`);
        console.log(`\nResult:\n${text}`);
      }
    } catch (err) {
      console.error(`A2A failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── sessions ──
program
  .command("sessions")
  .description("List your sessions")
  .requiredOption("--buyer <wallet>", "Your wallet address")
  .option("--status <status>", "Filter by status: active, closed, expired")
  .option("--api <url>", "API base URL")
  .action(async (opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });
      const { sessions } = await client.listSessions(opts.buyer, opts.status);

      if (sessions.length === 0) {
        console.log("No sessions found.");
        return;
      }

      console.log(`${sessions.length} session(s):\n`);
      for (const s of sessions) {
        console.log(`  ${s.id} [${s.status}]`);
        console.log(`    Agent: ${s.agent_auth}`);
        console.log(`    Messages: ${s.message_count} | Spent: ${formatUsdc(s.total_spent)} USDC`);
        console.log();
      }
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── stats ──
program
  .command("stats")
  .description("Platform statistics")
  .option("--api <url>", "API base URL")
  .action(async (opts) => {
    try {
      const client = createClient({ api: opts.api, wallet: false });
      const stats = await client.stats();

      console.log("AgentBazaar Platform Stats");
      console.log(`  Agents: ${stats.total_agents}`);
      console.log(`  Jobs: ${stats.total_jobs}`);
      console.log(`  Volume: $${stats.total_volume_usdc} USDC`);
      console.log(`  Fees: $${stats.platform_fees_usdc} USDC`);
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program.parse();
