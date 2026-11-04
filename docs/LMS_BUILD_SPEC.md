# Complete Learning Management System (LMS)

## Product Requirements, Architecture, UX, Data Model, Workflows, and AI-Agent Build Plan

**Document type:** Build-ready PRD + technical implementation blueprint\
**Version:** 1.0\
**Date:** 29 October 2026\
**Primary target:** Higher-education institutions (universities and
colleges), with architecture that can later support corporate training
and independent training providers.\
**Implementation approach:** Deliver a verified, usable vertical slice
in small phases. Do not attempt to generate the entire product in one
pass.

------------------------------------------------------------------------

# 1. Mission and product definition

Build a production-oriented, multi-tenant Learning Management System
(LMS) that allows an institution to manage the complete digital
teaching-and-learning lifecycle:

1.  Configure an institution, academic structure, terms, users, roles,
    and permissions.
2.  Create courses, map them to programmes/sections, assign faculty, and
    enrol learners.
3.  Build course content from modules, lessons, documents, video, links,
    SCORM packages, and learning activities.
4.  Publish content and deliver it through a clear student learning
    experience.
5.  Run assignments, quizzes, question banks, rubrics, grading,
    feedback, and gradebook workflows.
6.  Schedule live sessions, record attendance, and manage class
    communication.
7.  Track participation, progress, completion, certificates, and learner
    risk.
8.  Support higher-education outcomes: CO/PO/PSO mapping, attainment
    calculations, and evidence-based reports.
9.  Give administrators, faculty, students, and managers dashboards
    appropriate to their responsibilities.
10. Provide secure APIs, audit logs, imports/exports, notifications,
    backups, and operational monitoring.

## 1.1 Product boundaries

This is an **LMS first**, not a full replacement for every ERP function.
The first release should own learning workflows and integrate with an
existing Student Information System (SIS)/ERP where necessary.

### In scope for the core product

-   Tenant/institution management and role-based access.
-   Academic structure and course offerings.
-   User management, enrolment, and cohort/batch management.
-   Course authoring and delivery.
-   Assessments, submissions, grading, gradebook, and feedback.
-   Live-class scheduling and attendance.
-   Announcements, discussions, messaging, and notifications.
-   Learning progress, analytics, completion, and certificates.
-   OBE mapping and attainment reports for higher education.
-   CSV import/export, API foundations, audit, security, accessibility,
    and responsive UI.

### Later / optional scope

-   Full fee collection, payroll, HRMS, admissions, hostel, transport,
    library, timetable generation, and finance: integrate with ERP
    rather than rebuilding them in the initial LMS.
-   Native iOS/Android applications: begin with a mobile-responsive
    Progressive Web App (PWA).
-   Proctoring, biometric attendance, plagiarism detection, paid course
    marketplace, AI tutoring, skill ontology, and advanced adaptive
    learning: add only after the core LMS is reliable.
-   Live video infrastructure: integrate with a supported conferencing
    provider; do not build a video-conferencing engine from scratch.

## 1.2 Product principles

-   **Workflow completeness:** Every visible action must work, persist
    data, validate inputs, and show success/error states.
-   **Role clarity:** Users see only the institutions, courses, records,
    and actions they are authorized to access.
-   **Tenant isolation:** One institution must never access another
    institution's records.
-   **Configuration over hard-coding:** Academic years, grading scales,
    course rules, and deadlines must be configurable.
-   **Auditability:** Important administrative, assessment, grading, and
    permission changes must be recorded.
-   **Accessible by default:** Keyboard navigation, semantic labels,
    focus states, contrast, and screen-reader-friendly controls.
-   **Incremental delivery:** Each phase must compile, run, pass tests,
    and leave the application in a working state.
-   **Human approval for consequential AI actions:** AI can draft or
    recommend, but must not silently publish content, change grades, or
    send high-impact decisions.

------------------------------------------------------------------------

# 2. Product references and interpretation

The supplied websites are reference points for feature coverage and
product expectations, not a request to copy proprietary UI, text, or
code.

  -----------------------------------------------------------------------
  Reference               Capabilities to learn   How to apply them
                          from                    
  ----------------------- ----------------------- -----------------------
  Canvas LMS              Course modules, pages,  Make course delivery
                          assignments,            and faculty/student
                          discussions, quizzes,   workflows the core
                          gradebook, feedback,    experience
                          outcomes, analytics,    
                          mobile access           

  MasterSoft ERP / OBE    Academic                Add higher-education
                          administration,         configuration and OBE
                          assessment workflows,   as a dedicated module
                          CO/PO/PSO mapping,      
                          attainment and          
                          institutional reporting 

  Edmingle                Program/course/batch    Model course offerings
                          operations, live        and cohorts clearly;
                          classes, learner        support scheduled
                          engagement, training    learning
                          workflows               

  Disprz                  Learning journeys,      Add optional pathways,
                          microlearning,          badges,
                          personalized discovery, recommendations, and
                          gamification, skills    engagement analytics
                          and analytics           after core delivery

  Workday                 Enterprise-grade        Use explicit
                          administration,         permissions, audit,
                          security, integration   integration boundaries,
                          mindset, scalable       and operational
                          operations              controls
  -----------------------------------------------------------------------

Reference URLs: - Workday ERP:
https://www.workday.com/en-in/enterprise-resource-planning.html -
MasterSoft ERP: https://cims.mastersofterp.in/ - Edmingle:
https://www.edmingle.com/ - Canvas login/reference:
https://cloud.canvaslms.net/login/canvas - Canvas product:
https://www.instructure.com/canvas - Disprz LMS:
https://disprz.ai/learning-management-system-ind - MasterSoft OBE:
https://www.iitms.co.in/outcome-based-education/

Important: The Canvas URL supplied is a login endpoint, not a public
product specification. Do not assume access to its private screens or
undocumented behaviour. Confirm final scope with stakeholders before
implementation.

------------------------------------------------------------------------

# 3. Users, roles, and permissions

Use RBAC (role-based access control) plus resource-level checks. A role
grants capabilities, but every API must also verify tenant and resource
scope.

## 3.1 Roles

### Platform Super Admin

-   Create, suspend, and configure tenants.
-   View platform-level health and aggregate usage.
-   Manage global feature flags and platform settings.
-   Support tenant administrators without automatically browsing their
    learning data.
-   Access sensitive tenant data only through explicit, audited support
    procedures.

### Institution Admin

-   Configure institution profile, logo, academic years, terms,
    programmes, departments, courses, sections, and grading policy.
-   Invite/import users and assign institution roles.
-   Assign faculty, enrol students, configure course templates, and
    manage integrations.
-   View institution-level reports.
-   Configure retention, notification, and academic workflow settings.

### Academic Coordinator / HOD

-   View assigned department/programme courses and faculty.
-   Review course outlines and teaching plans.
-   Monitor course delivery, attendance, assessments, and OBE outcomes.
-   Approve or return selected academic artefacts if an approval
    workflow is enabled.
-   Cannot change grades unless explicitly granted a permission.

### Faculty / Instructor

-   Access assigned courses and their enrolled learners.
-   Create and publish modules, lessons, assignments, quizzes,
    announcements, and discussions.
-   Schedule classes and record attendance.
-   Grade submissions, provide feedback, and publish grades.
-   View progress and course-level reports.
-   Export course data within permission boundaries.

### Teaching Assistant / Evaluator

-   Access only explicitly assigned courses and activities.
-   Grade assigned submissions or moderate discussions.
-   Cannot change course ownership, enrolments, institution settings, or
    final grades unless granted permission.

### Student / Learner

-   View courses in which they are enrolled.
-   Access published course content and eligible activities.
-   Submit work, attempt quizzes, view feedback and released grades.
-   Join live sessions, participate in discussions, track progress,
    download permitted resources, and manage notification preferences.

### Parent / Observer (optional)

-   Read-only access to specifically linked learner progress.
-   No submission, grading, or private messaging as the learner.
-   Must require an explicit institution-approved linking and consent
    workflow.

### Corporate Manager (future, optional)

-   View assigned employees' learning progress and completion.
-   Assign learning paths within their organisational scope.
-   No access to unrelated learner records or confidential assessment
    content.

## 3.2 Permission implementation

Create a central permission catalogue, for example: - `tenant.manage` -
`institution.settings.manage` - `users.read`, `users.create`,
`users.update`, `users.deactivate`, `users.import` -
`academic_structure.manage` - `courses.create`, `courses.read`,
`courses.update`, `courses.publish`, `courses.archive` -
`enrolments.manage` - `content.create`, `content.publish`,
`content.delete` - `assessments.manage`, `submissions.submit`,
`submissions.grade` - `grades.read`, `grades.update`, `grades.publish` -
`attendance.manage`, `attendance.read` - `reports.course.read`,
`reports.institution.read` - `obe.manage`, `audit.read`,
`integrations.manage`

Rules: 1. Deny by default. 2. Check both permission and resource scope
on the server. 3. Never rely on hiding a button as the only access
control. 4. Prevent students from accessing another student's
submission, feedback, or personal information. 5. Prevent instructors
from accessing courses not assigned to them unless an explicit
administrative permission allows it. 6. Log role changes, permission
changes, grade changes, bulk imports, exports, and publication events.
7. Add automated tests for both allowed and denied access.

