/**
 * OBE evidence document.
 *
 * This is the artefact an accreditation review consumes: the mappings, the
 * policy version they were measured against, and the explicit statement that no
 * attainment value is reported while the institution has not confirmed a
 * formula. Every line is derived from stored rows, so the same data and policy
 * produce the same file.
 */

export const ATTAINMENT_NOT_COMPUTED =
  "No attainment value is reported. This institution has not confirmed a direct or indirect formula, so missing evidence stays missing rather than zero.";

export type ObeEvidencePolicy = {
  name: string | null;
  version: number | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED" | null;
  correlationScale: Array<{ level: number; label: string; code: string }>;
  rounding: number;
  thresholds: { courseOutcome: number | null; programmeOutcome: number | null };
  directMethod: { status: string; description?: string };
  indirectMethod: { status: string; description?: string };
  formulaConfigured: boolean;
};

export type ObeEvidenceDoc = {
  generatedAt: string;
  offering: {
    offeringId: string;
    courseCode: string;
    courseTitle: string;
    termName: string;
    academicYearName: string;
    programmeCode: string | null;
    programmeName: string | null;
  };
  policy: ObeEvidencePolicy;
  courseOutcomes: Array<{ code: string; title: string; status: string }>;
  programmeOutcomes: Array<{ code: string; type: string; title: string; status: string }>;
  correlations: Array<{
    courseOutcomeCode: string;
    programmeOutcomeCode: string;
    level: number;
    label: string;
  }>;
  evidence: Array<{
    courseOutcomeCode: string;
    kind: "ASSIGNMENT" | "QUESTION";
    target: string;
    weight: number;
  }>;
  warnings: Array<{ code: string; message: string }>;
};

const COLUMNS = ["section", "code", "detail", "extra", "weight", "status"] as const;

function cell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function row(...cells: Array<string | number | null | undefined>): string {
  return cells.map(cell).join(",");
}

function thresholdLabel(value: number | null): string {
  return value === null ? "not configured" : `${value}%`;
}

/**
 * Renders the evidence document as CSV. The header row is fixed, so a reviewer
 * can diff two exports line by line.
 */
export function buildObeEvidenceCsv(doc: ObeEvidenceDoc): string {
  const lines: string[] = [COLUMNS.join(",")];

  lines.push(row("meta", "generated_at", doc.generatedAt));
  lines.push(
    row(
      "meta",
      "offering",
      doc.offering.courseCode,
      doc.offering.courseTitle,
      null,
      doc.offering.termName,
    ),
  );
  lines.push(row("meta", "academic_year", doc.offering.academicYearName));
  lines.push(
    row(
      "meta",
      "programme",
      doc.offering.programmeCode,
      doc.offering.programmeName ?? "Offering is not attached to a section",
    ),
  );
  lines.push(
    row(
      "meta",
      "policy",
      doc.policy.name ?? "No policy",
      doc.policy.version === null ? "no active version" : `version ${doc.policy.version}`,
      null,
      doc.policy.status?.toLowerCase() ?? "none",
    ),
  );
  for (const entry of doc.policy.correlationScale) {
    lines.push(row("meta", "correlation_scale", entry.level, `${entry.label} (${entry.code})`));
  }
  lines.push(row("meta", "rounding", doc.policy.rounding, "decimal places"));
  lines.push(
    row("meta", "threshold_course_outcome", thresholdLabel(doc.policy.thresholds.courseOutcome)),
  );
  lines.push(
    row(
      "meta",
      "threshold_programme_outcome",
      thresholdLabel(doc.policy.thresholds.programmeOutcome),
    ),
  );
  lines.push(
    row(
      "meta",
      "direct_method",
      doc.policy.directMethod.status,
      doc.policy.directMethod.description ?? "",
    ),
  );
  lines.push(
    row(
      "meta",
      "indirect_method",
      doc.policy.indirectMethod.status,
      doc.policy.indirectMethod.description ?? "",
    ),
  );
  lines.push(row("meta", "attainment", "not computed", ATTAINMENT_NOT_COMPUTED));

  for (const outcome of doc.courseOutcomes) {
    lines.push(row("course_outcome", outcome.code, outcome.title, null, null, outcome.status));
  }

  for (const outcome of doc.programmeOutcomes) {
    lines.push(
      row("programme_outcome", outcome.code, outcome.title, outcome.type, null, outcome.status),
    );
  }

  for (const mapping of doc.correlations) {
    lines.push(
      row(
        "correlation",
        mapping.courseOutcomeCode,
        mapping.programmeOutcomeCode,
        mapping.label,
        null,
        mapping.level,
      ),
    );
  }

  for (const evidence of doc.evidence) {
    lines.push(
      row(
        "assessment_evidence",
        evidence.courseOutcomeCode,
        evidence.kind.toLowerCase(),
        evidence.target,
        evidence.weight,
      ),
    );
  }

  for (const warning of doc.warnings) {
    lines.push(row("warning", warning.code, warning.message));
  }

  return `${lines.join("\r\n")}\r\n`;
}
