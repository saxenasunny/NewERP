import { describe, expect, it } from "vitest";

import {
  createNonce,
  deriveCheckInKey,
  signCheckInToken,
  verifyCheckInToken,
} from "@/modules/attendance/check-in-token";

const SECRET = "unit-test-secret-at-least-16-characters";
const key = deriveCheckInKey(SECRET);
const NOW = 1_800_000_000_000; // fixed milliseconds
const PAYLOAD = {
  sessionId: "sess_abc123",
  nonce: "nonce-abcdefghijklmn",
  expiresAt: NOW / 1000 + 600,
};

function reencodeBody(token: string, change: (payload: Record<string, unknown>) => void): string {
  const [version = "", body = "", signature = ""] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  change(payload);
  const tampered = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${version}.${tampered}.${signature}`;
}

describe("check-in tokens", () => {
  it("round-trips a signed payload", () => {
    const token = signCheckInToken(PAYLOAD, key);
    const result = verifyCheckInToken(token, key, NOW);

    expect(token.split(".")).toHaveLength(3);
    expect(token.split(".")[0]).toBe("v1");
    expect(token).not.toContain("=");
    expect(result).toEqual({ valid: true, payload: PAYLOAD });
  });

  it("is deterministic for the same payload and key", () => {
    expect(signCheckInToken(PAYLOAD, key)).toBe(signCheckInToken(PAYLOAD, key));
    expect(signCheckInToken(PAYLOAD, key)).not.toBe(
      signCheckInToken(PAYLOAD, deriveCheckInKey(`${SECRET}-other`)),
    );
  });

  it("rejects a tampered payload and a signature from another key", () => {
    const token = signCheckInToken(PAYLOAD, key);
    const movedSession = reencodeBody(token, (payload) => {
      payload.sid = "sess_someone_else";
    });

    expect(verifyCheckInToken(movedSession, key, NOW)).toEqual({
      valid: false,
      reason: "signature",
    });
    expect(verifyCheckInToken(token, deriveCheckInKey(`${SECRET}-other`), NOW)).toEqual({
      valid: false,
      reason: "signature",
    });
  });

  it("reports an expired but otherwise valid token", () => {
    const token = signCheckInToken(PAYLOAD, key);
    expect(verifyCheckInToken(token, key, PAYLOAD.expiresAt * 1000)).toEqual({
      valid: false,
      reason: "expired",
    });
    expect(verifyCheckInToken(token, key, PAYLOAD.expiresAt * 1000 - 1).valid).toBe(true);
  });

  it("rejects malformed tokens without throwing", () => {
    const token = signCheckInToken(PAYLOAD, key);
    const [, body = "", signature = ""] = token.split(".");
    const badJson = `${Buffer.from("not json", "utf8").toString("base64url")}.${signature}`;
    const nullJson = `${Buffer.from("null", "utf8").toString("base64url")}.${signature}`;

    const malformed = [
      "",
      "v1",
      "v1.body",
      "v2.a.b",
      `v1..${signature}`,
      `v1.${body}.`,
      "v1.a.b.c",
      "x".repeat(600),
      `${nullJson.split(".")[0]}`,
    ];

    for (const candidate of malformed) {
      expect(verifyCheckInToken(candidate, key, NOW).valid).toBe(false);
    }

    // A structurally invalid payload is rejected before its signature is trusted,
    // so these are "malformed" rather than "signature".
    const shortNonce = signCheckInToken({ ...PAYLOAD, nonce: "short" }, key);
    expect(verifyCheckInToken(shortNonce, key, NOW)).toEqual({
      valid: false,
      reason: "malformed",
    });
    const fractionalExpiry = signCheckInToken({ ...PAYLOAD, expiresAt: 1.5 }, key);
    expect(verifyCheckInToken(fractionalExpiry, key, NOW)).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(verifyCheckInToken(badJson, key, NOW).valid).toBe(false);
  });

  it("derives a stable 32-byte key and refuses a short secret", () => {
    expect(deriveCheckInKey(SECRET)).toHaveLength(32);
    expect(deriveCheckInKey(SECRET).equals(deriveCheckInKey(SECRET))).toBe(true);
    expect(() => deriveCheckInKey("too-short")).toThrow(/at least 16/);
  });

  it("creates unique, URL-safe nonces", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(nonce.length).toBeGreaterThanOrEqual(20);
    }
  });
});