------------------------------------------------------------------------

# 4. Information architecture and navigation

## 4.1 Global application shell

-   Left navigation sidebar, collapsible on smaller screens.
-   Top bar: institution switcher (only for users in multiple tenants),
    global search, notifications, help, profile menu.
-   Breadcrumbs on nested pages.
-   Main content area with consistent page title, primary action,
    filters, table/list, empty state, loading state, and error state.
-   Responsive layouts for desktop, tablet, and mobile.
-   Avoid dashboards made entirely of decorative cards. Every metric
    should link to the underlying filtered records.

## 4.2 Admin navigation

1.  Overview
2.  Academic Setup
    -   Academic Years and Terms
    -   Faculties/Schools and Departments
    -   Programmes and Cohorts
    -   Courses and Course Offerings
    -   Sections/Batches
3.  People
    -   Students
    -   Faculty and Staff
    -   Roles and Permissions
    -   Imports and Invitations
4.  Course Operations
    -   Course Catalogue
    -   Enrolments
    -   Course Templates
    -   Publication Status
5.  Assessments
    -   Assessment Overview
    -   Grade Release
    -   Moderation / Re-evaluation (if enabled)
6.  Attendance and Live Classes
7.  Learning Analytics
8.  OBE and Accreditation
9.  Certificates
10. Integrations
11. Notifications and Templates
12. Audit Logs
13. Institution Settings

## 4.3 Faculty navigation

1.  My Dashboard
2.  My Courses
3.  Course Content
4.  Assignments
5.  Quizzes and Question Banks
6.  Submissions and Grading
7.  Gradebook
8.  Live Classes
9.  Attendance
10. Announcements and Discussions
11. Learner Progress
12. Course Outcomes
13. Reports
14. Course Settings

## 4.4 Student navigation

1.  Home / My Learning
2.  My Courses
3.  Calendar and To-do
4.  Assignments
5.  Quizzes
6.  Grades and Feedback
7.  Live Classes
8.  Discussions
9.  Learning Paths (optional)
10. Certificates
11. Notifications
12. Profile and Preferences

------------------------------------------------------------------------

# 5. Core end-to-end workflows

## 5.1 Institution onboarding

1.  Platform admin creates a tenant or an approved self-service
    onboarding flow creates a pending tenant.
2.  Institution admin enters institution name, timezone, locale, logo,
    primary contact, and academic configuration.
3.  System creates the first institution administrator and records the
    event.
4.  Admin configures academic year, terms, departments, programmes,
    course catalogue, grading scale, and attendance policy.
5.  Admin imports or invites faculty and students.
6.  System validates import rows and provides a downloadable error
    report.
7.  Admin assigns users to programmes, cohorts, sections, and course
    offerings.
8.  Faculty are assigned to course offerings.
9.  Admin/faculty creates a course from a template, adds content,
    previews it as a student, and publishes it.
10. Students see the course on their dashboard only after enrolment and
    publication rules are satisfied.

**Completion criteria:** A new tenant can be configured without a
developer editing the database manually.

## 5.2 Course creation and publication

1.  Instructor selects an assigned course offering.
2.  Instructor edits course title, description, outcomes, dates,
    visibility, and settings.
3.  Instructor creates modules and lessons.
4.  Instructor adds content items: rich text, files, links, embedded
    video, assignments, quizzes, or discussions.
5.  Instructor reorders items and sets availability/prerequisite rules.
6.  Instructor previews the course as a student.
7.  System validates required fields, broken references, missing
    content, and invalid dates.
8.  Instructor publishes the course or schedules publication.
9.  Students receive a notification according to their preferences.
10. Subsequent edits show draft/published state and preserve audit
    history.

**States:** `draft → published → archived`; publication and archive
actions require permission. Do not make a course public merely because a
lesson exists.

## 5.3 Student learning journey

1.  Student signs in and sees active courses, deadlines, announcements,
    and recent feedback.
2.  Student opens a course and sees progress, modules, next activity,
    course outcomes, and course communication.
3.  Student opens a lesson; the system records a meaningful
    view/completion event without counting every refresh as a new
    completed lesson.
4.  Student completes required activities and marks eligible lessons
    complete.
5.  Student starts an assignment or quiz.
6.  System checks deadlines, attempt limits, availability, and
    enrolment.
7.  Student submits work; the system stores a submission receipt and
    timestamp.
8.  Faculty grades it and releases feedback/grade.
9.  Progress and dashboards recalculate consistently.
10. Course completion and certificates are awarded only when configured
    requirements are met.

## 5.4 Assignment workflow

`Draft → Published/Open → Submitted → Grading → Graded → Released` -
Allow late submissions according to course policy. - Distinguish a saved
draft from a submitted attempt. - Record submission timestamp, file
references, version, and late status. - Prevent edits after submission
unless resubmission is allowed. - Support individual and group
assignments as separate supported modes. - Support rubric grading,
inline/general feedback, attachment feedback, and grade overrides with
audit history. - Notify the learner when feedback is released. - Do not
expose unpublished grades to students.

## 5.5 Quiz workflow

1.  Instructor builds a question bank and quiz blueprint.
2.  Instructor configures availability, duration, attempt count,
    randomisation, shuffle, grading method, feedback release, and
    accommodations.
3.  System validates quiz configuration before publication.
4.  Student starts an attempt; the server records start time and attempt
    status.
5.  Answers autosave to the server at safe intervals and on navigation.
6.  If connection is interrupted, show save status and recover the last
    acknowledged answer.
7.  On submit or timeout, finalise the attempt idempotently.
8.  Auto-grade objective questions; queue subjective questions for
    grading.
9.  Apply the configured scoring policy and publish results only when
    permitted.
10. Log attempt start, autosave failures, submission, grading, and
    result release.

**Security:** Never send correct answers to the browser before the
attempt is submitted and the release policy allows them. Server-side
timing and attempt validation are authoritative.

## 5.6 Attendance workflow

1.  Faculty selects course offering, session/date, and class group.
2.  System loads the authorised roster.
3.  Faculty marks Present, Absent, Late, or Excused according to
    institution configuration.
4.  Faculty saves; system validates duplicate records and records who
    changed what.
5.  Changes after a configurable lock period require an elevated
    permission and a reason.
6.  Students can view their own attendance summary.
7.  Reports calculate percentages using a documented policy for
    cancelled, excused, and partial sessions.

## 5.7 Course completion and certificates

1.  Institution configures completion requirements: required modules,
    activities, minimum grade, attendance threshold, or manual approval.
2.  System evaluates requirements using a repeatable service.
3.  Learner sees incomplete requirements and what remains.
4.  Once requirements pass, system creates a certificate record with
    unique verification ID.
5.  Learner can view/download the certificate.
6.  Public verification reveals only the minimum required certificate
    information.
7.  Revocation or correction is audited.

------------------------------------------------------------------------

# 6. Module-by-module functional requirements

## Module A --- Authentication and account lifecycle

### Features

-   Email/password authentication using a mature authentication
    library/provider.
-   Password reset with single-use, expiring token.
-   Email verification if self-registration is enabled.
-   Invitation-based onboarding.
-   Optional SSO using OIDC/SAML in a later phase.
-   Session expiry, logout, account lock/rate limit, and
    suspicious-login logging.
-   Optional MFA for administrators.
-   Profile: display name, profile photo, timezone, language,
    notification preferences.
-   Account deactivation and data-retention policy.
-   No plain-text passwords, password logging, or reusable reset tokens.

### Acceptance criteria

-   Invalid credentials show a generic error and do not disclose whether
    an email exists.
-   Expired/reset tokens cannot be reused.
-   Deactivated users cannot start new sessions.
-   Every protected API rejects unauthenticated requests.

## Module B --- Tenant and institution management

### Features

-   Tenant creation, status, branding, domain settings, timezone,
    locale, and feature flags.
-   Institution settings: academic calendar, default language, grading
    policy, attendance rules, notification templates, allowed file types
    and size limits.
-   Tenant-level data isolation.
-   Institution-specific custom fields only where required.
-   Tenant lifecycle: pending, active, suspended, archived.
-   Export and deletion workflows consistent with retention/legal
    requirements.

### Acceptance criteria

-   Automated tests prove tenant A cannot read or modify tenant B data
    by changing an ID in a URL or API payload.
-   Suspended tenant users cannot access learning features.
-   Tenant settings are not accidentally shared across institutions.

## Module C --- Academic structure and course catalogue

### Entities

-   Academic year
-   Term/semester
-   School/faculty
-   Department
-   Programme
-   Cohort/batch
-   Section/class group
-   Course catalogue entry
-   Course offering (a specific course in a term/section)
-   Instructor assignment
-   Enrolment

### Features

-   Create/edit/archive academic structures.
-   Validate start/end dates and parent-child relationships.
-   Course code uniqueness within the configured scope.
-   Course credits, description, prerequisites, course outcomes,
    category, and level.
-   Copy course offerings and content from a prior term without copying
    grades/submissions unless explicitly requested.
-   Bulk assign faculty and enrolments.
-   Roster search, filters, and exports.
-   Waitlist is optional; do not implement unless a stakeholder needs
    it.

### Acceptance criteria

