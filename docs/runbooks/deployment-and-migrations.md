# Deployment and migrations

## Environments

| Environment | Host / Platform | Database                     | Purpose                                      |
| ----------- | --------------- | ---------------------------- | -------------------------------------------- |
| Development | Localhost       | `lms_dev` (Docker Compose)   | Seeded fictional data, `npm run dev`.        |
| Test        | Localhost       | `lms_test` (Docker Compose)  | Integration tests; truncated per test.       |
| Production  | Vercel Serverless (`https://newerp-blue.vercel.app`) | Neon PostgreSQL Serverless (`ap-southeast-1`) | Live institution operations.                 |

## Production architecture (Vercel + Neon)

The application is deployed live in production:
- **Application Host**: Vercel Serverless Functions running Next.js 16 App Router, continuous deployment connected to the `main` branch of `https://github.com/saxenasunny/NewERP.git`.
- **Database**: Neon Serverless PostgreSQL with pgBouncer connection pooling (`ep-billowing-river-b33damwr-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb`). Neon supports 10,000+ pooled connections, resolving serverless connection spikes.
- **Background Cron Triggers**: Handled externally by **cron-job.org** hitting:
  - `/api/cron/notifications` (every 5 minutes) — processes pending notification deliveries.
  - `/api/cron/reminders` (every 15 minutes) — processes session and assignment deadline reminders.
  Both endpoints require HTTP header `Authorization: Bearer <CRON_SECRET>`.
- **Email & Onboarding**:
  - Live transactional email transport is wired via Resend's REST API (`RESEND_API_KEY`) in `lib/mail/send.ts`.
  - Under **Option 1 (Direct Invitation Links)**, when inviting a member in `/admin/users`, the single-use invitation URL is immediately surfaced on-screen with an "Open Link ↗" shortcut. This enables seamless, instantaneous onboarding of staff and students without requiring a custom domain.
  - Authenticated administrators can also review all system emails and generated invitation links in the outbox at `/dev/mail`.

## Clean deploy and initialization

From a clean checkout, with a target production database:

```bash
# 1. Apply all committed Prisma migrations (all 16 migrations)
npx prisma migrate deploy

# 2. Run fresh production initialization (NO demo data)
# Synchronizes permissions, creates system roles, creates 'Main Institution', and provisions the admin user.
npx tsx scripts/init-production.ts
```

For local or test verification, the development seed can still be used:

```bash
createdb lms_clean_test
DATABASE_URL="postgresql://…/lms_clean_test" npx prisma migrate deploy
DATABASE_URL="postgresql://…/lms_clean_test" npm run db:seed   # development only
```

Then check `/api/health/ready`, sign in, and open a course, a quiz, the gradebook,
and a certificate. The recorded run is in `docs/IMPLEMENTATION_STATUS.md`.

## Required configuration

Every variable is documented in `.env.example`. Required for production:

- `APP_BASE_URL` — Canonical application URL (e.g. `https://newerp-blue.vercel.app`).
- `DATABASE_URL` — PostgreSQL connection string (Neon pooled URL with `sslmode=require`).
- `AUTH_SECRET` — High-entropy secret (>=32 characters) for Better Auth session signing and tokens.
- `CRON_SECRET` — Secret token for authorizing background cron runners via bearer token.
- `RESEND_API_KEY` — API key from Resend for transactional email delivery.
- `EMAIL_FROM` — Sender label (defaults to `onboarding@resend.dev` or custom domain sender).
- `STORAGE_DRIVER` plus `OBJECT_STORAGE_*` values — Object storage credentials (S3/Cloudflare R2) for persistent course content and submissions in serverless deployments.
- `WEBHOOK_<PROVIDER>_SECRET` — HMAC secret per inbound webhook provider.

## Migration rules

1. Migrations are **forward-only**. Prisma has no down migrations, and a hand-written
   down script that has never been rehearsed is more dangerous than a restore.
2. Never edit an applied migration. Add a new one.
3. Every migration must be additive or backwards-compatible for one release:
   add columns as nullable or with defaults, backfill in a separate step, and drop
   in a later release. This keeps the previous application version working during a
   rolling deploy.
4. `prisma migrate deploy` runs in the release step, before the new process takes
   traffic, with a database backup taken immediately beforehand.
5. Check the result with `npx prisma migrate status`.

## Rollback

**Application rollback** — redeploy the previous build. Because migrations are
backwards-compatible for one release, the old code keeps working against the new
schema. This is the first response to a bad release.

**Schema rollback** — there is no automated down migration. If a migration must be
undone, restore the pre-deploy backup into a new database, verify it, and point the
application at it. Data written after the backup is lost; state that window in the
incident log. Do not hand-edit production tables to "undo" a migration.

## Release checklist

- [ ] `npm run verify` passes (format, lint, typecheck, full test suite).
- [ ] `npm run build` passes.
- [ ] Backup taken and a restore drill has succeeded at least once this quarter.
- [ ] `npx prisma migrate deploy` output reviewed; `migrate status` clean.
- [ ] `/api/health` and `/api/health/ready` return 200; `/api/health/queue` shows no stuck messages.
- [ ] Sign in, open one course, one assignment, one quiz, the gradebook, and a certificate.
- [ ] `WEBHOOK_*` secrets set for every enabled provider.
- [ ] Object storage credentials set and one upload/download tested.
- [ ] Rollback plan and the person authorised to trigger it are named.
