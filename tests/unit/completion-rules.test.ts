import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPLETION_RULES,
  completionRuleInputSchema,
  contentPercent,
  describeCompletionRules,
  evaluateCompletion,
  parseCompletionRules,
  rulesFromInput,
  summarizeCompletionRules,
  type CompletionFacts,
} from "@/modules/certificates/completion";

function facts(overrides: Partial<CompletionFacts> = {}): CompletionFacts {
  return {
    publishedContentItems: 4,
    completedContentItems: 2,
    publishedAssignments: 2,
    submittedAssignments: 1,
    publishedQuizzes: 1,
    submittedQuizzes: 0,
    releasedGradePercent: null,
    ...overrides,
  };
}

function rules(overrides: Partial<typeof DEFAULT_COMPLETION_RULES> = {}) {
  return { ...DEFAULT_COMPLETION_RULES, ...overrides };
}

describe("completion rules", () => {
  it("defaults to requiring every published lesson and nothing else", () => {
    expect(parseCompletionRules(undefined)).toEqual({
      requireAllPublishedContent: true,
      minContentPercent: null,
      requirePublishedAssignments: false,
      requirePublishedQuizzes: false,
      minReleasedGradePercent: null,
    });
    expect(parseCompletionRules("garbage")).toEqual(DEFAULT_COMPLETION_RULES);
    expect(parseCompletionRules([1, 2])).toEqual(DEFAULT_COMPLETION_RULES);
  });

  it("reads stored settings and clamps percentages", () => {
    const parsed = parseCompletionRules({
      requireAllPublishedContent: false,
      minContentPercent: "40",
      requirePublishedAssignments: true,
      requirePublishedQuizzes: "no",
      minReleasedGradePercent: 250,
    });
    expect(parsed).toEqual({
      requireAllPublishedContent: false,
      minContentPercent: 40,
      requirePublishedAssignments: true,
      requirePublishedQuizzes: false,
      minReleasedGradePercent: 100,
    });
    expect(parseCompletionRules({ minContentPercent: "-5" }).minContentPercent).toBe(0);
    expect(parseCompletionRules({ minContentPercent: "abc" }).minContentPercent).toBeNull();
  });

  it("turns an unchecked box into false and an empty number into null", () => {
    const input = completionRuleInputSchema.parse({
      requireAllContent: "on",
      requireAssignments: undefined,
      requireQuizzes: "true",
      minContentPercent: "",
      minGradePercent: "75",
    });
    expect(rulesFromInput(input)).toEqual({
      requireAllPublishedContent: true,
      minContentPercent: null,
      requirePublishedAssignments: false,
      requirePublishedQuizzes: true,
      minReleasedGradePercent: 75,
    });
  });

  it("rejects a percentage outside 0 to 100", () => {
    expect(() =>
      completionRuleInputSchema.parse({
        requireAllContent: "on",
        requireAssignments: "",
        requireQuizzes: "",
        minContentPercent: "140",
        minGradePercent: "",
      }),
    ).toThrow();
  });

  it("reports no content percentage when nothing is published", () => {
    expect(
      contentPercent(facts({ publishedContentItems: 0, completedContentItems: 0 })),
    ).toBeNull();
    expect(contentPercent(facts())).toBe(50);
    expect(contentPercent(facts({ completedContentItems: 9 }))).toBe(100);
  });

  it("is eligible when every rule is disabled", () => {
    const evaluation = evaluateCompletion(
      facts({ releasedGradePercent: null }),
      rules({ requireAllPublishedContent: false }),
    );
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.gaps).toEqual([]);
  });

  it("names each unmet requirement instead of treating it as a pass", () => {
    const evaluation = evaluateCompletion(
      facts(),
      rules({
        minContentPercent: 60,
        requirePublishedAssignments: true,
        requirePublishedQuizzes: true,
        minReleasedGradePercent: 70,
      }),
    );
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.gaps.map((gap) => gap.code)).toEqual([
      "content_incomplete",
      "content_percent",
      "assignments_incomplete",
      "quizzes_incomplete",
      "grade_missing",
    ]);
    expect(evaluation.gaps[1]?.message).toContain("60%");
  });

  it("does not require content in an offering with nothing published", () => {
    const evaluation = evaluateCompletion(
      facts({
        publishedContentItems: 0,
        completedContentItems: 0,
        publishedAssignments: 0,
        submittedAssignments: 0,
        publishedQuizzes: 0,
        submittedQuizzes: 0,
      }),
      rules(),
    );
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.contentPercent).toBeNull();
  });

  it("distinguishes a missing grade from a grade below the threshold", () => {
    const missing = evaluateCompletion(facts({ releasedGradePercent: null }), {
      ...DEFAULT_COMPLETION_RULES,
      requireAllPublishedContent: false,
      minReleasedGradePercent: 70,
    });
    expect(missing.gaps.map((gap) => gap.code)).toEqual(["grade_missing"]);

    const below = evaluateCompletion(facts({ releasedGradePercent: 65 }), {
      ...DEFAULT_COMPLETION_RULES,
      requireAllPublishedContent: false,
      minReleasedGradePercent: 70,
    });
    expect(below.gaps.map((gap) => gap.code)).toEqual(["grade_below_threshold"]);

    const met = evaluateCompletion(facts({ releasedGradePercent: 70 }), {
      ...DEFAULT_COMPLETION_RULES,
      requireAllPublishedContent: false,
      minReleasedGradePercent: 70,
    });
    expect(met.eligible).toBe(true);
  });

  it("describes the configured requirements for the screens", () => {
    expect(describeCompletionRules(DEFAULT_COMPLETION_RULES)).toEqual([
      "Complete every published lesson.",
      "No grade or assignment requirement is set.",
    ]);
    expect(
      summarizeCompletionRules({
        requireAllPublishedContent: true,
        minContentPercent: 50,
        requirePublishedAssignments: true,
        requirePublishedQuizzes: false,
        minReleasedGradePercent: 70,
      }),
    ).toBe(
      "all published lessons; 50% of lessons; all assignments submitted; released grade at least 70%",
    );
    expect(summarizeCompletionRules(rules({ requireAllPublishedContent: false }))).toBe(
      "no additional requirement",
    );
  });
});