-   A course catalogue entry is distinct from a course offering.
-   Students are enrolled in offerings, not merely catalogue entries.
-   Copying a course does not accidentally duplicate learner personal
    data or previous grades.

## Module D --- User directory and bulk import

### Features

-   Create/invite/update/deactivate users.
-   Assign roles with scope.
-   CSV import for students, faculty, enrolments, and course
    assignments.
-   Preview before import.
-   Validate headers, required fields, duplicate emails/IDs, invalid
    references, and malformed rows.
-   Support alphanumeric institutional IDs; treat them as strings, not
    numbers.
-   Provide row-by-row success/failure report.
-   Idempotency: rerunning a corrected import must not create
    uncontrolled duplicates.
-   Export only fields allowed by permission.

### Acceptance criteria

-   Admin can test an import before committing it.
-   Invalid rows do not corrupt valid rows.
-   All import runs are auditable and downloadable.
-   Large imports run in background jobs and show progress.

## Module E --- Course authoring and content management

### Content types

-   Rich-text page
-   File/document
-   Video link or supported embedded video
-   External link
-   SCORM package (planned after core release)
-   Assignment
-   Quiz
-   Discussion
-   Live-class link
-   Survey/poll (optional)
-   Learning resource collection

### Features

-   Course modules, submodules/units, lessons, and content items.
-   Drag-and-drop ordering with accessible alternative controls.
-   Draft and published states.
-   Scheduled publication and availability windows.
-   Prerequisites and completion rules.
-   Course templates and course copy.
-   Rich-text editor with sanitised HTML.
-   File upload with size/type validation and malware-scanning
    integration where available.
-   Private object storage; signed URLs or authorised streaming for
    protected files.
-   Preview as learner.
-   Version history for published course content.
-   Detect empty modules, broken links, missing attachments, and invalid
    dates before publishing.
-   Bulk download/export of course content where permitted.

### Acceptance criteria

-   Student cannot fetch a draft item by guessing its ID.
-   Content order is stable after refresh and concurrent edits.
-   Deleting a content item does not leave orphaned file records.
-   Course copy offers explicit choices for content, dates, and
    settings.

## Module F --- Learning experience and progress

### Features

-   My Learning dashboard with current courses, deadlines, progress,
    recent feedback, and announcements.
-   Course landing page with description, instructor, outcomes, modules,
    and progress.
-   Lesson viewer with previous/next navigation.
-   Responsive content for phone, tablet, and desktop.
-   Mark-complete controls where appropriate.
-   Required/optional content indicators.
-   Progress calculated from configured completion rules.
-   Resume last viewed location where supported.
-   Search within enrolled course content.
-   Calendar of due dates and scheduled sessions.
-   Empty, loading, offline, and error states.
-   Avoid counting a page refresh as meaningful progress.

### Progress model

Track events such as `content_viewed`, `lesson_completed`,
`assignment_submitted`, `quiz_submitted`, `live_session_attended`, and
`course_completed`. Define a single source of truth for progress; do not
let separate UI components invent their own percentages.

## Module G --- Assignments and submissions

### Instructor controls

-   Title, instructions, rich content, attachments, due date,
    available-from/until.
-   Points or rubric.
-   Submission type: text, file upload, URL, or configured combination.
-   Individual/group submission.
-   Late submission, resubmission, and attempt policy.
-   Similarity-check integration hook, if later required.
-   Anonymous grading option where institution policy allows it.
-   Publish/release feedback separately from saving a grade.

### Student controls

-   Read instructions and rubric.
-   Save draft text where supported.
-   Upload/remove files before submission.
-   Submit and receive a timestamped receipt.
-   View submission status and resubmission eligibility.
-   View released grade, rubric, and feedback.

### Grading controls

-   Submission queue with filters and sorting.
-   Rubric scoring and overall feedback.
-   Return for revision where enabled.
-   Grade history and reasoned override.
-   Bulk feedback/grade import with validation.
-   Prevent double submission caused by retrying the same request.

## Module H --- Quiz engine and question bank

### Question types for core release

-   Single-answer multiple choice
-   Multiple-select
-   True/false
-   Short answer
-   Essay/long answer
-   Fill in the blank (simple exact-match)
-   Matching (optional if it can be tested thoroughly)

### Question bank

-   Reusable questions, categories/tags, difficulty, author, version,
    points, explanation, and answer key.
-   Questions can be reused across quizzes without modifying historical
    attempts.
-   Random question selection from a bank.
-   Import/export with a documented template.
-   Do not support arbitrary executable code in question content.

### Quiz settings

-   Start/end availability.
-   Time limit.
-   Attempt limit and grading method (highest, latest, or configured).
-   Shuffle questions and options.
-   Randomised question set.
-   Navigation policy.
-   Autosave and recovery.
-   Auto-submit on timeout.
-   Feedback/answer release rules.
-   Accommodations or extra time when authorised.
-   Attempt review and audit log.

### Grading

-   Deterministic server-side scoring for objective questions.
-   Manual grading queue for essays/subjective questions.
-   Clear rules for partial credit and negative marking; default to
    disabled unless configured.
-   Version quiz/question data so changes do not rewrite completed
    attempts.
-   Use decimal-safe numeric handling for marks.

## Module I --- Gradebook and academic results

### Features

-   Gradebook by course offering.
-   Assessment columns with type, weight, points, and release status.
-   Student rows with submission status and scores.
-   Weighted and points-based grading schemes.
-   Configurable grading scale (letters/percentages/points).
-   Missing, late, excused, and not-yet-graded states.
-   Grade preview before release.
-   Bulk score import/export with row-level validation.
-   Grade override with reason and audit trail.
-   Release/publish controls.
-   Student grade view and feedback.
-   Recalculate when configuration changes, with a preview of affected
    learners.
-   Lock or version published results according to institutional policy.

### Important calculation rules

-   Do not silently treat ungraded work as zero unless the grading
    scheme explicitly says so.
-   Do not divide by the weight of missing assessments without a
    documented policy.
-   Store raw points, possible points, weighting, calculated result, and
    calculation-version metadata.
-   Use a single backend grade calculation service and unit tests for
    edge cases.

## Module J --- Live classes, calendar, and attendance

### Features

-   Create session with course, instructor, date/time, timezone,
    duration, meeting provider/link, and cohort.
-   Calendar and list views.
-   Recurring sessions only if recurrence editing/cancellation is
    tested.
-   Reminder notifications.
-   Attendance roster and status.
-   QR-based attendance may be added later with expiry, anti-replay
    protection, and manual correction.
-   Integrate with a video-conferencing provider instead of building
    conferencing.
-   Cancel/reschedule session and notify affected users.
-   Record attendance edits with actor and reason.
-   Attendance percentage calculation follows institution configuration.

## Module K --- Announcements, discussions, and messaging

### Announcements

-   Course-wide or scoped announcement.
-   Draft, publish-now, schedule, edit, and archive.
-   Optional email/in-app notification.
-   Pin important announcements.

### Discussions

-   Threaded topics and replies.
-   Course-scoped access.
-   Moderation, report/flag, lock, pin, and archive.
-   Instructor-only or learner participation settings.
-   Attachment permissions.
-   Prevent HTML/script injection and spam.

### Direct messaging

-   In-app messaging between permitted users.
-   Block or report controls if direct learner-to-learner messaging is
    enabled.
-   Respect institution communication policies.
-   No unauthorised exposure of private messages to course participants.

### Notifications

-   In-app notification centre.
-   Email provider abstraction.
-   User preferences by event category.
-   Templates with safe variable substitution.
-   Retry queue and delivery status.
-   Avoid duplicate notifications when background jobs retry.
-   Critical security notifications cannot be disabled where
    legally/operationally required.

## Module L --- Analytics and reports

### Student dashboard

-   Course progress.
-   Upcoming due dates.
-   Submission and grading status.
-   Quiz scores and released grades.
-   Attendance summary.
-   Recent feedback and recommended next activity.

### Faculty dashboard

-   Course enrolment and activity.
-   Content publication status.
-   Missing/late submissions.
-   Ungraded submissions.
-   Attendance and engagement.
-   Learners at risk using transparent, configurable rules.
-   Course outcome attainment.

### Admin dashboard

-   Active learners and faculty.
-   Course offerings and publication status.
-   Enrolment/import failures.
-   Assessment and grading status.
-   Course completion and attendance.
-   System activity and integration health.
-   OBE summary where configured.

### Reports

-   Course roster.
-   Enrolment by programme/term/section.
-   Assignment submission status.
-   Assessment score distribution.
-   Gradebook export.
-   Attendance by course/student/date.
-   Course completion.
-   User activity and content usage.
-   CO/PO/PSO attainment.
-   Certificate issuance and verification.
-   Audit log exports for authorised administrators.

### Analytics rules

-   Define each metric in documentation.
-   Display date range, timezone, filters, and data freshness.
-   Distinguish zero from missing data.
-   Restrict row-level exports by permission.
-   Use asynchronous jobs for expensive reports.
-   Do not use opaque AI risk scores for high-impact decisions; show the
    underlying indicators.

## Module M --- Outcome-Based Education (OBE)

This is especially relevant for university and college deployments.

### Entities

