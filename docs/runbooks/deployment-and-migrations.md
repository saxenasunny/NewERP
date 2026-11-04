# Deployment and migrations

## Environments

| Environment | Database           | Purpose                                      |
| ----------- | ------------------ | -------------------------------------------- |
| Development | `lms_dev`          | Seeded fictional data, `npm run dev`.        |
| Test        | `lms_test`         | Integration tests; truncated per test.       |
| Staging     | separate database  | Production-like verification before release. |
| Production  | managed PostgreSQL | Live institution data.                       |

No staging or production host is configured in this repository. The application
is a standard Next.js server (`npm run build` then `npm start`) with a PostgreSQL
connection string, so any Node 20.9+ host with a reachable PostgreSQL 16+ instance
can run it. **A staging deployment has not been performed**; what is verified here
is a clean database build from the committed migrations, which is the part of the
deploy that usually fails.

## Clean deploy (verified)

From a clean checkout, with an empty database:

```bash
npm ci
npx prisma migrate deploy        # applies every committed migration
npm run build
npm start
```

The seed is development-only and must not run in staging or production. Verify a
clean build with the same commands against a scratch database:

```bash
createdb lms_clean_test
DATABASE_URL="postgresql://…/lms_clean_test" npx prisma migrate deploy
DATABASE_URL="postgresql://…/lms_clean_test" npm run db:seed   # development only
```

Then check `/api/health/ready`, sign in, and open a course, a quiz, the gradebook,
and a certificate. The recorded run is in `docs/IMPLEMENTATION_STATUS.md`.

Recorded on 2026-11-04 against an empty `lms_clean_test`: `prisma migrate deploy`
applied all 15 committed migrations, the tables were created (70 application tables
excluding `_prisma_migrations`), and the development seed populated 2 tenants,
12 users, 4 offerings, 6 enrolments, and 1 certificate. The scratch database was
dropped afterwards. The seed count is lower than the development database's because
`lms_dev` also holds data added by hand during verification.

## Required configuration

Every variable is documented in `.env.example`. Names only:

- `APP_BASE_URL`, `DATABASE_URL`, `AUTH_SECRET` — required.
- `EMAIL_FROM` — optional sender label; email delivery itself is unconfigured.
- `STORAGE_DRIVER` plus the `OBJECT_STORAGE_*` values — required for uploads in
  production; the S3 adapter is installed but not verified against a real bucket.
- `WEBHOOK_<PROVIDER>_SECRET` — one per inbound webhook provider, at least 16
  characters. An unconfigured provider is refused with `503`.
- `SEED_DEMO_PASSWORD` — development seed only; never set in production.

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
