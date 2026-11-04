# Local development runbook

## Services and ports

| Service       | URL / port            | Started by          |
| ------------- | --------------------- | ------------------- |
| Next.js       | http://localhost:3000 | `npm run dev`       |
| PostgreSQL    | localhost:5432        | `npm run db:up`     |
| Prisma Studio | http://localhost:5555 | `npm run db:studio` |

The development credentials are non-secret placeholders defined in
`docker-compose.yml` and `.env.example`. They must not be reused anywhere else.

## First-time setup

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

Verify:

```bash
curl -s http://localhost:3000/api/health
```

A successful response looks like:

```json
{ "status": "ok", "service": "lms-platform", "requestId": "…", "timestamp": "…" }
```

Readiness (includes a database round-trip) is at
<http://localhost:3000/api/health/ready>. It returns `503` with
`"database":"down"` when PostgreSQL is unreachable.

## Signing in

Open <http://localhost:3000/sign-in> and use a seeded account, for example
`admin@northstar.example`. Demo accounts share the development-only password from
`SEED_DEMO_PASSWORD`, or `DemoPassword2026!` when it is unset.

There is no public sign-up. Additional accounts are created by an administrator
inviting an email address at `/admin/users`, then accepting the link.

No mail server is configured. Password-reset and invitation messages are captured
in the development outbox at <http://localhost:3000/dev/mail>, where the
single-use link can be opened. The page refuses to render in production.

Sign-in, reset requests, and reset submissions are rate limited per app instance
(5, 3, and 5 per minute). A 429 response is expected after repeated failures; wait
for the window to pass or restart `npm run dev`.

## Resetting the database

`npm run db:reset` drops and recreates the development database, replays all
migrations, and runs the seed explicitly. It is destructive and must not be
pointed at shared data. The seed is idempotent, so repeated runs do not duplicate
records.

## Test database

Integration tests use `TEST_DATABASE_URL` when set, otherwise `DATABASE_URL`. They
create and clean data in a dedicated schema/database and are skipped with a clear
message when no database is reachable, rather than silently passing.

Recommended setup for a separate test database:

```bash
docker compose exec db createdb -U lms lms_test
```

Then set in `.env.local`:

```
TEST_DATABASE_URL="postgresql://lms:lms_dev_password@localhost:5432/lms_test?schema=public"
```

Create it, then apply migrations once (replace the URL with your own):

```bash
DATABASE_URL="postgresql://lms:lms_dev_password@localhost:5432/lms_test?schema=public" \
  npx prisma migrate deploy
```

`npm test` then runs the integration suite against `lms_test`. The suite truncates
its tables between tests, which is why non-`_test` database names are rejected.

## Troubleshooting

**`npm run db:up` fails pulling the image.** Docker Hub downloads can fail on
restricted networks. Use any local PostgreSQL 16+ instance and point
`DATABASE_URL` at it; the app does not care how the database is hosted.

**Port 5432 already in use.** Another PostgreSQL instance is running. Stop it, or
change the published port in `docker-compose.yml` and update `DATABASE_URL`.

**`Invalid or missing server environment variables: …`** Copy `.env.example` to
`.env.local` and fill every required value. The error lists variable names only —
values are never logged.

**Migration drift.** In development, `npm run db:reset` is the fastest recovery.
Never edit an applied migration that has shipped; add a new one.

**Prisma cannot connect.** Confirm the container is healthy with
`docker compose ps`, and that the database in `DATABASE_URL` exists.