-   Programme Educational Objective (PEO)
-   Programme Outcome (PO)
-   Programme Specific Outcome (PSO)
-   Course Outcome (CO)
-   CO-to-PO/PSO mapping with configured correlation level
-   Assessment
-   Question/assessment item to CO mapping
-   Student result per assessment item
-   Attainment policy/version
-   Attainment report and evidence snapshot

### Workflow

1.  Admin/coordinator defines PEOs, POs, PSOs, and COs.
2.  Faculty maps course outcomes to assessment questions/items.
3.  Faculty maps COs to POs/PSOs using the institution's scale.
4.  Institution configures direct and indirect attainment methods,
    thresholds, weights, and rounding rules.
5.  Assessment marks are finalised.
6.  System calculates attainment using the configured, versioned policy.
7.  Faculty/coordinator reviews the calculation and missing-data
    warnings.
8.  Approved results are snapshotted for reporting.
9.  Reports show course-wise, student-wise, programme-wise, and
    year-wise attainment.
10. Export supporting data and calculation methodology for accreditation
    evidence.

### Guardrails

-   Do not hard-code a single NBA/NAAC formula as universal truth.
-   Store the policy and calculation version used for each report.
-   Show formula, source assessments, thresholds, mapping weights,
    exclusions, and rounding.
-   Identify insufficient evidence rather than fabricating attainment.
-   Recalculation must not silently overwrite an approved historical
    snapshot.
-   Obtain the institution's exact OBE formula and reporting template
    before treating this module as compliance-ready.

## Module N --- Learning paths, gamification, and recommendations (later phase)

-   Learning paths composed of courses/modules.
-   Prerequisites and completion rules.
-   Badges and points with transparent award criteria.
-   Optional leaderboards with privacy controls.
-   Learner interests/skills profile, if appropriate.
-   Recommendations based on course tags, declared goals, and completed
    learning.
-   Explain why a course was recommended.
-   Allow users to dismiss recommendations.
-   Avoid ranking students in a way that reveals sensitive data or
    creates unsupported high-stakes judgements.

## Module O --- Certificates

-   Institution-branded certificate template.
-   Configurable completion rules.
-   Unique, non-sequential public verification token.
-   PDF generation and secure download.
-   Issued date, learner display name, course/programme, issuer, and
    certificate ID.
-   Reissue/correction/revocation workflow with reason and audit.
-   Verification page reveals only the minimum necessary information.
-   Prevent duplicate issuance with idempotent completion jobs.

## Module P --- Integrations and APIs

### Integration foundations

-   Versioned REST API under `/api/v1`.
-   OpenAPI documentation.
-   API authentication and permission checks.
-   Rate limiting and request validation.
-   Webhooks with signature verification, retries, and idempotency.
-   Integration status, logs, and secret rotation.
-   CSV import/export as a practical first integration mechanism.

### Potential integrations

-   SIS/ERP for users, academic structure, courses, enrolment, and
    official student IDs.
-   Institutional identity provider via OIDC/SAML.
-   Email provider.
-   Video meeting provider.
-   Object storage.
-   SCORM 1.2/2004 and xAPI/LTI integrations as later standards-based
    work.
-   Plagiarism/similarity service if approved.
-   Calendar integration (ICS first; provider-specific sync later).

### Integration rules

-   Identify the system of record for each field.
-   Never store third-party credentials in source control.
-   Use signed webhooks and verify signatures.
-   Make sync jobs idempotent and observable.
-   Provide dry-run, error report, retry, and reconciliation workflows.

## Module Q --- AI-assisted features (later, opt-in)

Potential features: - Draft course outline from a syllabus. - Suggest
quiz questions from instructor-provided content. - Summarise a document
or discussion. - Generate a first draft of feedback comments. - Suggest
relevant resources. - Search course materials using retrieval augmented
generation (RAG).

Safety and quality rules: - Instructor must review and approve
AI-generated academic content before publication. - Do not train
external models on institutional/private data without explicit approval
and appropriate contractual safeguards. - Apply course/tenant access
checks to every retrieval request. - Cite source materials in generated
summaries and question suggestions. - Do not let AI assign final grades
or make disciplinary decisions. - Log model/provider, prompt template
version, source references, and approval status where appropriate. - Add
rate limits, budget controls, data minimisation, and a provider
abstraction. - AI is not a dependency for core course, assignment, quiz,
grading, or attendance workflows.

------------------------------------------------------------------------

# 7. Technical architecture

## 7.1 Recommended initial stack

Use a conventional, well-supported stack that AI coding agents can
implement consistently. Do not change frameworks mid-project without a
documented reason.

### Recommended baseline

-   **Frontend:** Next.js with TypeScript and React.
-   **UI:** Tailwind CSS plus an accessible component system such as
    shadcn/ui; keep tokens and reusable components centralised.
-   **Backend:** Next.js server routes/server actions for the initial
    modular monolith, or a separate TypeScript API service if team scale
    requires it.
-   **Database:** PostgreSQL.
-   **ORM/migrations:** Prisma or Drizzle; select one and use it
    consistently.
-   **Authentication:** Mature managed/auth library supporting secure
    sessions and RBAC integration. Do not hand-roll cryptography.
-   **File storage:** S3-compatible private object storage; use local
    storage only for development.
-   **Background jobs:** A durable queue and worker for emails, imports,
    report generation, certificates, and analytics rollups.
-   **Email:** Provider abstraction with development mail sink.
-   **Testing:** Unit tests, API/integration tests, and browser-based
    end-to-end tests.
-   **Deployment:** Container-friendly or managed deployment with
    managed PostgreSQL, object storage, secrets management, and
    automated backups.
-   **Observability:** Structured logs, error reporting, health checks,
    and basic performance metrics.

The exact provider can be selected after considering budget,
institutional procurement, data residency, and the agent's execution
environment. Keep provider-specific logic behind adapters.

## 7.2 Architecture style

Start with a **modular monolith**, not microservices. It is faster to
build, easier for one AI agent to reason about, and simpler to test.
Keep modules separated in code so high-load components can later be
extracted.

``` text
Browser / PWA
    |
    v
Next.js UI + Accessible Design System
    |
    v
Server/API Layer
    |-- Authentication & Authorization
    |-- Tenant / Institution
    |-- Academic Structure & Enrolment
    |-- Courses & Content
    |-- Assignments & Submissions
    |-- Quiz Engine & Question Bank
    |-- Gradebook
    |-- Attendance & Live Sessions
    |-- Discussions & Notifications
    |-- Analytics & OBE
    |-- Certificates & Integrations
    |
    +------ PostgreSQL
    +------ Private Object Storage
    +------ Background Job Queue / Workers
    +------ Email / Video / SIS / Identity Providers
    |
    v
Logs, Metrics, Audit Events, Backups
```

## 7.3 Suggested repository layout

``` text
lms-platform/
  app/
    (public)/
    (auth)/
    (platform-admin)/
    (institution-admin)/
    (faculty)/
    (student)/
    api/v1/
  components/
    ui/
    forms/
    tables/
    navigation/
    dashboards/
    course/
    assessment/
  modules/
    auth/
    tenancy/
    users/
    academics/
    enrolments/
    courses/
    content/
    assignments/
    quizzes/
    gradebook/
    attendance/
    communication/
    notifications/
    analytics/
    obe/
    certificates/
    integrations/
  lib/
    auth/
    db/
    permissions/
    validation/
    storage/
    email/
    jobs/
    audit/
    observability/
  prisma/                 # or drizzle/, select one
  workers/
  tests/
    unit/
    integration/
    e2e/
    fixtures/
  docs/
    architecture/
    decisions/
    runbooks/
  scripts/
  .env.example
  README.md
```

Do not put all business logic into page components. UI components should
call validated application services; services enforce permissions and
business rules.

## 7.4 Core engineering rules

-   TypeScript strict mode enabled.
-   Validate all incoming input at the server boundary.
-   Use database transactions for multi-step changes that must succeed
    together.
-   Add indexes for tenant IDs, foreign keys, course offering IDs, user
    IDs, dates, and common filter columns.
-   Use cursor pagination or reliable server-side pagination for large
    tables.
-   Use soft deletion only where justified; define how deleted data is
    hidden and eventually purged.
-   Keep timestamps in UTC in storage and render in the
    user's/institution's configured timezone.
-   Use decimal-safe numeric types for marks and weights.
-   Never trust client-side role, tenant ID, price, grade, deadline, or
    quiz timer values.
-   Store files outside the database; store metadata and object keys in
    PostgreSQL.
-   Keep secrets in environment/secret management, never in source code.
-   Provide a seed script with fictional demo data.
-   Use database migrations; never rely on manual production schema
    edits.
-   Add idempotency keys to critical retryable operations such as
    submissions, quiz finalisation, certificate issuance, and imports.

------------------------------------------------------------------------

# 8. Data model and entity relationships

This is a starter logical schema. The coding agent must convert it into
the selected ORM schema, add constraints/indexes, and document all
relationships before implementing feature modules.

## 8.1 Tenant and identity

-   `tenants`: id, name, slug, status, timezone, locale, logo_url,
    created_at, updated_at
-   `institutions`: id, tenant_id, name, code, settings_json,
    created_at, updated_at
-   `users`: id, email_normalized, name, status, timezone, locale,
    avatar_key, created_at, updated_at
