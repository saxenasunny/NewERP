# LMS Platform

A multi-tenant Learning Management System for higher education, built as a
modular monolith: Next.js App Router, TypeScript, PostgreSQL, Prisma.

The product baseline is [`docs/LMS_BUILD_SPEC.md`](docs/LMS_BUILD_SPEC.md). Work is
delivered phase by phase; the current state is recorded in
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

> **Status: Phases 0–12 are implemented.** The LMS covers tenancy and roles,
> authentication and invitations, academic structure and CSV imports, course
> authoring and delivery, assignments and grading, quizzes, the gradebook, live
> sessions, attendance, calendar, communication, OBE mapping, certificates with
> public verification, and the integration and operations surface. Every screen
> reads and writes real database rows. Optional and deferred work is named in the
> implementation ledger rather than faked — notably attainment numbers (waiting on
> the institution's formula), certificate PDFs, SSO, badges and leaderboards, and
> email delivery outside development.

## Stack

| Concern       | Choice                                               |
| ------------- | ---------------------------------------------------- |
| App           | Next.js 16 (App Router), React 19, TypeScript strict |
| Styling       | Tailwind CSS v4 with central design tokens           |
| Database      | PostgreSQL 16+, Prisma ORM 7                         |
| Auth          | Better Auth 1.7 (database sessions, invitation-only) |
| Tests         | Vitest (unit + PostgreSQL integration)               |
| Local runtime | Node.js 20.9+ and Docker Compose                     |

Decisions and trade-offs: [`docs/decisions/`](docs/decisions/).

## Prerequisites

- Node.js 20.9 or newer (developed on Node 24) and npm.
- Docker (for the local PostgreSQL container), or any reachable PostgreSQL 16+
  server.

## Quick start

```bash
npm install
cp .env.example .env.local     # development placeholders only
npm run db:up                  # PostgreSQL on localhost:5432
npm run db:migrate             # apply migrations
npm run db:seed                # fictional demo data
npm run dev                    # http://localhost:3000
```

Check the app is alive and its database is reachable:

- <http://localhost:3000/api/health> — liveness
- <http://localhost:3000/api/health/ready> — readiness (503 when PostgreSQL is down)
- <http://localhost:3000/api/health/queue> — notification queue depth (`due`, `stuck`, 24-hour volume)
- <http://localhost:3000/api/v1/openapi> — the OpenAPI 3.1 description of the HTTP API

If you cannot use Docker, start any PostgreSQL 16+ instance, create the role and
database described in `.env.example`, and set `DATABASE_URL` accordingly.

## Commands

| Command                    | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `npm run dev`              | Development server                              |
| `npm run build`            | Production build                                |
| `npm start`                | Serve the production build                      |
| `npm run lint`             | ESLint                                          |
| `npm run typecheck`        | `tsc --noEmit`                                  |
| `npm test`                 | Unit and integration tests (Vitest)             |
| `npm run format:check`     | Prettier check                                  |
| `npm run format`           | Prettier write                                  |
| `npm run verify`           | Format check + lint + typecheck + tests         |
| `npm run db:up`            | Start local PostgreSQL                          |
| `npm run db:down`          | Stop local PostgreSQL                           |
| `npm run db:migrate`       | Create/apply a development migration            |
| `npm run db:deploy`        | Apply committed migrations (staging/production) |
| `npm run db:seed`          | Load fictional demo data                        |
| `npm run db:reset`         | Drop, recreate, migrate, and seed the dev DB    |
| `npm run db:generate`      | Regenerate the Prisma client                    |
| `npm run db:studio`        | Prisma Studio                                   |
| `npm run test:integration` | Only the PostgreSQL-backed tests                |

Integration tests require a PostgreSQL database. They read `TEST_DATABASE_URL`,
falling back to `DATABASE_URL`, and refuse to run against a database whose name
does not end in `_test`, so a developer's data cannot be wiped by accident. When
no test database is configured, the integration suite is skipped with a warning
instead of silently passing.

## Seeded demo data (fictional)

`npm run db:seed` is idempotent and creates:

| Institution          | Slug        | People (all `.example` emails)                |
| -------------------- | ----------- | --------------------------------------------- |
| Northstar University | `northstar` | `admin@`, `faculty@`, `student@` — fictional  |
| Riverbend College    | `riverbend` | `admin@`, `student@` — fictional              |
| Platform             | —           | `platform@lms.example` — platform super admin |

Demo accounts share one **development-only** password: `SEED_DEMO_PASSWORD` when
set, otherwise `DemoPassword2026!`. Sign in at
<http://localhost:3000/sign-in> with, for example,
`admin@northstar.example`. The seed refuses to run in production and never
overwrites an existing password. Never replace this fixture with real learner
data, and never reuse the demo password outside development.

The seed also loads the academic structure both tenants need to exercise the app:

| Institution | Structure | Catalogue and delivery |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- || Northstar University | 2026/27 with two semesters; Computing and Business departments; BSc Computer Science and BBA programmes; one 2026 cohort and section A per programme | `CS101` and `BUS101`; three offerings (two published/sectioned, one draft in the next term without a section, to show catalogue ≠ offering); instructors and 5 enrolled learners |
| Riverbend College | 2026 with Term 1; Arts and Sciences department; Diploma in Liberal Arts; one cohort and section | `LIT101` and `ENG101`; one published offering with an instructor and one enrolled learner |

Course content is seeded as well: `CS101` has three modules (two published, one
draft) with rich-text lessons, a link, a video link, and a prerequisite chain;
`BUS101` is an unpublished course with draft content; Riverbend's `LIT101` has a
published module with a lesson and a reference link. The seed does not create
uploaded files, because those belong to a storage backend.

`CS101` also seeds one published assignment (`FizzBuzz practice`, file submission,
late work accepted, one resubmission, with a three-criterion rubric) and one draft
assignment that learners cannot see. No submissions or grades are seeded, so the
workflow starts from an empty queue.

Every academic row is upserted by its natural key, so `npm run db:seed` can be run
repeatedly without duplicating structure, offerings, or enrolments.

## Authentication

- Sign in at `/sign-in` with an institution email and password. **Public sign-up
  is disabled**: accounts are created by accepting an invitation from an
  institution administrator, or by the development seed.
- Sessions are database-backed, last 8 hours, and are revoked immediately on
  deactivation or password reset. There is no cookie cache.
- **Password reset**: use `/forgot-password`. Development has no mail server, so
  every message is captured in the outbox at `/dev/mail`; open the link there.
  Outside development the message is stored as undelivered and the UI does not
  claim it was sent.
- **Invitations**: an administrator invites an email address and role from
  `/admin/users`. The single-use link expires after 7 days, is stored only as a
  hash, and is shown in `/dev/mail` during development.
- **Rate limits**: 5 sign-in attempts/minute, 3 reset requests/minute, and 5 reset
  submissions/minute on the auth endpoints (per app instance), plus a
  PostgreSQL-backed counter for Server Actions that must hold across instances.
- Users who belong to more than one institution choose one at
  `/select-institution`; the choice is re-validated against their memberships on
  every request. Only the session determines the active institution, never the
  URL or request body.

## Academic setup and imports

Institution administrators configure the academic year at
<http://localhost:3000/admin/academics>:

1. **Academic years and terms** — a year has a name (for example `2026/27`), dates,
   and a status (`planned`, `active`, `archived`). Terms must fall inside their year;
   the rule is enforced by the service, not only by the form. Archive a year rather
   than deleting it, so historical offerings keep their context.
2. **Departments and programmes** — departments may nest under a parent; programmes
   belong to a department and carry a level (certificate, diploma, bachelor, master).
3. **Cohorts and sections** — a cohort is an intake of a programme in a year; sections
   are the class groups inside it and carry an optional capacity. Active members can
   be added to a cohort.
4. **Course catalogue** (`/admin/courses`) — reusable course codes, titles, credits,
   descriptions, and catalogue status. Nothing here belongs to a term.
5. **Course offerings** (`/admin/offerings`) — schedule a catalogue course into a
   term, optionally for one section, with its own dates and status. Instructors and
   enrolments attach to the offering, which is why the same course can run in two
   terms without sharing a roster. The offering screen assigns instructors by email
   (primary, co-instructor, teaching assistant) and manages the roster: enrol by
   institutional email, then withdraw or complete. Withdrawal keeps the record for
   audit.

**CSV imports** (`/admin/imports`) cover people, learner enrolments, and instructor
assignments:

- Upload a `.csv` (2 MB, 2000 rows) or paste the text. Templates are downloadable
  from the page.
- **Preview writes nothing to the academic tables.** Every row is validated and
  stored with a status and a message: invalid email, unknown or wrong role, duplicate
  email or institutional ID inside the file, an institutional ID owned by someone
  else, a deactivated account, an unknown course/term/section, a missing offering,
  or a capacity overrun.
- Commit applies only the valid rows, in one transaction, and reports
  `created / updated / already present / failed`.
- Re-running the same file updates existing records by natural key (email,
  institutional ID, offering + person) instead of creating duplicates, and a committed
  job cannot be committed again.
- Import history keeps the file name, counts, status, and the per-row report;
  **Download report (CSV)** re-exports it for the user who needs to fix a spreadsheet.

Institutional IDs are stored as text on the membership, unique per institution, so
leading zeros and letters survive a round trip through Excel.

## Course content and delivery

**Teaching** — open <http://localhost:3000/faculty/courses> (or **My courses** in
navigation) to see the offerings you are assigned to; administrators see all
offerings in the institution.

