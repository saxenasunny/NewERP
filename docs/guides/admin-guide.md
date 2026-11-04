# Administrator guide

You are an institution administrator: you configure the institution, its people,
its academic structure, and its course operations. You do not edit another
institution's records, and no screen anywhere accepts an institution id from the
browser.

## Set up an institution

1. **Academic years and terms** — `/admin/academics`. A year has dates and a
   status; terms must fall inside their year. Archive old years rather than
   deleting them, so historical offerings keep their context.
2. **Departments and programmes** — `/admin/academics/departments`. Departments may
   nest; programmes belong to a department and carry a level.
3. **Cohorts and sections** — `/admin/academics/cohorts`. A cohort is an intake of a
   programme in a year; sections are its class groups with an optional capacity.
4. **Course catalogue** — `/admin/courses`. Reusable codes, titles, credits. A
   catalogue course is not scheduled and has no learners.
5. **Course offerings** — `/admin/offerings`. Schedule a catalogue course into a
   term, optionally for one section, then assign instructors by email and manage
   the roster. Withdrawal keeps the enrolment record for audit; completion is a
   status, not a deletion.

## People and access

- `/admin/users` invites by email and role, shows pending invitations, and lets you
  revoke one. There is no public sign-up.
- On a member's page you can grant or remove roles, deactivate an account (which
  revokes its sessions immediately), and read that person's audit trail.
- The last active institution administrator cannot be deactivated. Promote someone
  else first.
- Roles are fixed definitions; a role's permissions are listed in
  `lib/permissions/catalogue.ts` and enforced server-side on every request.

## Imports

`/admin/imports` handles people, learner enrolments, and instructor assignments.
Preview validates every row and writes nothing to the academic tables; the report
names each bad row. Commit applies only valid rows in one transaction and is
idempotent by natural key, so re-uploading a corrected file updates instead of
duplicating. Download the template from the page.

## Courses, outcomes, and certificates

- Course content is authored by the assigned instructor. As an administrator you
  can open any offering and edit it; the audit trail records who did what.
- `/admin/obe` defines programme outcomes and the versioned attainment policy. Only
  one policy version is active at a time, and an active version cannot be edited.
- Certificates are issued from the course's **Certificates** screen by the teaching
  team. You can reissue or revoke with a written reason; both actions are audited,
  and revoked awards stay resolvable on their public verification page.

## Operations

- **Health**: `/api/health` (liveness), `/api/health/ready` (database),
  `/api/health/queue` (notification backlog counts).
- **API description**: `/api/v1/openapi`.
- **Backups**: follow `docs/runbooks/backup-and-restore.md`. A dump that has never
  been restored is not a backup.
- **Incidents**: follow `docs/runbooks/incident-response.md`.

## Things this build does not do

Email delivery has no provider configured outside development, certificate PDFs
are not generated, SSO is not implemented, and there is no leaderboard. Screens
say so rather than pretending. If you need one of these for a launch, it is a
development task, not a setting to switch on.
