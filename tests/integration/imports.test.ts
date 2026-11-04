import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError, ResourceNotFoundError } from "@/lib/errors";
import { createCourse, createOffering } from "@/modules/academics/course-service";
import {
  createAcademicYear,
  createCohort,
  createDepartment,
  createProgramme,
  createSection,
  createTerm,
} from "@/modules/academics/structure-service";
import {
  commitImport,
  getImportJob,
  importReportCsv,
  listImportJobs,
  previewImport,
} from "@/modules/imports/import-service";

import {
  createTenantFixture,
  disconnectTestDb,
  integrationDatabaseUrl,
  resetDatabase,
  seedPermissions,
  testDb,
  type TenantFixture,
} from "./helpers/database";

const databaseAvailable = Boolean(integrationDatabaseUrl());

if (!databaseAvailable) {
  console.warn(
    "Skipping import tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

const context = { requestId: "req-imports" };

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

async function seedOffering(admin: AccountContext) {
  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    context,
  );
  const term = await createTerm(
    admin,
    { academicYearId: year.id, name: "Semester 1", startsOn: "2026-08-15", endsOn: "2026-12-20" },
    context,
  );
  const department = await createDepartment(
    admin,
    { name: "Computer Science", code: "CS" },
    context,
  );
  const programme = await createProgramme(
    admin,
    { departmentId: department.id, name: "BSc Computer Science", code: "BSCS", level: "BACHELOR" },
    context,
  );
  const cohort = await createCohort(
    admin,
    { programmeId: programme.id, academicYearId: year.id, name: "2026 intake" },
    context,
  );
  const section = await createSection(
    admin,
    { cohortId: cohort.id, name: "A", capacity: "30" },
    context,
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: "4" },
    context,
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, sectionId: section.id, status: "PUBLISHED" },
    context,
  );
  return { year, term, course, section, offering };
}

