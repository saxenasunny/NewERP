# Implementation Status

Last updated: 2026-11-04

Source of truth: [`docs/LMS_BUILD_SPEC.md`](LMS_BUILD_SPEC.md). This ledger follows
the reporting format in section 17.1 of the specification.

## Current phase

**Phase 7 — quiz engine and question bank: complete and verified.**

Phase 7 had been written against a stale Prisma client and an invented model
shape (lower-case enum members, `opensAt`/`questionRefs`/`courseOfferingId`).
It is now aligned to the committed schema: the client is regenerated, the
migration is applied to both databases, and the services use the real columns
and Prisma enum members. A three-test integration suite exercises the phase.

**Phase 8 — gradebook and reporting foundations: complete and verified.**

The calculation service is documented and unit-tested
([`GRADEBOOK_RULES.md`](GRADEBOOK_RULES.md)). Grading schemes, weights, and
excusals persist with an audit trail and are computed on read, so a scheme change
recalculates every learner without rewriting a mark. The faculty gradebook offers
server-side learner search and paging, scheme and excusal controls, an
offering-level release preview with a confirming batch release, and a
permission-checked CSV export that always covers the whole cohort; learners see
their own released results. Faculty, student, and admin dashboards read real
database rows.

Phase 8 acceptance checks (from the specification):

| Criterion                                                  | State | Evidence                                                                                                                                                                                  |
| ---------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard values reconcile with underlying records         | Met   | `tests/integration/gradebook.test.ts` rebuilds each learner's total from stored grades and quiz attempts and matches the computed result; the dashboards read the same tables             |
| Calculation rules are documented and unit-tested           | Met   | [`GRADEBOOK_RULES.md`](GRADEBOOK_RULES.md); `tests/unit/gradebook-calculation.test.ts` (17 tests) covers weighting, rounding, clamping, excused work, missing vs zero, and ungraded cells |
| Exports are permission-checked and have clear column heads | Met   | `/faculty/courses/[offeringId]/gradebook/export` requires `grades.read` plus access to the offering and writes a header naming every column, its kind, and its points                     |
| Reports distinguish missing values from zero               | Met   | A missing cell stays `missing` and a zero score stays `scored 0`; the CSV writes `Missing` vs `0`, and both a unit test and the integration suite pin the difference                      |
| Grades are previewed before a whole offering is released   | Met   | `getReleasePreview` counts ready marks and outstanding submissions per column; `releaseOfferingMarks` publishes only scored draft marks and requires the form's confirmation checkbox     |

**Phase 9 — live sessions, attendance, calendar, and communication: complete and verified.**

Done so far: the schema (`live_sessions`, `attendance_records`, their status
enums, and a `sessions.manage` permission for administrators and faculty);
scheduling with an external meeting link and a validated time window;
rescheduling and cancelling, each of which emails the enrolled cohort once per
learner; the staff schedule with per-session attendance tallies; the attendance
roster with an upsert mark that corrects the same row instead of duplicating it;
and the learner's own schedule, which shows only their own attendance.

Notifications are in place too: an in-app notification centre with an unread
badge, a row per recipient, and a dedupe key per logical event. A schedule change
writes its notification and its email from the same key, so replaying a delivery
job notifies nobody twice; `deliverSessionChangeNotifications` is the retry entry
point and returns `notified: 0` on a repeat.

The calendar and the to-do list are the same projection seen two ways. `/calendar`
renders a month grid and an agenda over three sources — scheduled live sessions,
published assignment due dates, and quiz closing times — and its scope comes from
the caller rather than the URL: staff with `sessions.manage` see the offerings
they teach (all of them for administrators), learners see their own enrolments,
and naming an offering outside that scope is a 404. Windows are validated and
capped at 62 days, and every entry deep-links to the session, assignment, or quiz
that owns it.

Reminders are two re-runnable jobs in `reminder-service.ts`: one for sessions
inside a lead window (default 60 minutes) and one for published assignments due
inside theirs (default 24 hours). Each recipient gets an in-app notification and
one email, keyed on the event and the lead so a second run inside the same window
sends nothing. `npm run jobs:reminders` runs both once and prints a summary, and
takes `--lead-minutes` for a catch-up run after downtime. Scheduling belongs to
the operator's cron; the runner is the whole scheduler surface in this build.

The demo seed now creates two CS101 sessions, one past and one upcoming, so the
calendar, the faculty schedule, and the attendance roster all have content.

Attendance now has a lock policy and reports. The policy lives in
`course_offering.settings.attendance` and defaults to 168 hours: attendance goes
read-only that long after a session ends, staff can freeze a session immediately
with **Lock attendance now**, and only an administrator
(`institution.settings.manage`) can reopen one. Every lock, reopen, and policy
change writes an audit event, and a reopen only lifts locks that were already in
force when it happened, so a later manual lock still holds.

`/faculty/courses/[offeringId]/attendance` reports attendance per learner over
delivered sessions only: cancelled and future sessions are excluded, missing
records stay visible as _unmarked_ instead of counting as absences, and the rate
is present-plus-late over recorded statuses with excused absences outside the
denominator. A class nobody marked therefore shows a null rate rather than a
mass absence. The same table downloads as CSV from `.../attendance/export`, and
every session in the report links to its roster. The policy rules are pure
functions in `modules/attendance/policy.ts`, shared by the service and the UI.

Course communication is in place in `modules/communication/`. Announcements
belong to an offering: staff draft, publish, edit, and withdraw them, and
learners see published rows only. Publishing notifies the enrolled cohort once
per learner in the app and by email, keyed on the announcement, so
`deliverAnnouncement` is the retry entry point and reports `notified: 0` on a
replay. Withdrawal is final — a withdrawn announcement can be neither edited nor
republished — and every draft, edit, publish, and withdrawal is audited with the
previous values, because learners may already have read the text.

Discussions are one board per offering with threads and replies. Staff and
enrolled learners may start a thread and reply while it is open; moderators
(`discussions.moderate` plus the offering in scope) can pin, lock, hide, and
restore. Moderation never deletes: a hidden thread or reply keeps its row, who
hid it, and when, so a decision can be reversed and the audit trail still points
at real content. Learners never see hidden threads or hidden replies and get a
404 for them, while staff keep them in place, badged. A reply notifies the
thread's author once, and a reply to your own thread does not notify you.

Direct messages are the fourth communication surface. A conversation lives inside
one offering: a learner may write to the teaching team, staff may write to the
active cohort and to each other, and nobody may write to themselves or to anyone
outside the class — an outsider gets a 404 rather than a permission error. The
contact list shows the last message and an unread count per person, and opening a
conversation marks the other side's messages read for that recipient only.
Messages are personal, so they notify in the app and never by email; the text
stays in `direct_messages` and is not copied into a mailbox or a queued payload.

**Notification settings** live at `/account/notifications`, one row per category
with an in-app and an email switch. A missing row means both channels are on, so
nobody has to configure anything to receive notices; the page offers a link from
`/account`. Saving writes the whole grid in one transaction and records
`notification.preferences_updated` with the previous choices.

Text now comes from **templates** in `modules/notifications/templates.ts`: one
definition per event renders the in-app title and body, the email subject, and the
email body, and validates its own payload with Zod. Six templates ship — session
reminder, session changed, assignment due, announcement published, discussion
reply, and message received — and every service call site uses them instead of
building strings in place.

Email is now a **durable queue** rather than a best-effort send.
`modules/notifications/dispatch.ts` is the single entry point: it reads the
recipient's channel preferences, writes the in-app rows, enqueues one
`notification_deliveries` row per recipient keyed on the same dedupe key, and
attempts the queue immediately so a healthy transport still delivers inside the
request. A failure is recorded with its error and retried with exponential
backoff (5, 10, 20, 40 minutes), then left `failed` with a null next-attempt so an
operator can see exactly what never went out; a payload that no longer matches its
template is held as `skipped` instead of sending broken text.
`npm run jobs:notifications` drains whatever is due and prints counts of due and
stuck messages.

Phase 9 is complete: every task in the specification section is implemented and
verified. There is no outstanding work in this phase.

**Phase 10 — OBE and academic outcome attainment: complete, with attainment calculation deliberately deferred.**

A programme now carries PEOs, POs, and PSOs, each with a code, title, position,
and an active or archived status; a code cannot repeat within a programme. Each
offering defines its own course outcomes, so a CO belongs to the delivery rather
than the catalogue. Faculty correlate COs to POs and PSOs on the scale of the
active attainment policy: a PEO is refused as a target, an outcome from another
programme is a 404, a level outside the scale is a conflict, and an outsider
cannot reach the offering at all. The same screen ties each CO to the assignments
and quiz questions that supply evidence, with a weight per item, and lists every
coverage warning.

Attainment policies are versioned. A draft becomes active in one step, the
previous active version is archived, an active version can no longer be edited,
and a partial unique index allows only one active policy per institution.
`modules/obe/policy.ts` validates the stored configuration — correlation scale,
rounding, thresholds, and direct/indirect method status — and an institution with
no active policy reads the documented default scale of 1 to 3.

Attainment itself is **not computed**. The specification is explicit that direct
and indirect methods ship only after the institution confirms its formula, so both
methods stay `unconfigured`, the mapping screen says plainly that no attainment
number exists, and a missing mapping is a named warning rather than a zero.
`/faculty/courses/[offeringId]/outcomes/export` writes a reproducible CSV: the
offering, the active policy version and its scale, rounding, thresholds, method
status, every correlation, every piece of evidence, and the open warnings,
followed by the statement that no attainment value is reported. The same stored
rows and policy version always produce the same file.

Approved attainment snapshots stay deferred with the formula: there is nothing
meaningful to approve until a number exists, and a snapshot holding only mappings
would be an evidence export under a misleading name. The policy version in the
export is the anchor a future snapshot will cite.

Phase 10 acceptance checks (from the specification):

| Criterion                                                                      | State                                      | Evidence                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every reported attainment value is reproducible from inputs and policy version | Deferred — no attainment value is reported | `getCourseObeEvidence` rebuilds the export from stored rows and the active policy; `tests/integration/obe.test.ts` renders it under policy v1 and v2 and asserts the mappings are unchanged while the version changes       |
| Missing data is surfaced, not silently treated as zero                         | Met                                        | `coverageWarnings` names every uncovered CO, uncovered PO, unmapped published assignment, unmapped question, and the absent formula; the workspace, the page, and the export carry them, and a test watches a warning clear |
| Approved historical reports remain available after policy changes              | Not applicable yet                         | No approved report exists until a formula is confirmed. Activation archives the previous version instead of overwriting it, so a future snapshot can still cite the version it used                                         |
| The report explains the formula and mappings used                              | Met                                        | The export names the policy version, correlation scale with labels, rounding, thresholds, method status, and every mapping; the page states the same on screen                                                              |

**Phase 11 — certificates, completion rules, and public verification: complete for the required core; optional engagement features deferred.**

Completion is now a configured rule set, not an assumption. Each offering stores
its rules in `course_offering.settings.completion`: require every published
lesson, a percentage of published lessons, every published assignment, every
published quiz, and optionally a minimum released grade. The rules live in
`modules/certificates/completion.ts` as pure functions, shared by the service and
the screens. Only published material counts, a submission is enough regardless of
score, and unreleased grades are never guessed. Every unmet requirement becomes a
named gap, so a learner who is not eligible sees why rather than a silent zero.

`/faculty/courses/[offeringId]/certificates` edits the rules, lists every
enrolment with its lesson, assignment, quiz, and released-grade counters, and
offers **Issue**, **Reissue**, and **Revoke**. Issuance is idempotent: a learner
who already holds a current certificate gets the same one back, and a partial
unique index on `(course_offering_id, user_id) WHERE status = 'issued'` makes a
second live award impossible even under a race. A certificate snapshots the
learner, course, and institution names, the rules in force, and the facts they
were evaluated against — so a rename or a later rule change does not rewrite a
document already handed out.

