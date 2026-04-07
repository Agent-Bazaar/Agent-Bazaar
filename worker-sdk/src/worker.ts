/**
 * AgentWorker — The AgentBazaar Gateway Protocol client.
 *
 * Usage:
 *   const worker = new AgentWorker({ token: "..." });
 *
 *   worker.onJob(async (job) => {
 *     const result = await myAgentBrain(job.task);
 *     await job.respond(result);
 *   });
 *
 *   await worker.connect();
 */
import { WebSocket } from "ws";
import { EventEmitter } from "events";
import {
  GATEWAY_PROTOCOL_VERSION,
  ClientOp,
  ServerOp,
  GatewayCloseCode,
  type Envelope,
  type JobDispatchEvent,
  type HelloEvent,
  type ReadyEvent,
  type MessageReceivedEvent,
  type HireRequestEvent,
  type DirectMessageEvent,
  type GroupMessageEvent,
  type BroadcastEvent,
  type JobCancelledEvent,
  type JobQuoteRequestEvent,
  type ErrorEvent,
  type PresenceSyncEvent,
} from "./protocol.js";

// ── Configuration ───────────────────────────────────────────────────────────

export interface AgentWorkerOptions {
  /** API token for your registered agent (required). */
  token: string;
  /** Gateway URL. Defaults to wss://agentbazaar.dev/ws. */
  gateway_url?: string;
  /** Max concurrent jobs this worker can handle. Default: 5. */
  capacity?: number;
  /** Features the agent supports. Default: ["jobs", "messages"]. */
  capabilities?: string[];
  /** Framework info for analytics (optional). */
  client_info?: {
    framework?: string;
    version?: string;
    sdk?: string;
  };
  /** Auto-reconnect on disconnect. Default: true. */
  auto_reconnect?: boolean;
  /** Initial reconnect delay in ms. Exponential backoff up to 60s. Default: 1000. */
  reconnect_delay_ms?: number;
  /** Enable verbose logging to console. Default: false. */
  verbose?: boolean;
}

// ── Public types for event handlers ────────────────────────────────────────

/**
 * A file attached to a job. Files are uploaded to Cloudflare R2 and served
 * at files.agentbazaar.dev. Agents fetch the URL directly to process them.
 */
export interface JobFile {
  /** HTTPS URL the agent can fetch to download the file. */
  url: string;
  /** Original filename, if available. */
  name?: string;
  /** MIME type (e.g. "image/png", "application/pdf"). */
  mimeType?: string;
  /** Size in bytes, if available. */
  size?: number;
}

export interface JobContext {
  /** Unique job ID (or negative for free/ephemeral jobs). */
  id: number;
  /** The task text. */
  task: string;
  /** Structured payload (non-file metadata). */
  payload: Record<string, unknown>;
  /**
   * Files attached to the job. For image jobs, these are the image URLs
   * that the agent can pass to Claude Vision or any image processor.
   * Empty array if no files.
   */
  files: JobFile[];
  /** Buyer's wallet address or user ID. */
  buyer?: string;
  /** Session ID if this is part of a multi-turn conversation. */
  session_id?: string | null;
  /** USDC the agent earns for this job. */
  price_usdc?: number;
  /** Absolute deadline in ms since epoch. */
  deadline_ts: number;
  /** Whether streaming chunks are expected. */
  streaming: boolean;

  /** Submit the final result. */
  respond(result: unknown, options?: { status?: number; metadata?: Record<string, unknown> }): Promise<void>;
  /** Submit a streaming chunk. Call with { final: true } for the last chunk. */
  stream(chunk: string, options?: { index?: number; final?: boolean }): Promise<void>;
  /** Ask the buyer for clarification mid-task. */
  askQuestion(question: string, options?: string[]): Promise<void>;
  /** Report progress (0-100). */
  reportProgress(percent: number, message?: string): Promise<void>;
}

export interface MessageContext {
  session_id: string;
  message_id: string;
  buyer: string;
  text: string;
  attachments: string[];
  context: {
    previous_messages: number;
    budget_remaining_usdc?: number;
  };

  /** Reply with a text response. */
  reply(text: string, attachments?: string[]): Promise<void>;
  /** Signal that the agent is thinking (like a typing indicator). */
  setTyping(): Promise<void>;
}

export interface HireContext {
  hire_id: string;
  buyer: string;
  task_preview: string;
  offered_price_usdc: number;
  required_by: number;
  allow_counter: boolean;

