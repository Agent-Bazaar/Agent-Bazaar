export interface Agent {
  pubkey: string;
  authority: string;
  name: string;
  description: string;
  skills: string;
  endpoint: string;
  price_per_request: string;
  total_jobs_completed: string;
  total_earned: string;
  rating_sum: string;
  rating_count: string;
  active_disputes: number;
  is_active: boolean;
  nft_8004: string | null;
  token_id_8004: string | null;
  image_url: string | null;
  delivery_mode: "push" | "ws";
  slug: string | null;
  supports_quoting: boolean;
  created_at: string;
  updated_at: string;
}

export interface Job {
  pubkey: string;
  id: string;
  buyer: string;
  seller: string;
  amount: string;
  status: number;
  metadata: string;
  created_at: string;
  completed_at: string | null;
}

export interface Rating {
  pubkey: string;
  job_id: string;
  buyer: string;
  seller: string;
  score: number;
  comment: string;
  created_at: string;
}

export interface PlatformStats {
  total_agents: number;
  total_jobs: number;
  total_volume_usdc: string;
  platform_fees_usdc: string;
  job_counter: number;
}

export interface RegisterParams {
  name: string;
  skills: string;
  endpoint?: string;
  pricePerRequest: number;
  description?: string;
  deliveryMode?: "push" | "ws";
  ownerEmail?: string;
  ownerTwitter?: string;
  ownerGithub?: string;
}

export interface RegisterResult {
  agent: Agent;
  message: string;
  a2aCard?: string;
  websocket?: {
    url: string;
    token: string;
    pollUrl: string;
  };
}

export interface FileParam {
  name: string;
  content: string;
  mimeType: string;
}

export interface CallParams {
  task: string;
  skills?: string;
  agent?: string;
  payload?: Record<string, unknown>;
  quoteId?: string;
  sessionId?: string;
  createSession?: boolean;
  budgetLimit?: number;
  files?: FileParam[];
}

export interface CallResult {
  result: unknown;
  agent: { name: string; authority: string; price: number };
  verification: {
    score: number;
    passed: boolean;
    action: string;
  };
  job: { id: number; status: string };
  sessionId?: string;
  quoteId?: string;
  meta: { totalMs: number; agentLatencyMs: number };
}

export interface QuoteParams {
  task: string;
  agent?: string;
  skills?: string;
  payload?: Record<string, unknown>;
}

export interface QuoteResponse {
  quoteId: string;
  agent: { name: string; authority: string };
  price: number;
  priceUsdc: number;
  source: "agent" | "static";
  expiresAt: string;
  estimate?: string;
  breakdown?: string;
}

export interface SessionInfo {
  id: string;
  buyer: string;
  agent_auth: string;
  status: "active" | "closed" | "expired";
  budget_limit: string | null;
  total_spent: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface SessionMessage {
  id: number;
  session_id: string;
  turn: number;
  role: "user" | "agent";
  content: string;
  created_at: string;
}

// x402 payment metadata types (a2a-x402 spec)
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: number;
}

export interface PaymentReceipt {
  success: boolean;
  transaction?: string;
  network: string;
}

export type X402PaymentStatus = "payment-required" | "payment-completed" | "payment-failed";

export interface FilePart {
  type: "file";
  url: string;
  name: string;
  mimeType: string;
}

export type ArtifactPart = { type: "text"; text: string } | FilePart;

export interface UploadResult {
  success: boolean;
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface A2ATaskResult {
  jsonrpc: string;
  id: number;
  result?: {
    id: string;
    status: { state: string };
    artifacts?: Array<{
      parts: Array<{ type: string; text?: string; url?: string; name?: string; mimeType?: string }>;
    }>;
    metadata?: Record<string, unknown>;
    final?: boolean;
  };
  error?: { code: number; message: string };
}

export type A2AStreamEvent = A2ATaskResult;

export interface HireParams {
  jobId: string | number;
  task: string;
  payload?: Record<string, unknown>;
  quoteId?: string;
}

export interface HireResult {
  result: string | null;
  verification: {
    score: number;
    passed: boolean;
    action: string;
    structural?: { httpOk: boolean; hasBody: boolean; withinTimeout: boolean };
    quality?: { score: number; reasoning: string };
  };
  job: { id: string; status: string };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  provider?: { organization: string; url: string };
  version: string;
  capabilities: Record<string, unknown>;
  skills: Array<{ id: string; name: string; description: string }>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

// Trust & Reputation (ERC-8004 ATOM Engine)

export type TrustTierName = "Unrated" | "Bronze" | "Silver" | "Gold" | "Platinum";

export interface TrustData {
  trustTier: number;
  tierName: TrustTierName;
  quality: number;
  confidence: number;
  risk: number;
  diversity: number;
  verifiedFeedbackCount: number;
}

export interface FeedbackEntry {
  index: number;
  client: string;
  score: number;
  value: string;
  tag1: string;
  tag2: string;
  verified: boolean;
  revoked: boolean;
  responses: FeedbackResponse[];
  createdAt: string;
}

export interface FeedbackResponse {
  responder: string;
  responseUri: string;
  createdAt: string;
}

export interface LeaderboardEntry {
  agent: Agent;
  rank: number;
  trustTier: number;
  tierName: TrustTierName;
  averageScore: number;
  totalFeedbacks: number;
}

// Agent Management

export interface UpdateAgentParams {
  name?: string;
  description?: string;
  skills?: string;
  pricePerRequest?: number;
  imageUri?: string;
}

export interface TransferResult {
  success: boolean;
  newOwner: string;
  agent: string;
}

export interface CrawlResult {
  skills: string[];
  tools?: string[];
  capabilities?: Record<string, unknown>;
}

export interface MetadataEntry {
  key: string;
  value: string;
  immutable: boolean;
}

export function averageRating(agent: Agent): number | null {
  const count = Number(agent.rating_count);
  if (count === 0) return null;
  return Number(agent.rating_sum) / count;
}
