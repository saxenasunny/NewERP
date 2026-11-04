/**
 * Signed QR check-in codes.
 *
 * A code is a compact, self-describing token:
 *
 *     v1.<base64url payload>.<hex HMAC-SHA256>
 *
 * The payload names the session, a random nonce, and an expiry. The nonce is
 * stored on the session, so generating a new code invalidates every older one
 * even though the signature stays valid — the server compares the nonce, not
 * just the signature. Replay by the same learner is stopped separately by the
 * unique attendance row.
 *
 * Nothing here reads the database or the clock implicitly: expiry is passed in,
 * which keeps the rules testable without freezegun-style trickery.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const KEY_LABEL = "attendance-check-in:v1";
const MAX_TOKEN_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 64;
const MAX_NONCE_LENGTH = 64;
const MIN_NONCE_LENGTH = 8;

/**
 * The signing key is derived from `AUTH_SECRET` rather than configured
 * separately: one fewer secret to leak, and rotating `AUTH_SECRET` is already a
 * documented incident action. The label keeps this key unusable for session
 * tokens.
 */
export function deriveCheckInKey(secret: string): Buffer {
  if (secret.length < 16) {
    throw new Error("The check-in signing secret must be at least 16 characters.");
  }
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

/** A fresh nonce for one session's code. Rotation is what kills old codes. */
export function createNonce(): string {
  return randomBytes(18).toString("base64url");
}

export type CheckInPayload = {
  sessionId: string;
  nonce: string;
  /** Unix seconds. */
  expiresAt: number;
};

export type CheckInVerification =
  | { valid: true; payload: CheckInPayload }
  | { valid: false; reason: "malformed" | "signature" | "expired" };

function sign(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function signCheckInToken(payload: CheckInPayload, key: Buffer): string {
  const body = Buffer.from(
    JSON.stringify({ sid: payload.sessionId, n: payload.nonce, exp: payload.expiresAt }),
    "utf8",
  ).toString("base64url");
  return `${VERSION}.${body}.${sign(key, `${VERSION}.${body}`)}`;
}

/**
 * Verifies the shape, the signature, and the expiry. A structurally invalid
 * token never reaches the database; a validly signed but stale one is reported
 * as `expired` so the page can say something useful.
 */
export function verifyCheckInToken(
  token: string,
  key: Buffer,
  now: number = Date.now(),
): CheckInVerification {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { valid: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [version = "", body = "", provided = ""] = parts;
  if (version !== VERSION || body.length === 0 || provided.length === 0) {
    return { valid: false, reason: "malformed" };
  }

  const expected = Buffer.from(sign(key, `${version}.${body}`), "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { valid: false, reason: "signature" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (typeof decoded !== "object" || decoded === null) {
    return { valid: false, reason: "malformed" };
  }

  const candidate = decoded as { sid?: unknown; n?: unknown; exp?: unknown };
  if (
    typeof candidate.sid !== "string" ||
    candidate.sid.length === 0 ||
    candidate.sid.length > MAX_SESSION_ID_LENGTH
  ) {
    return { valid: false, reason: "malformed" };
  }
  if (
    typeof candidate.n !== "string" ||
    candidate.n.length < MIN_NONCE_LENGTH ||
    candidate.n.length > MAX_NONCE_LENGTH
  ) {
    return { valid: false, reason: "malformed" };
  }
  if (typeof candidate.exp !== "number" || !Number.isInteger(candidate.exp) || candidate.exp <= 0) {
    return { valid: false, reason: "malformed" };
  }

  if (candidate.exp * 1000 <= now) return { valid: false, reason: "expired" };

  return {
    valid: true,
    payload: { sessionId: candidate.sid, nonce: candidate.n, expiresAt: candidate.exp },
  };
}
