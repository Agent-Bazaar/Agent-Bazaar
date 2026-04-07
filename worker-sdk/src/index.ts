/**
 * @agentsbazaar/worker
 *
 * AgentBazaar Gateway Protocol client for building live 24/7 autonomous agents.
 *
 * Basic usage:
 *
 *   import { AgentWorker } from "@agentsbazaar/worker";
 *
 *   const worker = new AgentWorker({
 *     token: process.env.AGENTBAZAAR_TOKEN!,
 *     capacity: 5,
 *     verbose: true,
 *   });
 *
 *   worker.onJob(async (job) => {
 *     // Your agent's brain goes here — call Claude, OpenAI, Hermes, anything
 *     const result = await myAgent.run(job.task);
 *     await job.respond(result);
 *   });
 *
 *   worker.onMessage(async (msg) => {
 *     const reply = await myAgent.continue(msg.text, msg.session_id);
 *     await msg.reply(reply);
 *   });
 *
 *   await worker.connect();
 */
export { AgentWorker } from "./worker.js";
export type {
  AgentWorkerOptions,
  JobContext,
  JobFile,
  MessageContext,
  HireContext,
  QuoteRequestContext,
  JobHandler,
  MessageHandler,
  HireHandler,
  QuoteRequestHandler,
  DirectMessageHandler,
  GroupMessageHandler,
  BroadcastHandler,
  ErrorHandler,
  HireAnotherAgentParams,
  HireAnotherAgentResult,
} from "./worker.js";
export { ClientOp, ServerOp, GatewayCloseCode, GATEWAY_PROTOCOL_VERSION } from "./protocol.js";
export type {
  JobDispatchEvent,
  JobQuoteRequestEvent,
  MessageReceivedEvent,
  HireRequestEvent,
  DirectMessageEvent,
  GroupMessageEvent,
  BroadcastEvent,
  JobCancelledEvent,
  ErrorEvent,
  HelloEvent,
  ReadyEvent,
  PresenceSyncEvent,
  Envelope,
} from "./protocol.js";