1. Add modules, then add lessons or resources inside them: rich text, an uploaded
   file (25 MB maximum), an external link, or a video link.
2. Each module and each item is a **draft** or **published**, and an item can have
   an opening and closing time.
3. Prerequisites are module-level: a module stays locked until every selected
   prerequisite module is complete. Loops are rejected server-side.
4. **Move up / Move down** changes the saved order; refresh to confirm.
5. **Publish course** requires `content.publish` and releases the offering, every
   module, and every item in one transaction. **Unpublish course** hides it again
   without deleting anything.
6. **Preview as learner** shows drafts and future lessons as a teacher sees them,
   without recording progress.
7. An empty course can copy content from another course you manage. Modules,
   items, prerequisites, and file bytes are copied; **enrolments, instructors, and
   learner progress never are**.

**Learning** — <http://localhost:3000/student/courses> lists published courses you
are actively enrolled in. A lesson opens only when the course is published, the
lesson is published, it is inside its availability window, and its module is
unlocked. Everything else is listed as `opens later`, `closed`, or `locked` and
its content is never sent to the browser. **Mark complete** records progress and
a learning event; completing every lesson in a module unlocks the next one.

**Files** — uploads go to private storage and are served only by
`/api/v1/content/<itemId>/file`, which re-checks the session, the institution, the
enrolment, publication, availability, and locks before reading bytes. Signed-out
requests get `401` and another institution's request gets `404`. See
[the storage runbook](docs/runbooks/object-storage.md).

