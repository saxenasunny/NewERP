import { describe, expect, it } from "vitest";

import {
  ATTAINMENT_NOT_COMPUTED,
  buildObeEvidenceCsv,
  type ObeEvidenceDoc,
} from "@/modules/obe/evidence";

function sampleDoc(overrides: Partial<ObeEvidenceDoc> = {}): ObeEvidenceDoc {
  return {
    generatedAt: "2026-11-03T10:00:00.000Z",
    offering: {
      offeringId: "offering-1",
      courseCode: "CS101",
      courseTitle: "Introduction to Programming",
      termName: "Semester 1",
      academicYearName: "2026/27",
      programmeCode: "BSCS",
      programmeName: "BSc Computer Science",
    },
    policy: {
      name: "Institution attainment policy",
      version: 2,
      status: "ACTIVE",
      correlationScale: [
        { level: 1, label: "Slight", code: "L" },
        { level: 2, label: "Moderate", code: "M" },
        { level: 3, label: "Substantial", code: "H" },
      ],
      rounding: 2,
      thresholds: { courseOutcome: 60, programmeOutcome: null },
      directMethod: { status: "unconfigured", description: "Waiting for the institution." },
      indirectMethod: { status: "unconfigured" },
      formulaConfigured: false,
    },
    courseOutcomes: [
      { code: "CO1", title: "Variables, expressions, and assignment", status: "ACTIVE" },
      { code: "CO2", title: "Control flow", status: "ACTIVE" },
    ],
    programmeOutcomes: [
      { code: "PO1", type: "PO", title: "Design correct programs", status: "ACTIVE" },
      { code: "PSO1", type: "PSO", title: "Use modern tooling", status: "ACTIVE" },
    ],
    correlations: [
      {
        courseOutcomeCode: "CO1",
        programmeOutcomeCode: "PO1",
        level: 3,
        label: "Substantial",
      },
      {
        courseOutcomeCode: "CO2",
        programmeOutcomeCode: "PSO1",
        level: 2,
        label: "Moderate",
      },
    ],
    evidence: [
      { courseOutcomeCode: "CO1", kind: "ASSIGNMENT", target: "Week 1 exercises", weight: 2 },
      { courseOutcomeCode: "CO2", kind: "QUESTION", target: "Trace a loop", weight: 1.5 },
    ],
    warnings: [
      {
        code: "co_unmapped_to_assessment",
        message: "CO2 has no assignment or question mapped as evidence.",
      },
    ],
    ...overrides,
  };
}

describe("OBE evidence export", () => {
  it("writes a fixed header and one row per stored mapping", () => {
    const csv = buildObeEvidenceCsv(sampleDoc());
    const lines = csv.trimEnd().split("\r\n");

    expect(lines[0]).toBe("section,code,detail,extra,weight,status");
    expect(lines).toContain('course_outcome,CO1,"Variables, expressions, and assignment",,,ACTIVE');
    expect(lines).toContain("programme_outcome,PO1,Design correct programs,PO,,ACTIVE");
    expect(lines).toContain("correlation,CO1,PO1,Substantial,,3");
    expect(lines).toContain("correlation,CO2,PSO1,Moderate,,2");
    expect(lines).toContain("assessment_evidence,CO1,assignment,Week 1 exercises,2");
    expect(lines).toContain("assessment_evidence,CO2,question,Trace a loop,1.5");
    expect(lines).toContain(
      "warning,co_unmapped_to_assessment,CO2 has no assignment or question mapped as evidence.",
    );
  });

  it("states that attainment is not computed and records the policy version", () => {
    const lines = buildObeEvidenceCsv(sampleDoc()).split("\r\n");

    expect(lines).toContain("meta,policy,Institution attainment policy,version 2,,active");
    expect(lines).toContain(`meta,attainment,not computed,"${ATTAINMENT_NOT_COMPUTED}"`);
    expect(lines).toContain("meta,threshold_course_outcome,60%");
    expect(lines).toContain("meta,threshold_programme_outcome,not configured");
    expect(lines).toContain("meta,direct_method,unconfigured,Waiting for the institution.");
    expect(csvHasPercentageClaim(lines)).toBe(false);
  });

  it("escapes separators, quotes, and newlines so columns never shift", () => {
    const csv = buildObeEvidenceCsv(
      sampleDoc({
        courseOutcomes: [{ code: "CO1", title: 'Say "hello", then\nstop', status: "ACTIVE" }],
      }),
    );

    expect(csv).toContain('course_outcome,CO1,"Say ""hello"", then\nstop",,,ACTIVE');
  });

  it("is reproducible: the same document renders byte-identically", () => {
    const doc = sampleDoc();
    expect(buildObeEvidenceCsv(doc)).toBe(buildObeEvidenceCsv(sampleDoc()));
    expect(buildObeEvidenceCsv(sampleDoc())).not.toBe(
      buildObeEvidenceCsv(sampleDoc({ generatedAt: "2026-11-04T10:00:00.000Z" })),
    );
  });
});

/** Guards against a future edit smuggling a made-up attainment figure into the export. */
function csvHasPercentageClaim(lines: string[]): boolean {
  return lines.some(
    (line) =>
      /^(correlation|assessment_evidence|course_outcome|programme_outcome),/.test(line) &&
      /\d+(\.\d+)?%/.test(line),
  );
}