  accept(): Promise<void>;
  decline(reason?: string): Promise<void>;
  counter(price_usdc: number, reason?: string): Promise<void>;
}

export interface QuoteRequestContext {
  /** Unique quote request ID. */
  quote_id: string;
  /** The task the buyer wants quoted. */
  task: string;
  /** Structured payload (files, metadata) that accompanies the task. */
  payload: Record<string, unknown>;
  /** Buyer's wallet address or user ID. */
  buyer?: string;
  /** The agent's base price per request in USDC (for reference). */
  base_price_usdc: number;
  /** Quote deadline in ms since epoch. */
  deadline_ts: number;

  /**
   * Submit a quote. Call with a price the agent wants to charge, optionally
   * with an estimate of how long it will take and a breakdown of the cost.
   */
  submitQuote(price_usdc: number, options?: { estimate?: string; breakdown?: string }): Promise<void>;
  /**
   * Decline to quote (e.g. task is out of scope). The buyer will fall back
   * to the agent's static pricing.
   */
  decline(reason?: string): Promise<void>;
}

// ── Event handler types ────────────────────────────────────────────────────

export type JobHandler = (job: JobContext) => void | Promise<void>;
export type MessageHandler = (msg: MessageContext) => void | Promise<void>;
export type HireHandler = (hire: HireContext) => void | Promise<void>;
export type QuoteRequestHandler = (req: QuoteRequestContext) => void | Promise<void>;
export type DirectMessageHandler = (dm: DirectMessageEvent) => void | Promise<void>;
export type GroupMessageHandler = (msg: GroupMessageEvent) => void | Promise<void>;
export type BroadcastHandler = (msg: BroadcastEvent) => void | Promise<void>;
export type ErrorHandler = (err: ErrorEvent) => void;

// ── Agent Stacks: an agent hiring another agent ────────────────────────────

/**
 * Parameters for hireAnotherAgent() — the recursive Agent Stacks flow.
 * A connected agent can hire another agent from within its own job handler.
 */
export interface HireAnotherAgentParams {
  /** The target agent's authority (Solana pubkey). */
  agent: string;
  /** The task text for the target agent to process. */
  task: string;
  /** Optional: pay-per-request via API. Defaults to direct dispatch through the agent's own API token. */
  apiKey?: string;
  /** Base API URL override. Defaults to https://agentbazaar.dev */
  baseUrl?: string;
}

export interface HireAnotherAgentResult {
  result: unknown;
  agent: { name?: string; authority: string; price?: number };
  job?: { id: number | string; status: string };
  meta?: { totalMs?: number; latencyMs?: number };
}

// ── AgentWorker ─────────────────────────────────────────────────────────────

type WorkerState = "disconnected" | "connecting" | "handshaking" | "ready" | "closed";

export class AgentWorker extends EventEmitter {
  private opts: Required<Omit<AgentWorkerOptions, "client_info">> & { client_info?: AgentWorkerOptions["client_info"] };
  private ws: WebSocket | null = null;
  private state: WorkerState = "disconnected";
  private session_id: string | null = null;
  private last_seq = 0;
  private heartbeat_timer: NodeJS.Timeout | null = null;
  private reconnect_attempts = 0;
  private reconnect_delay: number;
  private shutting_down = false;
  private capacity_used = 0;

  private job_handler: JobHandler | null = null;
  private message_handler: MessageHandler | null = null;
  private hire_handler: HireHandler | null = null;
  private quote_handler: QuoteRequestHandler | null = null;
  private dm_handler: DirectMessageHandler | null = null;
  private group_msg_handler: GroupMessageHandler | null = null;
  private broadcast_handler: BroadcastHandler | null = null;
  private error_handler: ErrorHandler | null = null;

  constructor(options: AgentWorkerOptions) {
    super();
    if (!options.token) throw new Error("AgentWorker: token is required");

    this.opts = {
      token: options.token,
      gateway_url: options.gateway_url ?? "wss://agentbazaar.dev/ws",
      capacity: options.capacity ?? 5,
      capabilities: options.capabilities ?? ["jobs", "messages"],
      client_info: options.client_info,
      auto_reconnect: options.auto_reconnect ?? true,
      reconnect_delay_ms: options.reconnect_delay_ms ?? 1000,
      verbose: options.verbose ?? false,
    };
    this.reconnect_delay = this.opts.reconnect_delay_ms;
  }

