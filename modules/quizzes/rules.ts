/**
 * Quiz rules that do not need a database.
 *
 * These functions decide scoring behaviour, release policy, attempt eligibility,
 * deadline enforcement, and answer-key visibility.  Both the attempt engine and
 * the UI call them so the explanation a student sees and the enforcement on the
 * server cannot drift apart.
 */

import { Prisma } from "../../generated/prisma/client";

/** Prisma's Decimal implementation, re-exported so this module keeps one import. */
const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Enums (mirror prisma schema – kept here for use in pure-function tests)
// ---------------------------------------------------------------------------

export type QuestionType =
  "single_choice" | "multi_select" | "true_false" | "short_answer" | "fill_blank" | "essay";

export type QuizAttemptStatus = "in_progress" | "submitted" | "timed_out" | "graded";

export type ReleasePolicy = "never" | "on_submit" | "after_until" | "manual";

export type GradingMethod = "highest" | "latest" | "first";
export type NavigationPolicy = "free" | "linear";

// ---------------------------------------------------------------------------
// Quiz settings (stored as JSONB, parsed defensively)
// ---------------------------------------------------------------------------

export interface QuizSettings {
  timeLimitMinutes: number | null;
  attemptLimit: number;
  gradingMethod: GradingMethod;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  navigationPolicy: NavigationPolicy;
  releasePolicy: ReleasePolicy;
  /** Extra minutes granted to a specific user (keyed by user id). */
  extraTimeMinutes: Record<string, number>;
  /** Percentage of the total points a learner must reach to pass, or null. */
  passMark: number | null;
  allowPartialCredit: boolean;
  negativeMarking: boolean;
  negativeMarkingFraction: number;
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  timeLimitMinutes: null,
  attemptLimit: 1,
  gradingMethod: "highest",
  shuffleQuestions: false,
  shuffleOptions: false,
  navigationPolicy: "free",
  releasePolicy: "on_submit",
  extraTimeMinutes: {},
  passMark: null,
  allowPartialCredit: false,
  negativeMarking: false,
  negativeMarkingFraction: 0.25,
};

/** Reads the stored JSONB settings defensively; unknown shapes fall back to defaults. */
export function parseQuizSettings(value: unknown): QuizSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_QUIZ_SETTINGS };
  }
  const raw = value as Record<string, unknown>;

  const extra: Record<string, number> = {};
  if (raw.extraTimeMinutes && typeof raw.extraTimeMinutes === "object") {
    for (const [k, v] of Object.entries(raw.extraTimeMinutes as Record<string, unknown>)) {
      if (typeof v === "number" && v > 0) extra[k] = v;
    }
  }

  return {
    timeLimitMinutes:
      typeof raw.timeLimitMinutes === "number" && raw.timeLimitMinutes > 0
        ? raw.timeLimitMinutes
        : DEFAULT_QUIZ_SETTINGS.timeLimitMinutes,
    attemptLimit:
      typeof raw.attemptLimit === "number" && raw.attemptLimit >= 1
        ? Math.floor(raw.attemptLimit)
        : DEFAULT_QUIZ_SETTINGS.attemptLimit,
    gradingMethod: isGradingMethod(raw.gradingMethod)
      ? raw.gradingMethod
      : DEFAULT_QUIZ_SETTINGS.gradingMethod,
    shuffleQuestions:
      typeof raw.shuffleQuestions === "boolean"
        ? raw.shuffleQuestions
        : DEFAULT_QUIZ_SETTINGS.shuffleQuestions,
    shuffleOptions:
      typeof raw.shuffleOptions === "boolean"
        ? raw.shuffleOptions
        : DEFAULT_QUIZ_SETTINGS.shuffleOptions,
    navigationPolicy: isNavigationPolicy(raw.navigationPolicy)
      ? raw.navigationPolicy
      : DEFAULT_QUIZ_SETTINGS.navigationPolicy,
    releasePolicy: isReleasePolicy(raw.releasePolicy)
      ? raw.releasePolicy
      : DEFAULT_QUIZ_SETTINGS.releasePolicy,
    extraTimeMinutes: extra,
    passMark:
      typeof raw.passMark === "number" && raw.passMark >= 0 && raw.passMark <= 100
        ? raw.passMark
        : DEFAULT_QUIZ_SETTINGS.passMark,
    allowPartialCredit:
      typeof raw.allowPartialCredit === "boolean"
        ? raw.allowPartialCredit
        : DEFAULT_QUIZ_SETTINGS.allowPartialCredit,
    negativeMarking:
      typeof raw.negativeMarking === "boolean"
        ? raw.negativeMarking
        : DEFAULT_QUIZ_SETTINGS.negativeMarking,
    negativeMarkingFraction:
      typeof raw.negativeMarkingFraction === "number" &&
      raw.negativeMarkingFraction > 0 &&
      raw.negativeMarkingFraction <= 1
        ? raw.negativeMarkingFraction
        : DEFAULT_QUIZ_SETTINGS.negativeMarkingFraction,
  };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isGradingMethod(v: unknown): v is GradingMethod {
  return v === "highest" || v === "latest" || v === "first";
}

