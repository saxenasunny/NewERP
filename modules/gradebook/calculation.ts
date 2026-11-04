/**
 * Gradebook calculation — Phase 8.
 *
 * One pure function decides every learner's course result, so the faculty
 * gradebook, the learner view, and any export cannot disagree. All arithmetic
 * is done on plain numbers and rounded once, at the end.
 *
 * Documented rules
 * ----------------
 * 1. Every assessment is a **column** with `pointsPossible` and, in weighted
 *    mode, a `weight`. Columns are assignments or quizzes.
 * 2. A cell is exactly one of:
 *      - `scored`   — a released/known mark;
 *      - `missing`  — no submission at all;
 *      - `ungraded` — work was submitted but no mark exists yet;
 *      - `excused`  — the learner is excused from this assessment.
 * 3. `excused` and `ungraded` cells never contribute to the denominator: an
 *    unmarked essay must not look like a zero. `ungraded` also makes the result
 *    **incomplete**, so a pass/fail outcome is withheld until it is marked.
 * 4. `missing` is excluded from the denominator by default and reported as
 *    missing. A scheme may opt in with `treatMissingAsZero`, which is the only
 *    way missing work counts as zero.
 * 5. Points mode divides earned points by possible points. Weighted mode
 *    divides the sum of `weight × score/pointsPossible` by the sum of the
 *    weights of the counted columns. Both clamp a score into `0..pointsPossible`.
 * 6. The percentage is rounded **once** to `scheme.rounding` decimal places
 *    (default 2). Letters come from `scheme.scale`, highest threshold first.
 * 7. With no counted points the percentage is `null`, never `0`.
 */

export type ColumnKind = "assignment" | "quiz";

export type CellState = "scored" | "missing" | "ungraded" | "excused";

export type GradingMode = "points" | "weighted";

export interface GradebookColumn {
  id: string;
  title: string;
  kind: ColumnKind;
  /** Maximum points for this assessment; must be greater than zero. */
  pointsPossible: number;
  /** Relative weight in weighted mode. Defaults to 1. */
  weight?: number;
  /** Whether learners may see this column's mark. */
  released: boolean;
}

export interface GradebookCell {
  state: CellState;
  /** Present only for `scored`; ignored otherwise. */
  score?: number | null;
}

export interface GradeScaleBand {
  /** Minimum percentage, inclusive. */
  minPercent: number;
  letter: string;
}

export interface GradebookScheme {
  mode: GradingMode;
  /** Percentage a learner must reach to pass, or null when no pass mark applies. */
  passMark: number | null;
  /** Decimal places for the percentage. Defaults to 2. */
  rounding?: number;
  /** Highest threshold first. Defaults to {@link DEFAULT_SCALE}. */
  scale?: GradeScaleBand[];
  treatMissingAsZero?: boolean;
}

export const DEFAULT_SCALE: GradeScaleBand[] = [
  { minPercent: 90, letter: "A" },
  { minPercent: 80, letter: "B" },
  { minPercent: 70, letter: "C" },
  { minPercent: 60, letter: "D" },
  { minPercent: 0, letter: "F" },
];

export type ResultOutcome = "passed" | "failed" | "incomplete" | "no_result";

export interface LearnerResult {
  /** Points earned from counted columns (weighted mode reports weighted points). */
  earned: number;
  /** Points available from counted columns. */
  possible: number;
  /** Rounded percentage, or null when nothing could be counted. */
  percentage: number | null;
  letter: string | null;
  outcome: ResultOutcome;
  /** True when no counted column is ungraded. */
  complete: boolean;
  counts: {
    scored: number;
    missing: number;
    ungraded: number;
    excused: number;
  };
  /** Columns left out of the total, with the reason, for the audit trail. */
  excluded: { columnId: string; reason: "missing" | "ungraded" | "excused" | "unreleased" }[];
}

export interface CalculateInput {
  columns: GradebookColumn[];
  /** Cell per column id. A column without an entry is treated as `missing`. */
  cells: Record<string, GradebookCell | undefined>;
  scheme: GradebookScheme;
  /** Learner-facing views must hide columns that are not released yet. */
  learnerView?: boolean;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** Math.max(0, Math.trunc(places));
  return Math.round(value * factor) / factor;
}

function clampScore(score: number, pointsPossible: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(Math.max(score, 0), pointsPossible);
}

/** Calculates one learner's course result from the columns and their cells. */
export function calculateLearnerResult({
  columns,
  cells,
  scheme,
  learnerView = false,
}: CalculateInput): LearnerResult {
  const rounding = scheme.rounding ?? 2;
  const scale = scheme.scale ?? DEFAULT_SCALE;

  let earned = 0;
  let possible = 0;
  let weightedEarned = 0;
  let weightedPossible = 0;

  const counts = { scored: 0, missing: 0, ungraded: 0, excused: 0 };
  const excluded: LearnerResult["excluded"] = [];

  for (const column of columns) {
    if (learnerView && !column.released) {
      excluded.push({ columnId: column.id, reason: "unreleased" });
      continue;
    }

    const pointsPossible = column.pointsPossible > 0 ? column.pointsPossible : 0;
    if (pointsPossible === 0) {
      excluded.push({ columnId: column.id, reason: "missing" });
      continue;
    }

    const cell: GradebookCell = cells[column.id] ?? { state: "missing" };
    const weight = column.weight && column.weight > 0 ? column.weight : 1;

    if (cell.state === "excused") {
      counts.excused++;
      excluded.push({ columnId: column.id, reason: "excused" });
      continue;
    }

    if (cell.state === "ungraded") {
      counts.ungraded++;
      excluded.push({ columnId: column.id, reason: "ungraded" });
      continue;
    }

    if (cell.state === "missing" && !scheme.treatMissingAsZero) {
      counts.missing++;
      excluded.push({ columnId: column.id, reason: "missing" });
      continue;
    }

    const score = cell.state === "scored" ? clampScore(cell.score ?? 0, pointsPossible) : 0;
    counts[cell.state === "scored" ? "scored" : "missing"]++;

    earned += score;
    possible += pointsPossible;
    weightedEarned += weight * (score / pointsPossible);
    weightedPossible += weight;
  }

  const complete = counts.ungraded === 0;
  const rawPercentage =
    scheme.mode === "weighted"
      ? weightedPossible > 0
        ? (weightedEarned / weightedPossible) * 100
        : null
      : possible > 0
        ? (earned / possible) * 100
        : null;

  const percentage = rawPercentage === null ? null : roundTo(rawPercentage, rounding);
  const letter =
    percentage === null
      ? null
      : (scale.find((band) => percentage >= band.minPercent)?.letter ?? null);

  let outcome: ResultOutcome;
  if (!complete) {
    outcome = "incomplete";
  } else if (percentage === null) {
    outcome = "no_result";
  } else if (scheme.passMark === null) {
    outcome = "no_result";
  } else {
    outcome = percentage >= scheme.passMark ? "passed" : "failed";
  }

  return {
    earned: roundTo(scheme.mode === "weighted" ? weightedEarned : earned, rounding),
    possible: roundTo(scheme.mode === "weighted" ? weightedPossible : possible, rounding),
    percentage,
    letter,
    outcome,
    complete,
    counts,
    excluded,
  };
}

/** A human-readable note for a cell state, used by the gradebook and exports. */
export function describeCell(cell: GradebookCell | undefined): string {
  if (!cell) return "Missing";
  switch (cell.state) {
    case "scored":
      return "Graded";
    case "ungraded":
      return "Not yet graded";
    case "excused":
      return "Excused";
    case "missing":
      return "Missing";
  }
}