-   `tenant_memberships`: id, tenant_id, user_id, status, joined_at
-   `roles`: id, tenant_id nullable for platform roles, name, scope
-   `permissions`: id, key, description
-   `role_permissions`: role_id, permission_id
-   `user_role_assignments`: id, tenant_id, user_id, role_id,
    scope_type, scope_id
-   `sessions` / auth-provider-managed session records
-   `invitations`: id, tenant_id, email, role, token_hash, expires_at,
    accepted_at
-   `audit_events`: id, tenant_id, actor_user_id, action, resource_type,
    resource_id, before_json, after_json, reason, request_id, created_at

## 8.2 Academic structure

-   `academic_years`: id, tenant_id, name, starts_on, ends_on, status
-   `terms`: id, tenant_id, academic_year_id, name, starts_on, ends_on
-   `departments`: id, tenant_id, name, code, parent_department_id
    nullable
-   `programmes`: id, tenant_id, department_id, name, code, level,
    status
-   `cohorts`: id, tenant_id, programme_id, academic_year_id, name
-   `sections`: id, tenant_id, cohort_id, name, capacity nullable
-   `courses`: id, tenant_id, code, title, description, credits, status
-   `course_offerings`: id, tenant_id, course_id, term_id, section_id
    nullable, start_at, end_at, status, settings_json
-   `course_instructors`: id, tenant_id, course_offering_id, user_id,
    assignment_role
-   `enrolments`: id, tenant_id, course_offering_id, user_id, status,
    enrolled_at, source
-   Unique constraints must be defined for applicable codes and active
    enrolments.

## 8.3 Course content

-   `course_modules`: id, tenant_id, course_offering_id, title,
    description, position, status, availability_json
-   `content_items`: id, tenant_id, module_id, type, title, position,
    status, content_json, published_at, version
-   `content_prerequisites`: id, content_item_id,
    prerequisite_content_item_id
-   `content_progress`: id, tenant_id, user_id, content_item_id, status,
    started_at, completed_at, last_position_json
-   `files`: id, tenant_id, uploader_user_id, object_key, original_name,
    mime_type, size_bytes, checksum, scan_status, created_at
-   `content_file_links`: content_item_id, file_id
-   `learning_events`: id, tenant_id, user_id, course_offering_id,
    event_type, resource_type, resource_id, occurred_at, metadata_json

## 8.4 Assignments and grading

-   `assignments`: id, tenant_id, course_offering_id, content_item_id,
    title, instructions, due_at, available_from, available_until,
    points_possible, submission_types_json, settings_json, status
-   `assignment_submissions`: id, tenant_id, assignment_id, user_id
    nullable, group_id nullable, attempt_number, status, submitted_at,
    late_flag, version
-   `submission_files`: submission_id, file_id
-   `submission_text_versions`: id, submission_id, body, created_at
-   `rubrics`: id, tenant_id, course_offering_id, title, criteria_json,
    version
-   `grades`: id, tenant_id, assessment_type, assessment_id,
    learner_user_id, raw_score, points_possible, grade_value, status,
    graded_by, graded_at, released_at, version
-   `grade_feedback`: id, grade_id, body, file_id nullable, created_at
-   `grade_change_events`: id, grade_id, actor_user_id, old_value_json,
    new_value_json, reason, created_at

Use an explicit group entity if group assignments are enabled. Do not
overload a nullable `user_id` without a well-defined group model.

## 8.5 Quizzes

-   `question_banks`: id, tenant_id, course_offering_id nullable, title,
    owner_user_id
-   `questions`: id, tenant_id, question_bank_id, type, prompt_json,
    answer_key_encrypted_or_protected_json, points, tags_json, version,
    status
-   `quizzes`: id, tenant_id, course_offering_id, title, settings_json,
    availability_json, status, version
-   `quiz_question_refs`: id, quiz_id, question_id or bank selector,
    position, points_override, selection_rule_json
-   `quiz_attempts`: id, tenant_id, quiz_id, user_id, attempt_number,
    status, started_at, submitted_at, deadline_at, score, version
-   `quiz_answers`: id, attempt_id, question_version_id, answer_json,
    saved_at, score, feedback_json
-   `quiz_events`: id, attempt_id, event_type, occurred_at,
    metadata_json

Correct answers and private grading data must not be returned in
learner-facing API payloads before allowed release.

## 8.6 Attendance and communication

-   `live_sessions`: id, tenant_id, course_offering_id, title,
    starts_at, ends_at, timezone, provider, meeting_url_secret_ref,
    status
-   `attendance_records`: id, tenant_id, live_session_id,
    learner_user_id, status, marked_by, marked_at, reason
-   `announcements`: id, tenant_id, course_offering_id, author_user_id,
    title, body, status, publish_at
-   `discussion_topics`: id, tenant_id, course_offering_id,
    author_user_id, title, body, status
-   `discussion_posts`: id, tenant_id, topic_id, parent_post_id
    nullable, author_user_id, body, status, created_at
-   `conversations` and `messages` only if direct messaging is enabled
-   `notifications`: id, tenant_id, user_id, type, payload_json,
    read_at, created_at
-   `notification_deliveries`: id, notification_id, channel, status,
    attempts, last_error, delivered_at

## 8.7 OBE, analytics, and certificates

-   `programme_outcomes`: id, tenant_id, programme_id, code,
    description, outcome_type
-   `course_outcomes`: id, tenant_id, course_offering_id, code,
    description
-   `outcome_mappings`: id, tenant_id, course_outcome_id,
    programme_outcome_id, correlation_level, policy_version
-   `assessment_item_outcome_mappings`: id, tenant_id, assessment_type,
    assessment_id, item_ref, course_outcome_id, weight
-   `attainment_policies`: id, tenant_id, name, version,
    configuration_json, status
-   `attainment_snapshots`: id, tenant_id, course_offering_id,
    policy_id, generated_at, approved_by, results_json
-   `certificates`: id, tenant_id, user_id, course_offering_id nullable,
    certificate_type, verification_token_hash, issued_at, status,
    revoked_at, revocation_reason
-   `integration_connections`: id, tenant_id, provider, status,
    secret_reference, configuration_json
-   `webhook_deliveries`: id, tenant_id, event_type, target_id, status,
    attempt_count, next_attempt_at

## 8.8 Data-model rules

-   Most tenant-owned rows include `tenant_id`, even if derivable
    through a parent. Enforce tenant consistency in services and, where
    practical, database constraints.
-   Add foreign keys and appropriate `ON DELETE` behaviour.
-   Use unique constraints for normalized email where the identity model
    requires it, enrolment pairs, and idempotency tokens.
-   Treat institutional IDs as strings.
-   Store large files in object storage, not database blobs.
-   Keep a record of grade calculation and OBE policy versions.
-   Do not store answer keys in the same response object as
    student-facing quiz questions.
-   Avoid storing unnecessary personal data.
-   Define retention and deletion policies before production launch.

------------------------------------------------------------------------

# 9. API design

Use a versioned REST API with consistent errors and pagination. Endpoint
names below are illustrative; refine them into an OpenAPI document
before coding.

## 9.1 API conventions

-   Prefix: `/api/v1`
-   JSON request/response except file upload/download endpoints.
-   Authentication required except intentionally public routes.
-   Validate request body, query parameters, and path identifiers.
-   Use standard HTTP status codes.
-   Return a consistent error shape: `code`, `message`, `fieldErrors`,
    `requestId`.
-   Use pagination: `items`, `nextCursor`, `hasMore`.
-   Support filters/sorts only from an allowlist.
-   Avoid returning database internals or sensitive fields.
-   Use idempotency keys for critical create/submit/finalise operations.

## 9.2 Example endpoint groups

### Identity and tenant

-   `GET /me`
-   `GET /me/permissions`
-   `GET /tenants/current`
-   `PATCH /tenants/current/settings`
-   `POST /users/invitations`
-   `POST /users/imports`
-   `GET /users/imports/{id}`

### Academic setup

-   `GET/POST /academic-years`
-   `GET/POST /terms`
-   `GET/POST /departments`
-   `GET/POST /programmes`
-   `GET/POST /courses`
-   `GET/POST /course-offerings`
-   `POST /course-offerings/{id}/instructors`
-   `POST /course-offerings/{id}/enrolments`

### Course and content

-   `GET /courses`
-   `GET /course-offerings/{id}`
-   `POST /course-offerings/{id}/modules`
-   `PATCH /modules/{id}`
-   `POST /modules/{id}/content-items`
-   `POST /content-items/{id}/publish`
-   `POST /course-offerings/{id}/publish`
-   `POST /course-offerings/{id}/copy`

### Assignments

-   `POST /course-offerings/{id}/assignments`
-   `GET /assignments/{id}`
-   `POST /assignments/{id}/submissions`
-   `PATCH /submissions/{id}/draft`
-   `POST /submissions/{id}/submit`
-   `POST /submissions/{id}/grade`
-   `POST /grades/{id}/release`

### Quizzes

-   `POST /course-offerings/{id}/quizzes`
-   `POST /quizzes/{id}/publish`
-   `POST /quizzes/{id}/attempts`
-   `PUT /quiz-attempts/{id}/answers/{questionRef}`
-   `POST /quiz-attempts/{id}/submit`
-   `POST /quiz-attempts/{id}/finalise`
-   `POST /quiz-attempts/{id}/grade`

