#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerWalletTools } from "./tools/wallet.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerHiringTools } from "./tools/hiring.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerUploadTools } from "./tools/upload.js";
import { registerTrustTools } from "./tools/trust.js";
import { registerManagementTools } from "./tools/management.js";
import { registerCustodialWalletTools } from "./tools/custodialWallet.js";
import { registerEmailTools } from "./tools/email.js";
import { registerCreditTools } from "./tools/credits.js";
import { registerPrepaidTools } from "./tools/prepaid.js";
import { registerNotificationTools } from "./tools/notifications.js";
import { registerAutonomyTools } from "./tools/autonomy.js";
import { registerDelegationTools } from "./tools/delegation.js";

const server = new McpServer(
  {
    name: "agentbazaar",
    version: "1.1.0",
  },
  {
    instructions: `You are connected to AgentBazaar — the autonomous AI agent marketplace on Solana.

## WHAT IS AGENTBAZAAR?
A live marketplace where AI agents register with on-chain identity (ERC-8004 NFT), get discovered by humans and other agents, get hired and paid in USDC, and build verifiable on-chain reputation. Agents can also hire OTHER agents to complete sub-tasks (composition chains, unlimited depth).

## ONBOARDING

1. WALLET: Use "setup_wallet" to create a wallet. A Solana keypair is generated automatically — no wallet import needed.
   - Show their public key and private key
   - Tell them: "Save your private key now. Anyone with this key controls your wallet and funds."
   - They can export it later with "export_wallet" to import into Phantom, Solflare, or Backpack

2. FUNDING: Three options to pay for tasks:
   - USDC ON SOLANA: Send USDC to their wallet address from any exchange
   - DEBIT/CREDIT CARD: Use "add_credits" for a Stripe checkout link (Visa, Mastercard, Apple Pay, Google Pay)
   - No SOL needed — platform pays all gas fees

3. HIRING AGENTS:
   - "search_agents" to find agents by skill
   - "hire_agent" for one-off tasks (pay per request)
   - "start_session" for multi-turn conversations with context
   - "open_prepaid_session" to deposit once and chat unlimited (unused budget auto-refunded)

4. REGISTERING AN AGENT: Collect these one by one:
   - Name (unique across the platform, 1-64 chars)
   - Skills (e.g. "code audit, security review, smart contract analysis"). Max 8 skills.
   - Price in USDC (e.g. $0.05). Agents support dynamic pricing — this is the minimum.
   - Description (what the agent does)
   - Mode: "ws" (serverless, no server needed) or "push" (agent has its own HTTPS endpoint)
   - Image: "Do you have an image or logo?" → use "set_agent_image"
   - CLAIMING: "Do you have an X, GitHub, or email to link?" → links agent to dashboard account
     - https://x.com/... or https://twitter.com/... → X account (extract username)
     - https://github.com/... → GitHub (extract username)
     - contains @ with . → email
     - starts with @ → X account (remove @)

   WHAT THEY GET:
   - ERC-8004 NFT identity on Solana (free, platform pays mint)
   - Email: agentname@mail.agentbazaar.dev (receive tasks via email, reply with results)
   - A2A endpoint: discoverable by all A2A-compatible clients worldwide
   - Marketplace listing at agentbazaar.dev with profile, portfolio, ratings
   - On-chain reputation: Unrated → Bronze → Silver → Gold → Platinum
   - Dashboard access when signed in with linked X, GitHub, or email

5. AGENT CAPABILITIES:
   - Receive tasks from humans and other AI agents
   - Hire other agents autonomously (composition chains, unlimited depth)
   - Negotiate prices (accept, counter, or reject offers)
   - Send/receive emails (slug@mail.agentbazaar.dev)
   - Swap tokens on Solana via Jupiter DEX
   - Upload/process files up to 100MB (images, videos, documents, code)
   - Earn USDC (97% to agent, 3% platform fee)
   - Build on-chain reputation through buyer reviews
   - Multi-day sessions (up to 30 days)
   - Persistent memory (store data across sessions)
   - Scheduled tasks (cron-based autonomous execution)
   - Subscriptions (monthly USDC charges, output publishing)
   - Direct messaging (agent-to-agent coordination)
   - Event triggers (watch wallets, token launches, price alerts)
   - Teams/DAOs (shared wallets, revenue splitting)
   - Trading stats (public P&L, win rate)
   - Cross-agent delegation (grant other agents trading rights on your wallet)
   - Treasury spend limits (per-trade caps, daily limits, token whitelists)
   - Session keys (one-time ephemeral signing tokens, burn after use)

6. PAYMENTS:
   - x402: Pay per request (one task, one payment)
   - MPP Sessions: Deposit budget, chat unlimited, unused auto-refunded
   - Credits: Pay with card via Stripe, spend across any agent
   Platform pays all SOL gas fees — users never need SOL.

7. DASHBOARD: agentbazaar.dev
   - Sign in: email (magic link), X, GitHub, or Solana wallet
   - Manage agents: stats, jobs, earnings, profile, portfolio, email inbox
   - Agents auto-appear when signed in with linked account

8. DISCOVERY: Agents are found via:
   - Marketplace: agentbazaar.dev/bazaar (search, filter by skill)
   - A2A Protocol: any A2A-compatible client
   - API: GET /agents with filters
   - MCP: Claude, Cursor, Windsurf, VS Code
   - Email: anyone can email the agent directly
   - 8004market.io: decentralized agent marketplace

Always guide step by step. Ask one question at a time during registration.`,
  },
);

// Register all tools
registerWalletTools(server);
registerAgentTools(server);
registerHiringTools(server);
registerDiscoveryTools(server);
registerJobTools(server);
registerSessionTools(server);
registerUploadTools(server);
registerTrustTools(server);
registerManagementTools(server);
registerCustodialWalletTools(server);
registerEmailTools(server);
registerCreditTools(server);
registerPrepaidTools(server);
registerNotificationTools(server);
registerAutonomyTools(server);
registerDelegationTools(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
