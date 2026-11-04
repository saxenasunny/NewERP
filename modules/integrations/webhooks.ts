import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { getDb, type DatabaseClient } from "@/lib/db/client";

/**
 * Inbound webhooks.
 *
 * A provider signs `timestamp.body` with a shared secret and sends the result in
 * `x-webhook-signature` alongside `x-webhook-timestamp`. Verification is
 * constant-time, rejects a clock skew beyond five minutes (so a captured request
 * cannot be replayed tomorrow), and rejects oversized bodies before parsing.
 *
 * Handlers are not implemented for any provider yet: a verified event is stored
 * once under `(provider, external_id)` and can be replayed or marked processed by
 * a future worker. The endpoint therefore proves the transport, not a business
 * integration.
 */

export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const MAX_WEBHOOK_BYTES = 256 * 1024;

/** `stripe` → `WEBHOOK_STRIPE_SECRET`. Secrets never leave the server. */
export function providerSecretKey(provider: string): string {
  const normalised = provider
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return `WEBHOOK_${normalised}_SECRET`;
}

export function providerSecret(provider: string): string | null {
  const value = process.env[providerSecretKey(provider)];
  return typeof value === "string" && value.length >= 16 ? value : null;
}

export function signedPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

/** The canonical signature a provider must produce, as lowercase hex. */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(signedPayload(timestamp, body)).digest("hex");
}

export type SignatureFailure =
  "missing_signature" | "malformed_timestamp" | "stale_timestamp" | "mismatch";

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): SignatureCheck {
  if (!input.signature) return { ok: false, reason: "missing_signature" };

  const timestamp = Number(input.timestamp);
  if (!input.timestamp || !Number.isFinite(timestamp)) {
    return { ok: false, reason: "malformed_timestamp" };
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = signWebhookPayload(input.secret, input.timestamp, input.body);
  const provided = input.signature.trim().toLowerCase();
  if (provided.length !== expected.length) return { ok: false, reason: "mismatch" };

  const matches = timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
  return matches ? { ok: true } : { ok: false, reason: "mismatch" };
}

export type WebhookResult =
  | { status: "accepted"; eventId: string }
  | { status: "duplicate"; eventId: string }
  | { status: "rejected"; reason: string };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function isValidProvider(provider: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,39}$/.test(provider);
}

/**
 * Verifies and stores one delivery. The caller maps the result to an HTTP status;
 * nothing here trusts a tenant or user identifier from the payload.
 */
export async function receiveWebhook(
  input: {
    provider: string;
    headers: Headers;
    body: string;
    externalId?: string | null;
    now?: Date;
  },
  db: DatabaseClient = getDb(),
): Promise<WebhookResult> {
  const provider = input.provider.trim().toLowerCase();
  if (!isValidProvider(provider)) return { status: "rejected", reason: "unknown_provider" };

  const secret = providerSecret(provider);
  if (!secret) return { status: "rejected", reason: "provider_unconfigured" };

  if (Buffer.byteLength(input.body, "utf8") > MAX_WEBHOOK_BYTES) {
    return { status: "rejected", reason: "payload_too_large" };
  }

  const signature = verifyWebhookSignature({
    secret,
    timestamp: input.headers.get("x-webhook-timestamp"),
    signature: input.headers.get("x-webhook-signature"),
    body: input.body,
    now: input.now,
  });
  if (!signature.ok) return { status: "rejected", reason: signature.reason };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return { status: "rejected", reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "rejected", reason: "invalid_payload" };
  }

  const payload = parsed as Record<string, unknown>;
  const externalId = input.externalId ?? (typeof payload.id === "string" ? payload.id : null);
  if (!externalId || externalId.length > 200) {
    return { status: "rejected", reason: "missing_event_id" };
  }

  const eventType =
    typeof payload.type === "string" && payload.type.length > 0
      ? payload.type.slice(0, 120)
      : "unknown";
  const payloadHash = createHash("sha256").update(input.body, "utf8").digest("hex");
  const receivedAt = input.now ?? new Date();

  try {
    const created = await db.webhookEvent.create({
      data: {
        provider,
        externalId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
        payloadHash,
        receivedAt,
      },
      select: { id: true },
    });
    return { status: "accepted", eventId: created.id };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.webhookEvent.findUnique({
      where: { provider_externalId: { provider, externalId } },
      select: { id: true },
    });
    return { status: "duplicate", eventId: existing?.id ?? "" };
  }
}