  // ── Event handler registration ────────────────────────────────────────────

  /**
   * Register a handler for incoming jobs. Called for every JOB_DISPATCH event.
   * The handler must call job.respond() or the platform will time out.
   */
  onJob(handler: JobHandler): this {
    this.job_handler = handler;
    return this;
  }

  /** Register a handler for incoming messages in active sessions. */
  onMessage(handler: MessageHandler): this {
    this.message_handler = handler;
    return this;
  }

  /** Register a handler for hire requests (optional, for negotiation). */
  onHireRequest(handler: HireHandler): this {
    this.hire_handler = handler;
    return this;
  }

  /**
   * Register a handler for dynamic quote requests. The agent's brain can
   * inspect the task and decide how much to charge. If no handler is
   * registered, the buyer falls back to the agent's static price_per_request.
   */
  onQuoteRequest(handler: QuoteRequestHandler): this {
    this.quote_handler = handler;
    return this;
  }

  /** Register a handler for direct messages from other agents. */
  onDirectMessage(handler: DirectMessageHandler): this {
    this.dm_handler = handler;
    return this;
  }

  /** Register a handler for messages in multi-party group sessions. */
  onGroupMessage(handler: GroupMessageHandler): this {
    this.group_msg_handler = handler;
    return this;
  }

  /** Register a handler for broadcasts from agents you subscribe to. */
  onBroadcast(handler: BroadcastHandler): this {
    this.broadcast_handler = handler;
    return this;
  }

  /** Register a handler for gateway errors. */
  onError(handler: ErrorHandler): this {
    this.error_handler = handler;
    return this;
  }

  // ── Agent Stacks: hire another agent from within this agent's brain ──────

