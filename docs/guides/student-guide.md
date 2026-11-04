# Student guide

## Signing in

Open `/sign-in` and use the email your institution invited. There is no public
sign-up. If you belong to more than one institution, choose one after signing in;
the choice is checked against your memberships, not taken from a link.

Forgotten password? Use `/forgot-password`. In development the message is captured
at `/dev/mail`; outside development your institution must have email delivery
configured, and until then the message is stored rather than sent.

## Your courses

`/student/courses` lists the courses you are actively enrolled in and published.
Inside a course:

- A lesson opens only when the course is published, the lesson is published, it is
  inside its availability window, and every prerequisite module is complete.
  Otherwise it is labelled `opens later`, `closed`, or `locked`, and the content is
  not sent to your browser.
- **Mark complete** records progress. Completing every lesson in a module unlocks
  the next module.
- Lessons can be rich text, files, links, or video links. Files download through an
  authorised route; another institution's file returns "not found".

## Assignments

`/student/assignments` lists every published assignment with its state and, after
release, your mark. Open one to read the brief and **Save draft** or **Submit for
grading**. The receipt shows the time, attempt number, and whether it was late.
Submitting the same work twice returns the same receipt instead of creating a
duplicate. Released feedback and rubric comments appear below the form; unreleased
marks are never sent to your browser.

## Quizzes

Quizzes appear under the course while open. Start an attempt when you are ready:
the deadline is set by the server, **Save progress** does not extend it, and the
attempt submits automatically when time runs out. Objective questions score
immediately; essays wait for your instructor. Results stay hidden until released.

## Checking in to a live class

Your lecturer may show a QR code at the start of a live class. Scan it with your
phone, sign in to the same institution, and press **Check in now**. You are marked
present for that session only. The page tells you if you are already marked — a
second scan, or a mark your lecturer already made, is never overwritten. The code
expires after a few minutes and stops working as soon as a new one is shown, so ask
for a fresh code rather than reusing a screenshot.

## Calendar, messages, and notifications

`/calendar` combines live sessions, assignment due dates, and quiz closing times
for the courses you are enrolled in. Course **messages** reach your teaching team
and stay inside the course. `/notifications` collects in-app notices; you can turn
in-app or email delivery off per category at `/account/notifications`.

## Certificates

`/student/certificates` shows awards issued to you and how close each course is to
eligibility. A certificate carries a public verification link (`/verify/…`) that
shows your name, the course, the issuer, the date, and whether the award is valid;
it never shows your email, grades, or any other learning record. If an award is
revoked or replaced, the same link explains the current status.
