/**
 * Unit tests for modules/gradebook/calculation.ts — pure functions, no database.
 * The cases mirror the documented rules in that module.
 */
import { describe, expect, it } from "vitest";

import {
  calculateLearnerResult,
  describeCell,
  type GradebookColumn,
  type GradebookScheme,
} from "@/modules/gradebook/calculation";

function column(overrides: Partial<GradebookColumn> & { id: string }): GradebookColumn {
  return {
    title: overrides.id,
    kind: "assignment",
    pointsPossible: 10,
    released: true,
    ...overrides,
  };
}

const pointsScheme: GradebookScheme = { mode: "points", passMark: 50 };

describe("calculateLearnerResult — points mode", () => {
  const columns = [
    column({ id: "a", pointsPossible: 10 }),
    column({ id: "b", pointsPossible: 10 }),
  ];

  it("divides earned by possible", () => {
    const result = calculateLearnerResult({
      columns,
      cells: {
        a: { state: "scored", score: 8 },
        b: { state: "scored", score: 5 },
      },
      scheme: pointsScheme,
    });

    expect(result.earned).toBe(13);
    expect(result.possible).toBe(20);
    expect(result.percentage).toBe(65);
    expect(result.letter).toBe("D");
    expect(result.outcome).toBe("passed");
    expect(result.complete).toBe(true);
  });

  it("rounds the percentage once, to two places", () => {
    const result = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 3 })],
      cells: { a: { state: "scored", score: 2 } },
      scheme: pointsScheme,
    });

    expect(result.percentage).toBe(66.67);
  });

  it("honours a custom rounding precision", () => {
    const result = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 3 })],
      cells: { a: { state: "scored", score: 2 } },
      scheme: { ...pointsScheme, rounding: 0 },
    });

    expect(result.percentage).toBe(67);
  });

  it("clamps a score into the range of the assessment", () => {
    const result = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 10 })],
      cells: { a: { state: "scored", score: 40 } },
      scheme: pointsScheme,
    });

    expect(result.earned).toBe(10);
    expect(result.percentage).toBe(100);
  });
});

describe("calculateLearnerResult — weighting", () => {
  it("weights each column by its ratio and weight", () => {
    const result = calculateLearnerResult({
      columns: [
        column({ id: "exam", pointsPossible: 100, weight: 30 }),
        column({ id: "coursework", pointsPossible: 50, weight: 70 }),
      ],
      cells: {
        exam: { state: "scored", score: 80 },
        coursework: { state: "scored", score: 30 },
      },
      scheme: { mode: "weighted", passMark: 50 },
    });

    // 30% at 80 + 70% at 60 = 66
    expect(result.percentage).toBe(66);
    expect(result.earned).toBe(66);
    expect(result.possible).toBe(100);
  });

  it("ignores raw point size in weighted mode", () => {
    const small = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 5, weight: 1 })],
      cells: { a: { state: "scored", score: 2.5 } },
      scheme: { mode: "weighted", passMark: null },
    });
    const large = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 500, weight: 1 })],
      cells: { a: { state: "scored", score: 250 } },
      scheme: { mode: "weighted", passMark: null },
    });

    expect(small.percentage).toBe(50);
    expect(large.percentage).toBe(50);
  });
});

