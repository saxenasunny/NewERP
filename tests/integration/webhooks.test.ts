import { createHash } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_WEBHOOK_BYTES,
  receiveWebhook,
  signWebhookPayload,
} from "@/modules/integrations/webhooks";

import {
  disconnectTestDb,
  integrationDatabaseUrl,
  resetDatabase,
  testDb,
} from "./helpers/database";

const databaseAvailable = Boolean(integrationDatabaseUrl());

if (!databaseAvailable) {
  console.warn(
    "Skipping webhook tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

const SECRET = "integration-secret-at-least-16";
const now = new Date("2026-11-04T12:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000));

function signedRequest(body: string, overrides: { timestamp?: string; secret?: string } = {}) {
  const ts = overrides.timestamp ?? timestamp;
  const signature = signWebhookPayload(overrides.secret ?? SECRET, ts, body);
  return {
    headers: new Headers({
      "x-webhook-timestamp": ts,
      "x-webhook-signature": signature,
      "content-type": "application/json",
    }),
    body,
    now,
  };
}

beforeEach(async () => {
  await resetDatabase();
  process.env.WEBHOOK_ACME_SECRET = SECRET;
  process.env.WEBHOOK_PARTNER_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.WEBHOOK_ACME_SECRET;
  delete process.env.WEBHOOK_PARTNER_SECRET;
});

afterAll(async () => {
  await disconnectTestDb();
});

describeDb("inbound webhooks (PostgreSQL)", () => {
  it("stores a verified event once and answers a replay as a duplicate", async () => {
    const body = JSON.stringify({ id: "evt_123", type: "learner.created", data: { id: "u1" } });
    const request = signedRequest(body);

    const first = await receiveWebhook({ provider: "acme", ...request });
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("Expected the first delivery to be stored.");

    const second = await receiveWebhook({ provider: "acme", ...request });
    expect(second).toEqual({ status: "duplicate", eventId: first.eventId });

    const rows = await testDb().webhookEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "acme",
      externalId: "evt_123",
      eventType: "learner.created",
      status: "RECEIVED",
      payloadHash: createHash("sha256").update(body, "utf8").digest("hex"),
    });
  });

  it("prefers the header event id over the payload id", async () => {
    const body = JSON.stringify({ id: "payload-id", type: "invoice.paid" });
    const result = await receiveWebhook({
      provider: "acme",
      ...signedRequest(body),
      externalId: "header-id",
    });
    expect(result.status).toBe("accepted");

    const row = await testDb().webhookEvent.findFirstOrThrow();
    expect(row.externalId).toBe("header-id");
  });

  it("rejects a body changed after signing and a stale replay", async () => {
    const body = JSON.stringify({ id: "evt_tamper", type: "learner.created" });
    const request = signedRequest(body);
    const tampered = await receiveWebhook({
      provider: "acme",
      ...request,
      body: body.replace("learner.created", "learner.deleted"),
    });
    expect(tampered).toEqual({ status: "rejected", reason: "mismatch" });

    const staleTimestamp = String(Math.floor(now.getTime() / 1000) - 3600);
    const stale = await receiveWebhook({
      provider: "acme",
      ...signedRequest(body, { timestamp: staleTimestamp }),
    });
    expect(stale).toEqual({ status: "rejected", reason: "stale_timestamp" });
    expect(await testDb().webhookEvent.count()).toBe(0);
  });

  it("rejects an unconfigured or malformed provider and invalid payloads", async () => {
    const body = JSON.stringify({ id: "evt_x", type: "ping" });

    expect(await receiveWebhook({ provider: "unknown", ...signedRequest(body) })).toEqual({
      status: "rejected",
      reason: "provider_unconfigured",
    });
    expect(await receiveWebhook({ provider: "Not A Provider", ...signedRequest(body) })).toEqual({
      status: "rejected",
      reason: "unknown_provider",
    });

    const malformed = signedRequest("{not json");
    expect(await receiveWebhook({ provider: "acme", ...malformed })).toEqual({
      status: "rejected",
      reason: "invalid_json",
    });

    const noId = signedRequest(JSON.stringify({ type: "ping" }));
    expect(await receiveWebhook({ provider: "acme", ...noId })).toEqual({
      status: "rejected",
      reason: "missing_event_id",
    });

    expect(
      await receiveWebhook({
        provider: "acme",
        headers: new Headers(),
        body,
      }),
    ).toEqual({ status: "rejected", reason: "missing_signature" });
  });

  it("refuses an oversized body before verifying it", async () => {
    const oversized = JSON.stringify({
      id: "evt_big",
      type: "ping",
      pad: "x".repeat(MAX_WEBHOOK_BYTES),
    });
    const result = await receiveWebhook({ provider: "acme", ...signedRequest(oversized) });
    expect(result).toEqual({ status: "rejected", reason: "payload_too_large" });
  });

  it("scopes event ids per provider", async () => {
    const body = JSON.stringify({ id: "shared-id", type: "ping" });
    const first = await receiveWebhook({ provider: "acme", ...signedRequest(body) });
    const second = await receiveWebhook({ provider: "partner", ...signedRequest(body) });

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("accepted");
    expect(await testDb().webhookEvent.count()).toBe(2);
  });
});
