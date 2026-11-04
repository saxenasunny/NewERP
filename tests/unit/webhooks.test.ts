import { afterEach, describe, expect, it } from "vitest";

import {
  WEBHOOK_TOLERANCE_SECONDS,
  isValidProvider,
  providerSecret,
  providerSecretKey,
  signWebhookPayload,
  signedPayload,
  verifyWebhookSignature,
} from "@/modules/integrations/webhooks";

const secret = "unit-test-secret-at-least-16-chars";
const body = JSON.stringify({ id: "evt_1", type: "learner.created" });
const now = new Date("2026-11-04T12:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000));

afterEach(() => {
  delete process.env.WEBHOOK_ACME_SECRET;
});

describe("webhook signatures", () => {
  it("signs the timestamp and the exact body", () => {
    expect(signedPayload("1700000000", body)).toBe(`1700000000.${body}`);
    const first = signWebhookPayload(secret, timestamp, body);
    const second = signWebhookPayload(secret, timestamp, body);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(signWebhookPayload(secret, timestamp, `${body} `)).not.toBe(first);
  });

  it("accepts a fresh, correctly signed request", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature({ secret, timestamp, signature, body, now })).toEqual({
      ok: true,
    });
  });

  it("rejects a tampered body, a wrong secret, and a missing signature", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature,
        body: body.replace("learner.created", "learner.deleted"),
        now,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });

    expect(
      verifyWebhookSignature({
        secret: "a-different-secret-at-least-16",
        timestamp,
        signature,
        body,
        now,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });

    expect(verifyWebhookSignature({ secret, timestamp, signature: null, body, now })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("rejects a signature outside the tolerance window in either direction", () => {
    const stale = String(Math.floor(now.getTime() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 1);
    const future = String(Math.floor(now.getTime() / 1000) + WEBHOOK_TOLERANCE_SECONDS + 1);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp: stale,
        signature: signWebhookPayload(secret, stale, body),
        body,
        now,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });

    expect(
      verifyWebhookSignature({
        secret,
        timestamp: future,
        signature: signWebhookPayload(secret, future, body),
        body,
        now,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a missing or non-numeric timestamp", () => {
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: null,
        signature: signWebhookPayload(secret, "0", body),
        body,
        now,
      }),
    ).toEqual({ ok: false, reason: "malformed_timestamp" });
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: "yesterday",
        signature: signWebhookPayload(secret, "yesterday", body),
        body,
        now,
      }),
    ).toEqual({ ok: false, reason: "malformed_timestamp" });
  });

  it("names provider secrets predictably and refuses short ones", () => {
    expect(providerSecretKey("stripe")).toBe("WEBHOOK_STRIPE_SECRET");
    expect(providerSecretKey("acme-payments")).toBe("WEBHOOK_ACME_PAYMENTS_SECRET");
    expect(providerSecret("acme")).toBeNull();

    process.env.WEBHOOK_ACME_SECRET = "short";
    expect(providerSecret("acme")).toBeNull();

    process.env.WEBHOOK_ACME_SECRET = secret;
    expect(providerSecret("acme")).toBe(secret);
    expect(providerSecret("ACME")).toBe(secret);
  });

  it("accepts only lower-case provider slugs", () => {
    expect(isValidProvider("stripe")).toBe(true);
    expect(isValidProvider("acme-payments")).toBe(true);
    expect(isValidProvider("acme_1")).toBe(true);
    expect(isValidProvider("Acme")).toBe(false);
    expect(isValidProvider("../etc")).toBe(false);
    expect(isValidProvider("a")).toBe(false);
  });
});
