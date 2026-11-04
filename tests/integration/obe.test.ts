import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError, ResourceNotFoundError } from "@/lib/errors";
import { addInstructor, createCourse, createOffering } from "@/modules/academics/course-service";
import {
  createAcademicYear,
  createCohort,
  createDepartment,
  createProgramme,
  createSection,
  createTerm,
} from "@/modules/academics/structure-service";
import { createAssignment } from "@/modules/assignments/assignment-service";
import { ATTAINMENT_NOT_COMPUTED, buildObeEvidenceCsv } from "@/modules/obe/evidence";
import {
  activateAttainmentPolicy,
  createAssessmentMapping,
  createAttainmentPolicyDraft,
  createCourseOutcome,
  createProgrammeOutcome,
  getActiveAttainmentPolicy,
  getCourseObeEvidence,
  getCourseObeWorkspace,
  getProgrammeOutcomes,
  listAttainmentPolicies,
  updateAttainmentPolicyDraft,
  upsertOutcomeMapping,
} from "@/modules/obe/outcome-service";

import {
  createTenantFixture,
  disconnectTestDb,
  integrationDatabaseUrl,
  resetDatabase,
  seedPermissions,
  type TenantFixture,
} from "./helpers/database";

const databaseAvailable = Boolean(integrationDatabaseUrl());

if (!databaseAvailable) {
  console.warn(
    "Skipping OBE tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

async function accountFor(userId: string, tenantId: string): Promise<AccountContext> {
  const account = await buildAccountContext(
    {
      session: { id: "test-session", expiresAt: new Date(Date.now() + 60_000) },
      user: { id: userId },
    },
    { activeTenantId: tenantId },
  );
  if (!account) throw new Error("Expected an account context for an active user.");
  return account;
}

function policyInput(overrides: Record<string, string> = {}) {
  return {
    name: "Institution attainment policy",
    notes: "",
    rounding: "2",
    courseOutcomeThreshold: "60",
    programmeOutcomeThreshold: "",
    directMethodNotes: "",
    indirectMethodNotes: "",
    ...overrides,
  };
}

let north: TenantFixture;
let south: TenantFixture;
let admin: AccountContext;
let faculty: AccountContext;
let student: AccountContext;
let outsider: AccountContext;
let programmeId: string;
let otherProgrammeId: string;
let offeringId: string;
let poId: string;
let peoId: string;
let psoId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });
  south = await createTenantFixture({ slug: "south", name: "South College", code: "SC" });

  admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);
  outsider = await accountFor(south.admin.userId, south.tenantId);

  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    { requestId: "req-obe" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-obe" },
  );
  const department = await createDepartment(
    admin,
    { name: "Computer Science", code: "CS" },
    { requestId: "req-obe" },
  );
  programmeId = (
    await createProgramme(
      admin,
      {
        departmentId: department.id,
        name: "BSc Computer Science",
        code: "BSCS",
        level: "BACHELOR",
      },
      { requestId: "req-obe" },
    )
  ).id;
  otherProgrammeId = (
    await createProgramme(
      admin,
      {
        departmentId: department.id,
        name: "BSc Software Engineering",
        code: "BSSE",
        level: "BACHELOR",
      },
      { requestId: "req-obe" },
    )
  ).id;
  const cohort = await createCohort(
    admin,
    { programmeId, academicYearId: year.id, name: "2026 CS intake" },
    { requestId: "req-obe" },
  );
  const section = await createSection(
    admin,
    { cohortId: cohort.id, name: "A", capacity: 40 },
    { requestId: "req-obe" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 4 },
    { requestId: "req-obe" },
  );
  offeringId = (
    await createOffering(
      admin,
      { courseId: course.id, termId: term.id, sectionId: section.id, status: "DRAFT" },
      { requestId: "req-obe" },
    )
  ).id;
  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-obe" },
  );

  poId = (
    await createProgrammeOutcome(admin, programmeId, {
      type: "PO",
      code: "PO1",
      title: "Design and implement correct programs from a specification.",
    })
  ).id;
  peoId = (
    await createProgrammeOutcome(admin, programmeId, {
      type: "PEO",
      code: "PEO1",
      title: "Graduates apply computing in their first professional role.",
    })
  ).id;
  psoId = (
    await createProgrammeOutcome(admin, programmeId, {
      type: "PSO",
      code: "PSO1",
      title: "Build and test software with modern tooling.",
    })
  ).id;
});