describeDb("CSV imports (PostgreSQL)", () => {
  let alpha: TenantFixture;
  let beta: TenantFixture;
  let alphaAdmin: AccountContext;
  let betaAdmin: AccountContext;

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    alpha = await createTenantFixture({ slug: "alpha", name: "Alpha University", code: "ALP" });
    beta = await createTenantFixture({ slug: "beta", name: "Beta College", code: "BET" });
    alphaAdmin = await accountFor(alpha.admin.userId, alpha.tenantId);
    betaAdmin = await accountFor(beta.admin.userId, beta.tenantId);
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("previews per-row errors and commits only valid people, then updates on re-import", async () => {
    const csv = [
      "email,name,role,institutional_id",
      "newcomer@alpha.example,New Comer,student,STU-9001",
      "not-an-email,Bad Address,student,STU-9002",
      "duplicate@alpha.example,First,student,STU-9003",
      "duplicate@alpha.example,Second,student,STU-9004",
    ].join("\n");

    const preview = await previewImport(
      alphaAdmin,
      { kind: "USERS", fileName: "people.csv", csvText: csv },
      context,
    );
    expect(preview.status).toBe("PREVIEW");
    expect(preview.totalRows).toBe(4);
    expect(preview.validRows).toBe(2);
    expect(preview.invalidRows).toBe(2);

    // Preview writes no domain data.
    expect(await testDb().user.count({ where: { email: "newcomer@alpha.example" } })).toBe(0);
    expect(await testDb().importRow.count({ where: { importJobId: preview.id } })).toBe(4);

    const job = await getImportJob(alphaAdmin, preview.id);
    const messages = job.rows.map((row) => `${row.status}:${row.message ?? ""}`).join("\n");
    expect(messages).toContain("VALID");
    expect(messages).toContain("Enter a valid email address.");
    expect(messages).toContain("Duplicate email in this file");

    const commit = await commitImport(alphaAdmin, preview.id, context);
    expect(commit).toEqual({ created: 2, updated: 0, skipped: 0, failed: 0 });

    const user = await testDb().user.findUniqueOrThrow({
      where: { email: "newcomer@alpha.example" },
    });
    const membership = await testDb().tenantMembership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: alpha.tenantId, userId: user.id } },
    });
    expect(membership.status).toBe("ACTIVE");
    expect(membership.institutionalId).toBe("STU-9001");
    expect(
      await testDb().userRoleAssignment.count({
        where: { userId: user.id, tenantId: alpha.tenantId },
      }),
    ).toBe(1);

    const committed = await getImportJob(alphaAdmin, preview.id);
    expect(committed.status).toBe("COMMITTED");
    expect(committed.rows.find((row) => row.rowNumber === 2)?.status).toBe("CREATED");

    await expect(commitImport(alphaAdmin, preview.id, context)).rejects.toBeInstanceOf(
      ConflictError,
    );

    // Re-running the same file updates the same person rather than duplicating.
    const again = await previewImport(
      alphaAdmin,
      { kind: "USERS", fileName: "people.csv", csvText: csv },
      context,
    );
    const secondCommit = await commitImport(alphaAdmin, again.id, context);
    expect(secondCommit.updated).toBe(2);
    expect(await testDb().user.count({ where: { email: "newcomer@alpha.example" } })).toBe(1);
    expect(await testDb().tenantMembership.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await testDb().userRoleAssignment.count({
        where: { userId: user.id, tenantId: alpha.tenantId },
      }),
    ).toBe(1);

    const report = importReportCsv({
      fileName: "people.csv",
      kind: "USERS",
      rows: committed.rows,
    });
    expect(report.split("\r\n")[0]).toBe("row,status,identifier,message");
    expect(report).toContain("created");
    expect(report).toContain("newcomer@alpha.example");

    const audit = await testDb().auditEvent.findFirst({
      where: { action: "import.committed", resourceId: preview.id },
    });
    expect(audit?.actorUserId).toBe(alpha.admin.userId);
  });

  it("rejects a bad header as a failed job and refuses to commit it", async () => {
    const preview = await previewImport(
      alphaAdmin,
      {
        kind: "USERS",
        fileName: "bad-header.csv",
        csvText: "email,full_name,role\na@alpha.example,Name,student\n",
      },
      context,
    );

    expect(preview.status).toBe("FAILED");
    expect(preview.error).toContain("Missing required column(s): name");
    expect(await testDb().importRow.count({ where: { importJobId: preview.id } })).toBe(0);
    expect(await testDb().user.count({ where: { email: "a@alpha.example" } })).toBe(0);

    await expect(commitImport(alphaAdmin, preview.id, context)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("commits enrolments idempotently without letting invalid rows through", async () => {
    const structure = await seedOffering(alphaAdmin);
    const csv = [
      "email,course_code,term,academic_year,section",
      "student@alpha.example,CS101,Semester 1,2026/27,A",
      "ghost@alpha.example,CS101,Semester 1,2026/27,A",
      "student@alpha.example,CS101,Semester 1,2026/27,A",
      "student@alpha.example,MISSING,Semester 1,2026/27,A",
    ].join("\n");

    const preview = await previewImport(
      alphaAdmin,
      { kind: "ENROLMENTS", fileName: "enrolments.csv", csvText: csv },
      context,
    );
    expect(preview.validRows).toBe(1);
    expect(preview.invalidRows).toBe(3);
    expect(await testDb().enrolment.count()).toBe(0);

    const commit = await commitImport(alphaAdmin, preview.id, context);
    expect(commit.created).toBe(1);
    const enrolment = await testDb().enrolment.findFirstOrThrow({
      where: { courseOfferingId: structure.offering.id },
    });
    expect(enrolment.source).toBe("IMPORT");
    expect(enrolment.status).toBe("ACTIVE");

    const again = await previewImport(
      alphaAdmin,
      { kind: "ENROLMENTS", fileName: "enrolments.csv", csvText: csv },
      context,
    );
    const second = await commitImport(alphaAdmin, again.id, context);
    expect(second.skipped).toBe(1);
    expect(await testDb().enrolment.count()).toBe(1);
  });

  it("commits instructor assignments and updates their role on re-import", async () => {
    const structure = await seedOffering(alphaAdmin);
    const base = [
      "email,course_code,term,academic_year,section,role",
      "faculty@alpha.example,CS101,Semester 1,2026/27,A,primary",
    ].join("\n");

    const first = await previewImport(
      alphaAdmin,
      { kind: "INSTRUCTORS", fileName: "instructors.csv", csvText: base },
      context,
    );
    await commitImport(alphaAdmin, first.id, context);
    expect(await testDb().courseInstructor.count()).toBe(1);

    const changed = base.replace("primary", "co_instructor");
    const second = await previewImport(
      alphaAdmin,
      { kind: "INSTRUCTORS", fileName: "instructors.csv", csvText: changed },
      context,
    );
    const commit = await commitImport(alphaAdmin, second.id, context);
    expect(commit.updated).toBe(1);

    const instructor = await testDb().courseInstructor.findFirstOrThrow({
      where: { courseOfferingId: structure.offering.id },
    });
    expect(instructor.assignmentRole).toBe("CO_INSTRUCTOR");
    expect(await testDb().courseInstructor.count()).toBe(1);
  });

  it("keeps import jobs tenant-scoped and permission-gated", async () => {
    const preview = await previewImport(
      alphaAdmin,
      {
        kind: "USERS",
        fileName: "people.csv",
        csvText: "email,name,role\nsomeone@alpha.example,Some One,student\n",
      },
      context,
    );

    await expect(getImportJob(betaAdmin, preview.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(await listImportJobs(betaAdmin)).toEqual([]);

    const student = await accountFor(alpha.student.userId, alpha.tenantId);
    await expect(
      previewImport(
        student,
        { kind: "USERS", fileName: "people.csv", csvText: "email,name,role\n" },
        context,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(commitImport(student, preview.id, context)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );

    // The same preview is visible to its own tenant only.
    const job = await getImportJob(alphaAdmin, preview.id);
    expect(job.rows).toHaveLength(1);
  });
});
