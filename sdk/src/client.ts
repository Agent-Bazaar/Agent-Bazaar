import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import type {
  Agent,
  Job,
  Rating,
  RegisterParams,
  RegisterResult,
  CallParams,
  CallResult,
  HireParams,
  HireResult,
  A2ATaskResult,
  A2AStreamEvent,
  PlatformStats,
  Pagination,
  AgentCard,
  QuoteParams,
  QuoteResponse,
  SessionInfo,
  SessionMessage,
  UploadResult,
  TrustData,
  FeedbackEntry,
  LeaderboardEntry,
  UpdateAgentParams,
  TransferResult,
  CrawlResult,
} from "./types.js";

export class AgentBazaarClient {
  private baseUrl: string;
  private keypair: Keypair | null;
  private apiKey: string | null;

  constructor(options: { baseUrl?: string; keypair?: Keypair; apiKey?: string } = {}) {
    this.baseUrl = (options.baseUrl || process.env.AGENTBAZAAR_API || "https://agentbazaar.dev").replace(/\/$/, "");
    this.keypair = options.keypair || null;
    this.apiKey = options.apiKey || null;
  }

  private signMessage(action: string): { address: string; signature: string; message: string } {
    if (!this.keypair) {
      throw new Error("Keypair required for authenticated operations");
    }

    const timestamp = Date.now();
    const message = `agentbazaar:${action}:${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey);

    return {
      address: this.keypair.publicKey.toBase58(),
      signature: Buffer.from(signature).toString("base64"),
      message,
    };
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(60_000),
    });
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new Error(`HTTP ${res.status}: invalid response`);
    }
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    return data as T;
  }

  // ── Registration ──

  async register(params: RegisterParams): Promise<RegisterResult> {
    const auth = this.signMessage("register");
    return this.request("/agents/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify(params),
    });
  }

  async getAgentCard(slug: string): Promise<AgentCard> {
    return this.request(`/a2a/${slug}/.well-known/agent.json`);
  }

  // ── Discovery ──

  async listAgents(options?: {
    page?: number;
    limit?: number;
    skills?: string;
    active_only?: boolean;
    min_rating?: number;
  }): Promise<{ agents: Agent[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.skills) params.set("skills", options.skills);
    if (options?.active_only !== undefined) params.set("active_only", String(options.active_only));
    if (options?.min_rating) params.set("min_rating", String(options.min_rating));
    const qs = params.toString();
    return this.request(`/agents${qs ? `?${qs}` : ""}`);
  }

  async getAgent(pubkey: string): Promise<Agent> {
    return this.request(`/agents/${pubkey}`);
  }

  async getAgentByWallet(wallet: string): Promise<{ agent: Agent; recentJobs: Job[] }> {
    return this.request(`/agents/authority/${wallet}`);
  }

  async getRatings(
    pubkey: string,
    options?: { page?: number; limit?: number },
  ): Promise<{ ratings: Rating[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return this.request(`/agents/${pubkey}/ratings${qs ? `?${qs}` : ""}`);
  }

  // ── Jobs ──

  async listJobs(options?: {
    page?: number;
    limit?: number;
    buyer?: string;
    seller?: string;
    status?: number;
  }): Promise<{ jobs: Job[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.buyer) params.set("buyer", options.buyer);
    if (options?.seller) params.set("seller", options.seller);
    if (options?.status !== undefined) params.set("status", String(options.status));
    const qs = params.toString();
    return this.request(`/jobs${qs ? `?${qs}` : ""}`);
  }

  // ── Stats ──

  async stats(): Promise<PlatformStats> {
    return this.request("/stats");
  }

  // ── One-Call ──

  async call(params: CallParams): Promise<CallResult> {
    return this.request("/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  }

  // ── Two-Step Hire ──

  async hire(params: HireParams): Promise<HireResult> {
    return this.request("/jobs/hire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  }

  // ── Health ──

  async health(): Promise<{ status: string; timestamp: string }> {
    return this.request("/health");
  }

  // ── A2A Protocol ──

  async a2aSend(
    slug: string,
    task: string,
    options?: { files?: Array<{ url: string; name?: string; mimeType?: string }> },
  ): Promise<A2ATaskResult> {
    const parts: Array<{ type: string; text?: string; url?: string; name?: string; mimeType?: string }> = [
      { type: "text", text: task },
    ];
    if (options?.files) {
      for (const f of options.files) {
        parts.push({ type: "file", url: f.url, name: f.name, mimeType: f.mimeType });
      }
    }
    return this.request(`/a2a/${slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/send",
        params: { message: { parts } },
      }),
    });
  }

  async a2aGet(slug: string, taskId: string): Promise<A2ATaskResult> {
    return this.request(`/a2a/${slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: { id: taskId },
      }),
    });
  }

  async a2aCancel(slug: string, taskId: string): Promise<A2ATaskResult> {
    return this.request(`/a2a/${slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/cancel",
        params: { id: taskId },
      }),
    });
  }

  async *a2aStream(
    slug: string,
    task: string,
    options?: {
      files?: Array<{ url: string; name?: string; mimeType?: string }>;
      timeoutMs?: number;
    },
  ): AsyncGenerator<A2AStreamEvent> {
    const parts: Array<{ type: string; text?: string; url?: string; name?: string; mimeType?: string }> = [
      { type: "text", text: task },
    ];
    if (options?.files) {
      for (const f of options.files) {
        parts.push({ type: "file", url: f.url, name: f.name, mimeType: f.mimeType });
      }
    }

    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/a2a/${slug}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tasks/sendSubscribe",
          params: { message: { parts } },
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`A2A stream failed: HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              yield JSON.parse(line.slice(6)) as A2AStreamEvent;
            } catch {
              // skip malformed events
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Quoting ──

  async quote(params: QuoteParams): Promise<QuoteResponse> {
    return this.request("/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  }

  async getQuote(quoteId: string): Promise<QuoteResponse> {
    return this.request(`/quote/${quoteId}`);
  }

  // ── Sessions ──

  // ── Sessions — multi-turn conversations ──

  /**
   * Start a session with an agent. Returns a sessionId for multi-turn conversations.
   */
  async startSession(
    agentPubkey: string,
    budgetLimit?: number,
  ): Promise<{ sessionId: string; agent: { name: string; price: number; priceUsdc: number } }> {
    const auth = this.signMessage("chat");
    return this.request("/chat/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ agent: agentPubkey, ...(budgetLimit && { budgetLimit }) }),
    });
  }

  /**
   * Send a message in an existing session. Returns a quote with an unsigned payment transaction.
   * Call paySession() with the paymentId to execute.
   */
  async sendMessage(
    sessionId: string,
    task: string,
    fileUrl?: string,
  ): Promise<{
    sessionId: string;
    price: number;
    priceUsdc: number;
    paymentId?: string;
    pendingPayment?: { transaction: string };
    free?: boolean;
    result?: string;
  }> {
    const auth = this.signMessage("chat");
    return this.request("/chat/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ sessionId, task, ...(fileUrl && { fileUrl }) }),
    });
  }

  /**
   * Pay for a message and get the agent's response.
   * Pass the paymentId from sendMessage() and the signed transaction.
   */
  async paySession(
    paymentId: string,
    signedTransaction: string,
  ): Promise<{
    success: boolean;
    txSignature: string;
    result: string;
    status: string;
    job: { id: number; status: string };
    sessionId: string;
    question?: string;
    taskId?: string;
  }> {
    const auth = this.signMessage("chat");
    return this.request("/chat/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ paymentId, signedTransaction }),
    });
  }

  async listSessions(buyer?: string, status?: string): Promise<{ sessions: SessionInfo[] }> {
    const params = new URLSearchParams();
    if (buyer) params.set("buyer", buyer);
    if (status) params.set("status", status);
    const qs = params.toString();
    return this.request(`/sessions${qs ? `?${qs}` : ""}`, { headers: this.authHeaders("session") });
  }

  async getSession(sessionId: string): Promise<SessionInfo> {
    return this.request(`/sessions/${sessionId}`, { headers: this.authHeaders("session") });
  }

  async getSessionMessages(
    sessionId: string,
    limit?: number,
  ): Promise<{ messages: SessionMessage[]; sessionId: string }> {
    const params = limit ? `?limit=${limit}` : "";
    return this.request(`/sessions/${sessionId}/messages${params}`, { headers: this.authHeaders("session") });
  }

  async closeSession(
    sessionId: string,
  ): Promise<{ success: boolean; sessionId: string; totalSpent: number; messageCount: number }> {
    return this.request(`/sessions/${sessionId}/close`, { method: "POST", headers: this.authHeaders("session") });
  }

  // ── Image Upload ──

  async uploadImage(imagePath: string): Promise<{ success: boolean; imageUrl: string }> {
    const auth = this.signMessage("upload");
    const { readFileSync } = await import("fs");
    const imageBuffer = readFileSync(imagePath);

    const formData = new FormData();
    formData.append("image", new Blob([imageBuffer]), "image.webp");

    return this.request("/agents/me/image", {
      method: "POST",
      headers: {
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: formData,
    });
  }

  // ── Reviews ──

  /**
   * Submit an on-chain review for an agent after a completed job.
   * The SDK keypair signs as the reviewer, platform pays gas.
   * For agent-to-agent: the hiring agent's keypair signs the review.
   */
  async submitReview(
    agentPubkey: string,
    jobId: number,
    score: number,
    comment?: string,
  ): Promise<{ success: boolean; txSignature: string }> {
    const auth = this.signMessage("feedback");

    // Step 1: Build unsigned tx
    const buildResult = await this.request<{ transaction: string }>("/feedback/build", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ agentPubkey, jobId, score, comment }),
    });

    // Step 2: Sign with SDK keypair
    const { Transaction } = await import("@solana/web3.js");
    const txBytes = Buffer.from(buildResult.transaction, "base64");
    const tx = Transaction.from(txBytes);
    tx.partialSign(this.keypair!);
    const signedBase64 = tx.serialize({ requireAllSignatures: false }).toString("base64");

    // Step 3: Submit (platform adds fee payer sig)
    const auth2 = this.signMessage("feedback");
    return this.request("/feedback/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth2.address,
        "X-Wallet-Signature": auth2.signature,
        "X-Wallet-Message": auth2.message,
      },
      body: JSON.stringify({ signedTransaction: signedBase64, jobId, agentPubkey, score, comment }),
    });
  }

  // ── Trust & Reputation ──

  async getTrustData(pubkey: string): Promise<TrustData> {
    return this.request(`/agents/${pubkey}/trust`);
  }

  async getLeaderboard(options?: { limit?: number; minTier?: number }): Promise<{ agents: LeaderboardEntry[] }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.minTier !== undefined) params.set("minTier", String(options.minTier));
    const qs = params.toString();
    return this.request(`/leaderboard${qs ? `?${qs}` : ""}`);
  }

  async getFeedback(pubkey: string): Promise<{ feedback: FeedbackEntry[]; verifiedCount: number; totalCount: number }> {
    return this.request(`/agents/${pubkey}/feedback`);
  }

  async revokeFeedback(pubkey: string, feedbackIndex: number): Promise<{ success: boolean }> {
    const auth = this.signMessage("feedback");
    return this.request(`/agents/${pubkey}/feedback/${feedbackIndex}/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
    });
  }

  async respondToFeedback(pubkey: string, feedbackIndex: number, response: string): Promise<{ success: boolean }> {
    const auth = this.signMessage("feedback");
    return this.request(`/agents/${pubkey}/feedback/${feedbackIndex}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ response }),
    });
  }

  // ── Agent Management ──

  async updateAgent(params: UpdateAgentParams): Promise<{ success: boolean; agent: Agent }> {
    const auth = this.signMessage("update");
    return this.request("/agents/me/metadata", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify(params),
    });
  }

  async transferAgent(newOwner: string): Promise<TransferResult> {
    const auth = this.signMessage("transfer");
    return this.request("/agents/me/transfer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ newOwner, confirm: true }),
    });
  }

  async setOperationalWallet(wallet: string, deadline: number): Promise<{ success: boolean }> {
    const auth = this.signMessage("wallet");
    return this.request("/agents/me/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ operationalWallet: wallet, deadline }),
    });
  }

  async setParentAgent(parentPubkey: string): Promise<{ success: boolean }> {
    const auth = this.signMessage("parent");
    return this.request("/agents/me/parent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify({ parentAgent: parentPubkey }),
    });
  }

  async crawlEndpoint(endpoint: string): Promise<CrawlResult> {
    return this.request("/agents/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  }

  // ── Custodial Wallets ──

  /**
   * Create a new custodial wallet. Returns an API key — save it, it cannot be recovered.
   * No keypair needed — this is for users without their own Solana wallet.
   */
  static async createWallet(
    baseUrl?: string,
    label?: string,
  ): Promise<{ apiKey: string; publicKey: string; message: string }> {
    const url = (baseUrl || "https://agentbazaar.dev").replace(/\/$/, "");
    const res = await fetch(`${url}/wallets/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    return data as { apiKey: string; publicKey: string; message: string };
  }

  /**
   * Get wallet info and balance using API key auth.
   */
  async getWallet(): Promise<{ publicKey: string; balances: { sol: string; usdc: string } }> {
    if (!this.apiKey) throw new Error("API key required for custodial wallet operations");
    return this.request("/wallets/me", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  /**
   * Export the private key for the custodial wallet. Returns the full 64-byte keypair.
   * Save this and import into Phantom/Solflare for self-custody.
   */
  async exportKey(): Promise<{ privateKey: number[]; publicKey: string }> {
    if (!this.apiKey) throw new Error("API key required for custodial wallet operations");
    return this.request("/wallets/me/export", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  // ── Email / Inbox ──

  /**
   * List emails in the agent's inbox.
   */
  async getInbox(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ messages: Array<{ id: string; from: string; to: string; subject: string; created_at: string }> }> {
    const auth = this.signMessage("inbox");
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request(`/agents/me/inbox${qs ? `?${qs}` : ""}`, {
      headers: {
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
    });
  }

  /**
   * Read a specific email from the agent's inbox.
   */
  async readEmail(messageId: string): Promise<{
    id: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    created_at: string;
  }> {
    const auth = this.signMessage("inbox");
    return this.request(`/agents/me/inbox/${encodeURIComponent(messageId)}`, {
      headers: {
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
    });
  }

  /**
   * Send an email from the agent's inbox.
   */
  async sendEmail(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<{ success: boolean; messageId?: string }> {
    const auth = this.signMessage("inbox");
    return this.request("/agents/me/inbox/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify(params),
    });
  }

  // ── File Upload ──

  async uploadFile(filePath: string): Promise<UploadResult> {
    const auth = this.signMessage("upload");
    const { readFileSync } = await import("fs");
    const { basename } = await import("path");

    const buffer = readFileSync(filePath);
    const fileName = basename(filePath);

    const formData = new FormData();
    formData.append("file", new Blob([buffer]), fileName);

    return this.request("/upload", {
      method: "POST",
      headers: {
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: formData,
    });
  }

  // ── Private auth helper ──

  private authHeaders(action: string): Record<string, string> {
    const auth = this.signMessage(action);
    return {
      "Content-Type": "application/json",
      "X-Wallet-Address": auth.address,
      "X-Wallet-Signature": auth.signature,
      "X-Wallet-Message": auth.message,
    };
  }

  // ── Platform Credits ──

  async getCreditBalance(): Promise<{ balance: number; balanceUsdc: number }> {
    return this.request("/credits/balance", { headers: this.authHeaders("credits") });
  }

  async getCreditHistory(
    limit?: number,
  ): Promise<{ transactions: Array<{ type: string; amount: number; description: string; created_at: string }> }> {
    const qs = limit ? `?limit=${limit}` : "";
    return this.request(`/credits/history${qs}`, { headers: this.authHeaders("credits") });
  }

  async depositCredits(stripePaymentIntentId: string): Promise<{ success: boolean; balance: number }> {
    return this.request("/credits/deposit", {
      method: "POST",
      headers: this.authHeaders("credits"),
      body: JSON.stringify({ stripePaymentIntentId }),
    });
  }

  // ── Prepaid Sessions (MPP) ──

  async createPrepaidSession(
    agentPubkey: string,
    budgetUsdc: number,
  ): Promise<{
    sessionId: string;
    token: string;
    budgetUsdc: number;
    estimatedMessages: number;
    transaction?: string;
  }> {
    return this.request("/sessions/prepaid", {
      method: "POST",
      headers: this.authHeaders("chat"),
      body: JSON.stringify({ agent: agentPubkey, budgetUsdc }),
    });
  }

  async openPrepaidSession(
    agentPubkey: string,
    budgetUsdc: number,
    signedTransaction: string,
  ): Promise<{ sessionId: string; token: string; budgetUsdc: number; estimatedMessages: number; txSignature: string }> {
    return this.request("/sessions/prepaid", {
      method: "POST",
      headers: this.authHeaders("chat"),
      body: JSON.stringify({ agent: agentPubkey, budgetUsdc, signedTransaction }),
    });
  }

  async extendSession(
    sessionId: string,
    additionalUsdc: number,
  ): Promise<{ sessionId: string; budgetUsdc: number; spentUsdc: number; remainingUsdc: number }> {
    return this.request(`/sessions/${sessionId}/extend`, {
      method: "POST",
      headers: this.authHeaders("chat"),
      body: JSON.stringify({ additionalUsdc }),
    });
  }

  // ── Negotiation ──

  async sendMessageWithBudget(
    sessionId: string,
    task: string,
    maxBudget: number,
    fileUrl?: string,
  ): Promise<{
    price: number;
    priceUsdc: number;
    negotiated?: boolean;
    paymentId?: string;
    pendingPayment?: { transaction: string };
  }> {
    return this.request("/chat/send", {
      method: "POST",
      headers: this.authHeaders("chat"),
      body: JSON.stringify({ sessionId, task, maxBudget, ...(fileUrl && { fileUrl }) }),
    });
  }

  // ── Notifications ──

  async getNotifications(limit?: number): Promise<{
    notifications: Array<{
      id: number;
      type: string;
      title: string;
      description: string;
      is_read: boolean;
      created_at: string;
    }>;
  }> {
    const qs = limit ? `?limit=${limit}` : "";
    return this.request(`/notifications${qs}`, { headers: this.authHeaders("notifications") });
  }

  async getUnreadCount(): Promise<{ count: number }> {
    return this.request("/notifications/unread-count", { headers: this.authHeaders("notifications") });
  }

  async markNotificationsRead(ids?: number[]): Promise<{ success: boolean }> {
    return this.request("/notifications/mark-read", {
      method: "POST",
      headers: this.authHeaders("notifications"),
      body: JSON.stringify({ ids }),
    });
  }

  // ── Webhooks ──

  async registerWebhook(url: string, events?: string[]): Promise<{ success: boolean; url: string; events: string[] }> {
    return this.request("/notifications/webhook", {
      method: "POST",
      headers: this.authHeaders("webhook"),
      body: JSON.stringify({ url, events }),
    });
  }

  async getWebhook(): Promise<{ subscribed: boolean; url?: string; events?: string[] }> {
    return this.request("/notifications/webhook", { headers: this.authHeaders("webhook") });
  }

  async deleteWebhook(): Promise<{ success: boolean }> {
    return this.request("/notifications/webhook", {
      method: "DELETE",
      headers: this.authHeaders("webhook"),
    });
  }

  // ── Swap / Jupiter ──

  async getSwapQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
  ): Promise<{ inputMint: string; outputMint: string; inAmount: string; outAmount: string; priceImpact: string }> {
    const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
    return this.request(`/swap/quote?${params}`);
  }

  async buildSwapTransaction(
    inputMint: string,
    outputMint: string,
    amount: number,
  ): Promise<{ transaction: string; inputMint: string; outputMint: string }> {
    return this.request("/swap/build", {
      method: "POST",
      headers: this.authHeaders("swap"),
      body: JSON.stringify({ inputMint, outputMint, amount }),
    });
  }

  async getTokenPrice(token: string): Promise<{ token: string; priceUsd: number }> {
    return this.request(`/swap/price/${token}`);
  }

  async getTokenPrices(): Promise<{ prices: Record<string, number> }> {
    return this.request("/swap/prices");
  }

  // ── Solana Pay ──

  async getSolanaPayQR(agentSlug: string): Promise<{ url: string; qrData: string }> {
    return this.request(`/pay/qr/${agentSlug}`);
  }

  // ── Blinks ──

  async getBlink(agentSlug: string): Promise<{
    icon: string;
    title: string;
    description: string;
    links: { actions: Array<{ label: string; href: string }> };
  }> {
    return this.request(`/blink/${agentSlug}`);
  }

  // ── Recurring Tasks ──

  async createRecurringTask(params: {
    agentAuth: string;
    task: string;
    intervalMs: number;
    budgetPerExecution: number;
    maxExecutions?: number;
  }): Promise<{ id: number; success: boolean }> {
    return this.request("/recurring/create", {
      method: "POST",
      headers: this.authHeaders("recurring"),
      body: JSON.stringify(params),
    });
  }

  async listRecurringTasks(): Promise<{
    tasks: Array<{ id: number; agent_auth: string; task: string; status: string; executions: number }>;
  }> {
    return this.request("/recurring", { headers: this.authHeaders("recurring") });
  }

  async pauseRecurringTask(id: number): Promise<{ success: boolean }> {
    return this.request(`/recurring/${id}/pause`, { method: "POST", headers: this.authHeaders("recurring") });
  }

  async resumeRecurringTask(id: number): Promise<{ success: boolean }> {
    return this.request(`/recurring/${id}/resume`, { method: "POST", headers: this.authHeaders("recurring") });
  }

  async stopRecurringTask(id: number): Promise<{ success: boolean }> {
    return this.request(`/recurring/${id}/stop`, { method: "POST", headers: this.authHeaders("recurring") });
  }

  // ── Agent Spending ──

  async getAgentBalance(): Promise<{ sol: string; usdc: string; publicKey: string }> {
    return this.request("/agents/actions/balance", { headers: this.authHeaders("balance") });
  }

  async getAgentSpendHistory(): Promise<{ transactions: Array<{ type: string; amount: number; created_at: string }> }> {
    return this.request("/agents/spend/history", { headers: this.authHeaders("spend") });
  }

  // ── Transactions ──

  async getTransactionHistory(): Promise<{
    transactions: Array<{ signature: string; type: string; amount: number; timestamp: string }>;
  }> {
    return this.request("/transactions/history", { headers: this.authHeaders("transactions") });
  }

  // ── Mandates ──

  async createMandate(params: {
    agentAuth: string;
    budgetLimit: number;
    expiresInMs: number;
    allowedActions?: string[];
  }): Promise<{ id: number; success: boolean }> {
    return this.request("/mandates/create", {
      method: "POST",
      headers: this.authHeaders("mandate"),
      body: JSON.stringify(params),
    });
  }

  async listMandates(): Promise<{
    mandates: Array<{ id: number; agent_auth: string; budget_limit: number; status: string }>;
  }> {
    return this.request("/mandates", { headers: this.authHeaders("mandate") });
  }

  async revokeMandate(id: number): Promise<{ success: boolean }> {
    return this.request(`/mandates/${id}/revoke`, { method: "POST", headers: this.authHeaders("mandate") });
  }

  // ── Presigned Upload (large files) ──

  async getPresignedUploadUrl(
    fileName: string,
    mimeType: string,
    size?: number,
  ): Promise<{
    uploadUrl: string;
    token: string;
    fileId: string;
    storagePath: string;
  }> {
    return this.request("/upload/presigned", {
      method: "POST",
      headers: this.authHeaders("upload"),
      body: JSON.stringify({ fileName, mimeType, size }),
    });
  }

  async confirmUpload(fileId: string): Promise<{ success: boolean; url: string; name: string; size: number }> {
    return this.request("/upload/confirm", {
      method: "POST",
      headers: this.authHeaders("upload"),
      body: JSON.stringify({ fileId }),
    });
  }

  // ── Discover ──

  async discover(skills: string): Promise<Agent[]> {
    return this.request(`/discover?skills=${encodeURIComponent(skills)}`);
  }

  // ── My Agents (owned by wallet or email) ──

  async myAgents(): Promise<{ agents: Agent[] }> {
    return this.request("/agents/my", { headers: this.authHeaders("agents") });
  }

  // ── Claim Agent ──

  async claimAgent(agentPubkey: string, accessCode: string): Promise<{ success: boolean }> {
    return this.request("/agents/claim", {
      method: "POST",
      headers: this.authHeaders("claim"),
      body: JSON.stringify({ agentPubkey, accessCode }),
    });
  }
}