### Attendance, analytics, OBE

-   `POST /live-sessions`
-   `PUT /live-sessions/{id}/attendance`
-   `GET /course-offerings/{id}/reports/progress`
-   `GET /course-offerings/{id}/reports/gradebook`
-   `POST /obe/attainment-runs`
-   `GET /obe/attainment-runs/{id}`

Do not implement every endpoint at once. Add endpoints only when the
corresponding phase requires them.

------------------------------------------------------------------------

# 10. UX and design system

## 10.1 Visual direction

Use a modern, calm, academic product aesthetic: clean white or neutral
surfaces, restrained brand colour, clear typography, subtle borders,
consistent spacing, and meaningful status indicators. Avoid excessive
gradients, decorative charts, and too many dashboard cards.

## 10.2 Design tokens

Define central tokens for: - Brand, accent, background, surface, text,
muted text, border, success, warning, error, and info. - Typography
scale and line heights. - Spacing scale. - Border radius, shadows, and
focus ring. - Breakpoints. - Table density and form spacing.

Do not hard-code ad hoc colours throughout the application. Support a
tenant logo and limited brand customisation without allowing unreadable
contrast.

## 10.3 Required shared components

-   App shell, sidebar, top bar, breadcrumb, page header.
-   Buttons, icon buttons, dropdowns, tabs, modal/dialog, confirmation
    dialog.
-   Form fields with label, help text, validation, and error states.
-   Data table with server pagination, search, filters, sort, row
    selection, and bulk actions.
-   Status badge, avatar, date/time display, file picker, rich-text
    editor wrapper.
-   Empty state, loading skeleton, error boundary, toast, pagination.
-   Accessible chart wrappers and downloadable data alternatives.
-   Confirmation step for destructive/bulk operations.

## 10.4 Page-state checklist

Every page must implement: 1. Loading state. 2. Successful populated
state. 3. Empty state. 4. Validation errors. 5. Permission denied state.
6. Network/server error with retry when safe. 7. Responsive layout. 8.
Keyboard focus and accessible labels. 9. Confirmation for destructive
actions. 10. Success feedback and a persisted result.

## 10.5 Key screens to build first

-   Login and password reset.
-   Role-aware dashboard.
-   Admin academic structure list/detail screens.
-   User import preview/results.
-   Course offering detail with module builder.
-   Student course view and lesson player.
-   Assignment builder, submission view, grading view.
-   Quiz builder, attempt runner, results/feedback.
-   Gradebook.
-   Attendance roster.
-   Reports and OBE configuration.
-   Institution settings and audit log.

------------------------------------------------------------------------

# 11. Security, privacy, reliability, and accessibility

## 11.1 Security baseline

-   Secure authentication/session management.
-   Server-side RBAC and tenant isolation.
-   CSRF protection where applicable.
-   XSS protection and rich-text sanitisation.
-   SQL injection protection through parameterised ORM queries.
-   Rate limiting on login, password reset, invitation, public
    verification, and high-cost endpoints.
-   Safe file upload validation; reject dangerous types and mismatched
    MIME/extensions.
-   Malware scanning integration for uploaded files where feasible.
-   Private object storage and short-lived signed download URLs.
-   Secrets in a secret manager/environment, not source control.
-   Audit logs for sensitive actions.
-   Dependency scanning and lockfile review.
-   Secure headers, HTTPS, and production cookie settings.
-   Backups with documented restore tests.
-   Least privilege for database, storage, and integrations.

## 11.2 Privacy

-   Collect only necessary learner information.
-   Document data categories, purposes, access roles, retention, and
    deletion.
-   Provide authorised data export and correction workflows.
-   Avoid exposing email addresses or student IDs in public certificate
    pages.
-   Keep tenant data isolated in logs and analytics.
-   Establish consent and legal review for minors, observers,
    recordings, and AI processing where applicable.
-   Determine applicable Indian and other privacy/legal requirements
    with institutional counsel; do not claim compliance merely because a
    feature exists.

## 11.3 Reliability

-   Use database transactions for critical workflows.
-   Use job retries with backoff and dead-letter handling.
-   Use idempotency for repeated submissions and background jobs.
-   Monitor job queue health, database connections, error rates, and
    email failures.
-   Set up health and readiness endpoints.
-   Define backup frequency, retention, and recovery objectives with the
    institution.
-   Test restoring a backup, not merely creating one.
-   Keep a staging environment separate from production.

## 11.4 Accessibility

Target WCAG 2.2 AA as the design goal: - Keyboard access and visible
focus. - Semantic headings and landmarks. - Form labels and actionable
error messages. - Contrast compliance. - Accessible tables, dialogs,
menus, and charts. - Captions/transcripts where available for media. -
Avoid colour as the only signal. - Respect reduced-motion preferences. -
Test with automated tools plus manual keyboard and screen-reader checks.

------------------------------------------------------------------------

# 12. Testing strategy and definition of done

## 12.1 Test layers

### Unit tests

-   Permission and tenant-scope functions.
-   Grade calculations and grading scales.
-   Quiz scoring and attempt rules.
-   Attendance percentage policy.
-   Course completion rules.
-   OBE formula implementation and rounding.
-   File validation and import parsing.

### Integration tests

-   API + database.
-   Transactions and uniqueness constraints.
-   Course publication and student visibility.
-   Submission lifecycle.
-   Quiz autosave/finalisation.
-   Grade release.
-   Notification retries.
-   Import/export.
-   Tenant isolation.

### End-to-end tests

Use a browser automation tool to test critical journeys: 1. Admin
creates a course offering. 2. Admin enrols a student and assigns an
instructor. 3. Instructor builds and publishes content. 4. Student opens
the course and completes a lesson. 5. Student submits an assignment. 6.
Instructor grades and releases feedback. 7. Student sees the released
grade. 8. Student attempts a quiz and receives the allowed result. 9.
Faculty marks attendance and student sees their own summary. 10. Admin
runs a report. 11. Unauthorised users are blocked from restricted
records.

### Non-functional tests

-   Accessibility.
-   Large roster and pagination.
-   Upload size/type boundaries.
-   Concurrent submission/finalisation.
-   Basic load and response-time tests.
-   Backup restoration.
-   Security checks for tenant ID manipulation and IDOR.

## 12.2 Definition of done for every feature

A feature is not done just because a screen exists. It is done only
when: - The database model and migration exist. - Server validation
exists. - Permission and tenant checks exist. - Success and error states
exist. - Data persists after refresh/re-login. - Relevant
audit/notification events exist. - Unit/integration/E2E tests are added
at the appropriate level. - Empty/loading/error states are handled. -
Responsive and accessibility checks pass. - Documentation and seed data
are updated. - No known critical error remains in logs or test output.

------------------------------------------------------------------------

# 13. Phased build plan for an AI coding agent

## General rule for every phase

The agent must first inspect the repository and current state. It must
not overwrite existing work blindly. For each phase: 1. Read the project
instructions and current README. 2. State the goal and files/modules it
plans to change. 3. Implement only the current phase. 4. Run lint,
typecheck, tests, and build. 5. Fix failures caused by its changes. 6.
Update documentation and migration/seed scripts. 7. Summarise files
changed, commands run, test outcomes, and known limitations. 8. Stop and
request approval only if a genuine product decision or external
credential is required; otherwise continue within the phase. 9. Never
claim a test passed unless it was actually run.

### Phase 0 --- Repository reconnaissance and decisions

**Goal:** Establish a safe, reproducible starting point.

Tasks: - Inspect files, package manager, framework, existing code,
environment variables, database setup, and test scripts. - Identify
incomplete features and existing conventions. - Create
`docs/architecture/overview.md`. - Create
`docs/decisions/0001-stack-and-architecture.md`. - Choose one ORM and
one authentication approach. - Create `.env.example` containing
placeholders only. - Document local setup, test commands, and deployment
assumptions. - Do not implement product modules in this phase.

Acceptance: - Project starts locally using documented commands. -
Build/lint/typecheck commands are known and runnable. - Architecture and
decisions are documented. - No secret is committed.

### Phase 1 --- Application shell and design system

Tasks: - Set up global layout, typography, spacing, colour tokens,
responsive navigation, page header, breadcrumbs, buttons, forms, tables,
dialogs, notifications, and error boundaries. - Create role-specific
navigation configuration but do not rely on it for security. - Build
placeholder dashboards with clearly labelled demo/empty data. - Add
accessibility basics and component tests.

Acceptance: - All main layouts render at desktop/tablet/mobile widths. -
Shared components are reused rather than duplicated. - Keyboard
navigation works for menus/dialogs. - No fake action is presented as a
completed backend operation.

### Phase 2 --- Database foundation and tenant isolation

Tasks: - Configure PostgreSQL and migrations. - Implement tenant,
institution, user membership, roles, permissions, and audit event
tables. - Add seed data for two fictional tenants and several roles. -
Implement tenant context resolution and central permission checks. - Add
integration tests that attempt cross-tenant access. - Add request ID and
structured server logging.

