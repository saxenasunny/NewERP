import { z } from "zod";

/**
 * Completion rules decide when a learner may be issued a certificate. They are
 * stored per offering in `course_offering.settings.completion`, and they never
 * gate access to learning material — a learner who does not meet them simply is
 * not yet eligible for the award.
 *
 * Every rule is optional and additive. An institution can require all published
 * content, a percentage of it, submission of every published assignment and quiz,
 * or a minimum released grade. Missing evidence is reported as a named gap, never
 * treated as a pass.
 */

export type CompletionRuleConfig = {
  requireAllPublishedContent: boolean;
  minContentPercent: number | null;
  requirePublishedAssignments: boolean;
  requirePublishedQuizzes: boolean;
  minReleasedGradePercent: number | null;
};

export const DEFAULT_COMPLETION_RULES: CompletionRuleConfig = {
  requireAllPublishedContent: true,
  minContentPercent: null,
  requirePublishedAssignments: false,
  requirePublishedQuizzes: false,
  minReleasedGradePercent: null,
};

function toCheckbox(value: unknown): boolean {
  return value === true || value === "on" || value === "true" || value === 1;
}

const optionalPercent = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce
    .number()
    .int("Use a whole number.")
    .min(0, "Use a percentage between 0 and 100.")
    .max(100, "Use a percentage between 0 and 100.")
    .optional(),
);

/** Validates the rule form. Unchecked boxes arrive absent, hence the preprocess. */
export const completionRuleInputSchema = z.object({
  requireAllContent: z.preprocess(toCheckbox, z.boolean()),
  requireAssignments: z.preprocess(toCheckbox, z.boolean()),
  requireQuizzes: z.preprocess(toCheckbox, z.boolean()),
  minContentPercent: optionalPercent,
  minGradePercent: optionalPercent,
});

export type CompletionRuleInput = z.infer<typeof completionRuleInputSchema>;

export function rulesFromInput(input: CompletionRuleInput): CompletionRuleConfig {
  return {
    requireAllPublishedContent: input.requireAllContent,
    minContentPercent: input.minContentPercent ?? null,
    requirePublishedAssignments: input.requireAssignments,
    requirePublishedQuizzes: input.requireQuizzes,
    minReleasedGradePercent: input.minGradePercent ?? null,
  };
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function percentOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

/** Reads stored settings defensively: an unknown shape falls back to defaults. */
export function parseCompletionRules(raw: unknown): CompletionRuleConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_COMPLETION_RULES };
  }
  const value = raw as Record<string, unknown>;
  return {
    requireAllPublishedContent: booleanOr(
      value.requireAllPublishedContent,
      DEFAULT_COMPLETION_RULES.requireAllPublishedContent,
    ),
    minContentPercent: percentOrNull(value.minContentPercent),
    requirePublishedAssignments: booleanOr(value.requirePublishedAssignments, false),
    requirePublishedQuizzes: booleanOr(value.requirePublishedQuizzes, false),
    minReleasedGradePercent: percentOrNull(value.minReleasedGradePercent),
  };
}

export type CompletionFacts = {
  publishedContentItems: number;
  completedContentItems: number;
  publishedAssignments: number;
  submittedAssignments: number;
  publishedQuizzes: number;
  submittedQuizzes: number;
  releasedGradePercent: number | null;
};

export type CompletionGapCode =
  | "content_incomplete"
  | "content_percent"
  | "assignments_incomplete"
  | "quizzes_incomplete"
  | "grade_missing"
  | "grade_below_threshold";

export type CompletionGap = {
  code: CompletionGapCode;
  message: string;
};

export type CompletionEvaluation = {
  eligible: boolean;
  gaps: CompletionGap[];
  contentPercent: number | null;
};

/** Completed share of published content; `null` when the course has none yet. */
export function contentPercent(facts: CompletionFacts): number | null {
  if (facts.publishedContentItems <= 0) return null;
  const completed = Math.min(facts.completedContentItems, facts.publishedContentItems);
  return Math.round((completed / facts.publishedContentItems) * 1000) / 10;
}