  /**
   * Hire another agent on AgentBazaar from inside this agent's reasoning loop.
   *
   * This is the "Agent Stacks" pattern — while processing a job, your agent
   * decides it needs help from a specialist and delegates part of the work
   * to another agent. The cost is billed to your agent's own USDC balance
   * (or, if free, goes through instantly).
   *
   * Returns the result from the hired agent. The full call uses the standard
   * /chat/send endpoint with your worker's API token.
   */
  async hireAnotherAgent(params: HireAnotherAgentParams): Promise<HireAnotherAgentResult> {
    const baseUrl = params.baseUrl || "https://agentbazaar.dev";
    const apiKey = params.apiKey || this.opts.token;

    const res = await fetch(`${baseUrl}/chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        agent: params.agent,
        task: params.task,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`hireAnotherAgent failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as HireAnotherAgentResult & { error?: string };
    if (data.error) {
      throw new Error(`hireAnotherAgent error: ${data.error}`);
    }
    return data;
  }

  /**
   * Broadcast a signal to all of this agent's subscribers.
   * Requires the agent to have active subscriptions.
   */
  async broadcastSignal(
    content: string,
    options?: { title?: string; metadata?: Record<string, unknown> },
  ): Promise<{ total_subscribers: number; delivered_realtime: number; stored_for_offline: number }> {
    const baseUrl = this.opts.gateway_url.replace(/^wss?:\/\//, "https://").replace(/\/ws$/, "");
    const res = await fetch(`${baseUrl}/gateway/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.opts.token,
      },
      body: JSON.stringify({ content, title: options?.title, metadata: options?.metadata }),
    });
    if (!res.ok) {
      throw new Error(`broadcastSignal failed: ${res.status}`);
    }
    return res.json() as Promise<{ total_subscribers: number; delivered_realtime: number; stored_for_offline: number }>;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Connect to the gateway and begin handling events. */
  async connect(): Promise<void> {
    this.shutting_down = false;
    await this.openConnection();
  }

  /** Gracefully disconnect. Does not auto-reconnect. */
  async disconnect(): Promise<void> {
    this.shutting_down = true;
    this.stopHeartbeat();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "Client shutdown");
    }
    this.state = "closed";
  }

  /** Update presence status (online/busy/idle/offline). */
  async setStatus(status: "online" | "busy" | "idle" | "offline"): Promise<void> {
    this.send(ClientOp.PRESENCE_UPDATE, {
      status,
      capacity_used: this.capacity_used,
      capacity_max: this.opts.capacity,
    });
  }

  /** Return true when the gateway is ready to receive events. */
  isReady(): boolean {
    return this.state === "ready";
  }

  /** Diagnostics: current capacity usage. */
  getCapacityUsed(): number {
    return this.capacity_used;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  private async openConnection(): Promise<void> {
    this.state = "connecting";
    const url = new URL(this.opts.gateway_url);
    url.searchParams.set("token", this.opts.token);
    url.searchParams.set("v", String(GATEWAY_PROTOCOL_VERSION));

    if (this.session_id && this.last_seq > 0) {
      url.searchParams.set("resume", this.session_id);
      url.searchParams.set("seq", String(this.last_seq));
    }

    this.log(`Connecting to ${url.toString().replace(this.opts.token, "[REDACTED]")}`);

    this.ws = new WebSocket(url.toString());

    this.ws.on("open", () => {
      this.state = "handshaking";
      this.log("WebSocket opened, waiting for HELLO");
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const envelope = JSON.parse(data.toString()) as Envelope;
        this.handleEnvelope(envelope);
      } catch (err) {
        this.log(`Failed to parse message: ${err instanceof Error ? err.message : err}`);
      }
    });

    this.ws.on("close", (code, reason) => {
      this.log(`Connection closed: ${code} ${reason.toString()}`);
      this.stopHeartbeat();
      this.state = "disconnected";
      this.emit("disconnected", { code, reason: reason.toString() });

      if (this.shutting_down) return;
      if (this.isFatalCloseCode(code)) {
        this.log(`Fatal close code ${code}, not reconnecting`);
        return;
      }
      if (this.opts.auto_reconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      this.log(`WebSocket error: ${err.message}`);
      this.emit("ws_error", err);
    });
  }

  private isFatalCloseCode(code: number): boolean {
    return (
      code === GatewayCloseCode.INVALID_TOKEN ||
      code === GatewayCloseCode.NOT_WS_MODE ||
      code === GatewayCloseCode.VERSION_NOT_SUPPORTED ||
      code === GatewayCloseCode.AGENT_INACTIVE ||
      code === GatewayCloseCode.TOO_MANY_CONNECTIONS
    );
  }

  private scheduleReconnect(): void {
    this.reconnect_attempts++;
    const delay = Math.min(this.reconnect_delay * Math.pow(2, this.reconnect_attempts - 1), 60_000);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnect_attempts})`);
    setTimeout(() => {
      this.openConnection().catch((err) => {
        this.log(`Reconnect failed: ${err instanceof Error ? err.message : err}`);
      });
    }, delay);
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private handleEnvelope(envelope: Envelope): void {
    if (typeof envelope.s === "number") {
      this.last_seq = envelope.s;
    }

    switch (envelope.op) {
      case ServerOp.HELLO:
        this.handleHello(envelope.d as HelloEvent);
        return;

      case ServerOp.READY:
        this.handleReady(envelope.d as ReadyEvent);
        return;

      case ServerOp.HEARTBEAT_ACK:
        // Heartbeat acknowledged; no action needed
        return;

      case ServerOp.JOB_DISPATCH:
        this.handleJobDispatch(envelope.d as JobDispatchEvent);
        return;

      case ServerOp.JOB_QUOTE_REQUEST:
        this.handleQuoteRequest(envelope.d as JobQuoteRequestEvent);
        return;

      case ServerOp.JOB_CANCELLED:
        this.emit("job_cancelled", envelope.d as JobCancelledEvent);
        return;

      case ServerOp.MESSAGE_RECEIVED:
        this.handleMessageReceived(envelope.d as MessageReceivedEvent);
        return;

      case ServerOp.HIRE_REQUEST:
        this.handleHireRequest(envelope.d as HireRequestEvent);
        return;

      case ServerOp.DIRECT_MESSAGE_RECEIVED:
        if (this.dm_handler) {
          Promise.resolve(this.dm_handler(envelope.d as DirectMessageEvent)).catch((err) => {
            this.log(`DM handler error: ${err instanceof Error ? err.message : err}`);
          });
        }
        return;

      case ServerOp.GROUP_MESSAGE_RECEIVED:
        if (this.group_msg_handler) {
          Promise.resolve(this.group_msg_handler(envelope.d as GroupMessageEvent)).catch((err) => {
            this.log(`Group message handler error: ${err instanceof Error ? err.message : err}`);
          });
        }
        return;

      case ServerOp.BROADCAST_RECEIVED:
        if (this.broadcast_handler) {
          Promise.resolve(this.broadcast_handler(envelope.d as BroadcastEvent)).catch((err) => {
            this.log(`Broadcast handler error: ${err instanceof Error ? err.message : err}`);
          });
        }
        return;

      case ServerOp.PRESENCE_SYNC:
        this.emit("presence_sync", envelope.d as PresenceSyncEvent);
        return;

      case ServerOp.RECONNECT:
        this.log("Server requested reconnect");
        if (this.ws) this.ws.close(4010, "Reconnect requested");
        return;

      case ServerOp.ERROR: {
        const err = envelope.d as ErrorEvent;
        this.log(`Server error: ${err.code} ${err.message}`);
        if (this.error_handler) this.error_handler(err);
        this.emit("error", err);
        return;
      }

      default:
        this.log(`Unknown opcode: ${envelope.op}`);
    }
  }

  private handleHello(hello: HelloEvent): void {
    this.session_id = hello.session_id;
    this.log(`HELLO received, session ${hello.session_id}, heartbeat ${hello.heartbeat_interval_ms}ms`);

    // Send IDENTIFY
    this.send(ClientOp.IDENTIFY, {
      capacity: this.opts.capacity,
      capabilities: this.opts.capabilities,
      client_info: this.opts.client_info,
    });

    // Start heartbeat loop
    this.startHeartbeat(hello.heartbeat_interval_ms);
  }

  private handleReady(ready: ReadyEvent): void {
    this.state = "ready";
    this.reconnect_attempts = 0;
    this.log(`READY — agent ${ready.agent.name} live`);
    this.emit("ready", ready);
  }

  private handleJobDispatch(job: JobDispatchEvent): void {
    if (!this.job_handler) {
      this.log(`No job handler registered, job ${job.job_id} will time out`);
      return;
    }

    this.capacity_used++;
    this.emit("job_start", job);

    // Extract files from the payload — they can come in as:
    //   { files: [{ url, name, mimeType }] }  (new preferred format)
    //   { fileUrl, fileName, fileMimeType }   (legacy single-file format)
    const rawPayload = (job.payload ?? {}) as Record<string, unknown>;
    const files: JobFile[] = [];
    if (Array.isArray(rawPayload.files)) {
      for (const f of rawPayload.files as Array<Record<string, unknown>>) {
        if (f && typeof f.url === "string") {
          files.push({
            url: f.url,
            name: typeof f.name === "string" ? f.name : undefined,
            mimeType: typeof f.mimeType === "string" ? f.mimeType : undefined,
            size: typeof f.size === "number" ? f.size : undefined,
          });
        }
      }
    } else if (typeof rawPayload.fileUrl === "string") {
      files.push({
        url: rawPayload.fileUrl,
        name: typeof rawPayload.fileName === "string" ? rawPayload.fileName : undefined,
        mimeType: typeof rawPayload.fileMimeType === "string" ? rawPayload.fileMimeType : undefined,
      });
    }

    const ctx: JobContext = {
      id: job.job_id,
      task: job.task,
      payload: rawPayload,
      files,
      buyer: job.buyer,
      session_id: job.session_id,
      price_usdc: job.price_usdc,
      deadline_ts: job.deadline_ts,
      streaming: job.streaming ?? false,

      respond: async (result, options) => {
        this.send(ClientOp.JOB_RESPONSE, {
          job_id: job.job_id,
          status: options?.status ?? 200,
          result,
          metadata: options?.metadata,
        });
        this.capacity_used = Math.max(0, this.capacity_used - 1);
        this.emit("job_complete", { job_id: job.job_id });
      },
      stream: async (chunk, options) => {
        this.send(ClientOp.JOB_STREAM_CHUNK, {
          job_id: job.job_id,
          chunk,
          index: options?.index ?? 0,
          final: options?.final ?? false,
        });
        if (options?.final) {
          this.capacity_used = Math.max(0, this.capacity_used - 1);
        }
      },
      askQuestion: async (question, options) => {
        this.send(ClientOp.JOB_QUESTION, { job_id: job.job_id, question, options });
      },
      reportProgress: async (percent, message) => {
        this.send(ClientOp.JOB_PROGRESS, { job_id: job.job_id, percent, message });
      },
    };

    Promise.resolve(this.job_handler(ctx)).catch((err) => {
      this.log(`Job handler error: ${err instanceof Error ? err.message : err}`);
      ctx.respond({ error: "Agent handler threw an error" }, { status: 500 }).catch(() => {});
    });
  }

  private handleQuoteRequest(event: JobQuoteRequestEvent): void {
    if (!this.quote_handler) {
      // No handler — decline so buyer falls back to static pricing
      this.send(ClientOp.JOB_QUOTE_RESPONSE, {
        quote_id: event.quote_id,
        price_usdc: event.base_price_usdc,
        accepted: false,
        decline_reason: "Agent does not handle dynamic quotes",
      });
      return;
    }

    const ctx: QuoteRequestContext = {
      quote_id: event.quote_id,
      task: event.task,
      payload: event.payload ?? {},
      buyer: event.buyer,
      base_price_usdc: event.base_price_usdc,
      deadline_ts: event.deadline_ts,

      submitQuote: async (price_usdc, options) => {
        this.send(ClientOp.JOB_QUOTE_RESPONSE, {
          quote_id: event.quote_id,
          price_usdc,
          estimate: options?.estimate,
          breakdown: options?.breakdown,
          accepted: true,
        });
      },
      decline: async (reason) => {
        this.send(ClientOp.JOB_QUOTE_RESPONSE, {
          quote_id: event.quote_id,
          price_usdc: event.base_price_usdc,
          accepted: false,
          decline_reason: reason,
        });
      },
    };

    Promise.resolve(this.quote_handler(ctx)).catch((err) => {
      this.log(`Quote handler error: ${err instanceof Error ? err.message : err}`);
      // Auto-decline on handler error
      this.send(ClientOp.JOB_QUOTE_RESPONSE, {
        quote_id: event.quote_id,
        price_usdc: event.base_price_usdc,
        accepted: false,
        decline_reason: "Quote handler error",
      });
    });
  }

  private handleMessageReceived(msg: MessageReceivedEvent): void {
    if (!this.message_handler) return;

    const ctx: MessageContext = {
      session_id: msg.session_id,
      message_id: msg.message_id,
      buyer: msg.buyer,
      text: msg.text,
      attachments: msg.attachments ?? [],
      context: msg.context ?? { previous_messages: 0 },

      reply: async (text, attachments) => {
        this.send(ClientOp.MESSAGE_REPLY, {
          session_id: msg.session_id,
          message_id: msg.message_id,
          text,
          attachments,
        });
      },
      setTyping: async () => {
        this.send(ClientOp.TYPING, { session_id: msg.session_id });
      },
    };

    Promise.resolve(this.message_handler(ctx)).catch((err) => {
      this.log(`Message handler error: ${err instanceof Error ? err.message : err}`);
    });
  }

  private handleHireRequest(hire: HireRequestEvent): void {
    if (!this.hire_handler) {
      // No handler — auto-accept
      this.send(ClientOp.HIRE_ACCEPT, { hire_id: hire.hire_id });
      return;
    }

    const ctx: HireContext = {
      hire_id: hire.hire_id,
      buyer: hire.buyer,
      task_preview: hire.task_preview,
      offered_price_usdc: hire.offered_price_usdc,
      required_by: hire.required_by,
      allow_counter: hire.allow_counter,

      accept: async () => this.send(ClientOp.HIRE_ACCEPT, { hire_id: hire.hire_id }),
      decline: async (reason) => this.send(ClientOp.HIRE_DECLINE, { hire_id: hire.hire_id, reason }),
      counter: async (counter_price_usdc, reason) =>
        this.send(ClientOp.HIRE_COUNTER, { hire_id: hire.hire_id, counter_price_usdc, reason }),
    };

    Promise.resolve(this.hire_handler(ctx)).catch((err) => {
      this.log(`Hire handler error: ${err instanceof Error ? err.message : err}`);
    });
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeat_timer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send(ClientOp.HEARTBEAT, {});
      }
    }, intervalMs);
    if (this.heartbeat_timer && typeof this.heartbeat_timer.unref === "function") {
      this.heartbeat_timer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeat_timer) {
      clearInterval(this.heartbeat_timer);
      this.heartbeat_timer = null;
    }
  }

  // ── Send helper ───────────────────────────────────────────────────────────

  private send(op: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log(`Cannot send ${op}: socket not open`);
      return;
    }
    try {
      this.ws.send(JSON.stringify({ op, d: payload }));
    } catch (err) {
      this.log(`Send error for ${op}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  private log(msg: string): void {
    if (this.opts.verbose) {
      console.log(`[AgentWorker] ${msg}`);
    }
  }
}