Reissue replaces an award: the old row becomes `reissued`, a new number and token
are minted, and the audit event records the reason and the replaced id. Revocation
keeps the row and the reason but moves the public status to `revoked`; a revoked
award is never quietly reissued by pressing **Issue** again, because issuance
checks for any earlier award and refuses. Learners see their own awards, their
completion indicators, and the verification link at `/student/certificates`.

`/verify/[token]` is public, needs no session, and is `noindex`. It shows the
learner's name, the course, the issuer, the issue date, the certificate number,
and the status — nothing else. A revoked certificate keeps resolving and says so;
the revocation reason stays internal.
An unknown token renders the not-found page and reveals no award data. Because the
app shell streams before the database lookup completes, that response keeps HTTP 200
rather than 404, so verification relies on the page content, not the status code.

Certificate PDF generation, badges, learning paths, leaderboards, and
recommendations are not built. The specification makes badges, paths, and rankings
optional or later work, conditions recommendations on reliable analytics, and the
project has no PDF renderer; inventing a ranking surface would need a privacy
design first. What ships is the required core: configurable rules, one award per
completion, reissue and revocation with reasons and audit, reproducible snapshots,
and minimal public verification.

Phase 11 acceptance checks (from the specification):

| Criterion                                                                       | State | Evidence                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Certificates are issued once per eligible completion unless explicitly reissued | Met   | `issueCertificate` returns the existing live award (`created: false`), the partial unique index blocks a second live row, and a replaced or revoked award can only be replaced through `reissueCertificate`; the integration suite issues twice and counts one row |
| Revoked certificates show a controlled verification status                      | Met   | Revocation sets `revoked` with a reason and an audit event; `verifyCertificate` keeps returning the record with status `revoked` and the revocation date, while the reason never leaves the staff view                                                             |
| Optional engagement features do not block core learning                         | Met   | Completion rules are evaluated only when an award is considered; `getCourseView` still serves the course after rules demand 100% of lessons and a 90% grade, which the integration suite asserts                                                                   |

**Phase 12 — integrations, hardening, and production readiness: complete for everything that can run on this machine; staging deployment, SSO, error reporting, and a mail provider are not configured.**

The HTTP surface now documents itself. `/api/v1/openapi` serves an OpenAPI 3.1
document maintained by hand in `lib/api/openapi.ts` next to the handlers it
describes. It covers every implemented endpoint — identity, the people directory,
the two private file downloads, the webhook receiver, the health probes, and
the document itself — and states the tenant rule the API follows: no endpoint
accepts an institution id, the active institution comes from the session, and a
cross-tenant record is `NOT_FOUND` rather than `FORBIDDEN`.

Inbound integrations are real but narrowly scoped.
`POST /api/v1/webhooks/[provider]` reads the provider secret from
`WEBHOOK_<PROVIDER>_SECRET`, verifies a hex HMAC-SHA256 of
`${timestamp}.${rawBody}` against `x-webhook-signature`, rejects a timestamp more
than 300 seconds from server time, caps the body at 256 KB, and requires a JSON
object with a string `id` and `type`. A first delivery is stored in `webhook_events`
and answered `202 accepted`; a repeat of the same `(provider, external_id)` is
answered `200 duplicate` without a second row; a changed body or stale signature
is `401`, a malformed payload `400`, and a provider with no secret `503`. There is
deliberately no business handler: the row records what arrived and stops. Faking a
sync to an unnamed provider would be worse than a documented intake.

Responses carry security headers from `lib/security/headers.ts`, wired through
`next.config.ts`: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, a restrictive `Permissions-Policy`,
`Cross-Origin-Opener-Policy`, `X-Permitted-Cross-Domain-Policies`, and a CSP
subset (`frame-ancestors`, `base-uri`, `form-action`).
`Strict-Transport-Security` is added only in production. The subset is a choice,
not an oversight: a real `script-src` needs per-request nonces threaded through
the App Router, and shipping `unsafe-inline` to look strict would be theatre.

`/api/health/queue` gives operators the notification queue as counters — `due`,
`stuck`, and `sentLast24Hours` — and reports `degraded` once anything has
exhausted its attempts. It returns no recipient, subject, or payload, and is
`no-store` like every other operational response. When the database cannot be
read it answers `503` with `status: "unavailable"`.

Operations documentation exists rather than being promised:
[`docs/runbooks/backup-and-restore.md`](runbooks/backup-and-restore.md) with a
recorded drill, `deployment-and-migrations.md`, `incident-response.md`, and role
guides for administrators, faculty, and learners in `docs/guides/`. SSO is not
implemented: the specification allows it only with a provider's configuration and
none exists. Staging is not deployed: there is no host, so the clean-deploy drill
against an empty database is the evidence offered instead of a staging walkthrough.

Phase 12 acceptance checks (from the specification):