function isNavigationPolicy(v: unknown): v is NavigationPolicy {
  return v === "free" || v === "linear";
}

function isReleasePolicy(v: unknown): v is ReleasePolicy {
  return v === "never" || v === "on_submit" || v === "after_until" || v === "manual";
}

// ---------------------------------------------------------------------------
// Deadline computation
// ---------------------------------------------------------------------------

export interface DeadlineInput {
  startedAt: Date;
  timeLimitMinutes: number | null;
  /** Extra minutes granted to this specific user. */
  extraMinutes: number;
}

/**
 * Compute the server-side deadline for an attempt.
 * Returns null when there is no time limit (unlimited time).
 */
export function computeDeadline({
  startedAt,
  timeLimitMinutes,
  extraMinutes,
}: DeadlineInput): Date | null {
  if (timeLimitMinutes === null) return null;
  const totalMinutes = timeLimitMinutes + Math.max(0, extraMinutes);
  return new Date(startedAt.getTime() + totalMinutes * 60 * 1000);
}

/** Returns true if the deadline has passed at `now`. */
export function isPastDeadline(deadlineAt: Date | null, now: Date): boolean {
  if (!deadlineAt) return false;
  return now >= deadlineAt;
}

/** Remaining milliseconds; 0 when past deadline; Infinity when no limit. */
export function remainingMs(deadlineAt: Date | null, now: Date): number {
  if (!deadlineAt) return Infinity;
  return Math.max(0, deadlineAt.getTime() - now.getTime());
}

// ---------------------------------------------------------------------------
// Attempt eligibility
// ---------------------------------------------------------------------------

export interface AttemptEligibilityInput {
  settings: QuizSettings;
  quizStatus: "draft" | "published" | "archived";
  availableFrom: Date | null;
  availableUntil: Date | null;
  completedAttemptCount: number;
  hasInProgressAttempt: boolean;
  now: Date;
}

export type AttemptEligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * Determines whether a student can start (or resume) a new attempt.
 * Rules (in order):
 *  1. Quiz must be published.
 *  2. If availableFrom is set, now must be >= availableFrom.
 *  3. If availableUntil is set, now must be < availableUntil.
 *  4. completedAttempts must be < attemptLimit (in-progress counts as the live attempt, not a completed one).
 *  5. An in-progress attempt means resume, not a new start — eligibility still true.
 */
