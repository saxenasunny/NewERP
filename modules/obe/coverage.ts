/**
 * Mapping coverage warnings. These are not attainment values: a missing mapping
 * stays missing, never zero.
 */

export type CoverageWarning = {
  code:
    | "offering_without_programme"
    | "co_unmapped_to_po"
    | "co_unmapped_to_assessment"
    | "po_unmapped_from_co"
    | "assignment_unmapped"
    | "question_unmapped"
    | "formula_unconfigured";
  message: string;
  resourceType: string;
  resourceId: string;
};

export type CoverageInput = {
  offeringId: string;
  programmeId: string | null;
  formulaConfigured: boolean;
  courseOutcomes: Array<{ id: string; code: string; status: string }>;
  programmeOutcomes: Array<{ id: string; code: string; type: string; status: string }>;
  coToPo: Array<{ courseOutcomeId: string; programmeOutcomeId: string }>;
  coToAssessment: Array<{
    courseOutcomeId: string;
    kind: "ASSIGNMENT" | "QUESTION";
    refId: string;
  }>;
  assignments: Array<{ id: string; title: string; status: string }>;
  questions: Array<{ id: string; title: string }>;
};

export function coverageWarnings(input: CoverageInput): CoverageWarning[] {
  const warnings: CoverageWarning[] = [];
  const activeCos = input.courseOutcomes.filter((row) => row.status !== "ARCHIVED");
  const mappablePos = input.programmeOutcomes.filter(
    (row) => row.status !== "ARCHIVED" && (row.type === "PO" || row.type === "PSO"),
  );

  if (!input.formulaConfigured) {
    warnings.push({
      code: "formula_unconfigured",
      message:
        "No attainment formula is configured. Mapping coverage is reported; attainment is not calculated.",
      resourceType: "attainment_policy",
      resourceId: input.offeringId,
    });
  }

  if (!input.programmeId) {
    warnings.push({
      code: "offering_without_programme",
      message:
        "This offering is not attached to a section, so it cannot map course outcomes to programme outcomes.",
      resourceType: "course_offering",
      resourceId: input.offeringId,
    });
  }

  const cosWithPo = new Set(input.coToPo.map((row) => row.courseOutcomeId));
  const cosWithAssessment = new Set(input.coToAssessment.map((row) => row.courseOutcomeId));
  const posWithCo = new Set(input.coToPo.map((row) => row.programmeOutcomeId));
  const mappedAssignments = new Set(
    input.coToAssessment.filter((row) => row.kind === "ASSIGNMENT").map((row) => row.refId),
  );
  const mappedQuestions = new Set(
    input.coToAssessment.filter((row) => row.kind === "QUESTION").map((row) => row.refId),
  );

  for (const outcome of activeCos) {
    if (input.programmeId && !cosWithPo.has(outcome.id)) {
      warnings.push({
        code: "co_unmapped_to_po",
        message: `${outcome.code} is not mapped to a programme outcome.`,
        resourceType: "course_outcome",
        resourceId: outcome.id,
      });
    }
    if (!cosWithAssessment.has(outcome.id)) {
      warnings.push({
        code: "co_unmapped_to_assessment",
        message: `${outcome.code} has no assignment or question mapped as evidence.`,
        resourceType: "course_outcome",
        resourceId: outcome.id,
      });
    }
  }

  for (const outcome of mappablePos) {
    if (!posWithCo.has(outcome.id)) {
      warnings.push({
        code: "po_unmapped_from_co",
        message: `${outcome.code} has no course outcome mapped to it in this offering.`,
        resourceType: "programme_outcome",
        resourceId: outcome.id,
      });
    }
  }

  for (const assignment of input.assignments.filter((row) => row.status === "PUBLISHED")) {
    if (!mappedAssignments.has(assignment.id)) {
      warnings.push({
        code: "assignment_unmapped",
        message: `Assignment “${assignment.title}” is not mapped to a course outcome.`,
        resourceType: "assignment",
        resourceId: assignment.id,
      });
    }
  }

  for (const question of input.questions) {
    if (!mappedQuestions.has(question.id)) {
      warnings.push({
        code: "question_unmapped",
        message: `Question “${question.title}” is not mapped to a course outcome.`,
        resourceType: "question",
        resourceId: question.id,
      });
    }
  }

  return warnings;
}
