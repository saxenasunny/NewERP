# ADR 0004 — Authentication, invitations, and session lifecycle

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Phase 3 must make every protected page and endpoint depend on a real,
server-validated session, while preserving the tenancy rules in ADR 0002. The
specification requires sign-in, sign-out, password reset with a development mail
sink, invitations, account deactivation, session expiry, rate limiting on
sensitive endpoints, and audit events.

The product is institution-scoped: a user is global, but access comes from a
membership and role assignments inside one tenant. Two decisions are therefore
load-bearing:

1. **Accounts cannot be self-service.** Public sign-up would create users with
   no institution membership, bypassing the only path that grants roles.
2. **Revocation must be immediate.** Deactivation and password reset cannot wait
   for a token or cookie cache to expire.

## Decision

### Library and session storage

- **Better Auth 1.7** with its Prisma adapter, mounted at `/api/auth/[...all]`.
  It was preferred to a hand-written credential stack because password hashing,
  reset tokens, and CSRF/origin handling are security-critical and benefit from
  an audited implementation.
- **Database sessions, not JWTs.** Rows in `sessions` are the source of truth, so
  a session can be revoked server-side. Cookie cache is **disabled**; every
  request validates the session against PostgreSQL.
- Session lifetime is **8 hours**, refreshed at most every **30 minutes** while
  the user is active (`SESSION_TTL_SECONDS`, `SESSION_UPDATE_AGE_SECONDS`).
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when the app base URL is
  HTTPS.

### Account creation is invitation-only

- `emailAndPassword.disableSignUp` is `true`. `POST /api/auth/sign-up/email` is
  refused; there is no UI for it.
- The only paths that create a user are accepting an invitation (which creates
  the user, the membership, and the role assignment in one transaction) and the
  development seed.
- Invitation tokens are 32 random bytes, base64url-encoded, delivered in the
  message, and stored **only as a SHA-256 hash** (`invitations.token_hash`). They
  expire after **7 days**, are invalidated when revoked or superseded by a new
  invitation for the same address, and are consumed inside the acceptance
  transaction so two concurrent acceptances cannot both succeed.

### Account status is server-owned

- `users.status` (`ACTIVE`/`INACTIVE`/`SUSPENDED`) is declared to Better Auth as
  an additional field with `input: false`, so a client request cannot set it.
- A `session.create.before` hook refuses to create a session for a user that is
  not `ACTIVE`, which covers sign-in after deactivation even before sessions are
  revoked. `session.create.after` writes an `auth.session_created` audit event;
  an audit failure is logged but does not block a legitimate sign-in.
- Deactivation revokes all of the user's sessions in the same transaction as the
  status change and the audit event.

### Password reset

- Reset links are issued by Better Auth
  (`/api/auth/reset-password/<token>?callbackURL=/reset-password`), valid for
  **30 minutes**, single use, and revoke every existing session when redeemed.
- The reset form re-validates length (minimum 12 characters) and confirmation on
  the client, but the authoritative rules live in the Better Auth configuration.
- Unknown addresses receive the same response as known ones and produce no mail
  row: the endpoint is not an account-enumeration oracle.

### Rate limiting

Two limiters, deliberately separate:

- **Better Auth's built-in limiter** (in-memory, per process) guards its own HTTP
  endpoints: 5 sign-ins/minute, 3 reset requests/minute, 5 reset submissions/
  minute, 60 requests/minute overall. Verified over HTTP with `curl`.
- **`lib/rate-limit.ts`** is a PostgreSQL-backed fixed-window counter used by our
  own Server Actions (for example invitation acceptance), where several app
  instances must share the count. It increments with one atomic
  `INSERT … ON CONFLICT … RETURNING` statement and throws a mapped 429.

The in-memory limiter is per instance. A multi-instance deployment needs a shared
store (Better Auth's `secondaryStorage`); until then, the database limiter is the
one that holds cluster-wide.

### Email

- `lib/mail/send.ts` writes every message to `email_messages`; development marks
  it sent and `/dev/mail` renders the body so a single-use link can be followed
  without a mail server.
- **No production provider is configured.** Outside development the row is
  marked `unconfigured` with an error and nothing is delivered. The UI says so;
  this must not be presented as working email.

### Tenant selection

- The active institution is kept in an `HttpOnly` cookie
  (`lms_active_institution`) and is validated against the session user's active
  memberships on every read. The cookie is a preference, never an authorization
  grant: an unknown or foreign tenant ID resolves to no tenant, and pages that
  need one redirect to `/select-institution`.

## Consequences

- Every page under `app/(app)` and every endpoint that returns tenant data
  depends on `getAccountContext()`, so isolation tests can exercise the same
  assembly the UI uses.
- A deactivated user is locked out immediately, including in other browsers, at
  the cost of one database read per request. Acceptable at this scale; measure
  before adding a cache, and key any cache by session ID.
- Accounts cannot be provisioned except through an invitation or the seed. Bulk
  imports (Phase 4) must extend this deliberately rather than re-enabling sign-up.
- Better Auth's HTTP rate limiter does not cover Server Actions, and the database
  limiter does not cover Better Auth's endpoints. Both must be considered when a
  new sensitive entry point is added.
- Production email remains unconfigured and is labelled as such in the README and
  the implementation ledger until an adapter is tested.