Acceptance: - Migrations work on an empty database. - Seed script is
repeatable or clearly resets a development database. - Cross-tenant
read/write tests fail safely. - Every protected route checks
authentication and permission scope.

### Phase 3 --- Authentication and user lifecycle

Tasks: - Implement sign-in, sign-out, password reset, profile,
invitations, account deactivation, and session expiry. - Add admin user
list/detail pages. - Implement scoped role assignment. - Add rate
limiting to sensitive authentication endpoints. - Add audit events for
invitations, role changes, and deactivation.

Acceptance: - Password reset works end-to-end with a development mail
sink. - Deactivated users are blocked. - Role changes take effect
server-side. - Invalid and expired tokens are rejected.

### Phase 4 --- Academic setup and user imports

Tasks: - Implement academic years, terms, departments, programmes,
cohorts, sections, course catalogue, and course offerings. - Build CRUD
screens and validation. - Build CSV import preview, validation report,
commit, and import history. - Support alphanumeric student/staff IDs. -
Implement instructor assignment, enrolment, and roster management.

Acceptance: - Admin can configure a sample academic structure entirely
through the UI. - CSV errors are visible per row. - Duplicate imports do
not create uncontrolled duplicates. - Course catalogue and course
offering are distinct.

### Phase 5 --- Course authoring and content delivery

Tasks: - Implement course modules and content items. - Add rich text,
files, external links, and video-link content. - Implement
draft/published states, ordering, prerequisites, availability, course
preview, and course copy. - Store files in private object storage and
implement authorised downloads. - Build faculty course editor and
student course viewer. - Record content progress and meaningful learning
events.

Acceptance: - Instructor can create and publish a course without
database edits. - Student sees only enrolled, published, available
content. - Content ordering persists. - A copied course does not copy
grades or submissions. - File access is tenant-scoped and
permission-checked.

### Phase 6 --- Assignments and grading

Tasks: - Build assignment creation/settings. - Implement text/file/URL
submission types. - Implement submission receipts, deadlines, late
policy, resubmission rules, and submission history. - Build grading
queue, rubric, feedback, grade save/release, and audit history. - Add
notification when grades/feedback are released. - Build student
assignment status and feedback view.

Acceptance: - Complete instructor-to-student assignment workflow passes
E2E. - A retry does not create duplicate submissions. - Unreleased
grades are not visible to students. - Grade overrides require
appropriate permission and audit reason.

### Phase 7 --- Quiz engine and question bank

Tasks: - Implement supported question types, question bank, quiz
configuration, attempts, autosave, timeout, finalisation, objective
grading, manual grading queue, and result release. - Keep correct
answers server-side. - Use versioned questions and quizzes. - Implement
idempotent finalisation and concurrency-safe attempt state changes. -
Add comprehensive tests for timing, retries, and grading edge cases.

Acceptance: - Student can complete a quiz and see results only according
to release policy. - Server enforces attempt count and deadline. -
Timeout and manual submit cannot finalise the same attempt twice. -
Refresh/reconnect does not silently lose acknowledged answers.

### Phase 8 --- Gradebook and reporting foundations

Tasks: - Implement assessment columns, score aggregation, grading
schemes, missing/ungraded states, grade preview, release controls, and
exports. - Add server-side report filters and pagination. - Add tests
for weighting, rounding, excused work, missing assessments, and grade
changes. - Implement basic student, faculty, and admin dashboards from
real database data.

Acceptance: - Dashboard values reconcile with underlying records. -
Calculation rules are documented and unit-tested. - Exports are
permission-checked and have clear column headers. - Reports distinguish
missing values from zero.

### Phase 9 --- Live sessions, attendance, calendar, communication

Tasks: - Implement live-session scheduling and external meeting links. -
Add calendar/list views and reminder jobs. - Implement attendance
roster, status, edit permissions, lock policy, and reports. - Add
announcements and threaded discussions with moderation. - Implement
in-app notifications and email delivery adapter. - Add
retry/deduplication logic for notification jobs.

Acceptance: - Faculty can schedule a session and mark attendance. -
Students see only their own attendance details. - Rescheduled/cancelled
sessions notify the correct cohort. - Duplicate job retries do not spam
users.

### Phase 10 --- OBE and academic outcome attainment

Tasks: - Implement PEO/PO/PSO/CO entities and mapping screens. - Map
assessment items/questions to COs. - Create a configurable, versioned
attainment policy. - Implement direct/indirect methods only after the
institution confirms the formulas. - Generate preview, warnings,
approved snapshots, and exports. - Add tests using hand-calculated
sample datasets.

Acceptance: - Every reported attainment value is reproducible from
stored inputs and policy version. - Missing data is surfaced, not
silently treated as zero. - Approved historical reports remain available
after policy changes. - The report explains the formula and mappings
used.

### Phase 11 --- Certificates, learning paths, and engagement

Tasks: - Implement course completion rules. - Generate certificates and
verification tokens. - Add optional learning paths, badges, and
completion indicators. - Add recommendation hooks only if the base
analytics data is reliable. - Add privacy controls for leaderboards and
public verification.

Acceptance: - Certificates are issued once per eligible completion
unless explicitly reissued. - Revoked certificates show a controlled
verification status. - Optional engagement features do not block core
learning.

### Phase 12 --- Integrations, hardening, and production readiness

Tasks: - Publish OpenAPI documentation. - Add integration adapters and
webhook verification. - Add SSO only when provider configuration is
available. - Add backup/restore runbook, error monitoring, health
checks, queue monitoring, and security headers. - Run end-to-end
regression, accessibility, dependency, and tenant-isolation checks. -
Test staging deployment and migration rollback strategy. - Prepare admin
guide, faculty guide, student guide, and incident runbook.

Acceptance: - Staging deploys from a clean checkout. - Database backup
can be restored in a test environment. - No critical/high unresolved
security issue remains without an explicitly accepted mitigation. - Core
workflows pass the regression suite. - Environment variables and
external dependencies are documented.

### Phase 13 --- Advanced features (only after stable launch)

Candidates: - SCORM 1.2/2004 and xAPI support. - LTI 1.3 integrations. -
AI course/question drafting with human approval. - Skills and competency
framework. - Adaptive learning pathways. - Plagiarism/similarity
integration. - QR attendance with anti-replay controls. - Native mobile
apps. - Parent/observer portal. - Advanced proctoring, subject to policy
and privacy review. - Data warehouse/BI integration.

Do not begin Phase 13 while core submission, quiz, grading, permissions,
tenant isolation, backups, or audit flows are unstable.

------------------------------------------------------------------------

# 14. Critical workflow test matrix

  -----------------------------------------------------------------------
  Workflow          Actor             Required checks   Expected result
  ----------------- ----------------- ----------------- -----------------
  Create            Platform admin    Required fields,  Active/pending
  institution                         slug uniqueness,  tenant created
                                      audit             

  Import learners   Institution admin Duplicate IDs,    Valid rows
                                      invalid rows,     imported; error
                                      tenant scope      report generated

  Assign instructor Institution admin Course offering   Instructor can
                                      exists; user      access assigned
                                      belongs to tenant offering

  Publish course    Instructor        Permission,       Enrolled learners
                                      required fields,  can access
                                      valid dates       published content

  Open draft        Student           Publication and   Access denied
  content                             enrolment checks  

  Submit assignment Student           Deadline,         One durable
                                      attempt, file     submission
                                      rules, enrolment  receipt

  Grade assignment  Instructor        Course scope,     Grade saved with
                                      grade range,      audit history
                                      feedback          
                                      validation        

  Release grade     Instructor        Release           Student can now
                                      permission and    view result
                                      status            

  Start quiz        Student           Availability,     Server creates
                                      attempts,         valid attempt
                                      enrolment         

  Autosave answer   Student           Attempt state,    Answer persisted
                                      question          safely
                                      membership        

  Submit quiz       Student/system    Timeout,          Exactly one final
                                      concurrency,      attempt state
                                      idempotency       

  Mark attendance   Instructor        Roster, session,  Attendance
                                      allowed status    records saved and
                                                        audited

  Export report     Admin/faculty     Scope,            Only authorised
                                      permission, data  data exported
                                      minimisation      

  Generate OBE      Coordinator       Mapping, formula  Reproducible
  report                              version, missing  report and
                                      data              warnings

  Issue certificate System/admin      Completion rule,  One verifiable
                                      idempotency       certificate

  Cross-tenant      Any user          Manipulated       Request denied
  access                              tenant/resource   and security
                                      ID                event logged
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 15. Seed data and demo scenario

Provide a development seed dataset with fictional information: - Tenant
A: "Northstar University" - Tenant B: "Riverbend College" - One platform
admin. - One institution admin per tenant. - Two departments and two
programmes in Tenant A. - One academic year and two terms. - Two courses
and course offerings. - Two faculty users and at least five students. -
One published course with three modules and several lessons. - One draft
course not visible to students. - One assignment with submissions in
multiple states. - One quiz with objective and essay questions. - One
live session and attendance records. - Example CO/PO mappings and a
clearly labelled sample attainment policy. - A second tenant with
records used to test tenant isolation.

Use non-real emails such as `admin@northstar.example`. Never use real
student data in seed files or screenshots.

The README should explain how to reset the local development database
and load this seed dataset.

------------------------------------------------------------------------