afterAll(async () => {
  await disconnectTestDb();
});

describeDb("outcome-based education (PostgreSQL)", () => {
  it("defines programme outcomes and refuses duplicate codes or another tenant", async () => {
    const created = await createProgrammeOutcome(admin, programmeId, {
      type: "PO",
      code: "po9",
      title: "Handle ambiguity in requirements.",
    });
    expect(created).toMatchObject({ type: "PO", code: "PO9", status: "ACTIVE", position: 2 });

    await expect(
      createProgrammeOutcome(admin, programmeId, {
        type: "PO",
        code: "PO9",
        title: "Duplicate code.",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const list = await getProgrammeOutcomes(admin, programmeId);
    expect(list.outcomes.map((outcome) => outcome.code)).toEqual(["PEO1", "PO1", "PO9", "PSO1"]);

    await expect(getProgrammeOutcomes(outsider, programmeId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    await expect(
      createProgrammeOutcome(outsider, programmeId, {
        type: "PO",
        code: "PO2",
        title: "Cross-tenant write.",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(getProgrammeOutcomes(faculty, programmeId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("versions the attainment policy, keeps one active, and freezes it once active", async () => {
    const v1 = await createAttainmentPolicyDraft(admin, policyInput());
    expect(v1).toMatchObject({ version: 1, status: "DRAFT", formulaConfigured: false });

    const active = await activateAttainmentPolicy(admin, v1.id);
    expect(active).toMatchObject({ version: 1, status: "ACTIVE" });
    expect(active.formulaConfigured).toBe(false);

    await expect(
      updateAttainmentPolicyDraft(admin, v1.id, policyInput({ rounding: "3" })),
    ).rejects.toBeInstanceOf(ConflictError);

    const v2 = await createAttainmentPolicyDraft(admin, policyInput({ rounding: "3" }));
    expect(v2.version).toBe(2);

    await expect(createAttainmentPolicyDraft(admin, policyInput())).rejects.toBeInstanceOf(
      ConflictError,
    );

    const activated = await activateAttainmentPolicy(admin, v2.id);
    expect(activated.version).toBe(2);

    const versions = await listAttainmentPolicies(admin);
    expect(versions.map((policy) => [policy.version, policy.status])).toEqual([
      [2, "ACTIVE"],
      [1, "ARCHIVED"],
    ]);
    expect((await getActiveAttainmentPolicy(admin))?.version).toBe(2);

    await expect(activateAttainmentPolicy(admin, v1.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps course outcomes to POs and PSOs on the active scale only", async () => {
    const co = await createCourseOutcome(faculty, offeringId, {
      code: "co1",
      title: "Declare variables and predict the effect of assignment.",
    });
    expect(co.code).toBe("CO1");

    const mapping = await upsertOutcomeMapping(faculty, offeringId, {
      courseOutcomeId: co.id,
      programmeOutcomeId: poId,
      correlationLevel: "2",
    });
    expect(mapping.correlationLevel).toBe(2);

    await expect(
      upsertOutcomeMapping(faculty, offeringId, {
        courseOutcomeId: co.id,
        programmeOutcomeId: psoId,
        correlationLevel: "4",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      upsertOutcomeMapping(faculty, offeringId, {
        courseOutcomeId: co.id,
        programmeOutcomeId: peoId,
        correlationLevel: "2",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const otherPo = await createProgrammeOutcome(admin, otherProgrammeId, {
      type: "PO",
      code: "PO1",
      title: "Engineering programme outcome.",
    });
    await expect(
      upsertOutcomeMapping(faculty, offeringId, {
        courseOutcomeId: co.id,
        programmeOutcomeId: otherPo.id,
        correlationLevel: "2",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    await expect(
      upsertOutcomeMapping(student, offeringId, {
        courseOutcomeId: co.id,
        programmeOutcomeId: poId,
        correlationLevel: "2",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      upsertOutcomeMapping(outsider, offeringId, {
        courseOutcomeId: co.id,
        programmeOutcomeId: poId,
        correlationLevel: "2",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("surfaces missing mapping and evidence instead of reporting zero attainment", async () => {
    const co = await createCourseOutcome(faculty, offeringId, {
      code: "CO1",
      title: "Trace and write control flow.",
    });

    const before = await getCourseObeWorkspace(faculty, offeringId);
    const beforeCodes = before.warnings.map((warning) => warning.code);
    expect(beforeCodes).toContain("formula_unconfigured");
    expect(beforeCodes).toContain("co_unmapped_to_po");
    expect(beforeCodes).toContain("co_unmapped_to_assessment");

    await upsertOutcomeMapping(faculty, offeringId, {
      courseOutcomeId: co.id,
      programmeOutcomeId: poId,
      correlationLevel: "3",
    });
    const assignment = await createAssignment(
      faculty,
      {
        offeringId,
        title: "Week 1 exercises",
        pointsPossible: 10,
        submissionType: "TEXT",
      },
      { requestId: "req-obe" },
    );
    await createAssessmentMapping(faculty, offeringId, {
      courseOutcomeId: co.id,
      kind: "ASSIGNMENT",
      assignmentId: assignment.id,
      weight: "2",
    });

    const after = await getCourseObeWorkspace(faculty, offeringId);
    const afterCodes = after.warnings.map((warning) => warning.code);
    expect(afterCodes).not.toContain("co_unmapped_to_po");
    expect(afterCodes).not.toContain("co_unmapped_to_assessment");
    expect(afterCodes).toContain("formula_unconfigured");
    expect(after.assessmentMappings).toHaveLength(1);
    expect(after.assessmentMappings[0]?.weight).toBe(2);

    const evidence = await getCourseObeEvidence(faculty, offeringId);
    expect(evidence.correlations).toEqual([
      { courseOutcomeCode: "CO1", programmeOutcomeCode: "PO1", level: 3, label: "Substantial" },
    ]);
    expect(evidence.evidence).toEqual([
      { courseOutcomeCode: "CO1", kind: "ASSIGNMENT", target: "Week 1 exercises", weight: 2 },
    ]);

    const csv = buildObeEvidenceCsv(evidence);
    expect(csv).toContain(ATTAINMENT_NOT_COMPUTED);
    expect(csv).toContain("correlation,CO1,PO1,Substantial,,3");
    expect(csv).toContain("assessment_evidence,CO1,assignment,Week 1 exercises,2");
    expect(csv).not.toMatch(/(^|\r\n)(correlation|assessment_evidence),.*\d+(\.\d+)?%/);
  });

  it("exports the policy version actually used, so a report can be reproduced", async () => {
    const co = await createCourseOutcome(faculty, offeringId, {
      code: "CO1",
      title: "Decompose a problem into functions.",
    });
    await upsertOutcomeMapping(faculty, offeringId, {
      courseOutcomeId: co.id,
      programmeOutcomeId: poId,
      correlationLevel: "3",
    });

    const v1 = await createAttainmentPolicyDraft(admin, policyInput());
    await activateAttainmentPolicy(admin, v1.id);

    const first = await getCourseObeEvidence(faculty, offeringId);
    expect(first.policy).toMatchObject({
      name: "Institution attainment policy",
      version: 1,
      status: "ACTIVE",
      formulaConfigured: false,
      rounding: 2,
      thresholds: { courseOutcome: 60, programmeOutcome: null },
    });
    expect(buildObeEvidenceCsv(first)).toContain(
      "meta,policy,Institution attainment policy,version 1,,active",
    );

    const v2 = await createAttainmentPolicyDraft(admin, policyInput({ rounding: "3" }));
    await activateAttainmentPolicy(admin, v2.id);

    const second = await getCourseObeEvidence(faculty, offeringId);
    expect(second.policy.version).toBe(2);
    expect(second.policy.rounding).toBe(3);
    expect(second.correlations).toEqual(first.correlations);
    expect(buildObeEvidenceCsv(second)).toContain(
      "meta,policy,Institution attainment policy,version 2,,active",
    );
  });
});
