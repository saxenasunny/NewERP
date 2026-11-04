import { describe, expect, it } from "vitest";

import { getOrCreateRequestId } from "@/lib/observability/request-id";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("getOrCreateRequestId", () => {
  it("adopts a safe upstream request ID", () => {
    expect(getOrCreateRequestId("edge.req-12345678")).toBe("edge.req-12345678");
  });

  it("generates an ID when absent", () => {
    expect(getOrCreateRequestId(null)).toMatch(uuidPattern);
    expect(getOrCreateRequestId(undefined)).toMatch(uuidPattern);
  });

  it("rejects short, whitespace-bearing, or log-injecting values", () => {
    for (const unsafe of [
      "short",
      "has space here",
      "newline\ninjection",
      'quote"injection',
      "a".repeat(129),
    ]) {
      const generated = getOrCreateRequestId(unsafe);
      expect(generated).not.toBe(unsafe);
      expect(generated).toMatch(uuidPattern);
    }
  });
});