export function checkAttemptEligibility(input: AttemptEligibilityInput): AttemptEligibilityResult {
  const { settings, quizStatus, availableFrom, availableUntil, completedAttemptCount, now } = input;

  if (quizStatus !== "published") {
    return { eligible: false, reason: "This quiz is not available." };
  }

  if (availableFrom && now < availableFrom) {
    return {
      eligible: false,
      reason: `This quiz opens on ${availableFrom.toLocaleString()}.`,
    };
  }

  if (availableUntil && now >= availableUntil) {
    return {
      eligible: false,
      reason: "The submission window for this quiz has closed.",
    };
  }

  if (completedAttemptCount >= settings.attemptLimit) {
    return {
      eligible: false,
      reason: `You have used all ${settings.attemptLimit} attempt(s) for this quiz.`,
    };
  }

  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Autosave guard
// ---------------------------------------------------------------------------

/**
 * Returns true when an autosave should be accepted.
 * An autosave arriving after the deadline is rejected — the engine
 * will finalise the attempt as timed_out instead.
 */
export function autosaveAllowed(
  status: QuizAttemptStatus,
  deadlineAt: Date | null,
  now: Date,
): boolean {
  if (status !== "in_progress") return false;
  if (isPastDeadline(deadlineAt, now)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Objective scoring
// ---------------------------------------------------------------------------

/** Answer key for a question version (stored server-side as JSONB). */
export interface AnswerKey {
  /** For single_choice / true_false: the correct option id. */
  correctOptionId?: string;
  /** For multi_select: set of correct option ids. */
  correctOptionIds?: string[];
  /** For fill_blank / short_answer: acceptable exact strings (case-insensitive). */
  acceptedAnswers?: string[];
}

/** Submitted answer from the student. */
export interface StudentAnswer {
  /** For single_choice / true_false: chosen option id. */
  selectedOptionId?: string;
  /** For multi_select: chosen option ids. */
  selectedOptionIds?: string[];
  /** For fill_blank / short_answer: typed text. */
  text?: string;
}

export interface ScoreItemInput {
  type: QuestionType;
  key: AnswerKey;
  answer: StudentAnswer;
  pointsPossible: number;
  settings: Pick<
    QuizSettings,
    "allowPartialCredit" | "negativeMarking" | "negativeMarkingFraction"
  >;
}

export interface ScoreItemResult {
  /** null when the question cannot be auto-scored (essay). */
  score: number | null;
  /** Whether the answer was correct (null for essay). */
  correct: boolean | null;
}

/**
 * Score one objective item.
 *
 * Essay / short_answer go to the manual grading queue (returns null score).
 * All arithmetic uses plain numbers and is rounded to 2 decimal places on
 * return; callers must store via Decimal.
 */
export function scoreItem({
  type,
  key,
  answer,
  pointsPossible,
  settings,
}: ScoreItemInput): ScoreItemResult {
  if (type === "essay" || type === "short_answer") {
    return { score: null, correct: null };
  }

  if (type === "single_choice" || type === "true_false") {
    const correct = !!key.correctOptionId && answer.selectedOptionId === key.correctOptionId;
    const score = correct
      ? round2(pointsPossible)
      : settings.negativeMarking
        ? round2(-pointsPossible * settings.negativeMarkingFraction)
        : 0;
    return { score, correct };
  }

  if (type === "fill_blank") {
    const accepted = (key.acceptedAnswers ?? []).map((a) => a.toLowerCase());
    const submitted = (answer.text ?? "").trim().toLowerCase();
    const correct = accepted.length > 0 && accepted.includes(submitted);
    const score = correct
      ? round2(pointsPossible)
      : settings.negativeMarking
        ? round2(-pointsPossible * settings.negativeMarkingFraction)
        : 0;
    return { score, correct };
  }

  if (type === "multi_select") {
    const correctSet = new Set(key.correctOptionIds ?? []);
    const selectedSet = new Set(answer.selectedOptionIds ?? []);
    if (correctSet.size === 0) return { score: 0, correct: false };

    const allCorrect =
      correctSet.size === selectedSet.size && [...correctSet].every((id) => selectedSet.has(id));

    if (allCorrect) return { score: round2(pointsPossible), correct: true };

    if (!settings.allowPartialCredit) {
      const score = settings.negativeMarking
        ? round2(-pointsPossible * settings.negativeMarkingFraction)
        : 0;
      return { score, correct: false };
    }

    // Partial credit: (correct selections − wrong selections) / total correct × points
    let hits = 0;
    let wrongs = 0;
    for (const id of selectedSet) {
      if (correctSet.has(id)) hits++;
      else wrongs++;
    }
    const raw = Math.max(0, hits - wrongs) / correctSet.size;
    return { score: round2(raw * pointsPossible), correct: false };
  }

  // Matching — not in this phase
  return { score: null, correct: null };
}

/** Round to 2 decimal places (safe for display; Decimal used in DB layer). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Attempt score aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate item scores into a total attempt score.
 * Items with null score (essays) are treated as unscored (0 contribution)
 * until manually graded.
 */
export function aggregateScore(items: { score: number | null; pointsPossible: number }[]): {
  score: number;
  scoredPoints: number;
  unscoredCount: number;
} {
  let score = 0;
  let scoredPoints = 0;
  let unscoredCount = 0;

  for (const item of items) {
    if (item.score === null) {
      unscoredCount++;
    } else {
      score += item.score;
      scoredPoints += item.pointsPossible;
    }
  }

  return { score: round2(score), scoredPoints: round2(scoredPoints), unscoredCount };
}

// ---------------------------------------------------------------------------
// Release policy
// ---------------------------------------------------------------------------

export interface ResultVisibilityInput {
  releasePolicy: ReleasePolicy;
  releasedAt: Date | null;
  availableUntil: Date | null;
  attemptStatus: QuizAttemptStatus;
  now: Date;
}

export interface ResultVisibility {
  /** Whether the student can see their score/feedback. */
  showResults: boolean;
  /** Whether the student can see the correct answer key. */
  showAnswerKey: boolean;
}

/**
 * Determine what a student can see about their results, based on the quiz
 * release policy and current time.
 *
 * Answer keys are shown under the same condition as results (by design in
 * this phase). Instructors always get full access — this function is for
 * learner-facing payloads only.
 */
export function getResultVisibility({
  releasePolicy,
  releasedAt,
  availableUntil,
  attemptStatus,
  now,
}: ResultVisibilityInput): ResultVisibility {
  const isTerminal =
    attemptStatus === "submitted" || attemptStatus === "timed_out" || attemptStatus === "graded";

  if (!isTerminal) return { showResults: false, showAnswerKey: false };

  switch (releasePolicy) {
    case "never":
      return { showResults: false, showAnswerKey: false };

    case "on_submit":
      return { showResults: true, showAnswerKey: true };

    case "after_until":
      if (availableUntil && now >= availableUntil) {
        return { showResults: true, showAnswerKey: true };
      }
      return { showResults: false, showAnswerKey: false };

    case "manual":
      if (releasedAt && now >= releasedAt) {
        return { showResults: true, showAnswerKey: true };
      }
      return { showResults: false, showAnswerKey: false };
  }
}

// ---------------------------------------------------------------------------
// Shuffle helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic Fisher-Yates shuffle seeded by attempt id + question id.
 *
 * Deterministic: replaying the same seed returns the same order (required for
 * review to match what the student saw).  We use a simple xorshift32 seeded by
 * a numeric hash of the combined string.
 */
export function shuffleForAttempt<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let state = hashSeed(seed);

  for (let i = arr.length - 1; i > 0; i--) {
    state = xorshift32(state);
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }

  return arr;
}

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h || 1; // never return 0
}

function xorshift32(state: number): number {
  let s = state;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return s >>> 0 || 1;
}

// ---------------------------------------------------------------------------
// Decimal helpers (thin wrapper; keeps import to one place)
// ---------------------------------------------------------------------------

/** Convert a plain number to Prisma Decimal for storage. */
export function toDecimal(n: number): Decimal {
  return new Decimal(n);
}

/** Convert a Prisma Decimal (or null) to a plain number. */
export function fromDecimal(d: Decimal | null | undefined): number | null {
  if (d == null) return null;
  return d.toNumber();
}
