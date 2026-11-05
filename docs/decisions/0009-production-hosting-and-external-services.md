# ADR 0009 — Production hosting, serverless runtime, and external services

- **Status:** accepted
- **Date:** 2026-11-05
- **Phase:** Production Launch

## Context

Following the completion of core LMS application phases (tenancy, RBAC, authentication,
academic structure, course content, assignments, quizzes, gradebook, communication, and OBE),
the platform required deployment to a scalable, production-ready environment without
ongoing infrastructure management overhead.

Key production requirements:
1. **Serverless App Execution**: Zero server management, rapid autoscaling, and global CDN delivery.
2. **PostgreSQL Concurrency**: High-concurrency connection pooling resilient to serverless cold-start connection surges.
3. **Background Schedulers**: Reliable triggering of periodic queues (notifications every 5 min, reminders every 15 min) while operating on free/standard hosting tiers.
4. **Email & User Onboarding**: Immediate, friction-free onboarding of institution staff and students even when a verified custom DNS domain is not yet purchased or attached.

## Decisions

1. **Host on Vercel with Next.js 16 App Router.**
   The web application is deployed to Vercel connected directly to the GitHub repository
   `saxenasunny/NewERP`. Serverless dynamic execution is enforced for authentication and data routes
   via `export const dynamic = "force-dynamic"`, preventing build-time static evaluation of
   unconfigured runtime secrets.

2. **Database on Neon Serverless PostgreSQL with pgBouncer pooling.**
   We provisioned Neon PostgreSQL in `ap-southeast-1` using the pooled connection string
   (`-pooler.c-4.ap-southeast-1.aws.neon.tech`). Neon's connection pooler multiplexes over 10,000
   concurrent connections, preventing PostgreSQL `max_connections` exhaustion during high serverless concurrency.
   The application communicates via the committed `@prisma/adapter-pg` driver.

3. **Background Cron orchestration via cron-job.org.**
   Vercel Hobby plan restricts built-in cron jobs to daily frequencies (`@daily`), whereas notification
   dispatch requires 5-minute intervals and reminders require 15-minute intervals. Rather than incurring
   fixed server costs or managed Redis dependencies, we established external HTTP webhook cron jobs on
   **cron-job.org** calling:
   - `/api/cron/notifications` (every 5 min)
   - `/api/cron/reminders` (every 15 min)
   Each endpoint is secured with a shared `CRON_SECRET` verified via the `Authorization: Bearer <secret>` header.

4. **Transactional Email via Resend REST API with on-screen direct link fallback (Option 1).**
   - We integrated Resend's native REST API (`https://api.resend.com/emails`) in `lib/mail/send.ts`,
     authenticated with `RESEND_API_KEY`.
   - Without a custom domain, outbound emails sent from `onboarding@resend.dev` are restricted to the
     registered account owner (`saxena.sunny85@gmail.com`). To eliminate onboarding friction, we implemented
     **Option 1**: when an administrator invites a user, the system returns and displays the single-use
     invitation link directly on-screen in the Admin UI with 1-click clipboard copy and an "Open Link ↗"
     shortcut. The pending invitations table provides a "Resend / Get Link" action.
   - The `/dev/mail` outbox is unlocked for authenticated institution administrators in production,
     providing a full operational audit log of outgoing communication tokens.

5. **Better Auth origin validation for serverless subdomains.**
   Better Auth requires origin validation for all sign-in and session requests. We configured `trustedOrigins`
   to include the wildcard `"https://*.vercel.app"` alongside `APP_BASE_URL` and `process.env.VERCEL_URL`
   to ensure seamless authentication across both production domains and ephemeral Vercel preview environments.

## Consequences

- **Operational simplicity**: The entire production platform runs serverless on free/standard tiers with zero VM management, zero OS maintenance, and zero patching overhead.
- **Connection stability**: Neon's pooler safely handles traffic spikes without database connection exhaustion.
- **Immediate onboarding**: Institution administrators can onboard faculty and students immediately across any messaging channel (email, chat, WhatsApp, SMS) using direct single-use links without waiting for DNS purchases or propagation.
- **Ephemeral filesystem consideration**: Serverless execution environments have ephemeral local filesystems. Persistent file attachments (course documents, assignment uploads) require configuring an S3-compatible bucket (e.g. Cloudflare R2 or AWS S3) via `STORAGE_DRIVER=s3` as the next operational enhancement.
