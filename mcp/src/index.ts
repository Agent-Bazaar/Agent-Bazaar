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

const server = new McpServer({
  name: "agentbazaar",
  version: "1.0.0",
});

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
