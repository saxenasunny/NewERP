# ADR 0005 — Academic structure, catalogue separation, and CSV imports

- **Status:** accepted
- **Date:** 2026-10-30
- **Phase:** 4

## Context

Phase 4 has to let an institution describe itself (years, terms, departments,
programmes, cohorts, sections), catalogue its courses, schedule those courses into
terms, staff and fill them, and bulk-load people and enrolments from spreadsheets.
The data is long-lived and audit-relevant: a term boundary is never just a UI hint,
and a duplicate enrolment is a reporting error that surfaces much later.

Acceptance criteria in the specification: the structure must be configurable
entirely through the UI, CSV errors must be visible per row, repeated imports must
not create uncontrolled duplicates, and a catalogue course must be distinct from a
course offering.

## Decisions

### 1. Explicit hierarchy, no polymorphic "academic unit"

`AcademicYear → Term`, `Department → Programme → Cohort → Section`, and
`Course → CourseOffering → (CourseInstructor | Enrolment)` are separate tables with
real foreign keys. Every row carries `tenantId` directly, even where a parent
already implies it, so tenant scoping is a single predicate rather than a join.

Natural keys are enforced in the database: `(tenant, year name)`,
`(year, term name)`, `(tenant, department code)`, `(tenant, programme code)`,
`(programme, year, cohort name)`, `(cohort, section name)`, `(tenant, course code)`,
`(course, term, section)` for offerings, and `(offering, user)` for instructors and
enrolments. The last one is what makes re-running an import safe.

### 2. Dates are validated server-side, in the service

A term must fall inside its academic year, an offering must run inside its term, and
a section belongs to exactly one cohort. These are checked in `modules/academics`
against the stored parent row inside the same transaction, not in the page component
and not only in the form. The UI repeats the rule for feedback; the service is the
control.

### 3. Archive instead of delete

Academic years, courses, and offerings use status enums
(`PLANNED | ACTIVE | ARCHIVED`, `DRAFT | PUBLISHED | CLOSED`, …). Destroying a year would
orphan historical offerings and grades, so the screens offer archive/status changes.
Structural rows that are genuinely unused can still be removed by the service only
when no dependent record exists (the database's `RESTRICT` foreign keys enforce it).

### 4. Catalogue and offering are different objects

A `Course` is reusable: code, title, credits, description, status. A
`CourseOffering` is one delivery of that course in one term, optionally for one
section, with its own dates and status. Instructors and enrolments attach to the
offering only. The seed deliberately creates the same `CS101` catalogue course in two
terms to make the separation visible, and the offering screen repeats it in its copy.

### 5. Institutional IDs are text on the membership

Student and staff identifiers live on `tenant_memberships.institutionalId`, are
unique per tenant, and are stored as text so leading zeros and letters survive. They
are optional because existing members predate the import; the importer refuses to
move an ID that already belongs to someone else.

### 6. Imports are two-phase and row-addressable

`previewImport` parses the file, validates every row against the tenant's current
data, and persists an `ImportJob` plus one `ImportRow` per line with
`VALID | INVALID | CREATED | UPDATED | SKIPPED | FAILED` and a human message. Nothing
else is written. `commitImport` re-resolves every valid row inside one transaction,
applies it by natural key (create, update, or skip when identical), and records the
counts plus an audit event. Consequences:

- Errors are per row and downloadable as CSV, so an operator can fix only what is
  broken.
- A committed job cannot be committed twice, and a re-upload of the same file
  updates instead of duplicating.
- Rows that stopped resolving between preview and commit (a renamed course, a
  deleted section) are marked `FAILED` instead of aborting the whole batch.
- Commit is synchronous and bounded (2 MB, 2000 rows). No job queue is introduced
  for a workload that a single request can finish; a queue remains a Phase 12
  concern for larger files.

The parser is a small RFC 4180-style reader (quoted fields, escaped quotes, newlines
inside quotes, CRLF, UTF-8 BOM). It refuses a file whose header lacks required
columns rather than guessing a delimiter or encoding.

### 7. Permissions

`academic_structure.manage`, `courses.create`, `courses.read`, `enrolments.manage`,
and `users.import` gate the new operations, all through the central catalogue and
`requirePermission`. Institution administrators hold all of them; faculty hold
`courses.read` and see rosters read-only; students have no administrative access.
Cross-tenant identifiers return 404 exactly like unknown ones.

## Consequences

- Adding a field to a structure entity means touching the schema, the service's Zod
  schema, the screen, and the seed — deliberate, since each is a real decision.
- The structure cannot be bulk-imported yet; only people, enrolments, and instructor
  assignments have CSV support. Structure is low-volume and validated interactively.
- Imports are synchronous; a future queue must preserve the same row-status contract
  rather than introducing a second reporting format.
- Sections are optional on an offering, which supports whole-cohort delivery without
  inventing a synthetic section.
