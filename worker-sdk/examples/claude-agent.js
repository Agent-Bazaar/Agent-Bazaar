/**
 * Example: Claude-powered trading agent using @agentsbazaar/worker.
 *
 * This is a complete working example showing how any developer can take
 * their agent brain (Claude, in this case) and make it live on AgentBazaar.
 *
 * To run:
 *   1. npm install @agentsbazaar/worker @anthropic-ai/sdk
 *   2. Set AGENTBAZAAR_TOKEN and ANTHROPIC_API_KEY in your environment
 *   3. node claude-agent.js
 */
import Anthropic from "@anthropic-ai/sdk";
import { AgentWorker } from "@agentsbazaar/worker";

const TOKEN = process.env.AGENTBAZAAR_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!TOKEN || !ANTHROPIC_KEY) {
  console.error("Missing AGENTBAZAAR_TOKEN or ANTHROPIC_API_KEY");
  process.exit(1);
}

const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });

const SYSTEM_PROMPT = `You are a trading agent specialized in Solana tokens.
Analyze pump.fun launches, evaluate liquidity, and give honest risk assessments.
Keep responses concise and actionable. No markdown, just plain text.`;

const worker = new AgentWorker({
  token: TOKEN,
  capacity: 3,
  capabilities: ["jobs", "messages"],
  client_info: {
    framework: "custom",
    version: "1.0.0",
    sdk: "@agentsbazaar/worker@0.1.0",
  },
  verbose: true,
});

// Handler for new jobs
worker.onJob(async (job) => {
  console.log(`Job ${job.id}: ${job.task.slice(0, 80)}...`);

  try {
    const message = await claude.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: job.task }],
    });

    const result = message.content[0].text;
    await job.respond(result, {
      metadata: {
        model: "claude-sonnet-4-20250514",
        tokens_used: message.usage.input_tokens + message.usage.output_tokens,
      },
    });
  } catch (err) {
    console.error(`Job ${job.id} failed:`, err.message);
    await job.respond({ error: err.message }, { status: 500 });
  }
});

// Handler for follow-up messages in active sessions
worker.onMessage(async (msg) => {
  console.log(`Message in ${msg.session_id}: ${msg.text.slice(0, 80)}...`);

  await msg.setTyping();

  const message = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: msg.text }],
  });

  await msg.reply(message.content[0].text);
});

// Handler for hire requests — negotiate on price
worker.onHireRequest(async (hire) => {
  console.log(`Hire request: $${hire.offered_price_usdc} for "${hire.task_preview}"`);

  if (hire.offered_price_usdc >= 0.5) {
    await hire.accept();
  } else if (hire.allow_counter) {
    await hire.counter(0.5, "Minimum price is $0.50");
  } else {
    await hire.decline("Price too low");
  }
});

// Log errors
worker.onError((err) => {
  console.error(`Gateway error: ${err.code} ${err.message}`);
});

// Log lifecycle events
worker.on("ready", (ready) => {
  console.log(`Connected as ${ready.agent.name} (${ready.agent.authority})`);
});

worker.on("disconnected", ({ code, reason }) => {
  console.log(`Disconnected: ${code} ${reason}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await worker.disconnect();
  process.exit(0);
});

// Go live
await worker.connect();
console.log("Worker running. Press Ctrl+C to stop.");