| Criterion                                            | State         | Evidence                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The implemented API is documented for integrators    | Met           | `/api/v1/openapi` returns 200 with an OpenAPI 3.1 document covering every implemented path, its parameters, its error shape, and the session cookie scheme                               |
| Inbound webhooks are authenticated and idempotent    | Met           | HMAC-SHA256 over the raw body with a 300-second window and a 256 KB cap; a duplicate `(provider, external_id)` is answered without a second row; the live curl run returned 202 then 200 |
| An unconfigured integration fails closed             | Met           | A provider with no `WEBHOOK_<PROVIDER>_SECRET` is refused with 503 before the body is trusted; a secret shorter than 16 characters is treated as unconfigured                            |
| Monitoring exposes no personal data                  | Met           | `/api/health/queue` returns four counters and `no-store`; the health routes never read tenant tables, and the queue route selects counts only                                            |
| Backups are restorable, not merely taken             | Met           | A 252,662-byte custom-format dump restored into `lms_restore_test` with identical tenant, user, offering, enrolment, and certificate counts, and the certificate kept its token          |
| A clean environment builds from committed migrations | Met           | `lms_clean_test` received all 15 migrations (70 application tables) and the development seed, without touching either existing database                                                  |
| Security headers are served                          | Met           | `/sign-in` returned nosniff, `X-Frame-Options: DENY`, the CSP subset, COOP, and the permissions policy; HSTS is production-only and untested here because there is no TLS host           |
| Operators and users have written guidance            | Met           | `docs/guides/{admin,faculty,student}-guide.md` and `docs/runbooks/incident-response.md`, each naming what the build does not do                                                          |
| Regression, dependency, and tenant-isolation checks  | Met           | Full suite 330 tests in 36 files; `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities; every integration test still runs under the tenant fixtures                      |
| SSO behind provider configuration                    | Not built     | No identity provider is configured, so credential sign-in remains the only method; the code contains no half-finished SSO path                                                           |
| Staging deployment                                   | Not performed | No staging host exists in this repository; the clean-deploy drill is the substitute, and the runbook says so plainly                                                                     |

**Phase 13 — QR attendance with anti-replay: one candidate from the specification's optional menu, built and verified.**

The specification lists Phase 13 as a menu of advanced candidates to start only after a
stable launch, not as a required scope. One candidate needs no external service and
no policy review, so it was built: QR attendance check-in for live sessions.

The faculty attendance page now opens a short-lived check-in code for one session
(1 to 120 minutes, default 10). The code is a signed token,
`v1.<payload>.<HMAC-SHA256>`, naming the session, a random nonce, and the expiry. The
signing key is derived from `AUTH_SECRET` under a `attendance-check-in:v1` label, so
there is no second secret to configure, leak, or forget to rotate.

A learner scans the QR code, lands on `/student/check-in/[token]` (private, `noindex`),
and presses **Check in now**. The page and the button both resolve the token through
the same checks: signature, expiry, the nonce stored on the session, the session's
state, the course attendance lock, and an active enrolment. Success writes one
`attendance_records` row with `source = qr` and status `present`, plus an
`attendance.checked_in` audit event.

Anti-replay is enforced in two independent places. Generating a new code (or closing
the old one) replaces the session nonce, so every previously captured token stops
working even though its signature remains valid. And `attendance_records` is still
unique on `(session, learner)`, so a second scan, a retried request, or two racing
requests produce one row; the second attempt is reported as already recorded. A scan
never rewrites an existing row, so a lecturer who marked a learner absent keeps that
mark and its note.

The code is rendered server-side as an SVG by the `qrcode` package. No attendance data
leaves the server, and no third-party QR service is called.

Phase 13 acceptance checks (self-authored — the specification defines no acceptance
criteria for this phase):

| Criterion                                                  | State | Evidence                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A check-in code is short-lived and staff-controlled        | Met   | Codes last 1–120 minutes; the expiry is both signed and stored; closing or regenerating a code invalidates the previous one, which the integration suite asserts by replaying the old token |
| Replay by the same learner never creates a second record   | Met   | The second scan returns `alreadyRecorded: true` and the table still holds one row; the unique `(session, learner)` index is the concurrency guarantee                                       |
| A scan cannot overwrite a staff decision                   | Met   | A learner marked absent with a note, who then scans, keeps `absent`, `staff`, and the note; asserted by test                                                                                |
| Expired, closed, cancelled, locked, and foreign codes fail | Met   | Each path has its own expected error and no write: expiry, rotation, closure, cancellation, attendance lock, another institution (404), and an unenrolled member (403)                      |
| The feature adds no new secret or external dependency      | Met   | The key is derived from `AUTH_SECRET`; QR rendering is a local server-side SVG; the only new package is the QR encoder                                                                      |

Phase 7 acceptance checks (from the specification):

| Criterion                                                         | State | Evidence                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Faculty can create a question bank and add questions of all types | Met   | `bank-service.ts` implements bank and question CRUD for every `QuestionType`; publishing writes an immutable `question_versions` row; UI at `/faculty/courses/[offeringId]/question-banks`; the seed creates a 5-question CS101 bank       |
| Faculty can assemble and publish a quiz                           | Met   | `quiz-service.ts` + `/faculty/courses/[offeringId]/quizzes`; publishing is refused while a referenced question is unpublished; the settings JSON holds time limit, attempt limit, pass mark, shuffle flags, and release policy             |
| Student can start and submit an attempt within the time limit     | Met   | `startAttempt` snapshots published question versions, sets `deadline_at`, and returns `AttemptView`; the deadline is re-checked on autosave and resume; integration test asserts a 30-minute deadline and a single attempt per learner     |
| Autosave preserves answers across reconnections                   | Met   | `autosave` writes `quiz_answers` rows without moving the deadline and is refused once it passes; the runner posts **Save progress** to `autosaveAttemptAction`; integration test re-reads every saved answer                               |
| Objective questions are auto-scored                               | Met   | `rules.ts` `scoreItem` scores single choice, true/false, fill-in-the-blank, and multi-select (exact match, optional partial credit and negative marking); integration test asserts 5 of 8 points before the essay is graded                |
| Essay questions enter a manual grading queue                      | Met   | `listUngradedEssays` returns attempts with unscored essay/short-answer items; `gradeEssayItem` writes score, feedback, and an audit event, and the attempt becomes `GRADED` once nothing is left unscored                                  |
| Results are hidden until faculty releases them                    | Met   | `getResultVisibility` derives `showResults` from the release policy and `releasedAt`; `AttemptView` omits the score while hidden; `releaseResults` requires `grades.publish`; integration test proves the score stays hidden until release |

Phase 6 acceptance checks (from the specification):

| Criterion                                                       | State | Evidence                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete instructor-to-student assignment workflow passes E2E   | Met   | Integration tests drive the whole path: an assigned instructor creates and publishes an assignment, a learner saves a draft, submits, the instructor grades with rubric scores and feedback, releases the grade, and the learner reads the released mark. A colleague, an unassigned member, and another institution are refused. |
| A retry does not create duplicate submissions                   | Met   | `assignment_submissions` is unique on (assignment, learner); submission is an upsert, and resubmitting identical work returns the stored receipt (`created: false`). Integration tests submit twice and assert one row with one attempt.                                                                                          |
| Unreleased grades are not visible to students                   | Met   | Grades are created as `draft`; the learner view and list return `grade: null` until `releasedAt` is set. Integration tests assert the grade is hidden before release and visible with score, percentage, feedback, and rubric scores afterwards.                                                                                  |
| Grade overrides require appropriate permission and audit reason | Met   | Changing a released grade requires `grades.update` plus a reason of at least three characters; a teaching assistant with `submissions.grade` is refused. Every save and release appends a `grade_change_events` row and an audit event, shown in the grading queue.                                                               |

Phase 5 acceptance checks (from the specification):

| Criterion                                                   | State | Evidence                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instructor can create and publish a course without DB edits | Met   | Browser run as an assigned teacher: added a rich-text lesson and a file item through the editor, pressed **Publish course**, and the offering plus every module and item moved to published. The same action is covered by an integration test; an unassigned faculty member with `content.create` is refused.   |
| Student sees only enrolled, published, available content    | Met   | Browser run: the student viewer listed 6 published lessons, hid the draft module and draft lessons entirely, showed future/closed lessons as non-openable, and rendered `locked` on the prerequisite module. Integration tests cover unpublished course (404), drafts, future windows, and locked modules.       |
| Content ordering persists                                   | Met   | Move up/down rewrites sibling positions in one transaction; an integration test reorders a module and an item, then re-reads the workspace and asserts the new order and positions. Browser run showed the seeded order and the editor's explicit move controls.                                                 |
| A copied course does not copy grades or submissions         | Met   | Copy copies modules, items, prerequisites, and file bytes only. An integration test asserts the target has zero enrolments and zero progress rows; assignments, grades, and submissions never leave their delivery; the copy path cannot see them.                                                               |
| File access is tenant-scoped and permission-checked         | Met   | Browser run: the enrolled learner downloaded `handbook.txt` (200, `attachment`, `private, no-store`); a signed-out request returned 401; the same URL from another institution returned 404. Integration tests cover bytes, staff access, unenrolled member (403), and cross-tenant (404), plus object deletion. |

Phase 4 acceptance checks (from the specification):

| Criterion                                               | State | Evidence                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin can configure a sample academic structure via UI  | Met   | Browser run on the seeded institution: created `2027/28`, saw a term outside the year rejected with a field-level message, then created a valid term and watched it persist; departments, programmes, cohorts, sections, catalogue, and offerings screens all read and write real rows. Integration tests cover every create/update path. |
| CSV errors are visible per row                          | Met   | Browser run with a five-row file: rows 2–6 reported `valid`, `invalid` (bad email), `invalid` (role), `invalid` (duplicate email on row 2), `invalid` (name length); the same report downloads as CSV. Unit tests cover the parser; integration tests assert the per-row messages.                                                        |
| Duplicate imports do not create uncontrolled duplicates | Met   | Committed the file (1 created), uploaded it again (0 created, 1 updated), and the People directory still shows one person. Committing a committed job is rejected with a conflict. Integration tests re-import users, enrolments, and instructor assignments.                                                                             |
| Course catalogue and course offering are distinct       | Met   | `Course` carries code/title/credits and no term; `CourseOffering` carries term, optional section, dates, and status, and owns instructors and enrolments. The seed schedules `CS101` in two terms; the UI and ADR 0005 state the split.                                                                                                   |

Phase 3 acceptance checks (from the specification), still covered by the suite: password
reset end to end with a capture sink, deactivated users blocked, role changes taking
effect server-side, and invalid/expired/reused tokens rejected.

## Completed

### Phase 0 — repository reconnaissance and decisions

- Inspected the workspace: empty except for the specification; no git repository,
  no existing code to preserve.
- Selected and documented the stack (ADR 0001), tenant/authorization model
  (ADR 0002), and rendering/caching policy (ADR 0003).
- Scaffolded Next.js 16 + React 19 + TypeScript strict (`noUncheckedIndexedAccess`)
  - Tailwind CSS v4 + ESLint + Prettier + Vitest 5.
- Added `lib/env.ts`: lazy, fail-closed validation of `APP_BASE_URL`,
  `DATABASE_URL`, `AUTH_SECRET`, `NODE_ENV`. Errors name variables, never values.
- Added `GET /api/health` (liveness, no-store).
- Added `docker-compose.yml` (PostgreSQL 16) and `.env.example` with placeholders
  only.
- Added scripts for dev/build/lint/typecheck/test/format/db lifecycle.
- Wrote README, architecture overview, local-development runbook, and ADR set.

### Phase 1 — application shell and design system

- Design tokens (colour, typography, radius, shadow, focus ring) in
  `app/globals.css`; light theme only, contrast-checked.
- Shared components: Button, StatusBadge, Alert, Breadcrumbs, PageHeader,
  EmptyState, Input/Textarea/Select/Field, Skeleton, native Dialog.
- Responsive app shell: skip link, desktop sidebar, mobile drawer, top bar with
  tenant/role context, and footer.
- Role-aware navigation configuration (`lib/navigation.ts`) for platform admin,
  institution admin, faculty, and student, with unimplemented modules explicitly
  excluded from links.
- Four clearly labelled role preview dashboards, a development-only design system
  page, loading/error/not-found states, and a project index page.
- 18 unit/component tests added (26 total at the end of the phase).

### Phase 2 — database foundation and tenant isolation

- PostgreSQL via Docker Compose; Prisma ORM 7.10 with the `@prisma/adapter-pg`
  driver adapter and a committed initial migration
  (`20261029141217_phase2_tenancy_rbac`).
- Schema: tenants, institutions, users, tenant memberships, roles, permissions,
  role-permission join, scoped role assignments, audit events. All timestamps are
  `timestamptz(3)` in UTC; foreign keys and tenant indexes are defined.
- Idempotent seed: two fictional institutions (Northstar University, Riverbend
  College), 31 permissions, five tenant roles plus one platform role, six
  fictional users with memberships and role assignments. Emails use `.example`.
- Central permission catalogue (`lib/permissions/catalogue.ts`) is the single
  source of truth for permission keys and role grants; the database is seeded from
  it.
- Actor resolution (`lib/tenancy/actor.ts`): requires an active user, active
  membership, and active tenant; requires explicit tenant selection for users in
  multiple institutions; derives permissions only from tenant-scoped roles.
  Platform roles grant no tenant-record access.
- Central checks (`lib/permissions/check.ts`) with deny-by-default semantics.
  Cross-tenant records are reported as not found (404).
- Tenancy service (`modules/tenancy/institution-service.ts`): tenant-scoped
  institution read/update with Zod validation, transactional write, and audit
  event; paginated member directory; permission enforcement.
- Request IDs (safe adoption/regeneration) propagated by `proxy.ts` and a
  structured JSON logger; dependency readiness endpoint.
- Integration test harness against a dedicated PostgreSQL `_test` database,
  refusing to run against non-test database names. 14 isolation tests plus 13
  supporting unit tests added (53 total).

### Phase 3 — authentication and user lifecycle

**Authentication** (ADR 0004)

- Better Auth 1.7 mounted at `/api/auth/[...all]`, using the Prisma adapter and
  **database sessions** (8-hour lifetime, 30-minute refresh, cookie cache
  disabled so revocation is immediate).
- Email/password sign-in with public sign-up **disabled**: accounts exist only
  through invitation acceptance or the seed.
- Account status (`ACTIVE`/`INACTIVE`/`SUSPENDED`) is a server-owned user field.
  A session-creation hook refuses non-active users and writes an
  `auth.session_created` audit event.
- `getAccountContext()` resolves the session, memberships, scoped roles, and
  permissions once per request; `requireAccountContext()` redirects anonymous
  visitors to `/sign-in`. Every page under `app/(app)` uses it.
- Active institution is kept in an HttpOnly cookie and re-validated against the
  user's active memberships on every request; users in several institutions are
  routed through `/select-institution`.

**Pages**

- `/sign-in` — credential sign-in with validation, pending, rate-limit, and
  generic failure states.
- `/forgot-password` and `/reset-password` — request and redeem a single-use
  link; identical response for unknown addresses.
- `/accept-invitation/[token]` — sets a name and password, then creates the
  user, membership, and role assignment in one transaction.
- `/select-institution` — explicit tenant choice for multi-institution users.
- `/account` — own profile (name, timezone, locale), institution access list,
  session expiry, and sign-out.
- `/admin/users` — paginated, searchable directory; invite by email and role;
  pending invitations with revoke; permission-gated (non-admins get a
  permission-denied panel).
- `/admin/users/[userId]` — member detail: roles (grant/remove), account status
  (deactivate with reason / reactivate), and that person's audit trail.
- `/dev/mail` — development-only outbox that renders captured messages and their
  single-use links; disabled in production.

**Services and rules**

- `modules/identity/invitation-service.ts`: invite, preview, accept, revoke.
  Tokens are 32 random bytes, stored as SHA-256 hashes, expire after 7 days,
  are superseded by a new invitation for the same address, and are consumed
  inside the acceptance transaction so a retry cannot create a second account.
- `modules/identity/user-service.ts`: paginated member listing (`users.read`
  required), role grant/removal with audit events, deactivation (revokes all
  sessions, keeps at least one active institution administrator), reactivation,
  and self-service profile update. Cross-tenant targets return 404.
- All mutating actions require a permission, validate with Zod, write the change
  and its audit event in one transaction, and revalidate affected paths.
- Better Auth limits sign-in (5/min), reset request (3/min), and reset
  submission (5/min); a PostgreSQL-backed limiter (`lib/rate-limit.ts`) covers
  our own Server Actions with an atomic counter.
- `POST` requests to Better Auth are origin-checked via `trustedOrigins`.

**API**

- `/api/v1/me` — the authenticated identity, session expiry, active institution,
  and roles; 401 without a session; `Cache-Control: private, no-store`.
- `/api/v1/users` — tenant-scoped directory with `q` and `limit`; 401 anonymous,
  403 without `users.read`, 409 when the user must choose an institution.

**Email**

- `lib/mail/send.ts` writes every message to `email_messages`. Development marks
  it sent and exposes it in `/dev/mail`; production has **no provider**, writes
  the row as `unconfigured` with an error, and logs the failure. The README and
  UI label this as unconfigured.

**Tests**

- `tests/integration/auth-lifecycle.test.ts` (14 tests): invitation
  create/accept/expiry/revocation/duplicates; credential sign-in; generic
  failure for unknown accounts; deactivation and reactivation; cross-tenant and
  self-target guards; role grant/removal idempotency; last-administrator guard;
  password reset through the outbox including session revocation and token
  reuse; unknown-address silence; invalid reset token; mapped 429 from the
  database limiter.
- `tests/integration/tenancy-isolation.test.ts` continues to cover tenant
  isolation through the real account-context assembly.

### Phase 4 — academic structure, catalogue, offerings, and imports

**Schema** (migration `20261030160000_phase4_academic_structure`)

- `academic_years`, `terms`, `departments`, `programmes`, `cohorts`, `sections`,
  `cohort_members`, `courses`, `course_offerings`, `course_instructors`,
  `enrolments`, `import_jobs`, `import_rows`, plus `institutional_id` on
  `tenant_memberships`.
- Every table carries `tenant_id` directly, with composite unique keys for the
  natural identifiers (year name, department/programme/course code, cohort name per
  programme and year, section name per cohort, course+term+section per offering,
  offering+user for instructors and enrolments, tenant+institutional ID for
  memberships). Restrictive foreign keys keep structure rows that are still in use.
- Status enums replace deletion for years, programmes, courses, offerings, and
  enrolments; `import_rows.status` records the per-row verdict.

**Services**

- `modules/academics/structure-service.ts` — years (create, update, status change),
  terms (create, update; must sit inside the year), departments with optional parent,
  programmes, cohorts, sections with capacity, cohort membership, and the
  institution-scoped lookups the screens need. Every function takes an
  `AccountContext`, requires `academic_structure.manage`, resolves parents by
  `(id, tenantId)`, and writes an audit event in the same transaction as the change.
- `modules/academics/course-service.ts` — catalogue CRUD and status changes,
  offering creation/updating (validating that the term belongs to the tenant and the
  section to that term's year, and that dates fall inside the term), instructor
  assignment by institutional email with a role (primary/co-instructor/teaching
  assistant), instructor removal, enrolment, withdrawal, and completion. Rosters
  report the source (`manual`/`import`) and never delete a record.
- `modules/imports/csv.ts` — RFC 4180-style reader (quotes, escaped quotes,
  embedded newlines, CRLF, BOM) with a 2 MB / 2000-row ceiling, case- and
  space-insensitive headers, and an explicit header error instead of delimiter
  guessing.
- `modules/imports/import-service.ts` — preview validates every row against current
  tenant data and persists the job with per-row status and message; commit
  re-resolves valid rows inside one transaction, applies them by natural key
  (create/update/skip), marks rows that stopped resolving as `FAILED` instead of
  aborting the batch, records counts in `summary`, and writes an audit event.
- `app/(app)/admin/imports/template/route.ts` and
  `app/(app)/admin/imports/[jobId]/report/route.ts` serve the downloadable templates
  and the stored per-row report as `text/csv` attachments, permission-checked.

**Screens**

- `/admin/academics` — years list and creation, with term counts and status.
- `/admin/academics/years/[yearId]` — year dates and status, terms with inline
  create/edit and the inside-the-year rule.
- `/admin/academics/departments` — departments and parent selection.
- `/admin/academics/programmes` — programmes with department, level, and status.
- `/admin/academics/cohorts` and `/admin/academics/cohorts/[cohortId]` — cohorts
  per programme and year, sections with capacity, and cohort membership.
- `/admin/courses` — course catalogue with credits and catalogue status.
- `/admin/offerings` and `/admin/offerings/[offeringId]` — offerings filtered by
  course/term, and the detail screen with instructor assignment and the roster
  (enrol, withdraw, complete, sources, capacity).
- `/admin/imports` and `/admin/imports/[jobId]` — upload/paste with kind selector,
  preview, per-row report, commit result, templates, and import history.
- Navigation exposes the new destinations to institution administrators only; the
  pages themselves return a permission-denied panel for other roles.

**Seed**

- Northstar University: `2026/27` with two semesters, Computing and Business
  departments, BSc Computer Science and BBA programmes, a 2026 cohort and section A
  for each, `CS101` and `BUS101`, a published `CS101` offering with an instructor and
  three learners, a draft `BUS101` offering with an instructor and two learners, and a
  section-less `CS101` offering in Semester 2 to show catalogue ≠ offering.
- Riverbend College: a `2026` year with Term 1, one department, one programme, one
  cohort and section, `LIT101` + `ENG101`, and one published offering with an
  instructor and one learner.
- All structure writes are upserts on natural keys, so the seed stays idempotent.

**Tests added** (25)

- `tests/unit/csv.test.ts` — quoted fields, escaped quotes, embedded newlines, CRLF,
  BOM, header normalisation, malformed rows, empty input, size/row ceilings.
- `tests/integration/academics.test.ts` — structure CRUD, term-inside-year
  validation, offering dates inside the term, cross-tenant parent rejection (404),
  catalogue code uniqueness, permission denial for faculty, instructor assignment
  upsert by email, enrolment idempotency, withdrawal/completion, and capacity and
  cross-tenant guards.
- `tests/integration/imports.test.ts` — preview writes nothing but the job, per-row
  messages for each validation branch, commit counts, re-import updating instead of
  duplicating, committed-job conflict, enrolment and instructor imports, and
  cross-tenant rejection.

### Phase 5 — course authoring and delivery

**Schema** (migration `20261031045123_phase5_course_content`)

- `course_modules` (offering, title, summary, position, status),
  `module_prerequisites` (composite key, same-offering edges),
  `content_items` (rich text, file key/name/size/type, link, availability
  window, position, status), `content_progress` (one row per item and learner),
  and `learning_events` (append-only).
- Status enums (`draft`/`published`, `not_started`/`in_progress`/`completed`);
  files keep only an opaque key and metadata in the database.

**Services**

- `modules/content/content-service.ts` — module and item authoring, ordering,
  prerequisites (with loop detection), publish/unpublish, copy, file upload, and
  the download lookup. Authorisation requires a content permission **and** being
  the assigned instructor or an administrator, so a content permission alone
  cannot touch a colleague's course.
- `modules/content/delivery-service.ts` — the learner view (enrolment, course
  publication, item publication, availability, prerequisite locks), progress,
  learning events, and `canAccessOfferingItem`, which the download route reuses.
- `modules/content/visibility.ts` — pure availability, visibility, lock, and
  cycle-detection rules.
- `modules/content/rich-text.ts` — allowlist sanitation on write and render.
- `lib/storage/` — `StorageAdapter` with a local adapter (atomic writes, key
  validation) and an S3-compatible adapter using a purpose-built SigV4 signer.
  The S3 path is installed but not verified; it fails closed.

**Screens**

- `/faculty/courses` — offerings the teacher can author (all offerings for
  administrators), with module/item/learner counts and offering status.
- `/faculty/courses/[offeringId]` — module and item editors, availability
  windows, prerequisites, move up/down, delete, publish/unpublish, copy from
  another course, and a link to the preview.
- `/faculty/courses/[offeringId]/preview` — the learner view with teacher
  visibility, no progress recording.
- `/student/courses` and `/student/courses/[offeringId]` — enrolled published
  courses, progress, lesson viewer, and mark complete / reopen.
- `/api/v1/content/[itemId]/file` — authorised private download (401 anonymous,
  404 cross-tenant, 403 not enrolled, 503 storage unconfigured).
- Navigation now links **My courses** for both roles; dashboards show real course
  counts and progress instead of placeholder text.

**Seed**

- `CS101`: three modules (two published, one draft) with rich-text lessons, an
  external link, a sample video link, and a prerequisite chain from module 2 to
  module 3. `BUS101`: draft course with draft content. `LIT101`: published module
  with a lesson and a reference link. All writes are idempotent lookups by
  (offering, title).
- The seed creates no uploaded files; those depend on a storage backend and are
  created through the editor.

**Tests added** (39)

- `tests/unit/content-visibility.test.ts` (13) — availability boundaries, draft
  visibility, prerequisite locking and unlocking, empty modules, missing and
  unpublished prerequisites, cycle detection.
- `tests/unit/rich-text.test.ts` (8) — formatting kept; scripts, event handlers,
  `javascript:` links, iframes, and styles removed; noopener added; plain-text
  previews.
- `tests/unit/storage.test.ts` (8) — key traversal rejection, local put/get/copy/
  delete, atomic overwrite, SigV4 determinism and sensitivity.
- `tests/integration/content.test.ts` (10) — authoring and publication, stranger
  refusal, draft/future hiding, prerequisite lock/unlock, ordering, cycle
  rejection, file authorisation by tenant/enrolment/publication plus deletion,
  unpublished course visibility and preview, progress and learning events,
  copy-without-enrolments-or-progress, and access reporting.

### Phase 7 — quiz engine and question bank

**Schema** (migration `20261101120000_phase7_quizzes`)

- `question_banks` (tenant, optional offering, title, owner), `questions`
  (bank, type enum, prompt JSON, answer-key JSON, points, status, version counter),
  `question_versions` (immutable published snapshot, per question+version unique),
  `quizzes` (offering, title, instructions, availability window, JSON settings,
  status, release timestamp), `quiz_question_refs` (quiz+question position map with
  optional points override), `quiz_attempts` (per user+quiz with attempt number,
  status, deadline, score, points possible, version), `quiz_attempt_items` (one row
  per question in the attempt, points possible), `quiz_attempt_answers` (upserted on
  autosave, keyed to the attempt item).

**Services**

- `modules/quizzes/rules.ts` — pure-function layer: settings parsing and defaults,
  per-type objective scoring (MCQ exact, TRUE_FALSE, fill-blank), attempt state machine
  (`can_start`, `can_submit`, deadline enforcement), release policy
  (`manual`/`immediate`), result/answer-key visibility, score/percentage helpers, and
  pass/fail determination. No database access; fully unit-tested.
- `modules/quizzes/bank-service.ts` — question bank CRUD (create/update/delete, with
  offering scope), question create/update/delete with published-version locking,
  question publish (snapshots to `question_versions` and increments `current_version`),
  list functions for the faculty screens. Requires `assessments.manage`.
- `modules/quizzes/quiz-service.ts` — quiz CRUD, publish (validates at least one
  question is published), archive, delete (draft only), question-ref management
  (add/remove/reorder), results release, and the student/faculty listing functions.
  Requires `assessments.manage` for writes, `submissions.submit` for student reads.
- `modules/quizzes/attempt-engine.ts` — `startAttempt` (idempotent, resumes
  `in_progress`; snapshots published versions, applies shuffle, sets deadline);
  `autosave` (upserts answers, no deadline reset, validates item ownership);
  `finaliseAttempt` (auto-scores objective items, totals score and `pointsPossible`,
  marks timed-out attempts, idempotent on already-submitted); `gradeEssayItem`
  (manual score + feedback, re-totals score, audit event); `getAttemptForLearner`
  (returns `AttemptView` with per-item scores when `showResults`/`showAnswerKey`
  allow it); `listUngradedEssays` (faculty grading queue).

**Screens — faculty**

- `/faculty/courses/[offeringId]/quizzes` — quiz list with status badges, publish/
  archive/delete actions, and a create form.
- `/faculty/courses/[offeringId]/quizzes/[quizId]` — quiz settings editor, question
  picker (add/remove questions from the offering's banks), reorder, release-results
  button, and published/draft status toggle.
- `/faculty/courses/[offeringId]/quizzes/[quizId]/grading` — essay grading queue:
  lists ungraded essay and short-answer items per attempt; inline score + feedback
  form per item.
- `/faculty/courses/[offeringId]/question-banks` — bank list and create form.
- `/faculty/courses/[offeringId]/question-banks/[bankId]` — question list with type
  badges; inline add-question form for all five question types; publish and delete
  per question.

**Screens — student**

- `/student/courses/[offeringId]/quizzes` — lists all published quizzes for the
  course with time limit, attempt count, and open/close windows.
- `/student/courses/[offeringId]/quizzes/[quizId]` — quiz detail with instructions,
  deadline info, and a start button (gated by open window).
- `/student/courses/[offeringId]/quizzes/[quizId]/attempt/[attemptId]` — attempt
  runner: timer banner (red under 5 min), per-question cards with radio/textarea/
  input controls matching question type, autosave via form submission, and a confirm-
  and-submit card.
- `/student/courses/[offeringId]/quizzes/[quizId]/results` — score summary (hidden
  until released), pass/fail badge, pending-essay notice, and per-question review
  with score and feedback when `showAnswerKey` is set.

**Seed**

- Northstar CS101 gets a 5-question `CS101 question bank` (2 MCQ, 1 TRUE_FALSE,
  1 ESSAY, 1 SHORT_ANSWER) and a published `CS101 Week 1 Quiz` (60-min time limit,
  1 attempt, 60% pass mark, manual release). All writes are idempotent upserts.

**Tests**

- `tests/unit/quiz-rules.test.ts` (45 tests) — settings defaults and parsing,
  MCQ/TRUE_FALSE/fill-blank scoring, partial and zero credit, every attempt-state
  transition, deadline enforcement, release policy variants, visibility logic,
  percentage and pass/fail, and max-attempts guard.

### Phase 6 — assignments, submissions, and grading

**Schema** (migration `20261102050116_phase6_assignments_grading`)

- `assignments` (offering, title, instructions, due/availability window, points,
  submission type, JSON settings, status), `assignment_submissions` (unique per
  assignment and learner, attempt, status, late flag, version),
  `submission_text_versions` (append-only), `submission_file_links` (private
  storage metadata), `rubric_criteria`, `rubric_criterion_scores`, `grades`
  (draft or released), `grade_feedback`, and `grade_change_events`.
- The migration itself was correct, but the committed Prisma models had 17
  validation errors, which is why `prisma generate` never emitted the Phase 6
  models. Missing opposite relation fields on `Tenant`, `User`, `CourseOffering`,
  `Assignment`, and `AssignmentSubmission` were added; `GradeFeedback` and
  `GradeChangeEvent` pointed their `tenant` relation at `Grade` instead of
  `Tenant`; `Grade.submission` was declared one-to-one without a unique index and
  was corrected to the many side; and `points_possible`, `submission_types`,
  `file_name`, and `file_size` were missing `@map`. After the repair the client
  generated cleanly and the migration was applied to both the development and
  `_test` databases.

**Services**

- `modules/assignments/rules.ts` — pure window, lateness, submission-gate,
  learner-state, grade-visibility, percentage, and rubric-total rules shared by
  the services and the screens.
- `modules/assignments/assignment-service.ts` — create/update, publish, archive,
  delete (draft only, and only without submissions), rubric replacement (locked
  once grades exist), and the lists the faculty screens use. Writes require
  `assessments.manage` **and** offering management, so a colleague with the same
  role cannot touch another teacher's course.
- `modules/assignments/submission-service.ts` — draft save, submit with receipt,
  an idempotent retry for identical work, late flagging, resubmission and attempt
  limits, append-only text history, the current file attachment, and private file
  authorisation.
- `modules/assignments/grading-service.ts` — the grading queue, rubric scoring,
  draft grades, release one or all with notification, overrides that require
  `grades.update` and a reason, and the per-grade change history.

**Screens and API**

- `/faculty/assignments` — assignments across the courses a teacher manages.
- `/faculty/courses/[offeringId]/assignments` — create assignments and see each
  assignment's queue counts.
- `/faculty/courses/[offeringId]/assignments/[assignmentId]` — settings,
  publish/archive/delete, the rubric editor, the grading queue with a
  score/feedback/rubric form per learner, release controls, and grade history.
- `/student/assignments` — learner to-do list with state and released percentage.
- `/student/courses/[offeringId]/assignments/[assignmentId]` — brief, receipt,
  a draft/submit form that matches the submission type, history, private
  attachments, and released feedback with rubric comments.
- `/api/v1/submissions/[fileId]/file` — private download for the owner and
  teaching staff (401 anonymous, 403 not authorised, 404 cross-tenant).

**Seed**

- `CS101` gets a published `FizzBuzz practice` assignment (file submission, late
  work accepted, one resubmission, three-criterion rubric) and a draft
  `functions worksheet`. No submissions or grades are seeded, so the grading queue
  starts empty and every state is reached through the UI.
- Navigation now links Assignments for faculty and students, and the dashboards no
  longer describe assignments as future work.

**Tests added** (30)

- `tests/unit/assignment-rules.test.ts` (22) — settings parsing, window states,
  lateness, every submission-gate branch, learner-state precedence, grade
  visibility, percentages, score bounds, and rubric totals.
- `tests/integration/assignments.test.ts` (8) — authoring, publication, and
  permission boundaries; draft → submit → idempotent retry; late policy and
  attempt limits; hidden-then-released grades; override permission, reason, and
  audit; rubric scoring and the rubric lock; submission-file authorisation; and
  release-all.

## Not started

- Staging deployment and SSO, both blocked on infrastructure that does not exist
  here: a host for staging and an identity provider for SSO.
- Hardening follow-ups that Phase 12 named but did not build: a nonce-based
  `script-src` CSP, external error reporting, scheduled off-host backups, and
  automated accessibility checks in CI.
- Remaining Phase 13 candidates, each needing a partner system, a provider, or a
  policy review: SCORM/xAPI, LTI 1.3, AI drafting, skills frameworks, adaptive
  pathways, plagiarism, proctoring, native mobile, a parent portal, and BI export.
- Optional Phase 11 engagement features: certificate PDFs and branded templates,
  badges, learning paths, leaderboards with privacy controls, and recommendation
  hooks (the specification conditions recommendations on reliable analytics).
- Group assignments, assignment-specific notifications beyond grade release,
  and reopening an already graded submission are not built.
- Quiz: reconnect-recovery timer sync via client-side JS (current timer is
  server-rendered; a client counter would improve UX but is not required).

## Tests run and results

### Verification log

| Date       | Command(s)                                                     | Result                                                                                                                                                  |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-29 | `npm run lint`                                                 | Passed (0 errors, 0 warnings)                                                                                                                           |
| 2026-10-29 | `npm run typecheck`                                            | Passed                                                                                                                                                  |
| 2026-10-29 | `npm test`                                                     | Passed — 53 tests in 8 files                                                                                                                            |
| 2026-10-29 | `npm run build`                                                | Passed; 9 routes, proxy compiled                                                                                                                        |
| 2026-10-29 | `npm run db:reset`                                             | Passed; migration applied, seed executed                                                                                                                |
| 2026-10-29 | `npm run db:seed` (twice)                                      | Idempotent; row counts unchanged                                                                                                                        |
| 2026-10-29 | `curl /api/health/ready`                                       | 200 ready; 503 with PostgreSQL stopped, then recovered                                                                                                  |
| 2026-10-30 | `npm run verify`                                               | Passed — format check, lint, typecheck, 67 tests in 9 files                                                                                             |
| 2026-10-30 | `npm run build`                                                | Passed; sign-in, reset, invitation, account, admin, and API routes compiled                                                                             |
| 2026-10-30 | `curl` × 7 on `/api/auth/sign-in/email` with wrong password    | 401 × 5, then 429 `{"message":"Too many requests. Please try again later."}` — HTTP rate limiting confirmed                                             |
| 2026-10-30 | Browser: invite → outbox → accept                              | Invitation row created, message captured, acceptance sets the password and lands the user in the institution                                            |
| 2026-10-30 | Browser: invite duplicate member / revoke invitation           | Conflict message shown for an existing member; revoke removes the pending row and shows a notice                                                        |
| 2026-10-30 | Browser: forgot password → `/dev/mail` link → reset → sign in  | Reset completes; old password rejected, new password accepted; admin session unaffected by the faculty reset                                            |
| 2026-10-30 | Browser: admin users, member detail, account profile           | Permission gates, role changes, and profile edits persist across refresh                                                                                |
| 2026-10-31 | `npm run format` + `npm run verify`                            | Passed — format check, lint, typecheck, 92 tests in 12 files                                                                                            |
| 2026-10-31 | `npm run build`                                                | Passed; all Phase 4 routes compiled (academics, courses, offerings, imports, report and template handlers)                                              |
| 2026-10-31 | Browser: create year, then a term outside it                   | Year `2027/28` persisted as `planned`; the out-of-range term was rejected with "The term must fall inside 2027/28."                                     |
| 2026-10-31 | Browser: create a valid term                                   | Term persisted with its dates and appeared in the year's table                                                                                          |
| 2026-10-31 | Browser: five-row people CSV preview and commit                | 1 valid / 4 invalid with distinct per-row messages; commit reported 1 created                                                                           |
| 2026-10-31 | Browser: re-upload the same file and commit                    | 0 created, 1 updated; the people directory still lists one person                                                                                       |
| 2026-10-31 | Browser: enrol a learner, then an unknown email                | Enrolment persisted as `manual`; the unknown email produced a clear error and wrote nothing                                                             |
| 2026-10-31 | `fetch` of report and template routes from the browser         | 200 `text/csv` with attachment headers; the report lines match the on-screen row report                                                                 |
| 2026-10-31 | `npm run format` + `npm run verify`                            | Passed — format check, lint (0 errors), typecheck, 131 tests in 16 files                                                                                |
| 2026-10-31 | `npm run build`                                                | Passed; Phase 5 routes compiled (faculty courses, editor, preview, student courses, file download)                                                      |
| 2026-10-31 | Browser: faculty course list and editor                        | Signed in as faculty; list showed CS101 with 3 modules and 6 items; editor showed statuses, prerequisite labels, and ordering controls                  |
| 2026-10-31 | Browser: add a lesson through the editor                       | Item created from the form, notice shown, item count rose to 7                                                                                          |
| 2026-10-31 | Browser: preview as learner                                    | Draft module and draft lessons visible with a preview banner; no progress controls; rich text rendered                                                  |
| 2026-10-31 | Browser: learner viewer and completion                         | Draft module hidden; module 2 shown as locked; after completing both module 1 lessons, module 2 unlocked and progress read 2/5                          |
| 2026-10-31 | Browser: upload a file, then download it                       | File item created with the local adapter (FILES count 1); learner download returned 200, `attachment`, `private, no-store`, original filename and bytes |
| 2026-10-31 | `fetch` of a course file signed out / from another institution | 401 `UNAUTHENTICATED`, and 404 `NOT_FOUND` for a Riverbend admin — no tenant leak                                                                       |

### Phase 6 verification

| Date       | Command(s)                                           | Result                                                                                       |
| ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 2026-11-01 | `prisma validate` + `prisma generate`                | Failed with 17 errors before the repair; passes afterwards and emits the nine Phase 6 models |
| 2026-11-01 | `prisma migrate deploy` (development and `lms_test`) | Phase 6 migration applied to both databases                                                  |
| 2026-11-01 | `npm run format` + `npm run verify`                  | Passed — format, lint (0 errors), typecheck, 161 tests in 18 files                           |
| 2026-11-01 | `npm run db:seed` (twice)                            | Passed; idempotent, adds the CS101 assignment and rubric once                                |
| 2026-11-01 | `npm run build`                                      | Passed; faculty and student assignment routes plus the submission download compiled          |

### Phase 8 verification

| Date       | Command(s)                                 | Result                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-02 | `tests/unit/gradebook-calculation.test.ts` | 17 tests: points and weighted totals, rounding, clamping, missing vs zero, excused, ungraded, scales, visibility                                                                                                                                                                                  |
| 2026-11-02 | `tests/integration/gradebook.test.ts`      | 15 tests: reconciliation, learner visibility, colleague refusal, CSV headers, weighted scheme, recalculation, excusal, configuration permission checks, cohort paging, name/email search, unpaged export, regrades, the release preview, batch release with its audit event, and release refusals |
| 2026-11-02 | `npm run format` + `npm run verify`        | Passed — format, lint (0 errors), typecheck, 245 tests in 22 files                                                                                                                                                                                                                                |
| 2026-11-02 | `npm run db:seed` (twice)                  | Passed; the second run adds no rows                                                                                                                                                                                                                                                               |
| 2026-11-02 | `npm run build`                            | Passed; gradebook, gradebook export, and learner grades routes compiled                                                                                                                                                                                                                           |

### Phase 9 verification

### Phase 10 verification

### Phase 11 verification

| Date       | Command(s)                               | Result                                                                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-04 | `prisma validate` + `prisma generate`    | Schema valid; the client now emits `Certificate` and `CertificateStatus`                                                                                                                                                                                                                              |
| 2026-11-04 | `prisma migrate deploy` (dev and test)   | Applied `20261104100000_phase11_certificates` to both databases (14 migrations)                                                                                                                                                                                                                       |
| 2026-11-04 | `tests/unit/completion-rules.test.ts`    | 10 tests: defaults, stored-settings parsing and clamping, form parsing, percentage bounds, content percentage, every gap code, an empty offering, grade missing vs below vs met, and rule descriptions                                                                                                |
| 2026-11-04 | `tests/integration/certificates.test.ts` | 6 tests: rules scoped to the teaching team with an audit event, eligibility gaps then idempotent issuance, reissue with a new token plus revocation that stays visible, minimal public verification with null for an unknown token, learner and staff scoping, and course access unaffected by rules  |
| 2026-11-04 | `npm run format` + `npm run verify`      | Passed — format, lint (0 errors, 3 pre-existing warnings), typecheck, 314 tests in 33 files                                                                                                                                                                                                           |
| 2026-11-04 | `npm run db:seed` (twice)                | Passed; the second run adds no rows and leaves the demo certificate and CS101 completion rules untouched                                                                                                                                                                                              |
| 2026-11-04 | `npm run build`                          | Passed; `/faculty/courses/[offeringId]/certificates`, `/student/certificates`, and `/verify/[token]` compiled                                                                                                                                                                                         |
| 2026-11-04 | `curl` on the seeded verification token  | 200 showing the learner name, course, issuer, and `ISSUED` status. An unknown token renders the not-found page without award data; because the app shell streams before the lookup completes, that response is a streamed 200 rather than a 404, so it must be read rather than probed by status code |

| Date       | Command(s)                             | Result                                                                                                                                                                                                                                                                                         |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-03 | `prisma generate`                      | Passed; the client now emits the five Phase 10 models (it predated them, which broke typecheck until regenerated)                                                                                                                                                                              |
| 2026-11-03 | `prisma migrate deploy` (dev and test) | Applied `20261103200000_phase10_obe`; five tables, four enums, the one-active-policy partial index, and all foreign keys exist in both databases                                                                                                                                               |
| 2026-11-03 | `tests/integration/obe.test.ts`        | 5 tests: programme outcome creation with duplicate and cross-tenant refusal, policy versioning with one active and an immutable active version, correlation scale/PEO/cross-programme rules, warnings that clear as mappings are added, and an evidence export that follows the policy version |
| 2026-11-03 | `tests/unit/obe-evidence.test.ts`      | 4 tests: fixed header and one row per mapping, the not-computed statement plus policy version, CSV escaping of commas/quotes/newlines, and byte-identical re-rendering                                                                                                                         |
| 2026-11-03 | `npm run format` + `npm run verify`    | Passed — format, lint (0 errors, 3 pre-existing warnings), typecheck, 298 tests in 31 files                                                                                                                                                                                                    |
| 2026-11-03 | `npm run db:seed` (twice)              | Passed; second run adds no rows: 5 programme outcomes, 4 course outcomes, 6 correlations, 2 evidence mappings, and one active policy whose formula is unconfigured                                                                                                                             |
| 2026-11-03 | `npm run build`                        | Passed; `/admin/obe`, `/admin/obe/policies`, `/admin/obe/programmes/[programmeId]`, `/faculty/courses/[offeringId]/outcomes`, and `.../outcomes/export` compiled                                                                                                                               |
| 2026-11-03 | Seeded-data check (`tsx` script)       | Northstar BSCS holds PEO1, PO1 to PO3, PSO1; CS101 holds CO1 to CO4, 6 correlations, and 2 evidence mappings; the active policy parses as scale 1 to 3 with both methods `unconfigured`                                                                                                        |

| Date       | Command(s)                                       | Result                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-02 | `prisma migrate deploy` (dev and test)           | Applied **both** `20261102140000_phase9_live_sessions` and `20261102160000_phase9_notifications`; no pending migrations afterwards                                                                                                                                                                                      |
| 2026-11-02 | `tests/integration/sessions.test.ts`             | 5 tests: schedule plus attendance with correction, learner-only visibility, cohort notice on reschedule and cancel with a dedupe replay, own-notice read/clear isolation, permission and time-window refusals                                                                                                           |
| 2026-11-02 | `npm run format` + `npm run verify`              | Passed — format, lint (0 errors), typecheck, 250 tests in 23 files                                                                                                                                                                                                                                                      |
| 2026-11-02 | `npm run db:seed` (twice)                        | Passed; the second run adds no rows                                                                                                                                                                                                                                                                                     |
| 2026-11-02 | `npm run build`                                  | Passed; faculty sessions, faculty attendance, learner sessions, and the notification centre routes compiled                                                                                                                                                                                                             |
| 2026-11-03 | `tests/integration/calendar.test.ts`             | 6 tests: learner scope excludes drafts and other courses, cross-course and unassigned-colleague ids are 404s, day grouping plus reversed and oversized range refusals, session reminder dedupe, assignment reminder dedupe (drafts ignored)                                                                             |
| 2026-11-03 | `npm run jobs:reminders`                         | First run `{processed: 1, recipients: 4}`; an immediate second run `{processed: 1, recipients: 0, skipped: 4}`, so the dedupe keys hold against the seeded session                                                                                                                                                      |
| 2026-11-03 | `npm run format` + `npm run verify`              | Passed — format, lint (0 errors), typecheck, 256 tests in 24 files                                                                                                                                                                                                                                                      |
| 2026-11-03 | `npm run db:seed` (twice)                        | Passed; the second run adds no rows, including the two seeded live sessions                                                                                                                                                                                                                                             |
| 2026-11-03 | `npm run build`                                  | Passed; `/calendar` and `/notifications` compiled alongside the session and attendance routes                                                                                                                                                                                                                           |
| 2026-11-03 | Manual check, `next build` + `next start`        | Signed in as the seeded faculty account: `/calendar` renders the November grid and agenda with the seeded 6 Nov session (14:30–16:00) and the 21 Nov assignment deadline; `?view=list` returns the same events under "Agenda"                                                                                           |
| 2026-11-03 | `prisma migrate deploy` (dev and test)           | Applied `20261103120000_phase9_attendance_lock`; the columns and the reopened-by foreign key exist in both databases                                                                                                                                                                                                    |
| 2026-11-03 | `tests/unit/attendance-policy.test.ts`           | 9 tests: defensive settings parsing, policy write without losing other settings, open/closed windows, cancelled sessions, manual lock, reopen precedence, rate rounding                                                                                                                                                 |
| 2026-11-03 | `tests/integration/attendance-lock.test.ts`      | 8 tests: policy lock refusal, tightening the window, settings preservation plus audit, manual lock with administrator-only reopen and audit order, delivered-only report counts and rates, null rate when unmarked, outsider refusals, range validation                                                                 |
| 2026-11-03 | `tests/integration/sessions.test.ts`             | Fixtures moved to a session three days old, so the default seven-day policy does not block the marking these tests assert; 5 tests still pass                                                                                                                                                                           |
| 2026-11-03 | `npm run format` + `npm run verify`              | Passed — format, lint (0 errors, 2 pre-existing warnings), typecheck, 273 tests in 26 files                                                                                                                                                                                                                             |
| 2026-11-03 | `npm run db:seed` (twice)                        | Passed; the second run adds no rows                                                                                                                                                                                                                                                                                     |
| 2026-11-03 | `npm run build`                                  | Passed; `/faculty/courses/[offeringId]/attendance` and `/faculty/courses/[offeringId]/attendance/export` compiled alongside the session routes                                                                                                                                                                          |
| 2026-11-03 | Seeded-data check (`tsx` script)                 | Faculty policy reads `{lockAfterHours: 168}`; the 22 Oct session reports `locked: policy` and the 6 Nov session `open`; the report counts one delivered session and one upcoming, with every rate `null` while all records are unmarked                                                                                 |
| 2026-11-03 | `prisma migrate deploy` (dev and test)           | Applied `20261103150000_phase9_communication`; the three tables and their foreign keys exist in both databases                                                                                                                                                                                                          |
| 2026-11-03 | `tests/integration/communication.test.ts`        | 6 tests: publish notifies once and a delivery replay notifies nobody, drafts hidden from learners with withdrawal final, learner publish and cross-tenant reads refused, reply notification plus locked-reply refusal, hide/restore of thread and reply without deletion, moderation permission and audit rows          |
| 2026-11-03 | `npm run format` + `npm run verify`              | Passed — format, lint (0 errors), typecheck, 279 tests in 27 files                                                                                                                                                                                                                                                      |
| 2026-11-03 | `npm run db:seed` (twice)                        | Passed; the catalogue grew to 35 permissions and the faculty role received both new ones, with no rows added on the second run                                                                                                                                                                                          |
| 2026-11-03 | `npm run build`                                  | Passed; all six announcement and discussion routes compiled                                                                                                                                                                                                                                                             |
| 2026-11-03 | `prisma migrate deploy` (dev and test)           | Applied `20261103170000_phase9_notification_queue_messaging`; the three tables, the delivery-status enum, and their foreign keys exist in both databases                                                                                                                                                                |
| 2026-11-03 | `tests/integration/notifications-outbox.test.ts` | 6 tests: default dual-channel delivery with a muted channel honoured, email switched off leaving no queue row, one email per event with none on replay, an unusable payload held as `skipped` and a future attempt not sent early, learner-to-staff delivery with read clearing, self/outsider/classmate/blank refusals |
| 2026-11-03 | `tests/unit/notification-templates.test.ts`      | 4 tests: in-app text and email from one payload, long preview shortened without touching the email, a missing field rejected, exponential backoff capped at six hours                                                                                                                                                   |
| 2026-11-03 | `npm run jobs:notifications`                     | Empty queue: `{attempted: 0, sent: 0, failed: 0, skipped: 0}` with `{due: 0, stuck: 0}`, so the worker runs against the seeded database                                                                                                                                                                                 |
| 2026-11-03 | `npm run format` + `npm run verify`              | Passed — format, lint (0 errors, 2 pre-existing warnings), typecheck, 289 tests in 29 files                                                                                                                                                                                                                             |
| 2026-11-03 | `npm run db:seed` (twice)                        | Passed; the second run adds no rows                                                                                                                                                                                                                                                                                     |
| 2026-11-03 | `npm run build`                                  | Passed; `/account/notifications`, `/faculty/courses/[offeringId]/messages`, and `/student/courses/[offeringId]/messages` compiled                                                                                                                                                                                       |

### Phase 7 verification

| Date       | Command(s)                                   | Result                                                                                                             |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-11-02 | `prisma generate`                            | Passed; the client now emits all nine Phase 7 models (it predated the quiz schema)                                 |
| 2026-11-02 | `prisma migrate deploy` (dev and `lms_test`) | Applied `20261101120000_phase7_quizzes`; no pending migrations afterwards                                          |
| 2026-11-02 | `npm run format` + `npm run verify`          | Passed — format, lint (0 errors), typecheck, 213 tests in 20 files                                                 |
| 2026-11-02 | `npm run db:seed` (twice)                    | Passed and idempotent: 1 bank, 5 questions, 5 versions, 1 quiz, 5 refs after both runs                             |
| 2026-11-02 | `npm run build`                              | Passed; question-bank, quiz builder, grading, attempt, and results routes compiled                                 |
| 2026-11-02 | `tests/integration/quizzes.test.ts`          | 3 tests: publication gates, the attempt lifecycle (autosave, auto-scoring, essay queue, release), tenant isolation |

### Phase 12 verification

| Date       | Command(s)                                                      | Result                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-04 | `prisma validate` + `prisma generate`                           | Schema valid; the client emits `WebhookEvent` and `WebhookEventStatus`                                                                                                                                                                                      |
| 2026-11-04 | `prisma migrate deploy` (development and `lms_test`)            | Applied `20261104160000_phase12_webhooks` to both databases (15 migrations)                                                                                                                                                                                 |
| 2026-11-04 | `tests/unit/webhooks.test.ts` (7)                               | Signature covers the timestamp and exact body; fresh request accepted; tampered body, wrong secret, missing signature, and out-of-window timestamps refused; provider slugs and secret length enforced                                                      |
| 2026-11-04 | `tests/unit/security-headers.test.ts` (3)                       | Sniffing, framing, referrer, and permission policies always set; the CSP subset carries no `script-src`; HSTS appears only in production                                                                                                                    |
| 2026-11-04 | `tests/integration/webhooks.test.ts` (6)                        | Verified event stored once and a replay answered as a duplicate; header event id preferred; tampered and stale deliveries refused; unconfigured provider and invalid payloads refused; oversized body rejected before verification; ids scoped per provider |
| 2026-11-04 | `npm run format` + `npm run verify`                             | Passed — format, lint (0 errors, 3 pre-existing warnings), typecheck, 330 tests in 36 files                                                                                                                                                                 |
| 2026-11-04 | `npm audit --omit=dev --audit-level=high`                       | Exit 0 — `found 0 vulnerabilities`                                                                                                                                                                                                                          |
| 2026-11-04 | `docker exec lms-pg pg_dump` + `pg_restore` drill               | 252,662-byte custom dump restored into `lms_restore_test`, `pg_restore` exit 0; source and restore both 2 tenants / 13 users / 4 offerings / 7 enrolments / 1 certificate; scratch database dropped                                                         |
| 2026-11-04 | `prisma migrate deploy` + `npm run db:seed` on `lms_clean_test` | 15 migrations applied to an empty database, 70 application tables created, seed succeeded (2 tenants / 12 users / 4 offerings / 6 enrolments / 1 certificate); scratch database dropped                                                                     |
| 2026-11-04 | `npm run build`                                                 | Passed; `/api/v1/openapi`, `/api/v1/webhooks/[provider]`, and `/api/health/queue` compiled                                                                                                                                                                  |
| 2026-11-04 | `curl` against `next dev`                                       | `/api/v1/openapi` 200 with `"openapi":"3.1.0"`; `/api/health/queue` 200 (`due` 0, `stuck` 0); signed webhook 202 then 200 duplicate; unconfigured provider 503; `/sign-in` returned the security headers                                                    |

### Phase 13 verification

| Date       | Command(s)                                           | Result                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-04 | `prisma validate` + `prisma generate`                | Schema valid; the client emits `AttendanceSource` and the new session fields                                                                                                               |
| 2026-11-04 | `prisma migrate deploy` (development and `lms_test`) | Applied `20261104180000_phase13_qr_attendance` to both databases (16 migrations); `prisma migrate status` clean                                                                            |
| 2026-11-04 | `tests/unit/check-in-token.test.ts` (7)              | Round-trip, deterministic signing, tampered payload and foreign key, expiry boundary, malformed shapes, derived key length, nonce uniqueness                                               |
| 2026-11-04 | `tests/integration/check-in.test.ts` (7)             | Open and scan once, replay without a second row, rotation and closure, expiry, staff-mark preservation, outsider/other-tenant/cancelled/locked refusals, forged token, lifetime validation |
| 2026-11-04 | `npm run format` + `npm run verify`                  | Passed — format, lint (0 errors, 3 pre-existing warnings), typecheck, 344 tests in 38 files                                                                                                |
| 2026-11-04 | `npm run build`                                      | Passed; `/student/check-in/[token]` and the updated faculty session page compiled                                                                                                          |
| 2026-11-04 | `npm run db:seed`                                    | Passed twice on 2026-11-04; the second run adds no rows. The seed creates no session codes                                                                                                 |

## Known issues and limitations

- **Certificate PDFs, badges, learning paths, leaderboards, and recommendations are not
  built.** The specification treats badges, paths, and rankings as optional or later work,
  conditions recommendations on reliable analytics, and the project has no PDF renderer.
  The shipped core is completion rules, idempotent issuance, reissue and revocation with
  reasons and audit, reproducible rule and evidence snapshots, and minimal public
  verification. No leaderboard exists, so no learner ranking data is exposed; adding one
  would need an opt-in privacy design before it is safe to ship.

- **Attainment numbers are not implemented, by design.** The specification requires
  the institution's exact formula before direct or indirect methods ship, so a policy
  stores scale, rounding, and thresholds while both methods read `unconfigured`. No
  approved snapshots or attainment-value reports exist yet; the mapping workspace,
  coverage warnings, and reproducible evidence export are what this build provides. A
  formula engine and snapshot store belong to whichever phase the confirmed formula
  arrives in.

- **The S3 storage adapter is unverified.** Development and tests use the local
  adapter only. The S3 path is implemented and fails closed, but no real bucket
  has been exercised; the runbook lists the checks required first.
- **Completion is learner-declared.** There are no assessments yet, so a learner
  marks a lesson complete themselves. Phase 6 can replace the trigger without
  changing the stored records.
- **Lesson windows ignore the learner's timezone.** Availability is evaluated in
  UTC and the viewer says so; applying the profile timezone is a later decision.
- **Downloads are buffered** up to the 25 MB upload ceiling. No range requests or
  streaming yet.
- **The object-storage SigV4 signer is unit-tested for determinism**, not against
  AWS's published signature vectors.
- **Imports are synchronous.** A 2 MB / 2000-row file is validated and committed inside
  the request; there is no queue, progress stream, or resume. Phase 12 did not add a
  job queue, and any future worker must keep the same per-row status contract.
- **Only people, enrolments, and instructor assignments are importable.** Academic
  structure is entered through the screens; there is no structure CSV yet.
- **Rosters are managed one person at a time on the offering screen.** Bulk enrolment is
  available through the CSV pipeline rather than a multi-select control.
- **Email delivery is unconfigured.** Development captures messages in
  `email_messages`; production refuses to pretend and records the failure, so
  every queued message ends `failed` after five attempts instead of leaving the
  system. Phase 12 did not select an adapter or provider, so the queue still proves
  retry and dedupe, not inbox delivery.
- **The notification queue needs an external scheduler.** `npm run
jobs:notifications` is the worker; nothing runs it automatically in this build,
  and a process that dies mid-send leaves the row `pending` until the next run
  retries it.
- Better Auth's rate limiter is per process. A multi-instance deployment needs a
  shared store; the database limiter is the one that is cluster-wide today.
- Platform-scope operations (tenant creation, platform audit) are modelled but
  not implemented; the platform role deliberately grants no tenant data access.
- The seeded demo password is documented and development-only. Real deployments
  must invite real administrators and must not run the seed.
- Docker Hub image pulls failed in this build environment. Local verification used
  a PostgreSQL 17 container with the same role/database names; the compose file
  targets PostgreSQL 16 and remains unverified here.
- **Backups are documented and drilled but not automated.** Nothing schedules a
  dump, moves it off-host, verifies it, or rotates the encryption keys; those stay
  operator responsibilities and are not wired into the application.
- Production object storage has no selected provider; the S3-compatible adapter
  needs a bucket and the runbook checks before files can be served in production.

### Phase 13 limitations

- **QR check-in is an honour system.** The code is shared by design, so any enrolled
  learner who obtains the link can check in from anywhere; there is no device
  binding, IP pinning, location check, or photo capture. It records a claim, not proof
  of presence, and it is not a proctoring tool.
- **No rate limit beyond uniqueness.** A learner can retry the endpoint freely; every
  retry is idempotent, but nothing throttles a scripted attempt to brute-force tokens.
  The signature and the nonce make guessing impractical, and a bucket limiter would be
  the next hardening step.
- **Rotating `AUTH_SECRET` invalidates open codes.** That is the intended emergency
  behaviour, but it means an incident response mid-class also stops check-in until a
  new code is generated.
- **The token is in the URL.** The page is `noindex`, responses are private, and the
  referrer policy limits leakage, but a screenshot or browser history keeps the code
  usable until it expires or is rotated.
- **Codes work before the session starts.** The lifetime is staff-chosen, so an early
  code can be used during the pre-class window; the attendance lock (not the code
  window) is what closes a session permanently.
- **No offline path.** Scanning needs the app and a reachable database; there is no
  queued check-in to reconcile later.

### Phase 12 limitations

- **No staging deployment.** No staging host exists, so the release checklist has
  never been run against a production-like environment. The clean-deploy drill
  covers migrations and seeding, not reverse-proxy, TLS, or process supervision.
- **No SSO.** The specification permits SSO only with a provider configuration and
  none is available; credential sign-in stays the only method, and no stub or
  roaming "coming soon" path was added.
- **No error reporter.** Failures are structured JSON logs on stdout carrying a
  request id; there is no Sentry-style aggregation, deduplication, or alerting, and
  an operator has to read logs or call `/api/health/queue` to notice trouble.
- **The CSP has no `script-src`.** A full policy needs per-request nonces threaded
  through the App Router. The served subset blocks framing, base-tag, and
  cross-origin form attacks only; it is not an XSS mitigation.
- **Webhooks are intake only.** A verified event is stored and counted; nothing
  dispatches it to a handler, retries it, or acknowledges it back to the provider
  beyond the HTTP response. `webhook_events` has no processing worker.
- **No scheduled or off-host backups.** The runbook and drill prove a dump can be
  restored; scheduling, retention enforcement, and encryption at rest remain
  deployment work.
- **Accessibility is not tool-tested.** No axe or pa11y run is part of the suite;
  the claim is limited to semantic markup, labelled controls, and focus behaviour
  reviewed by hand.
- **The dependency check is manual.** `npm audit` was run once for this phase; no
  CI job fails a build on a new advisory.

### Phase 6 limitations

- **A rubric cannot be changed once a grade exists.** Replacing criteria would
  discard its scores, so the service refuses it; clear the grades first.
- **Overriding a released grade returns it to draft.** The learner stops seeing
  the old mark immediately, and the new one appears only after re-release.
- **Submission files are current-attempt only.** Replacing a file deletes the
  previous object; text versions keep their history.
- **No group assignments, peer review, or reopening graded work.** Each is a later
  decision rather than an overload of the submission row.
- **The late policy records no automatic penalty.** Late work is accepted and
  flagged with its timestamp; applying a points deduction stays a teacher decision.
- **Draft submissions appear in the grading queue but cannot be graded** until the
  learner submits.
- **Release notifications use the existing outbox**, so production records an
  undelivered message until an email provider is configured.
- **Phase 6 was verified by the integration suite and a production build.** No
  browser walkthrough was recorded for this phase; the equivalent paths are
  covered end to end in tests, and the screens compile and render server-side.

## Deferred decisions

- Job queue technology (imports currently commit synchronously within their size
  limits; queueing becomes necessary for large files and Phase 9 notifications).
- Production object-storage provider and bucket (an S3-compatible adapter exists
  and is unverified; local disk serves development and tests).
- Exact OBE attainment formula and reporting template (Phase 10, institution
  specific).
- Email provider (development outbox until an adapter is required).
- Shared rate-limit store for multi-instance deployments.

## Database migrations added

| Migration                                            | Contents                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261029141217_phase2_tenancy_rbac`                 | Tenancy, identity, RBAC, and audit tables, enums, indexes, FKs                                                                                                                                                                              |
| `20261029151832_phase3_auth_lifecycle`               | `sessions`, `accounts`, `verifications`, `invitations`, `email_messages`, `rate_limit_buckets`; user avatar field replaced by `image`                                                                                                       |
| `20261030160000_phase4_academic_structure`           | Academic years, terms, departments, programmes, cohorts, sections, cohort members, courses, offerings, instructors, enrolments, import jobs and rows; `tenant_memberships.institutional_id`; natural-key unique indexes and restrictive FKs |
| `20261031045123_phase5_course_content`               | `course_modules`, `module_prerequisites`, `content_items`, `content_progress`, `learning_events`; content status, kind, and progress enums                                                                                                  |
| `20261102050116_phase6_assignments_grading`          | `assignments`, `assignment_submissions`, `submission_text_versions`, `submission_file_links`, `rubric_criteria`, `rubric_criterion_scores`, `grades`, `grade_feedback`, `grade_change_events`; assignment, submission, and grade enums      |
| `20261101120000_phase7_quizzes`                      | `question_banks`, `questions`, `question_versions`, `quizzes`, `quiz_question_refs`, `quiz_attempts`, `quiz_attempt_items`, `quiz_answers`, `quiz_events`; question, quiz, attempt, and event enums                                         |
| `20261102140000_phase9_live_sessions`                | `live_sessions`, `attendance_records`; live session and attendance status enums                                                                                                                                                             |
| `20261102160000_phase9_notifications`                | `notifications`; the notification category enum. The unique (tenant, user, dedupe key) index is what makes a retried delivery idempotent                                                                                                    |
| `20261102120000_phase8_gradebook_schemes`            | `grading_schemes`, `assessment_weights`, `assessment_excusals`; grading mode and assessment kind enums                                                                                                                                      |     | `20261103120000_phase9_attendance_lock` | `live_sessions.attendance_locked_at`, `attendance_reopened_at`, and `attendance_reopened_by_user_id` for the manual lock and administrator reopen |
| `20261103150000_phase9_communication`                | `announcements`, `discussion_threads`, `discussion_posts`; announcement, thread, and post status enums                                                                                                                                      |
| `20261103170000_phase9_notification_queue_messaging` | `notification_preferences`, `notification_deliveries` (status enum, attempts, backoff), and `direct_messages`                                                                                                                               |
| `20261103200000_phase10_obe`                         | `programme_outcomes`, `course_outcomes`, `outcome_mappings`, `assessment_outcome_mappings`, `attainment_policies`; four enums, and a partial unique index allowing one active policy per institution                                        |
| `20261104100000_phase11_certificates`                | `certificates`; `CertificateStatus` enum; unique certificate number and verification token; a partial unique index allowing one live award per learner and offering                                                                         |
| `20261104160000_phase12_webhooks`                    | `webhook_events`; `WebhookEventStatus` enum; a unique (provider, external id) index for idempotent delivery; received time and the raw payload                                                                                              |
| `20261104180000_phase13_qr_attendance`               | `attendance_records.source` (`attendance_source` enum, default `staff`), `live_sessions.check_in_nonce`, and `check_in_expires_at`; the one-row-per-learner unique index is unchanged                                                       |

