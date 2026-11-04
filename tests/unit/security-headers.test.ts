import { describe, expect, it } from "vitest";

import { securityHeaders } from "@/lib/security/headers";

function asMap(headers: ReturnType<typeof securityHeaders>): Map<string, string> {
  return new Map(headers.map((header) => [header.key, header.value]));
}

describe("security headers", () => {
  it("always sets clickjacking, sniffing, referrer, and permission policies", () => {
    const headers = asMap(securityHeaders({ production: false }));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("uses a CSP subset that cannot break inline bootstrap scripts", () => {
    const headers = asMap(securityHeaders({ production: false }));
    const csp = headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("script-src");
  });

  it("adds HSTS only in production", () => {
    expect(asMap(securityHeaders({ production: false })).has("Strict-Transport-Security")).toBe(
      false,
    );
    expect(asMap(securityHeaders({ production: true })).get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});