## Assignments and grading

**Teaching** — open **Assignments** in navigation (or the Assignments link on a
course) to see every assignment in the courses you teach. Inside a course, create
an assignment with:

- a submission type — text answer, file upload, web link, or text and file;
- points possible and an optional due date, opening time, and close time;
- a **late policy** (accepted and flagged, or refused) and an optional
  **resubmission** allowance with a maximum number of attempts.

Assignments start as **drafts** and are invisible to learners until published.
The assignment screen has the grading queue: open a learner to read their work and
attachments, enter a score and feedback, score rubric criteria, and save. Saving
keeps the grade in **draft**; **Release this grade** (or **Release all scored
grades**) makes it visible and writes a notification to the development outbox.
Changing a released grade requires `grades.update` and a reason; every save and
release is recorded in the grade history shown with the submission. An assignment
can be archived instead of deleted once it has submissions.

**Learning** — <http://localhost:3000/student/assignments> lists every published
assignment in your enrolled courses with its status (`to do`, `submitted`,
`submitted late`, `graded`, `closed`). Open one to read the brief, **Save draft**
without submitting, then **Submit for grading**; the receipt shows the time,
attempt number, and late flag. A second identical submit returns the same receipt
rather than a duplicate. Released feedback, the score, and rubric comments appear
below the form; unreleased marks are never sent to the browser.