## Endpoints and pages completed

| Route                                                                | Purpose                                                                          |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `/`                                                                  | Project and role-preview index                                                   |
| `/sign-in`                                                           | Credential sign-in                                                               |
| `/forgot-password`                                                   | Request a password-reset link                                                    |
| `/reset-password`                                                    | Redeem a single-use reset link                                                   |
| `/accept-invitation/[token]`                                         | Accept an invitation and create the account                                      |
| `/select-institution`                                                | Choose the active institution                                                    |
| `/dashboard`                                                         | Redirects to the signed-in user's role dashboard                                 |
| `/admin`                                                             | Institution admin dashboard                                                      |
| `/faculty`                                                           | Faculty dashboard                                                                |
| `/student`                                                           | Student dashboard                                                                |
| `/platform`                                                          | Platform operations preview                                                      |
| `/admin/users`                                                       | People directory, invitations, member management                                 |
| `/admin/users/[userId]`                                              | Member detail: roles, status, audit trail                                        |
| `/admin/academics`                                                   | Academic years, status, term counts                                              |
| `/admin/academics/years/[yearId]`                                    | Year dates and status; terms inside the year                                     |
| `/admin/academics/departments`                                       | Departments with optional parent                                                 |
| `/admin/academics/programmes`                                        | Programmes with department, level, status                                        |
| `/admin/academics/cohorts`                                           | Cohorts per programme and year                                                   |
| `/admin/academics/cohorts/[cohortId]`                                | Sections and cohort membership                                                   |
| `/admin/courses`                                                     | Course catalogue (no term, no roster)                                            |
| `/admin/offerings`                                                   | Offerings by course and term                                                     |
| `/admin/offerings/[offeringId]`                                      | Instructors and learner roster                                                   |
| `/admin/imports`                                                     | Upload/preview, templates, import history                                        |
| `/admin/imports/[jobId]`                                             | Per-row report and commit                                                        |
| `/admin/imports/template`                                            | CSV template download (permission-checked)                                       |
| `/admin/imports/[jobId]/report`                                      | Stored row report as a CSV attachment                                            |
| `/faculty/courses`                                                   | Courses a teacher can author                                                     |
| `/faculty/courses/[offeringId]`                                      | Module and lesson editor, publish, copy                                          |
| `/faculty/courses/[offeringId]/preview`                              | Learner view with teacher visibility                                             |
| `/student/courses`                                                   | Enrolled, published courses with progress                                        |
| `/student/courses/[offeringId]`                                      | Learner course viewer, completion, private files                                 |
| `/api/v1/content/[itemId]/file`                                      | Authorised private file download                                                 |
| `/faculty/assignments`                                               | Assignments across the courses you teach                                         |
| `/faculty/courses/[offeringId]/assignments`                          | Assignment authoring and creation                                                |
| `/faculty/courses/[offeringId]/assignments/[assignmentId]`           | Settings, rubric, grading queue, release                                         |
| `/student/assignments`                                               | Learner assignment list and released marks                                       |
| `/student/courses/[offeringId]/assignments/[assignmentId]`           | Brief, submission, history, feedback                                             |
| `/api/v1/submissions/[fileId]/file`                                  | Private submission-file download                                                 |
| `/faculty/courses/[offeringId]/question-banks`                       | Question banks for an offering                                                   |
| `/faculty/courses/[offeringId]/question-banks/[bankId]`              | Questions in a bank: add, publish, delete                                        |
| `/faculty/courses/[offeringId]/quizzes`                              | Quiz list and creation for an offering                                           |
| `/faculty/courses/[offeringId]/quizzes/[quizId]`                     | Quiz settings, questions, publish, archive, release                              |
| `/faculty/courses/[offeringId]/quizzes/[quizId]/grading`             | Essay grading queue                                                              |
| `/student/courses/[offeringId]/quizzes`                              | Published quizzes for an enrolled learner                                        |
| `/student/courses/[offeringId]/quizzes/[quizId]`                     | Quiz brief, start or resume                                                      |
| `/student/courses/[offeringId]/quizzes/[quizId]/attempt/[attemptId]` | Attempt runner with save-progress and submit                                     |
| `/student/courses/[offeringId]/quizzes/[quizId]/results`             | Results and per-question breakdown after release                                 |
| `/faculty/courses/[offeringId]/sessions`                             | Live-session schedule, scheduling, reschedule and cancel                         |
| `/faculty/courses/[offeringId]/sessions/[sessionId]`                 | Attendance roster, marking, lock and reopen                                      |
| `/faculty/courses/[offeringId]/attendance`                           | Course attendance report, lock policy, per-learner rates                         |
| `/faculty/courses/[offeringId]/attendance/export`                    | Attendance CSV (permission-checked, private, no-store)                           |
| `/faculty/courses/[offeringId]/announcements`                        | Draft, publish, edit, and withdraw course announcements                          |
| `/faculty/courses/[offeringId]/discussions`                          | Course discussion board with moderation                                          |
| `/faculty/courses/[offeringId]/discussions/[threadId]`               | Thread, replies, pin/lock/hide and per-reply moderation                          |
| `/student/courses/[offeringId]/announcements`                        | Published announcements for an enrolled learner                                  |
| `/student/courses/[offeringId]/discussions`                          | Learner board: start a thread, read and reply                                    |
| `/student/courses/[offeringId]/discussions/[threadId]`               | Thread and replies; closed with a notice once locked                             |
| `/account/notifications`                                             | Per-category in-app and email switches with an audit trail                       |
| `/faculty/courses/[offeringId]/messages`                             | Course conversations with the cohort, unread counts, reply form                  |
| `/admin/obe`                                                         | Programme list, active policy status, and the formula warning                    |
| `/admin/obe/policies`                                                | Versioned policy drafts, activation, and archived history                        |
| `/admin/obe/programmes/[programmeId]`                                | PEO/PO/PSO definitions per programme                                             |
| `/faculty/courses/[offeringId]/outcomes`                             | Course outcomes, CO to PO/PSO matrix, assessment evidence, and coverage warnings |
| `/faculty/courses/[offeringId]/outcomes/export`                      | Permission-checked CSV evidence export naming the policy version                 |
| `/faculty/courses/[offeringId]/certificates`                         | Completion rules, eligibility gaps, and issue, reissue, and revoke               |
| `/student/certificates`                                              | A learner's own awards, verification links, and per-course completion indicators |
| `/verify/[token]`                                                    | Public, noindex certificate verification with the minimum fields                 |
| `/student/courses/[offeringId]/messages`                             | Private messages with the teaching team for one offering                         |
| `/faculty/courses/[offeringId]/gradebook`                            | Course gradebook computed from assignments and quizzes                           |
| `/faculty/courses/[offeringId]/gradebook/export`                     | Gradebook CSV (permission-checked, private, no-store)                            |
| `/student/courses/[offeringId]/grades`                               | Learner's own released marks and current result                                  |
| `/account`                                                           | Own profile, access, session                                                     |
| `/dev/mail`                                                          | Development outbox (404 in production)                                           |
| `/design`                                                            | Component gallery (development only)                                             |
| `/api/auth/[...all]`                                                 | Better Auth endpoints (sign-in, sign-out, reset, session)                        |
| `/api/v1/me`                                                         | Authenticated identity (401 without a session; private, no-store)                |
| `/api/v1/users`                                                      | Tenant-scoped directory (401/403/409 enforced server-side)                       |
| `/api/health`                                                        | Liveness probe                                                                   |
| `/api/health/ready`                                                  | Readiness probe (database connectivity)                                          |
| `/api/v1/openapi`                                                    | OpenAPI 3.1 document covering every implemented endpoint                         |
| `/api/v1/webhooks/[provider]`                                        | HMAC-verified inbound webhook intake with per-provider idempotency               |
| `/api/health/queue`                                                  | Notification queue counters for operators, with no recipient data                |
| `/student/check-in/[token]`                                          | Learner QR check-in for a signed, short-lived session code (noindex)             |

## Next three concrete tasks

1. Deploy to a staging host, run the release checklist against it, and record the
   result here, including the parts the local drill cannot cover.
2. Select an email provider and a real object-storage bucket, verify both through
   their runbook checklists, and close the two oldest limitations.
3. Add nonce-based `script-src` to the CSP and an external error reporter, then
   rerun the header and health checks against the deployed environment.
