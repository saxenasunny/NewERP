/**
 * Unit tests for modules/quizzes/rules.ts — pure functions, no DB.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateScore,
  autosaveAllowed,
  checkAttemptEligibility,
  computeDeadline,
  DEFAULT_QUIZ_SETTINGS,
  fromDecimal,
  getResultVisibility,
  isPastDeadline,
  parseQuizSettings,
  remainingMs,
  scoreItem,
  shuffleForAttempt,
  toDecimal,
} from "@/modules/quizzes/rules";

// ---------------------------------------------------------------------------
// parseQuizSettings
// ---------------------------------------------------------------------------
describe("parseQuizSettings", () => {
  it("returns defaults for null / array / empty", () => {
    expect(parseQuizSettings(null)).toEqual(DEFAULT_QUIZ_SETTINGS);
    expect(parseQuizSettings([])).toEqual(DEFAULT_QUIZ_SETTINGS);
    expect(parseQuizSettings({})).toEqual(DEFAULT_QUIZ_SETTINGS);
  });

  it("parses valid fields", () => {
    const s = parseQuizSettings({
      timeLimitMinutes: 90,
      attemptLimit: 3,
      gradingMethod: "highest",
      shuffleQuestions: true,
      releasePolicy: "manual",
      extraTimeMinutes: { u1: 15 },
      allowPartialCredit: true,
      negativeMarkingFraction: 0.5,
    });
    expect(s.timeLimitMinutes).toBe(90);
    expect(s.attemptLimit).toBe(3);
    expect(s.releasePolicy).toBe("manual");
    expect(s.extraTimeMinutes["u1"]).toBe(15);
    expect(s.negativeMarkingFraction).toBe(0.5);
  });

  it("falls back on invalid enum values", () => {
    expect(parseQuizSettings({ gradingMethod: "bad" }).gradingMethod).toBe(
      DEFAULT_QUIZ_SETTINGS.gradingMethod,
    );
    expect(parseQuizSettings({ releasePolicy: "bad" }).releasePolicy).toBe(
      DEFAULT_QUIZ_SETTINGS.releasePolicy,
    );
  });

  it("ignores non-positive timeLimitMinutes", () => {
    expect(parseQuizSettings({ timeLimitMinutes: -5 }).timeLimitMinutes).toBeNull();
    expect(parseQuizSettings({ timeLimitMinutes: 0 }).timeLimitMinutes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deadline helpers
// ---------------------------------------------------------------------------
describe("deadline helpers", () => {
  const start = new Date("2026-11-01T10:00:00Z");

  it("null for no time limit", () => {
    expect(
      computeDeadline({ startedAt: start, timeLimitMinutes: null, extraMinutes: 0 }),
    ).toBeNull();
  });

  it("adds limit minutes correctly", () => {
    const d = computeDeadline({ startedAt: start, timeLimitMinutes: 60, extraMinutes: 0 });
    expect(d?.toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });

  it("adds extra minutes", () => {
    const d = computeDeadline({ startedAt: start, timeLimitMinutes: 60, extraMinutes: 15 });
    expect(d?.toISOString()).toBe("2026-11-01T11:15:00.000Z");
  });

  it("ignores negative extra", () => {
    const d = computeDeadline({ startedAt: start, timeLimitMinutes: 60, extraMinutes: -30 });
    expect(d?.toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });

  it("isPastDeadline: false for null", () => {
    expect(isPastDeadline(null, new Date())).toBe(false);
  });

  it("isPastDeadline: true at exactly deadline", () => {
    const dl = new Date("2026-11-01T11:00:00Z");
    expect(isPastDeadline(dl, dl)).toBe(true);
  });

  it("remainingMs: Infinity with no deadline", () => {
    expect(remainingMs(null, new Date())).toBe(Infinity);
  });

  it("remainingMs: 0 when past", () => {
    expect(remainingMs(new Date("2026-11-01T09:00:00Z"), new Date("2026-11-01T10:00:00Z"))).toBe(0);
  });

  it("remainingMs: correct value", () => {
    expect(remainingMs(new Date("2026-11-01T11:00:00Z"), new Date("2026-11-01T10:00:00Z"))).toBe(
      3_600_000,
    );
  });
});

// ---------------------------------------------------------------------------
// checkAttemptEligibility
// ---------------------------------------------------------------------------
describe("checkAttemptEligibility", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const base = {
    settings: { ...DEFAULT_QUIZ_SETTINGS, attemptLimit: 2 },
    quizStatus: "published" as const,
    availableFrom: null,
    availableUntil: null,
    completedAttemptCount: 0,
    hasInProgressAttempt: false,
    now,
  };

  it("eligible for fresh start", () =>
    expect(checkAttemptEligibility(base)).toEqual({ eligible: true }));
  it("rejects draft quiz", () =>
    expect(checkAttemptEligibility({ ...base, quizStatus: "draft" }).eligible).toBe(false));
  it("rejects before availableFrom", () => {
    const r = checkAttemptEligibility({ ...base, availableFrom: new Date("2026-11-02T00:00:00Z") });
    expect(r).toMatchObject({ eligible: false, reason: expect.stringMatching(/opens/) });
  });
  it("rejects after availableUntil", () => {
    const r = checkAttemptEligibility({
      ...base,
      availableUntil: new Date("2026-11-01T11:00:00Z"),
    });
    expect(r).toMatchObject({ eligible: false, reason: expect.stringMatching(/closed/) });
  });
  it("rejects at attempt limit", () => {
    const r = checkAttemptEligibility({ ...base, completedAttemptCount: 2 });
    expect(r.eligible).toBe(false);
  });
  it("allows in-progress resume", () => {
    expect(checkAttemptEligibility({ ...base, hasInProgressAttempt: true })).toEqual({
      eligible: true,
    });
  });
});

// ---------------------------------------------------------------------------
// autosaveAllowed
// ---------------------------------------------------------------------------
describe("autosaveAllowed", () => {
  it("allows in_progress before deadline", () => {
    expect(
      autosaveAllowed(
        "in_progress",
        new Date("2026-11-01T13:00:00Z"),
        new Date("2026-11-01T12:00:00Z"),
      ),
    ).toBe(true);
  });
  it("allows with no deadline", () => {
    expect(autosaveAllowed("in_progress", null, new Date())).toBe(true);
  });
  it("rejects past deadline", () => {
    expect(
      autosaveAllowed(
        "in_progress",
        new Date("2026-11-01T11:00:00Z"),
        new Date("2026-11-01T12:00:00Z"),
      ),
    ).toBe(false);
  });
  it("rejects submitted", () => {
    expect(autosaveAllowed("submitted", null, new Date())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreItem
// ---------------------------------------------------------------------------
describe("scoreItem", () => {
  const noNeg = {
    allowPartialCredit: false,
    negativeMarking: false,
    negativeMarkingFraction: 0.25,
  };
  const neg = { ...noNeg, negativeMarking: true };
  const part = { ...noNeg, allowPartialCredit: true };

  it("single_choice: correct → full marks", () => {
    const r = scoreItem({
      type: "single_choice",
      key: { correctOptionId: "a" },
      answer: { selectedOptionId: "a" },
      pointsPossible: 2,
      settings: noNeg,
    });
    expect(r.score).toBe(2);
    expect(r.correct).toBe(true);
  });
  it("single_choice: wrong → 0 without negative marking", () => {
    const r = scoreItem({
      type: "single_choice",
      key: { correctOptionId: "a" },
      answer: { selectedOptionId: "b" },
      pointsPossible: 2,
      settings: noNeg,
    });
    expect(r.score).toBe(0);
  });
  it("single_choice: wrong → negative with marking", () => {
    const r = scoreItem({
      type: "single_choice",
      key: { correctOptionId: "a" },
      answer: { selectedOptionId: "b" },
      pointsPossible: 4,
      settings: neg,
    });
    expect(r.score).toBe(-1);
  });
  it("true_false: correct", () => {
    expect(
      scoreItem({
        type: "true_false",
        key: { correctOptionId: "true" },
        answer: { selectedOptionId: "true" },
        pointsPossible: 1,
        settings: noNeg,
      }).score,
    ).toBe(1);
  });
  it("fill_blank: case-insensitive match", () => {
    expect(
      scoreItem({
        type: "fill_blank",
        key: { acceptedAnswers: ["Paris"] },
        answer: { text: "PARIS" },
        pointsPossible: 1,
        settings: noNeg,
      }).score,
    ).toBe(1);
  });
  it("fill_blank: wrong → 0", () => {
    expect(
      scoreItem({
        type: "fill_blank",
        key: { acceptedAnswers: ["Paris"] },
        answer: { text: "London" },
        pointsPossible: 1,
        settings: noNeg,
      }).score,
    ).toBe(0);
  });
  it("multi_select: all correct", () => {
    const r = scoreItem({
      type: "multi_select",
      key: { correctOptionIds: ["a", "b"] },
      answer: { selectedOptionIds: ["a", "b"] },
      pointsPossible: 2,
      settings: noNeg,
    });
    expect(r.score).toBe(2);
    expect(r.correct).toBe(true);
  });
  it("multi_select: partial → 0 without partial credit", () => {
    expect(
      scoreItem({
        type: "multi_select",
        key: { correctOptionIds: ["a", "b"] },
        answer: { selectedOptionIds: ["a"] },
        pointsPossible: 2,
        settings: noNeg,
      }).score,
    ).toBe(0);
  });
  it("multi_select: partial credit 2/3", () => {
    const r = scoreItem({
      type: "multi_select",
      key: { correctOptionIds: ["a", "b", "c"] },
      answer: { selectedOptionIds: ["a", "b"] },
      pointsPossible: 3,
      settings: part,
    });
    expect(r.score).toBe(2);
  });
  it("essay: null score (manual queue)", () => {
    const r = scoreItem({
      type: "essay",
      key: {},
      answer: { text: "..." },
      pointsPossible: 10,
      settings: noNeg,
    });
    expect(r.score).toBeNull();
    expect(r.correct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateScore
// ---------------------------------------------------------------------------
describe("aggregateScore", () => {
  it("sums scored items", () => {
    const r = aggregateScore([
      { score: 2, pointsPossible: 2 },
      { score: 1, pointsPossible: 2 },
    ]);
    expect(r.score).toBe(3);
    expect(r.scoredPoints).toBe(4);
    expect(r.unscoredCount).toBe(0);
  });
  it("counts unscored essays", () => {
    const r = aggregateScore([
      { score: 2, pointsPossible: 2 },
      { score: null, pointsPossible: 10 },
    ]);
    expect(r.score).toBe(2);
    expect(r.unscoredCount).toBe(1);
  });
  it("empty list → zeros", () => {
    expect(aggregateScore([])).toEqual({ score: 0, scoredPoints: 0, unscoredCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// getResultVisibility
// ---------------------------------------------------------------------------
describe("getResultVisibility", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const base = {
    releasePolicy: "on_submit" as const,
    releasedAt: null,
    availableUntil: null,
    attemptStatus: "submitted" as const,
    now,
  };

  it("hides while in_progress", () =>
    expect(getResultVisibility({ ...base, attemptStatus: "in_progress" }).showResults).toBe(false));
  it("on_submit shows after submit", () => {
    const r = getResultVisibility(base);
    expect(r.showResults).toBe(true);
    expect(r.showAnswerKey).toBe(true);
  });
  it("never policy hides all", () => {
    const r = getResultVisibility({ ...base, releasePolicy: "never" });
    expect(r.showResults).toBe(false);
  });
  it("after_until hides before close", () => {
    expect(
      getResultVisibility({
        ...base,
        releasePolicy: "after_until",
        availableUntil: new Date("2026-11-02T00:00:00Z"),
      }).showResults,
    ).toBe(false);
  });
  it("after_until shows after close", () => {
    expect(
      getResultVisibility({
        ...base,
        releasePolicy: "after_until",
        availableUntil: new Date("2026-11-01T11:00:00Z"),
      }).showResults,
    ).toBe(true);
  });
  it("manual hides before releasedAt", () => {
    expect(
      getResultVisibility({
        ...base,
        releasePolicy: "manual",
        releasedAt: new Date("2026-11-02T00:00:00Z"),
      }).showResults,
    ).toBe(false);
  });
  it("manual shows after releasedAt", () => {
    expect(
      getResultVisibility({
        ...base,
        releasePolicy: "manual",
        releasedAt: new Date("2026-11-01T10:00:00Z"),
      }).showResults,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shuffleForAttempt
// ---------------------------------------------------------------------------
describe("shuffleForAttempt", () => {
  it("same seed → same order", () => {
    const items = [1, 2, 3, 4, 5];
    expect(shuffleForAttempt(items, "seed-abc")).toEqual(shuffleForAttempt(items, "seed-abc"));
  });
  it("different seeds → different order (probabilistic)", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(shuffleForAttempt(items, "seed-one")).not.toEqual(shuffleForAttempt(items, "seed-two"));
  });
  it("does not mutate original", () => {
    const items = [1, 2, 3];
    shuffleForAttempt(items, "s");
    expect(items).toEqual([1, 2, 3]);
  });
  it("contains same elements", () => {
    const items = [1, 2, 3, 4, 5];
    expect([...shuffleForAttempt(items, "x")].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// Decimal helpers
// ---------------------------------------------------------------------------
describe("Decimal helpers", () => {
  it("round-trips a number", () => expect(fromDecimal(toDecimal(3.14))).toBeCloseTo(3.14));
  it("fromDecimal(null) → null", () => expect(fromDecimal(null)).toBeNull());
});
