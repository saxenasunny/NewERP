/**
 * Assignment rules that do not need a database.
 *
 * These functions decide the submission window, whether a learner may submit or
 * resubmit, how lateness is recorded, and when a grade becomes visible. The
 * services and the UI both call them, so the explanation a learner sees and the
 * enforcement on the server cannot drift apart.
 */

export type AssignmentSettings = {
  /** Submissions after `dueAt` are accepted and flagged late. */
  allowLateSubmission: boolean;
  /** A learner may submit again, up to `maxAttempts`. */
  allowResubmission: boolean;
  maxAttempts: number;
};

export const DEFAULT_ASSIGNMENT_SETTINGS: AssignmentSettings = {
  allowLateSubmission: true,
  allowResubmission: false,
  maxAttempts: 1,
};

/** Reads the stored JSON settings defensively; unknown shapes fall back to defaults. */
export function parseAssignmentSettings(value: unknown): AssignmentSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_ASSIGNMENT_SETTINGS };
  }
  const raw = value as Record<string, unknown>;
  const attempts = Number(raw.maxAttempts);

  return {
    allowLateSubmission:
      typeof raw.allowLateSubmission === "boolean"
        ? raw.allowLateSubmission
        : DEFAULT_ASSIGNMENT_SETTINGS.allowLateSubmission,
    allowResubmission:
      typeof raw.allowResubmission === "boolean"
        ? raw.allowResubmission
        : DEFAULT_ASSIGNMENT_SETTINGS.allowResubmission,
    maxAttempts:
      Number.isInteger(attempts) && attempts >= 1 && attempts <= 10
        ? attempts
        : DEFAULT_ASSIGNMENT_SETTINGS.maxAttempts,
  };
}

export type AssignmentWindow = {
  availableFrom: Date | null;
  availableUntil: Date | null;
  dueAt: Date | null;
};

export type WindowState = "not_yet" | "open" | "past_due" | "closed";

/**
 * Availability is a hard window (`availableFrom`/`availableUntil`). `dueAt` is
 * the deadline that decides lateness; past it, the assignment is `past_due`
 * until availability closes.
 */
export function windowState(window: AssignmentWindow, now: Date): WindowState {
  if (window.availableFrom && now < window.availableFrom) return "not_yet";
  if (window.availableUntil && now > window.availableUntil) return "closed";
  if (window.dueAt && now > window.dueAt) return "past_due";
  return "open";
}

export function isLate(window: AssignmentWindow, submittedAt: Date): boolean {
  return Boolean(window.dueAt && submittedAt > window.dueAt);
}

export type SubmissionStatus = "DRAFT" | "SUBMITTED" | "LATE" | "GRADED";

export type SubmissionGate =
  | { allowed: true; late: boolean }
  | {
      allowed: false;
      reason:
        "not_yet" | "closed" | "past_due" | "graded" | "resubmission_not_allowed" | "max_attempts";
    };

/**
 * Whether a new or replacement submission is allowed right now.
 *
 * A graded submission cannot be replaced: the teacher would otherwise grade
 * work that has since changed. Instructors can reopen work in a later phase;
 * today the rule is explicit and enforced on the server.
 */
export function submissionGate(input: {
  window: AssignmentWindow;
  settings: AssignmentSettings;
  submission: { status: SubmissionStatus; attemptNumber: number } | null;
  now: Date;
}): SubmissionGate {
  const { window, settings, submission, now } = input;
  const state = windowState(window, now);

  if (submission && submission.status !== "DRAFT") {
    if (submission.status === "GRADED") return { allowed: false, reason: "graded" };
    if (!settings.allowResubmission) return { allowed: false, reason: "resubmission_not_allowed" };
    if (submission.attemptNumber >= settings.maxAttempts) {
      return { allowed: false, reason: "max_attempts" };
    }
  }

  if (state === "not_yet") return { allowed: false, reason: "not_yet" };
  if (state === "closed") return { allowed: false, reason: "closed" };
  if (state === "past_due" && !settings.allowLateSubmission) {
    return { allowed: false, reason: "past_due" };
  }

  return { allowed: true, late: state === "past_due" };
}

export type GradeStatus = "UNGRADED" | "DRAFT" | "RELEASED";

/** Learners see only released grades; staff always see their own grading work. */
export function gradeVisibleToLearner(
  grade: { gradeStatus: GradeStatus; releasedAt: Date | null } | null,
): boolean {
  return Boolean(grade && grade.gradeStatus === "RELEASED" && grade.releasedAt);
}

/** `null` when there is no score yet, so the UI never shows a false zero. */
export function percentOf(rawScore: number | null, pointsPossible: number): number | null {
  if (rawScore === null || pointsPossible <= 0) return null;
  return Math.round((rawScore / pointsPossible) * 1000) / 10;
}

export function scoreWithinPoints(score: number, pointsPossible: number): boolean {
  return Number.isFinite(score) && score >= 0 && score <= pointsPossible;
}

/** A rubric total, used to suggest a score; the teacher still enters the grade. */
export function rubricTotal(scores: readonly { score: number | null }[]): number {
  return Math.round(scores.reduce((total, entry) => total + (entry.score ?? 0), 0) * 100) / 100;
}

export type LearnerAssignmentState =
  "not_open" | "open" | "submitted" | "late" | "graded" | "closed";

/**
 * The single status a learner sees for one assignment. A released grade wins,
 * then the submission, then the window.
 */
export function learnerAssignmentState(input: {
  window: AssignmentWindow;
  now: Date;
  submission: { status: SubmissionStatus } | null;
  gradeReleased: boolean;
}): LearnerAssignmentState {
  if (input.gradeReleased) return "graded";
  if (input.submission && input.submission.status !== "DRAFT") {
    return input.submission.status === "LATE" ? "late" : "submitted";
  }
  const state = windowState(input.window, input.now);
  if (state === "not_yet") return "not_open";
  if (state === "closed") return "closed";
  return "open";
}
