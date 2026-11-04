import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const INVITATION_TTL_DAYS = 7;
export const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 256 bits of entropy, URL-safe. */
export function generateSingleUseToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Tokens are stored only as SHA-256 digests. A database leak therefore does not
 * yield usable invitation or reset links, and tokens are never logged.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Constant-time digests comparison for cases that compare hashes directly. */
export function tokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
