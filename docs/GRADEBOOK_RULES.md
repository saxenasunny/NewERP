# Gradebook calculation rules

Phase 8. The single implementation is `modules/gradebook/calculation.ts`; the
faculty gradebook, the learner view, and the CSV export all call it, so they
cannot disagree.

## Columns and cells

A course gradebook has one **column** per published assignment and per published
quiz. Each column stores a title, its kind, and `pointsPossible`. In weighted
mode a column also carries a `weight`.

Each learner has one **cell** per column, in exactly one of four states:

| State      | Meaning                                     | Counted?                    |
| ---------- | ------------------------------------------- | --------------------------- |
| `scored`   | A mark exists and has been released         | Yes                         |
| `ungraded` | Work exists but has no mark yet             | No — result is `incomplete` |
| `missing`  | Nothing was submitted                       | No, unless opted in         |
| `excused`  | The learner is excused from this assessment | No                          |

A column with no cell at all is treated as `missing`.

## Totals

- **Points mode** (default): `earned / possible`, where both sums include only
  counted columns.
- **Weighted mode**: `Σ(weight × score/pointsPossible) / Σ(weight)` over counted
  columns, reported as a percentage.

Both modes clamp a score into `0..pointsPossible`, so a bad import can never
produce more than full marks.

## Missing and ungraded work

- Ungraded work is **never** treated as zero and never contributes to the
  denominator. The result is reported as `incomplete` and a pass/fail outcome is
  withheld until everything is marked.
- Missing work is **excluded** by default and reported as missing. A scheme can
  opt in with `treatMissingAsZero`; that is the only way missing work counts as
  zero.
- Excused work is removed from both the numerator and the denominator.
- When nothing can be counted, the percentage is `null` and the outcome is
  `no_result` — never `0`.

## Rounding and letters

The percentage is computed at full precision and rounded **once**, to
`rounding` decimal places (default 2). Letters come from the scheme's scale,
highest threshold first; the default scale is A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60,
F below 60. A pass mark, when configured, is compared against the rounded
percentage.

## Learner visibility

A learner sees only columns whose marks are released: an assignment grade that
is `RELEASED`, or a quiz whose results have been released. Hidden columns are
excluded from the learner's total rather than shown as zero.

## Changing a grade

A saved grade change returns the mark to `DRAFT` until it is released again, so a
regrade never quietly replaces a mark a learner has already seen. While it is
draft the cell is `ungraded` and the result is `Incomplete`; once released, the
next read shows the new percentage. One grade row per submission is kept, so a
regrade replaces the mark rather than adding a column.

## Quiz score source

A quiz column uses the learner's highest finished attempt that has a score. An
attempt still in progress, or a finished attempt without a score, makes the cell
`ungraded`.

## Where configuration lives

Per offering, `grading_schemes` stores the mode, pass mark, rounding, letter
scale, and the missing-work policy; `assessment_weights` stores the weight of
each assessment for weighted mode; `assessment_excusals` stores per-learner,
per-assessment excusals with a reason and the actor. All three are optional — an
offering without a scheme uses points mode with no pass mark.

Saving a scheme increments its `version` and writes an audit event. Nothing
recomputes or rewrites stored marks: results are calculated on every read, so a
configuration change takes effect on the next page load and every panel agrees.

## Release controls

The faculty gradebook shows every column with its release state and, per column,
how many marks are ready to publish and how many submissions are still waiting
for a mark. Releasing one assessment is unchanged; releasing the whole offering
publishes every draft mark that already has a score.

Only scored marks move: a submission without a mark stays ungraded, so a batch
release cannot publish an empty grade. Each released mark keeps its history in
`grade_change_events`, the batch writes one `gradebook.offering_released` audit
event with the counts, and each affected learner receives one summary email
rather than one message per assessment. Quiz results are released from their own
page, because a quiz controls its own release policy.

Faculty reports filter and page learners server-side, and the CSV export always
covers the whole cohort.
