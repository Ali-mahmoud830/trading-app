/**
 * lib/nexus.ts
 *
 * Client and cryptographic helper library for Nexus Crypto Payment Gateway.
 * Supports TRON (TRC-20) and BNB Chain (BEP-20) instant deposits.
 */

import crypto from "crypto";

export type NexusNetwork = "TRON" | "BSC";

export interface NexusInvoiceData {
  invoiceId: string;
  depositAddress: string;
  expectedCryptoAmount: string;
  baseAmount: number;
  feeAmount: number;
  paidCryptoAmount?: string;
  cryptoCurrency: string;
  network: NexusNetwork;
  status: "PENDING" | "DETECTED" | "CONFIRMED" | "EXPIRED" | "FAILED" | "UNDERPAID";
  confirmations?: number;
  txHash?: string;
  expiresAt: string;
  createdAt: string;
}

export interface NexusCreateInvoiceParams {
  userId: string;
  amount: number;
  network: NexusNetwork;
  metadata?: Record<string, unknown>;
  webhookUrl?: string;
}

const DEFAULT_API_URL = "https://nexus-gateway-backend-2n4s.onrender.com/api/v1";
const DEFAULT_CHECKOUT_HOST = "https://nexus-gateway-vert.vercel.app";

export function getNexusApiUrl(): string {
  return (process.env.NEXUS_GATEWAY_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

export function getNexusApiKey(): string {
  return process.env.NEXUS_API_KEY || "nx_live_c4c0e1df9249df29e7d072f87e17bd5b15334aed4322365768dfe076";
}

export function getNexusCheckoutHost(): string {
  return (process.env.NEXUS_CHECKOUT_HOST || DEFAULT_CHECKOUT_HOST).replace(/\/+$/, "");
}

export function getHostedCheckoutUrl(invoiceId: string): string {
  return `${getNexusCheckoutHost()}/pay/${invoiceId}`;
}

/**
 * Creates a unique ephemeral crypto invoice on Nexus Gateway.
 * Uses a 20-second timeout to handle Render free-tier cold starts gracefully.
 */
export async function createNexusInvoice(
  params: NexusCreateInvoiceParams
): Promise<NexusInvoiceData> {
  const apiUrl = getNexusApiUrl();
  const apiKey = getNexusApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000); // 20s for cold start

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        userId: params.userId,
        amount: Number(params.amount),
        network: params.network,
        metadata: params.metadata || {},
        webhookUrl: params.webhookUrl,
      }),
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    clearTimeout(timeoutId);
    if (fetchErr?.name === "AbortError") {
      throw new Error(
        "Nexus payment gateway is waking up. Please wait 15–30 seconds and try again."
      );
    }
    throw new Error(`Network error reaching Nexus gateway: ${fetchErr?.message || String(fetchErr)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  // Guard: Render 503 responses return HTML. Detect and surface a clean error.
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Nexus gateway returned an unexpected response (HTTP ${response.status}). ` +
      "The payment service may be temporarily unavailable. Please try again in 30 seconds."
    );
  }

  const json = await response.json();

  if (!response.ok || !json.success) {
    const errorMsg =
      json.error?.message ||
      json.message ||
      `Nexus API returned status ${response.status}`;
    throw new Error(errorMsg);
  }

  return json.data as NexusInvoiceData;
}

/**
 * Polls the current live on-chain status of an invoice from Nexus Gateway.
 */
export async function getNexusInvoice(
  invoiceId: string
): Promise<NexusInvoiceData> {
  const apiUrl = getNexusApiUrl();
  const apiKey = getNexusApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    clearTimeout(timeoutId);
    if (fetchErr?.name === "AbortError") {
      throw new Error("Nexus gateway request timed out. Please try again.");
    }
    throw new Error(`Network error: ${fetchErr?.message || String(fetchErr)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Nexus gateway returned an unexpected response (HTTP ${response.status}).`
    );
  }

  const json = await response.json();

  if (!response.ok || !json.success) {
    const errorMsg =
      json.error?.message ||
      json.message ||
      `Nexus API returned status ${response.status}`;
    throw new Error(errorMsg);
  }

  return json.data as NexusInvoiceData;
}

/**
 * Verifies HMAC-SHA256 signature for incoming Nexus webhooks.
 * Header format: X-Nexus-Signature: t={timestamp},v1={hash}
 */
export function verifyNexusWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secretKey: string
): boolean {
  if (!signatureHeader || !timestampHeader || !secretKey) {
    return false;
  }

  try {
    // 1. Check timestamp age (within 10 minutes to prevent replay attacks)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const incomingTimestamp = parseInt(timestampHeader, 10);
    if (isNaN(incomingTimestamp) || Math.abs(currentTimestamp - incomingTimestamp) > 600) {
      console.warn("[NexusWebhook] Timestamp expired or skewed:", {
        currentTimestamp,
        incomingTimestamp,
      });
      return false;
    }

    // 2. Extract v1 hash from signatureHeader
    const parts = signatureHeader.split(",");
    const hashPart = parts.find((p) => p.trim().startsWith("v1="));
    if (!hashPart) return false;
    const expectedHash = hashPart.trim().split("=")[1];
    if (!expectedHash) return false;

    // 3. Compute expected signature: `${incomingTimestamp}.${rawBody}`
    const expectedPayload = `${incomingTimestamp}.${rawBody}`;
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(expectedPayload)
      .digest("hex");

    // 4. Timing-safe comparison
    const computedBuffer = Buffer.from(computedHash, "hex");
    const expectedBuffer = Buffer.from(expectedHash, "hex");

    if (computedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuffer, expectedBuffer);
  } catch (err) {
    console.error("[NexusWebhook] Error verifying signature:", err);
    return false;
  }
}