describe("calculateLearnerResult — missing, ungraded, and excused", () => {
  const columns = [
    column({ id: "a", pointsPossible: 10 }),
    column({ id: "b", pointsPossible: 10 }),
    column({ id: "c", pointsPossible: 10 }),
  ];

  it("reports a missing assessment without treating it as zero", () => {
    const result = calculateLearnerResult({
      columns,
      cells: {
        a: { state: "scored", score: 9 },
        // b is absent entirely → missing
        c: { state: "scored", score: 8 },
      },
      scheme: pointsScheme,
    });

    expect(result.counts.missing).toBe(1);
    expect(result.possible).toBe(20);
    expect(result.percentage).toBe(85);
    expect(result.excluded).toContainEqual({ columnId: "b", reason: "missing" });
  });

  it("counts missing work as zero only when the scheme says so", () => {
    const result = calculateLearnerResult({
      columns,
      cells: { a: { state: "scored", score: 9 }, c: { state: "scored", score: 8 } },
      scheme: { ...pointsScheme, treatMissingAsZero: true },
    });

    expect(result.possible).toBe(30);
    expect(result.percentage).toBe(56.67);
    expect(result.outcome).toBe("passed");
  });

  it("excludes an ungraded assessment and withholds a pass/fail outcome", () => {
    const result = calculateLearnerResult({
      columns,
      cells: {
        a: { state: "scored", score: 10 },
        b: { state: "ungraded" },
        c: { state: "scored", score: 10 },
      },
      scheme: pointsScheme,
    });

    expect(result.counts.ungraded).toBe(1);
    expect(result.possible).toBe(20);
    expect(result.percentage).toBe(100);
    expect(result.complete).toBe(false);
    expect(result.outcome).toBe("incomplete");
  });

  it("drops excused work from both sides of the calculation", () => {
    const result = calculateLearnerResult({
      columns,
      cells: {
        a: { state: "scored", score: 4 },
        b: { state: "excused" },
        c: { state: "scored", score: 6 },
      },
      scheme: pointsScheme,
    });

    expect(result.counts.excused).toBe(1);
    expect(result.possible).toBe(20);
    expect(result.percentage).toBe(50);
    expect(result.complete).toBe(true);
    expect(result.outcome).toBe("passed");
  });

  it("returns no percentage instead of zero when nothing can be counted", () => {
    const result = calculateLearnerResult({
      columns,
      cells: {
        a: { state: "excused" },
        b: { state: "excused" },
        c: { state: "excused" },
      },
      scheme: pointsScheme,
    });

    expect(result.percentage).toBeNull();
    expect(result.letter).toBeNull();
    expect(result.outcome).toBe("no_result");
  });
});

describe("calculateLearnerResult — letters, pass marks, and learner visibility", () => {
  it("uses the highest matching band", () => {
    const result = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 10 })],
      cells: { a: { state: "scored", score: 9 } },
      scheme: pointsScheme,
    });

    expect(result.percentage).toBe(90);
    expect(result.letter).toBe("A");
  });

  it("honours a custom scale", () => {
    const result = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 10 })],
      cells: { a: { state: "scored", score: 7 } },
      scheme: {
        ...pointsScheme,
        scale: [
          { minPercent: 70, letter: "Distinction" },
          { minPercent: 0, letter: "Fail" },
        ],
      },
    });

    expect(result.letter).toBe("Distinction");
  });

  it("fails a learner below the pass mark", () => {
    const result = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 10 })],
      cells: { a: { state: "scored", score: 4 } },
      scheme: pointsScheme,
    });

    expect(result.outcome).toBe("failed");
  });

  it("reports no outcome when the scheme has no pass mark", () => {
    const result = calculateLearnerResult({
      columns: [column({ id: "a", pointsPossible: 10 })],
      cells: { a: { state: "scored", score: 10 } },
      scheme: { mode: "points", passMark: null },
    });

    expect(result.percentage).toBe(100);
    expect(result.outcome).toBe("no_result");
  });

  it("omits unreleased columns from a learner-facing result", () => {
    const result = calculateLearnerResult({
      columns: [
        column({ id: "a", pointsPossible: 10, released: true }),
        column({ id: "b", pointsPossible: 10, released: false }),
      ],
      cells: {
        a: { state: "scored", score: 10 },
        b: { state: "scored", score: 0 },
      },
      scheme: pointsScheme,
      learnerView: true,
    });

    expect(result.possible).toBe(10);
    expect(result.percentage).toBe(100);
    expect(result.excluded).toContainEqual({ columnId: "b", reason: "unreleased" });
  });
});

describe("describeCell", () => {
  it("labels each state for the UI and exports", () => {
    expect(describeCell(undefined)).toBe("Missing");
    expect(describeCell({ state: "scored", score: 4 })).toBe("Graded");
    expect(describeCell({ state: "ungraded" })).toBe("Not yet graded");
    expect(describeCell({ state: "excused" })).toBe("Excused");
    expect(describeCell({ state: "missing" })).toBe("Missing");
  });
});
