# ADR 0003 — Rendering and caching policy

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

`create-next-app` enables Next.js 16 Cache Components and Partial Prefetching by
default. This application serves tenant-scoped, permission-filtered data behind a
session cookie. A cached page or data function that is not keyed by user,
membership, and tenant can leak one institution's data to another.

The specification's priority is correctness and isolation over peak throughput at
this stage.

## Decision

- `cacheComponents` and `partialPrefetching` are **disabled** in `next.config.ts`.
- Session-dependent pages are dynamic. Reads hit PostgreSQL per request.
- No `use cache` directives are added for tenant data.
- Public, non-personalised content (for example certificate verification) may later
  opt into explicit caching with no personal data in the cached value; that will be
  a new decision.
- HTTP responses that contain personalised data set `Cache-Control: private,
no-store` once authenticated pages exist.

## Consequences

- Higher database load per page view; acceptable at the expected scale, measured
  before any optimisation.
- Some Next.js documentation that assumes Cache Components does not apply; use the
  "caching without Cache Components" guidance.
- If throughput later requires caching, the cache key must include tenant and user
  scope, and isolation tests must cover the cached path too.
