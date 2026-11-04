# ADR 0008 — Quiz engine, versioned questions, and result release

- **Status:** accepted
- **Date:** 2026-11-01
- **Phase:** 7

## Context

Phase 7 adds the second assessment workflow: reusable questions, quizzes, timed
attempts, autosave, objective scoring, essay grading, and a result-release
policy. The specification requires that correct answers stay server-side until
release allows them, that question and quiz edits must not rewrite completed
attempts, and that submit and timeout cannot finalise the same attempt twice.

Phase 6 already supplies offerings, enrolment, instructor assignment, audit
events, and a mail outbox. Its `Grade` table is assignment-specific
(`assignment_id` and `submission_id` are required). Quizzes therefore keep
their own score records until Phase 8 unifies the gradebook.

## Decisions

1. **Attempts snapshot question versions, never live questions.**
   Publishing a question writes an immutable `question_versions` row. Starting
   an attempt copies those versions (and shuffled option order) into
   `quiz_attempt_items`. Later edits create a new version and leave historical
   attempts untouched.

2. **Answer keys never travel in learner payloads.**
   `answer_key_json` is stored on versions. Learner DTOs omit it until the
   release policy says results may be shown. Instructor views may include keys.

3. **One in-progress attempt per learner per quiz.**
   `quiz_attempts` is unique on `(quiz_id, user_id, attempt_number)`. A partial
   unique index allows at most one `in_progress` row per `(quiz_id, user_id)`.
   Starting while one is open resumes it.

4. **Finalise is a single idempotent transition.**
   Submit and timeout share `finaliseAttempt`. The update matches
   `status = in_progress`. A second caller sees zero rows updated and returns
   the stored terminal attempt. Objective items are scored in that transaction;
   essays stay unscored until a teacher with `submissions.grade` writes a mark.

5. **The server owns the clock.**
   `deadline_at` is computed at start from the time limit plus quiz-wide extra
   minutes. Autosave after the deadline is refused and the attempt is finalised
   as timed out. The runner displays remaining time from that timestamp, not
   from a client timer.

6. **Randomisation is shuffle-only in this phase.**
   Quiz question refs point at explicit questions. Shuffle of question order
   and option order is snapshotted on start so review matches what the learner
   saw. Live random-from-bank selection is deferred: it is hard to reproduce
   and easy to leak keys.

7. **Scores live on the attempt, not on `grades`.**
   `quiz_attempts.score` and per-item `quiz_answers.score` are the source of
   truth. Phase 8 will fold these into the gradebook. Manual result release
   (`grades.publish`) sets `quizzes.released_at` when the policy is `manual`.

8. **Release policy is a quiz setting.**
   `never` hides scores and keys. `on_submit` shows them after a terminal
   attempt. `after_until` waits for `available_until`. `manual` waits for
   `released_at`. Objective scores may exist internally before any of these.

## Consequences

- A refresh or retried submit cannot duplicate an attempt or drop the last
  acknowledged autosave (`saved_at` on each answer).
- Teachers can change a bank without rewriting yesterday's sitting.
- Teaching assistants with `submissions.grade` can mark essays on courses they
  can access; they cannot author quizzes (`assessments.manage` is required).
- Matching questions, per-learner extra time, question CSV import, and
  gradebook columns are later decisions.
