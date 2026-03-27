import { Keypair } from "@solana/web3.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { toClientSvmSigner } from "@x402/svm";

const MAX_PAYMENT = Number(process.env.MAX_PAYMENT_USDC || "5.00");

let cachedHttpClient: x402HTTPClient | null = null;
let cachedKeypairKey: string | null = null;

async function getHttpClient(keypair: Keypair): Promise<x402HTTPClient> {
  const keyStr = keypair.publicKey.toBase58();

  if (cachedHttpClient && cachedKeypairKey === keyStr) {
    return cachedHttpClient;
  }

  const kitSigner = await createKeyPairSignerFromBytes(keypair.secretKey);
  const svmSigner = toClientSvmSigner(kitSigner);

  const client = new x402Client();
  registerExactSvmScheme(client, { signer: svmSigner });

  cachedHttpClient = new x402HTTPClient(client);
  cachedKeypairKey = keyStr;

  return cachedHttpClient;
}

/**
 * Make a POST request with x402 payment handling.
 * First attempts without payment — if 402, constructs payment and retries.
 */
export async function postWithPayment<T>(url: string, body: Record<string, unknown>, keypair: Keypair): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const bodyStr = JSON.stringify(body);

  // First attempt
  const res = await fetch(url, { method: "POST", headers, body: bodyStr });

  if (res.status !== 402) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    return data as T;
  }

  // 402 — need to pay
  const httpClient = await getHttpClient(keypair);

  // Parse payment requirements from response
  // Read body for v1 fallback, but catch errors if body already consumed
  let responseBody: unknown;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = undefined;
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse((name: string) => res.headers.get(name), responseBody);

  // Check spending limit
  if (paymentRequired.accepts && paymentRequired.accepts.length > 0) {
    const amount = Number(paymentRequired.accepts[0].amount) / 1_000_000;
    if (amount > MAX_PAYMENT) {
      throw new Error(
        `Payment of $${amount.toFixed(2)} USDC exceeds your spending limit of $${MAX_PAYMENT.toFixed(2)} USDC. ` +
          `Set MAX_PAYMENT_USDC in your MCP config to increase the limit.`,
      );
    }
  }

  // Create payment payload
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  // Retry with payment
  const retryRes = await fetch(url, {
    method: "POST",
    headers: { ...headers, ...paymentHeaders },
    body: bodyStr,
  });

  const data = await retryRes.json();
  if (!retryRes.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${retryRes.status}`);
  }
  return data as T;
}
