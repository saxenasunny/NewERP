import { describe, expect, it } from "vitest";

import {
  DEFAULT_ASSIGNMENT_SETTINGS,
  gradeVisibleToLearner,
  isLate,
  learnerAssignmentState,
  parseAssignmentSettings,
  percentOf,
  rubricTotal,
  scoreWithinPoints,
  submissionGate,
  windowState,
} from "@/modules/assignments/rules";

const now = new Date("2026-11-01T12:00:00.000Z");
const day = 86_400_000;

const unbounded = { availableFrom: null, availableUntil: null, dueAt: null };

describe("assignment settings", () => {
  it("falls back to defaults for missing or malformed settings", () => {
    expect(parseAssignmentSettings(null)).toEqual(DEFAULT_ASSIGNMENT_SETTINGS);
    expect(parseAssignmentSettings("nonsense")).toEqual(DEFAULT_ASSIGNMENT_SETTINGS);
    expect(parseAssignmentSettings({ maxAttempts: 0 })).toEqual(DEFAULT_ASSIGNMENT_SETTINGS);
  });

  it("keeps valid stored settings", () => {
    expect(
      parseAssignmentSettings({
        allowLateSubmission: false,
        allowResubmission: true,
        maxAttempts: 3,
      }),
    ).toEqual({ allowLateSubmission: false, allowResubmission: true, maxAttempts: 3 });
  });
});

describe("assignment window", () => {
  it("reports a future opening", () => {
    expect(windowState({ ...unbounded, availableFrom: new Date(now.getTime() + day) }, now)).toBe(
      "not_yet",
    );
  });

  it("reports a closed window after the close time", () => {
    expect(windowState({ ...unbounded, availableUntil: new Date(now.getTime() - 1) }, now)).toBe(
      "closed",
    );
  });

  it("reports past due between the deadline and the close time", () => {
    expect(windowState({ ...unbounded, dueAt: new Date(now.getTime() - day) }, now)).toBe(
      "past_due",
    );
  });

  it("closes take precedence over the due date", () => {
    expect(
      windowState(
        {
          dueAt: new Date(now.getTime() - day),
          availableFrom: null,
          availableUntil: new Date(now.getTime() - 1),
        },
        now,
      ),
    ).toBe("closed");
  });

  it("flags work submitted after the deadline", () => {
    expect(isLate({ ...unbounded, dueAt: new Date("2026-11-01T11:00:00.000Z") }, now)).toBe(true);
    expect(isLate({ ...unbounded, dueAt: new Date("2026-11-01T13:00:00.000Z") }, now)).toBe(false);
    expect(isLate(unbounded, now)).toBe(false);
  });
});

describe("submission gate", () => {
  const settings = { allowLateSubmission: false, allowResubmission: false, maxAttempts: 1 };

  it("allows a first submission inside the window", () => {
    expect(submissionGate({ window: unbounded, settings, submission: null, now })).toEqual({
      allowed: true,
      late: false,
    });
  });

  it("refuses a first submission before it opens", () => {
    expect(
      submissionGate({
        window: { ...unbounded, availableFrom: new Date(now.getTime() + day) },
        settings,
        submission: null,
        now,
      }),
    ).toEqual({ allowed: false, reason: "not_yet" });
  });

  it("refuses work after the deadline when late work is not accepted", () => {
    expect(
      submissionGate({
        window: { ...unbounded, dueAt: new Date(now.getTime() - day) },
        settings,
        submission: null,
        now,
      }),
    ).toEqual({ allowed: false, reason: "past_due" });
  });

  it("accepts late work and flags it when the policy allows", () => {
    expect(
      submissionGate({
        window: { ...unbounded, dueAt: new Date(now.getTime() - day) },
        settings: { ...settings, allowLateSubmission: true },
        submission: null,
        now,
      }),
    ).toEqual({ allowed: true, late: true });
  });

  it("refuses late work once availability closes, even with a late policy", () => {
    expect(
      submissionGate({
        window: { ...unbounded, availableUntil: new Date(now.getTime() - 1) },
        settings: { ...settings, allowLateSubmission: true },
        submission: null,
        now,
      }),
    ).toEqual({ allowed: false, reason: "closed" });
  });

  it("refuses a second submission when resubmission is off", () => {
    expect(
      submissionGate({
        window: unbounded,
        settings,
        submission: { status: "SUBMITTED", attemptNumber: 1 },
        now,
      }),
    ).toEqual({ allowed: false, reason: "resubmission_not_allowed" });
  });

  it("stops at the attempt limit", () => {
    expect(
      submissionGate({
        window: unbounded,
        settings: { ...settings, allowResubmission: true, maxAttempts: 2 },
        submission: { status: "SUBMITTED", attemptNumber: 2 },
        now,
      }),
    ).toEqual({ allowed: false, reason: "max_attempts" });
  });

  it("never replaces a graded submission", () => {
    expect(
      submissionGate({
        window: unbounded,
        settings: { ...settings, allowResubmission: true, maxAttempts: 5 },
        submission: { status: "GRADED", attemptNumber: 1 },
        now,
      }),
    ).toEqual({ allowed: false, reason: "graded" });
  });
});

describe("learner status", () => {
  it("reports a released grade first", () => {
    expect(
      learnerAssignmentState({
        window: unbounded,
        now,
        submission: { status: "SUBMITTED" },
        gradeReleased: true,
      }),
    ).toBe("graded");
  });

  it("distinguishes a late submission", () => {
    expect(
      learnerAssignmentState({
        window: unbounded,
        now,
        submission: { status: "LATE" },
        gradeReleased: false,
      }),
    ).toBe("late");
  });

  it("falls back to the window when nothing is submitted", () => {
    expect(
      learnerAssignmentState({ window: unbounded, now, submission: null, gradeReleased: false }),
    ).toBe("open");
    expect(
      learnerAssignmentState({
        window: { ...unbounded, availableUntil: new Date(now.getTime() - 1) },
        now,
        submission: null,
        gradeReleased: false,
      }),
    ).toBe("closed");
    expect(
      learnerAssignmentState({
        window: { ...unbounded, availableFrom: new Date(now.getTime() + day) },
        now,
        submission: null,
        gradeReleased: false,
      }),
    ).toBe("not_open");
  });
});

describe("grades", () => {
  it("hides draft and ungraded grades from learners", () => {
    expect(gradeVisibleToLearner(null)).toBe(false);
    expect(gradeVisibleToLearner({ gradeStatus: "DRAFT", releasedAt: null })).toBe(false);
    expect(gradeVisibleToLearner({ gradeStatus: "RELEASED", releasedAt: new Date() })).toBe(true);
    // Released without a timestamp is still treated as not shown.
    expect(gradeVisibleToLearner({ gradeStatus: "RELEASED", releasedAt: null })).toBe(false);
  });

  it("computes percentages without inventing a zero", () => {
    expect(percentOf(null, 10)).toBeNull();
    expect(percentOf(7, 10)).toBe(70);
    expect(percentOf(0, 10)).toBe(0);
  });

  it("bounds scores to the points available", () => {
    expect(scoreWithinPoints(0, 10)).toBe(true);
    expect(scoreWithinPoints(10, 10)).toBe(true);
    expect(scoreWithinPoints(10.5, 10)).toBe(false);
    expect(scoreWithinPoints(-1, 10)).toBe(false);
  });

  it("adds rubric scores, treating unscored criteria as zero", () => {
    expect(rubricTotal([{ score: 2 }, { score: null }, { score: 3.5 }])).toBe(5.5);
  });
});