# 16. Operational and deployment requirements

## Environments

-   Local development.
-   Automated test environment.
-   Staging with production-like configuration and synthetic data.
-   Production.

## Environment configuration

Document all required variables in `.env.example`, such as: -
`DATABASE_URL` - `AUTH_SECRET` or provider-specific auth variables -
`APP_BASE_URL` - `OBJECT_STORAGE_ENDPOINT` - `OBJECT_STORAGE_BUCKET` -
`OBJECT_STORAGE_ACCESS_KEY` - `OBJECT_STORAGE_SECRET_KEY` -
`EMAIL_PROVIDER` - `EMAIL_API_KEY` - `JOB_QUEUE_URL` where applicable -
`ERROR_REPORTING_DSN`

These are names/examples only; the chosen libraries may require
different variables. Never put real secrets in `.env.example`.

## Deployment checklist

-   Build succeeds from a clean checkout.
-   Migrations are reviewed and run in the correct order.
-   Secrets are configured in the hosting environment.
-   HTTPS and secure cookies are enabled.
-   Storage bucket is private.
-   Admin bootstrap process is documented and secure.
-   Backups and retention are configured.
-   Health checks and error monitoring work.
-   Background workers are running.
-   Email and file upload are tested in staging.
-   Tenant isolation tests pass.
-   No demo credentials or seeded production users remain.
-   Rollback and incident procedures are documented.

------------------------------------------------------------------------

# 17. Project management and AI-agent operating protocol

## 17.1 Keep an implementation ledger

Maintain `docs/IMPLEMENTATION_STATUS.md` with: - Current phase. -
Completed tasks. - In-progress tasks. - Tests run and results. - Known
issues. - Deferred decisions. - Next three concrete tasks. - Database
migrations added. - Endpoints/pages completed.

Update this file at the end of every phase.

## 17.2 Keep architecture decisions explicit

Use short Architecture Decision Records (ADRs), for example: -
Authentication provider and session strategy. - ORM and migration
strategy. - Object storage provider. - Background job queue. - Tenant
isolation approach. - Grade calculation semantics. - OBE formula and
policy versioning. - Email and conferencing integrations.

## 17.3 Avoid common AI-agent failure modes

-   Do not generate every module in one giant response.
-   Do not replace a working project with a fresh scaffold without
    approval.
-   Do not create buttons that do nothing.
-   Do not hard-code fake metrics as if they were real.
-   Do not bypass permissions to make a demo appear to work.
-   Do not make direct database edits from UI code.
-   Do not invent provider API behaviour or credentials.
-   Do not silently change schema or grading rules.
-   Do not use mock data in production paths.
-   Do not declare success without running checks.
-   Do not continue piling features onto a broken build.
-   Do not add microservices before there is a demonstrated need.

## 17.4 Required response format after each phase

The agent must report: 1. **Phase and objective** 2. **Implemented
features** 3. **Files/modules changed** 4. **Database migrations** 5.
**Routes/APIs added** 6. **Tests and exact results** 7. **Known issues
and limitations** 8. **Manual steps or credentials needed** 9. **Next
phase recommendation**

------------------------------------------------------------------------

# 18. Master prompt for the AI coding agent

Copy this prompt into the coding agent after placing this document in
the repository as `docs/LMS_BUILD_SPEC.md`.

------------------------------------------------------------------------

## MASTER IMPLEMENTATION PROMPT

You are the lead software architect and implementation engineer for a
production-oriented, multi-tenant Learning Management System (LMS). Your
source of truth is `docs/LMS_BUILD_SPEC.md`.

### Your mission

Implement the product incrementally, with working end-to-end workflows,
secure data access, clear UX, tests, and documentation. A visually
convincing prototype is not sufficient. All core actions must persist
data and enforce server-side rules.

### First actions

1.  Inspect the current repository, instructions, package scripts,
    framework, database, migrations, authentication, tests, and existing
    UI.
2.  Do not overwrite or replace working code without a clear reason.
3.  Compare the repository against this specification.
4.  Create or update `docs/IMPLEMENTATION_STATUS.md`.
5.  Record architecture decisions in `docs/decisions/`.
6.  Identify the smallest safe next phase. If the repository is empty,
    start with Phase 0.
7.  Report the planned changes before making broad structural changes.

### Implementation rules

-   Use the stack and modular-monolith architecture in the specification
    unless the repository already has a sound, compatible stack.
    Document deviations.
-   TypeScript strict mode, server-side validation, database migrations,
    central permission checks, and automated tests are mandatory.
-   Every tenant-owned record must be scoped correctly. Test
    cross-tenant access.
-   Every protected operation must enforce permissions on the server.
-   Keep business logic in services/modules, not page components.
-   Use transactions for multi-step data changes and idempotency for
    retryable critical actions.
-   Use private file storage for uploaded course materials.
-   Do not expose quiz answer keys or unreleased grades.
-   Never hard-code a universal OBE formula. Make it configurable and
    versioned.
-   Never commit secrets or use real student data in seed fixtures.
-   Do not introduce placeholder buttons or pretend that unavailable
    integrations work.
-   If an external provider requires credentials, implement a clean
    adapter, a development/test mode, and documented setup steps.
    Clearly label the integration as unconfigured until tested.
-   Use accessible, responsive UI patterns and implement loading, empty,
    success, validation, permission-denied, and error states.
-   Do not add advanced AI, proctoring, microservices, or native apps
    before the core workflows are stable.
-   Do not claim tests passed unless you ran them and observed the
    result.

### Phase execution loop

For each phase: 1. Restate the phase objective and acceptance criteria.
2. Inspect relevant existing code. 3. Implement only the scope needed
for that phase. 4. Add/update schema, migrations, seed data,
API/services, UI, and tests as appropriate. 5. Run formatting, lint,
typecheck, unit/integration tests, and production build using the
repository's actual scripts. 6. Fix regressions caused by your changes.
7. Update README, API docs, and `docs/IMPLEMENTATION_STATUS.md`. 8.
Summarise exactly what works, what was tested, and what remains. 9.
Proceed to the next phase only when the current phase meets its
acceptance criteria, unless a documented blocker requires a different
order.

### Completion standard

A feature is complete only when it works from the UI through server
validation to persistent storage, obeys access rules, survives
refresh/re-login, handles errors, and has appropriate tests. If any part
is mocked, state exactly what is mocked and why.

### First deliverable

Start with Phase 0: repository reconnaissance, architecture decisions,
environment documentation, and a reproducible local run. Do not build
the entire LMS in one pass. After Phase 0, continue phase by phase using
the acceptance criteria in the specification.

------------------------------------------------------------------------

# 19. Decisions to confirm before production

The build can start with the defaults in this document, but the
following decisions must be confirmed before a production rollout:

1.  **Primary market:** higher education, corporate training, or both
    from day one?
2.  **Tenant model:** one institution per deployment, or many
    institutions on a shared platform?
3.  **Identity:** email/password, institutional SSO, or both?
4.  **System of record:** which ERP/SIS owns official student IDs,
    course enrolments, and final academic results?
5.  **Grading:** exact grading scales, weighting, missing-work policy,
    grade moderation, and re-evaluation workflow.
6.  **OBE:** exact CO/PO/PSO mapping scale, attainment formulas,
    thresholds, indirect assessment method, and required reports.
7.  **Live classes:** preferred provider and whether recordings are
    required.
8.  **Storage/data residency:** hosting region, backup retention, and
    institutional policy.
9.  **Scale:** expected number of tenants, users, concurrent quiz
    takers, and maximum upload size.
10. **Compliance:** applicable privacy, accessibility,
    records-retention, and procurement requirements.
11. **Branding:** single institutional brand or tenant-specific themes.
12. **Commercial model:** internal institutional deployment, licensed
    SaaS, or white-label platform.

Do not block local development on every decision. Use documented
defaults and isolate configurable decisions so they can be changed
safely.

------------------------------------------------------------------------

# 20. External reference notes

The following public product pages informed the capability categories in
this document. Feature availability can vary by edition, contract,
deployment, and product updates; verify directly with each provider
before using this as a procurement comparison.

-   Canvas LMS overview and teaching/learning features:
    https://www.instructure.com/canvas
-   Canvas feature guide:
    https://community.instructure.com/en/kb/canvas-lms-basics-guide
-   MasterSoft OBE overview:
    https://www.iitms.co.in/outcome-based-education/
-   MasterSoft college ERP overview:
    https://www.iitms.co.in/college-erp/
-   Edmingle LMS/training operations: https://www.edmingle.com/
-   Disprz LMS: https://disprz.ai/learning-management-system-lms
-   Disprz learning experience platform:
    https://disprz.ai/learning-experience-platform-lxp
-   Workday ERP overview:
    https://www.workday.com/en-in/enterprise-resource-planning.html

------------------------------------------------------------------------

# Final instruction

Treat this document as the product baseline, not as permission to
implement every feature simultaneously. The highest priority is a
secure, tested vertical slice:

**Tenant and user setup → academic structure → course offering →
published content → student learning → assignment submission → grading
and feedback → quiz attempt → attendance → reporting.**

Only after that slice works end-to-end should the agent expand into OBE,
certificates, integrations, learning paths, and AI-assisted features.
