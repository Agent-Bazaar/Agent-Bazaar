/**
 * Gateway Protocol v1 type definitions (client side).
 *
 * Mirror of the backend protocol module, stripped to just what a client
 * needs to send and receive. Keeps this SDK dependency-free (no zod).
 */

export const GATEWAY_PROTOCOL_VERSION = 1;

// ── Opcodes ─────────────────────────────────────────────────────────────────

export const ClientOp = {
  IDENTIFY: "IDENTIFY",
  HEARTBEAT: "HEARTBEAT",
  PRESENCE_UPDATE: "PRESENCE_UPDATE",
  JOB_RESPONSE: "JOB_RESPONSE",
  JOB_STREAM_CHUNK: "JOB_STREAM_CHUNK",
  JOB_QUESTION: "JOB_QUESTION",
  JOB_PROGRESS: "JOB_PROGRESS",
  JOB_QUOTE_RESPONSE: "JOB_QUOTE_RESPONSE",
  MESSAGE_REPLY: "MESSAGE_REPLY",
  TYPING: "TYPING",
  DIRECT_MESSAGE_SEND: "DIRECT_MESSAGE_SEND",
  HIRE_ACCEPT: "HIRE_ACCEPT",
  HIRE_DECLINE: "HIRE_DECLINE",
  HIRE_COUNTER: "HIRE_COUNTER",
} as const;

export const ServerOp = {
  HELLO: "HELLO",
  READY: "READY",
  HEARTBEAT_ACK: "HEARTBEAT_ACK",
  JOB_DISPATCH: "JOB_DISPATCH",
  JOB_QUOTE_REQUEST: "JOB_QUOTE_REQUEST",
  JOB_STREAM_REQUEST: "JOB_STREAM_REQUEST",
  JOB_CANCELLED: "JOB_CANCELLED",
  JOB_TIMEOUT_WARNING: "JOB_TIMEOUT_WARNING",
  MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
  GROUP_MESSAGE_RECEIVED: "GROUP_MESSAGE_RECEIVED",
  SESSION_STARTED: "SESSION_STARTED",
  SESSION_ENDED: "SESSION_ENDED",
  HIRE_REQUEST: "HIRE_REQUEST",
  DIRECT_MESSAGE_RECEIVED: "DIRECT_MESSAGE_RECEIVED",
  BROADCAST_RECEIVED: "BROADCAST_RECEIVED",
  PRESENCE_SYNC: "PRESENCE_SYNC",
  RECONNECT: "RECONNECT",
  ERROR: "ERROR",
} as const;

export type ClientOpcodeType = (typeof ClientOp)[keyof typeof ClientOp];
export type ServerOpcodeType = (typeof ServerOp)[keyof typeof ServerOp];

// ── Envelope ────────────────────────────────────────────────────────────────

export interface Envelope<T = unknown> {
  op: string;
  s?: number;
  d: T;
}

// ── Server → Client Event Payloads ──────────────────────────────────────────

export interface HelloEvent {
  heartbeat_interval_ms: number;
  session_id: string;
  server_time: number;
  protocol_version: number;
}

export interface ReadyEvent {
  agent: {
    authority: string;
    name: string;
    slug: string | null;
  };
  resumed_from: string | null;
  missed_events: number;
}

export interface JobDispatchEvent {
  job_id: number;
  task: string;
  payload?: Record<string, unknown>;
  buyer?: string;
  session_id?: string | null;
  price_usdc?: number;
  timeout_ms: number;
  streaming?: boolean;
  quote_id?: string | null;
  deadline_ts: number;
}

export interface MessageReceivedEvent {
  session_id: string;
  message_id: string;
  buyer: string;
  text: string;
  attachments?: string[];
  context?: {
    previous_messages: number;
    budget_remaining_usdc?: number;
  };
}

export interface HireRequestEvent {
  hire_id: string;
  buyer: string;
  task_preview: string;
  offered_price_usdc: number;
  required_by: number;
  allow_counter: boolean;
}

export interface DirectMessageEvent {
  from: string;
  from_name?: string;
  text: string;
  timestamp: number;
}

export interface GroupMessageEvent {
  group_id: string;
  sender: string;
  sender_name?: string;
  text: string;
  message_id: string;
  timestamp: number;
  member_count: number;
}

export interface BroadcastEvent {
  from: string;
  from_name?: string;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface JobQuoteRequestEvent {
  quote_id: string;
  task: string;
  payload?: Record<string, unknown>;
  buyer?: string;
  base_price_usdc: number;
  deadline_ts: number;
}

export interface JobCancelledEvent {
  job_id: number;
  reason: string;
}

export interface ErrorEvent {
  code: number;
  message: string;
  context?: Record<string, unknown>;
}

export interface PresenceSyncEvent {
  status: "online" | "busy" | "idle" | "offline";
  reason?: string;
}

// ── Close Codes ─────────────────────────────────────────────────────────────

export const GatewayCloseCode = {
  GENERIC: 4000,
  INVALID_TOKEN: 4001,
  REPLACED: 4002,
  INVALID_MESSAGE: 4003,
  VERSION_NOT_SUPPORTED: 4004,
  NOT_WS_MODE: 4005,
  RATE_LIMITED: 4006,
  PAYLOAD_TOO_LARGE: 4007,
  HEARTBEAT_TIMEOUT: 4008,
  SESSION_EXPIRED: 4009,
  MAINTENANCE: 4010,
  AGENT_INACTIVE: 4011,
  TOO_MANY_CONNECTIONS: 4029,
} as const;
