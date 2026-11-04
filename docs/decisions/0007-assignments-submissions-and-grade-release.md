# ADR 0007 — Assignments, submissions, and grade release

## Context

Phase 6 adds the first assessment workflow: instructors create assignments,
learners submit work, instructors grade it, and learners see results. The
specification requires a submission receipt and history, a distinction between a
saved draft and a submitted attempt, configurable late and resubmission rules,
rubric grading with feedback, grade release control, and an audit trail for
overrides. It also requires that unreleased grades are never visible and that a
retried submission does not create duplicates.

The existing model already supplies course offerings, instructors, enrolments,
private file storage, audit events, and a mail outbox. Those are reused rather
than duplicated.

## Decisions

1. **One submission row per learner per assignment.**
   `assignment_submissions` has a unique index on `(assignment_id, user_id)`.
   Drafts, submissions, and resubmissions update that row; the attempt number and
   version increase. This makes the submit action naturally idempotent at the
   database level: a second request cannot create a second row.

2. **Text history is append-only; files are current-attempt metadata.**
   Every distinct body is written as a new `submission_text_versions` row, so a
   learner can see what changed and a teacher can review earlier attempts without
   a mutable blob. `submission_file_links` describes the files of the current
   attempt; replacing a file replaces its metadata and object, and the previous
   object is deleted. File versioning is deliberately out of scope for this phase.

3. **The window and the deadline are different things.**
   `available_from`/`available_until` are a hard window. `due_at` defines lateness.
   After `due_at` an assignment is `past_due`: accepted and flagged late when the
   policy allows, refused otherwise. Once `available_until` passes, nothing is
   accepted even with a late policy. The same pure functions in
   `modules/assignments/rules.ts` drive both enforcement and the explanation shown
   in the UI.

4. **Resubmission is bounded and never replaces graded work.**
   Resubmission requires the policy flag and an unused attempt. A submitted work
   may be replaced; a graded one may not, because the teacher would otherwise have
   graded work that has since changed. Reopening graded work is a later feature,
   not an implicit behaviour.

5. **Grades are drafts until explicitly released.**
   A grade is created with `grade_status = draft`. Learner reads (`getLearnerAssignment`,
   `listLearnerAssignments`) return the grade only when it is released and has a
   `released_at` timestamp. Release is a separate permission (`grades.publish`), so
   grading and publication can be different people.

6. **Overrides need `grades.update` and a reason.**
   Changing a released grade requires `grades.update` and a reason of at least
   three characters. The change writes a `grade_change_events` row (old/new score
   and status, actor, reason, request ID) and an audit event in the same
   transaction. An override returns the grade to draft status, so the learner does
   not see the new mark until it is released again.

7. **Rubrics are immutable once grades exist.**
   Criteria and per-criterion scores are stored separately. Replacing a rubric
   after a grade exists would discard its scores, so the service refuses it and
   asks the teacher to clear the grades first.

8. **Release notification reuses the mail outbox.**
   Releasing a grade writes a message to `email_messages`. Development shows it at
   `/dev/mail`; production records that no provider is configured. The release
   itself has already committed, so a notification failure is logged and does not
   roll the grade back.

9. **File attachments use the existing private storage adapter.**
   Submission files are stored under `tenants/<tenant>/assignments/<assignment>/submissions/…`
   and are never public. `/api/v1/submissions/<fileId>/file` authorises the owner or
   teaching staff before reading bytes; another institution's file is `404`.

## Consequences

- A double-click, a retried request, or a refreshed form cannot create duplicate
  submissions or attempts.
- Teachers can work on grades privately and release in batches; learners cannot
  discover an unreleased mark through the API or the page.
- The submission flow is honest about late work without automating penalties; the
  late flag and timestamps give the teacher the evidence to apply policy.
- File history is limited to the current attempt. If institutions need every
  submitted file version, the schema already has the room (`version` on the
  submission) but the object-versioning policy must be decided first.
- Group assignments, peer review, and reopening graded work are not modelled yet;
  they would add their own tables rather than overloading the submission row.
- The rubric lock is intentionally strict. A richer authoring model would need
  criterion versions referenced by scores, which is a Phase 8 gradebook decision.
