# ADR 0001 — Stack and application architecture

- **Status:** Accepted (auth choice to be re-validated in Phase 3)
- **Date:** 2026-10-29

## Context

The repository started empty apart from the build specification. The LMS must be
delivered by a small team/agent incrementally, with server-enforced permissions,
tenant isolation, migrations, and tests. The specification recommends a
conventional TypeScript stack and a modular monolith, and explicitly allows a
different provider/stack when documented.

## Decision

| Concern           | Choice                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Language          | TypeScript, `strict` plus `noUncheckedIndexedAccess`                                                         |
| Framework         | Next.js 16 App Router (Server Components, Server Actions, Route Handlers under `/api/v1` for the public API) |
| UI                | React 19, Tailwind CSS v4, an in-repo accessible component layer built on design tokens                      |
| Database          | PostgreSQL 16 (17 compatible); local instance via Docker Compose                                             |
| ORM / migrations  | Prisma ORM 7 with the `@prisma/adapter-pg` driver adapter; `prisma migrate` for versioned SQL migrations     |
| Authentication    | Better Auth 1.x with database sessions, email/password, and its Prisma adapter                               |
| Validation        | Zod at every server boundary                                                                                 |
| Tests             | Vitest (unit + PostgreSQL-backed integration); Playwright for E2E in a later phase                           |
| Formatting/lint   | Prettier + ESLint (`eslint-config-next`), TypeScript typecheck                                               |
| Architecture      | Modular monolith: `app/` → `modules/<domain>` services → Prisma                                              |
| Deployment target | Node.js server (container-friendly). No serverless-only assumptions; no microservices                        |

### Why Better Auth

- Database-backed sessions are required: deactivating a user, changing a role, or
  resetting a password must invalidate existing sessions. Auth.js v5's
  Credentials provider is JWT-only, which would push session revocation and
  password-reset token handling into custom code.
- Better Auth owns password hashing, reset tokens, and session records, and ships
  rate limiting that can be pointed at a shared store. We still enforce all
  authorization ourselves against our tenant tables.
- It documents Next.js 16 and Prisma/PostgreSQL support. We will not use its
  Organization plugin as the source of truth: the LMS tenancy model (memberships,
  scoped role assignments, department/programme/course scopes) is domain data and
  lives in our own Prisma models.

**To validate in Phase 3:** the exact installed versions, the generated schema,
cookie settings, and cross-tenant denial tests. If integration fails, a
superseding ADR may choose an equivalent library; no hand-rolled password
hashing or session tokens will be introduced.

### Why Prisma

Prisma provides a reviewable schema, generated SQL migrations, typed queries, and
interactive transactions — the properties this project needs for auditable
academic data. It is a single choice across the codebase; no second query layer
is introduced. Decimal/numeric values are mapped to `Prisma.Decimal`.

## Consequences

- One deployable unit and one database; module boundaries are conventions enforced
  in review and tests, not network calls.
- Server Components are the default for reads; mutations are Server Actions for
  first-party UI and versioned Route Handlers for the public API. Both call the
  same services.
- Next.js upgrades are treated as deliberate changes: `next` is pinned.
- The public API surface is versioned under `/api/v1` and documented with
  OpenAPI in Phase 12.

## Deviations from the specification

- **Component system:** the specification suggests shadcn/ui. We use Tailwind v4
  with a small in-repo component layer (and headless primitives only where
  accessibility demands them) to avoid generated-code churn and to keep one
  explicit design-token source. Documented here as an accepted deviation.
- **Cache Components:** disabled. See ADR 0003.
- **Local database:** Docker Compose is the documented path. Development
  machines that cannot pull Docker Hub images may run any PostgreSQL 16+
  instance and set `DATABASE_URL`; the application does not depend on how the
  database is hosted.
