# Faculty guide

You teach the offerings you are assigned to. An administrator assigns instructors
and manages the roster; holding a teaching role alone never opens another
teacher's course.

## Your courses

`/faculty/courses` lists the offerings you can author. Open one to edit modules and
items, set availability windows and module prerequisites, move items, and publish.
**Publish course** releases the offering and every item marked published in one
step; **Unpublish** hides it without deleting anything. **Preview as learner** shows
drafts and future lessons without recording progress. A new empty course can copy
modules and items from another course you manage — enrolments, grades, and progress
are never copied.

## Assessment

- **Assignments** — `/faculty/assignments`, or the link on a course. Create with a
  submission type, points, due/availability window, late policy, and optional
  resubmissions. Drafts are invisible until published. Grade from the queue, score
  rubrics, and release marks explicitly. Changing a released grade needs
  `grades.update` and a written reason; every change is in the grade history.
- **Quizzes** — question banks and quizzes under the course. Publishing a quiz
  requires its questions to be published. Essay and short-answer items wait in the
  grading queue; objective items score automatically. Results stay hidden until you
  release them.
- **Gradebook** — `/faculty/courses/[offeringId]/gradebook`. Configure the scheme and
  weights, excuse assessments with a reason, preview the offering before release,
  and export the whole cohort as CSV. A missing mark stays missing; it is never
  averaged as a zero.

## Delivery and communication

- **Live sessions** — schedule, reschedule, or cancel; a change notifies the enrolled
  cohort once per learner. The attendance roster upserts one mark per learner, and
  the attendance report excludes cancelled and future sessions.
- **QR check-in** — on a session's attendance page, **Open check-in** shows a code
  that lasts up to two hours (ten minutes by default). Learners scan it and mark
  themselves present; a second scan changes nothing, and a mark you already made is
  never overwritten. **Close the code** ends it early, and generating a new code stops
  the old one working immediately. The code only proves that a signed-in, enrolled
  learner opened the link — treat it as a convenience, not as proof of presence.
- **Announcements** and **discussions** live on the course. Publishing an
  announcement notifies enrolled learners. Moderation hides content instead of
  deleting it, so a decision can be reversed and audited.
- **Messages** are learner-to-teaching-team and staff-to-cohort; they stay inside the
  offering and notify in the app only.
- **Outcomes** — define course outcomes, map them to programme outcomes on the
  policy's scale, attach assessment evidence, and download the evidence CSV. No
  attainment number is calculated: the institution has not confirmed a formula, and
  the screen says so instead of inventing one.

## Certificates

Open the course's **Certificates** screen to configure completion rules and issue
awards. Rules never hide course material. A learner who does not meet them is shown
the exact gaps. Issuing twice returns the existing award; **Reissue** replaces an
award (for a corrected name) and keeps the old one visible as replaced; **Revoke**
requires a reason and keeps the public verification page explaining the status.

## Working with learners

Learners see published content only when enrolled, inside the availability window,
and with prerequisites met. If someone reports a missing course, check the offering
status, their enrolment status, and whether they are signed in to the right
institution before assuming a bug. Quote a request ID from an error page when you
report a problem.
