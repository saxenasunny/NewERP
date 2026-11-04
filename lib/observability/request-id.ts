export const REQUEST_ID_HEADER = "x-request-id";

/** Safe opaque token: no spaces, quotes, or control characters. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Accepts an upstream request ID only when it is a safe opaque token;
 * otherwise generates one. Never log or reflect arbitrary header values.
 */
export function getOrCreateRequestId(value: string | null | undefined): string {
  if (value && REQUEST_ID_PATTERN.test(value)) return value;
  return crypto.randomUUID();
}