Submission files go through the same private storage adapter as course material
and are downloaded only from `/api/v1/submissions/<fileId>/file`, which allows the
owner and staff on that offering and treats another institution's file as `404`.

## Repository layout

```
app/            routes, layouts, Server Actions, /api/v1 handlers, health probes
components/     shared accessible UI (design system)
modules/        domain services (one directory per bounded context)
lib/            env, db, permissions, tenancy, audit, observability
prisma/         schema.prisma, migrations, idempotent seed
tests/          unit/, integration/, fixtures/
docs/           architecture/, decisions/, runbooks/, implementation ledger
```

## Security model (summary)

- Tenant-scoped access on every query; IDs from other tenants return 404.
- Central permission catalogue (`lib/permissions/catalogue.ts`) checked on the
  server, plus per-resource scope checks. Hiding a button is never the control.
- Actor resolution requires an active user, membership, and tenant; users in
  several institutions must select one explicitly. Platform roles do not grant
  access to tenant learning data.
- Session and tenant context come from the authenticated session, never from the
  request body. Deactivation and password reset revoke sessions immediately.
- Credentials and secrets live in environment variables; `.env.local` is
  gitignored and `.env.example` contains placeholders only.
- Audit events for sensitive actions are written in the same transaction as the
  change.
- Requests carry a validated request ID through structured logs and API errors.

See [`docs/architecture/overview.md`](docs/architecture/overview.md),
[ADR 0002](docs/decisions/0002-tenant-isolation-and-authorization.md), and
[ADR 0004](docs/decisions/0004-authentication-and-session-lifecycle.md).

## Integration status

External services are unconfigured and clearly labelled as such; the app does not
pretend they work.

| Integration        | State              | Notes                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email delivery     | Not configured     | Messages are captured in `email_messages` and shown at `/dev/mail` in development. Production has **no provider**: nothing is delivered and the row is marked with an error.                                                                                                                          |
| Object storage     | Local / unverified | Development writes to `.data/storage` through a local adapter (tested). An S3-compatible adapter exists but has **not** been verified against a real bucket; uploads fail closed with `503` when credentials are absent. See [the storage runbook](docs/runbooks/object-storage.md).                  |
| Video conferencing | External link only | Sessions store a meeting URL; no provider API is integrated.                                                                                                                                                                                                                                          |
| Inbound webhooks   | Implemented        | `POST /api/v1/webhooks/<provider>` verifies an HMAC-SHA256 signature over `timestamp.body`, rejects clock skew beyond 300 seconds, and stores each `(provider, event id)` once. Secrets come from `WEBHOOK_<PROVIDER>_SECRET`. No business handler exists yet, so verified events wait as `received`. |
| SIS/ERP, SSO       | Not implemented    | No provider configuration is available; SSO is deliberately not stubbed.                                                                                                                                                                                                                              |
| Error reporting    | Not configured     | Structured JSON logs with request IDs only; no third-party reporter.                                                                                                                                                                                                                                  |

## Documentation

- [Implementation ledger](docs/IMPLEMENTATION_STATUS.md)
- [Architecture overview](docs/architecture/overview.md)
- [Decisions (ADRs)](docs/decisions/)
- [Administrator guide](docs/guides/admin-guide.md)
- [Faculty guide](docs/guides/faculty-guide.md)
- [Student guide](docs/guides/student-guide.md)
- [Local development runbook](docs/runbooks/local-development.md)
- [Deployment and migrations](docs/runbooks/deployment-and-migrations.md)
- [Backup and restore](docs/runbooks/backup-and-restore.md)
- [Incident response](docs/runbooks/incident-response.md)
- [Object storage runbook](docs/runbooks/object-storage.md)
- [Build specification](docs/LMS_BUILD_SPEC.md)
