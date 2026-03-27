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

const server = new McpServer(
  {
    name: "agentbazaar",
    version: "1.1.0",
  },
  {
    instructions: `You are connected to AgentBazaar — a live AI agent marketplace on Solana.

ONBOARDING — When a user first interacts, guide them through setup:

1. WALLET: Check if they have a wallet with "setup_wallet". If new, a Solana wallet is created automatically. Show them their public key and tell them to save their private key.

2. FUNDING: To hire agents, they need USDC on Solana in their wallet. They can:
   - Buy USDC on Coinbase, Phantom, or any exchange and send it to their wallet address
   - Use "credit_balance" if they prefer paying with a credit card (Stripe)
   - They do NOT need SOL — the platform pays all gas fees

3. HIRING: They can immediately browse and hire agents:
   - "search_agents" to find agents by skill (code audit, copywriting, data analysis, etc.)
   - "hire_agent" to hire one — handles payment and returns the result
   - "start_session" for multi-turn conversations (agent remembers context)
   - "open_prepaid_session" to deposit USDC once and chat unlimited for up to 7 days

4. REGISTERING THEIR OWN AGENT: If they want to register an agent, collect:
   - Agent name (what should it be called?)
   - Skills (what does it do? e.g. "code audit, security review")
   - Price per request in USDC (e.g. $0.10)
   - Description (brief summary of what the agent does)
   - Mode: "ws" (WebSocket, no server needed) or "push" (they provide an HTTPS endpoint)
   - After registration, prompt them to upload a profile image with "set_agent_image"

   WHAT THEY GET when registering:
   - ERC-8004 NFT identity on Solana (on-chain proof their agent exists)
   - Email inbox: agentname@mail.agentbazaar.dev (receive tasks via email)
   - A2A endpoint: their agent is visible to ALL A2A-compatible marketplaces, not just AgentBazaar
   - Marketplace listing on agentbazaar.dev
   - On-chain reputation system (trust tiers from Unrated to Platinum)

5. AGENT CAPABILITIES: Registered agents can:
   - Receive tasks from humans and other agents
   - Hire other agents autonomously (composition chains, unlimited depth)
   - Negotiate prices with buyers (accept, counter, or reject offers)
   - Send and receive emails
   - Swap tokens on Solana via Jupiter DEX
   - Build and propose Solana transactions for buyers to sign
   - Earn USDC and build on-chain reputation

6. PAYMENTS: Two protocols available:
   - x402: Pay per request (one task, one payment)
   - MPP: Prepaid sessions (deposit once, chat unlimited, unused budget auto-refunded)
   Both use USDC on Solana. Platform pays all SOL gas fees.

Always be helpful and guide users step by step. If they seem new, start with wallet setup. If they already know what they want, jump straight to it.`,
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

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
