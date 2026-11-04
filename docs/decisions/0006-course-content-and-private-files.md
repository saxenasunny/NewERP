# ADR 0006 — Course content, learner visibility, and private files

- **Status:** accepted
- **Date:** 2026-10-31
- **Phase:** 5

## Context

Phase 5 turns a scheduled course offering into something a teacher can author
and a learner can follow. That needs an ordered content model, explicit draft and
published states, availability windows, prerequisite ordering, file storage, and
a record of what a learner has actually done — without letting drafts leak or
files be fetched by URL guessing.

Acceptance criteria in the specification: an instructor can create and publish a
course without database edits; a learner sees only enrolled, published, available
content; ordering persists; a copied course does not copy grades or submissions;
and file access is tenant-scoped and permission-checked.

## Decisions

### 1. Content belongs to the offering, not the catalogue

`CourseModule` and `ContentItem` hang off `CourseOffering`. The same catalogue
`CS101` can therefore run with different modules, different lesson windows, and a
different pace in two terms. Copying is explicit rather than implicit.

`CourseModule` has `position` and `status`; `ContentItem` has `position`, `kind`
(`RICH_TEXT | FILE | LINK | VIDEO_LINK`), `status`, and `availableFrom` /
`availableUntil`. Ordering is normalised by rewriting sibling positions inside
one transaction when a move is requested; there is no client-side ordering state.

### 2. Visibility is a server rule with four independent conditions

A learner may open an item only when **all** hold:

1. an `ACTIVE` enrolment exists for this offering and this user;
2. the offering is `PUBLISHED`;
3. the module is `PUBLISHED` and the item is `PUBLISHED`;
4. the item is inside its availability window and every prerequisite module is
   complete.

The rule lives in `modules/content/visibility.ts` as pure functions plus
`delivery-service.ts` for the data-dependent parts, so the viewer's locks are an
explanation of a decision the server already made. `content.create` alone never
grants access to a colleague's course: authoring also requires being the assigned
instructor or an administrator.

Module a counts as complete when it is published, has at least one visible item,
and every visible item is completed. Adding a new lesson to a finished module
therefore re-locks its dependants until the new lesson is done — intended, and
observed in a browser run.

### 3. Course publication is an instructor action

`publishCourse` requires `content.publish` **and** management rights on that
offering. It publishes the offering, all its modules, and all its items in one
transaction and records an audit event. This is how the acceptance criterion
("instructor can publish a course") is met without an administrator editing rows,
and it is why faculty do not receive a tenant-wide publish permission: the
service scopes the permission to the courses they teach.

Unpublishing sets the offering back to `DRAFT` and leaves content untouched.

### 4. Rich text is sanitised, not trusted

Lesson text is stored as HTML from a fixed allowlist (headings, lists, links,
code, emphasis) using `sanitize-html`. It is sanitised on write and again on
render, and link `href`s are restricted to `http`, `https`, and `mailto`. This
prevents stored XSS from a compromised staff account, which matters because the
viewer injects the HTML with `dangerouslySetInnerHTML`.

### 5. Files are private, proxied, and adapter-based

The `StorageAdapter` interface has two implementations:

- **local** — files under `.data/storage`, atomic writes, path-traversal checks.
  This is the development and test mode and the only one exercised here.
- **s3** — any S3-compatible endpoint, signed with a small purpose-built SigV4
  signer. Installed but **unverified against a real bucket**; it throws
  `StorageNotConfiguredError` (mapped to `503`) instead of pretending, and the
  runbook lists the checks needed before it can be called configured.

Downloads go through `/api/v1/content/[itemId]/file`, which resolves the session,
runs the same visibility check as the viewer, and only then reads bytes. Responses
are `private, no-store`, `Content-Disposition: attachment`, `nosniff`, and
sandboxed. There are no public or signed URLs, so a leaked construct cannot be
shared beyond the session it was authorised for.

### 6. Progress and learning events are separate records

`ContentProgress` holds one row per (item, learner) with status and timestamps;
`LearningEvent` is append-only (`content.viewed`, `content.completed`,
`content.reopened`). Completion is learner-declared in Phase 5 because there are
no assessments yet; Phase 6+ can replace that trigger without changing the
records. Viewing a completed lesson never regresses its status.

### 7. Copy copies content only

`copyCourseContent` requires an empty target, copies modules, items, prerequisites,
and file bytes to fresh storage keys, and writes an audit event. It deliberately
does not copy enrolments, instructors, progress, or learning events; a test
asserts the target has no enrolments and no progress.

## Consequences

- Availability is evaluated against UTC timestamps; the learner's profile
  timezone is not applied to lesson windows yet (stated in the viewer).
- Module prerequisites are validated for loops and cross-offering references at
  write time; a cycle cannot be stored.
- The viewer buffers a downloaded file up to 25 MB. Range requests and streaming
  are deferred, and the limit is enforced in the service.
- Teaching assistants can author content when assigned to the offering, but they
  cannot publish, because they do not hold `content.publish`.
- The object-storage integration remains a documented, unverified adapter rather
  than a claimed working integration.
