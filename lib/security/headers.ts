/**
 * Security headers applied to every response.
 *
 * The Content-Security-Policy is deliberately a safe subset: `frame-ancestors`,
 * `base-uri`, and `form-action` need no nonce and cannot break Next.js inline
 * bootstrap scripts. A full `default-src`/`script-src` policy needs per-request
 * nonces threaded through the App Router; until that is built, adding one here
 * would either break the app or be fiction. The gap is recorded in the incident
 * runbook rather than papered over with `unsafe-inline`.
 */

export type SecurityHeader = { key: string; value: string };

export function securityHeaders(options: { production: boolean }): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ];

  if (options.production) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }

  return headers;
}