/**
 * Evaluates one learner against one rule set. An empty published course cannot
 * satisfy "all content", so the rule is simply not applicable there and reported
 * as no gap rather than a false pass or a misleading zero.
 */
export function evaluateCompletion(
  facts: CompletionFacts,
  rules: CompletionRuleConfig,
): CompletionEvaluation {
  const gaps: CompletionGap[] = [];
  const percent = contentPercent(facts);

  if (
    rules.requireAllPublishedContent &&
    facts.publishedContentItems > 0 &&
    facts.completedContentItems < facts.publishedContentItems
  ) {
    gaps.push({
      code: "content_incomplete",
      message: `Complete all published lessons (${Math.min(facts.completedContentItems, facts.publishedContentItems)} of ${facts.publishedContentItems} done).`,
    });
  }

  if (
    rules.minContentPercent !== null &&
    facts.publishedContentItems > 0 &&
    (percent ?? 0) < rules.minContentPercent
  ) {
    gaps.push({
      code: "content_percent",
      message: `Reach ${rules.minContentPercent}% of published lessons (currently ${percent ?? 0}%).`,
    });
  }

  if (
    rules.requirePublishedAssignments &&
    facts.submittedAssignments < facts.publishedAssignments
  ) {
    gaps.push({
      code: "assignments_incomplete",
      message: `Submit every published assignment (${facts.submittedAssignments} of ${facts.publishedAssignments} submitted).`,
    });
  }

  if (rules.requirePublishedQuizzes && facts.submittedQuizzes < facts.publishedQuizzes) {
    gaps.push({
      code: "quizzes_incomplete",
      message: `Submit every published quiz (${facts.submittedQuizzes} of ${facts.publishedQuizzes} submitted).`,
    });
  }

  if (rules.minReleasedGradePercent !== null) {
    if (facts.releasedGradePercent === null) {
      gaps.push({
        code: "grade_missing",
        message: `No released grade yet; ${rules.minReleasedGradePercent}% is required.`,
      });
    } else if (facts.releasedGradePercent < rules.minReleasedGradePercent) {
      gaps.push({
        code: "grade_below_threshold",
        message: `Released grade is ${facts.releasedGradePercent}%; ${rules.minReleasedGradePercent}% is required.`,
      });
    }
  }

  return { eligible: gaps.length === 0, gaps, contentPercent: percent };
}

/** Human-readable summary of what a rule set requires, for the screens. */
export function describeCompletionRules(rules: CompletionRuleConfig): string[] {
  const requirements: string[] = [];
  if (rules.requireAllPublishedContent) requirements.push("Complete every published lesson.");
  if (rules.minContentPercent !== null) {
    requirements.push(`Complete at least ${rules.minContentPercent}% of published lessons.`);
  }
  if (rules.requirePublishedAssignments) requirements.push("Submit every published assignment.");
  if (rules.requirePublishedQuizzes) requirements.push("Submit every published quiz.");
  if (rules.minReleasedGradePercent !== null) {
    requirements.push(`Hold a released grade of at least ${rules.minReleasedGradePercent}%.`);
  }
  if (rules.minReleasedGradePercent === null && !rules.requirePublishedAssignments) {
    requirements.push("No grade or assignment requirement is set.");
  }
  return requirements;
}

/** One-line description used in verification and export contexts. */
export function summarizeCompletionRules(rules: CompletionRuleConfig): string {
  const parts: string[] = [];
  if (rules.requireAllPublishedContent) parts.push("all published lessons");
  if (rules.minContentPercent !== null) parts.push(`${rules.minContentPercent}% of lessons`);
  if (rules.requirePublishedAssignments) parts.push("all assignments submitted");
  if (rules.requirePublishedQuizzes) parts.push("all quizzes submitted");
  if (rules.minReleasedGradePercent !== null) {
    parts.push(`released grade at least ${rules.minReleasedGradePercent}%`);
  }
  return parts.length > 0 ? parts.join("; ") : "no additional requirement";
}
