import { Keypair } from "@solana/web3.js";
import { signMessage } from "./wallet.js";

const API_BASE = (process.env.AGENTBAZAAR_API || "https://agentbazaar.dev").replace(/\/$/, "");

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || API_BASE;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    return data as T;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    return data as T;
  }

  async postAuthenticated<T>(
    path: string,
    body: Record<string, unknown>,
    keypair: Keypair,
    action: string,
  ): Promise<T> {
    const auth = signMessage(keypair, action);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": auth.address,
        "X-Wallet-Signature": auth.signature,
        "X-Wallet-Message": auth.message,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    return data as T;
  }

  /**
   * POST with x402 payment. Makes initial request, if 402 returned,
   * calls the payment handler to construct payment header and retries.
   */
  async postWithPayment<T>(
    path: string,
    body: Record<string, unknown>,
    constructPaymentHeader: (res: Response) => Promise<string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const bodyStr = JSON.stringify(body);

    // First attempt — may get 402
    const res = await fetch(url, { method: "POST", headers, body: bodyStr });

    if (res.status === 402) {
      const paymentHeader = await constructPaymentHeader(res);
      const retryRes = await fetch(url, {
        method: "POST",
        headers: { ...headers, "X-Payment": paymentHeader },
        body: bodyStr,
      });
      const data = await retryRes.json();
      if (!retryRes.ok) {
        throw new Error((data as { error?: string }).error || `HTTP ${retryRes.status}`);
      }
      return data as T;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    return data as T;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const api = new ApiClient();
