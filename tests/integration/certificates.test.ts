import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError, ResourceNotFoundError } from "@/lib/errors";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import {
  createAcademicYear,
  createCohort,
  createDepartment,
  createProgramme,
  createSection,
  createTerm,
} from "@/modules/academics/structure-service";
import {
  getOfferingCertificatesWorkspace,
  getOfferingCompletionRules,
  issueCertificate,
  listLearnerCertificates,
  listLearnerCompletion,
  reissueCertificate,
  revokeCertificate,
  saveCompletionRules,
  verifyCertificate,
} from "@/modules/certificates/certificate-service";
import { getCourseView } from "@/modules/content/delivery-service";

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
    "Skipping certificate tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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

const ruleInput = (overrides: Record<string, string> = {}) => ({
  requireAllContent: "on",
  requireAssignments: "",
  requireQuizzes: "",
  minContentPercent: "",
  minGradePercent: "",
  ...overrides,
});

let north: TenantFixture;
let south: TenantFixture;
let admin: AccountContext;
let faculty: AccountContext;
let student: AccountContext;
let classmate: AccountContext;
let outsider: AccountContext;
let offeringId: string;
let itemOneId: string;
let itemTwoId: string;

async function addClassmate(tenantId: string, slug: string): Promise<string> {
  const db = testDb();
  const user = await db.user.create({
    data: {
      email: `classmate@${slug}.example`,
      name: "Classmate Student",
      status: "ACTIVE",
      emailVerified: true,
    },
  });
  await db.tenantMembership.create({
    data: { tenantId, userId: user.id, status: "ACTIVE", joinedAt: new Date() },
  });
  const role = await db.role.findFirstOrThrow({ where: { tenantId, key: "student" } });
  await db.userRoleAssignment.create({
    data: { tenantId, userId: user.id, roleId: role.id, scopeType: "TENANT" },
  });
  return user.id;
}

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
    { requestId: "req-cert" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-cert" },
  );
  const department = await createDepartment(
    admin,
    { name: "Computer Science", code: "CS" },
    { requestId: "req-cert" },
  );
  const programme = await createProgramme(
    admin,
    {
      departmentId: department.id,
      name: "BSc Computer Science",
      code: "BSCS",
      level: "BACHELOR",
    },
    { requestId: "req-cert" },
  );
  const cohort = await createCohort(
    admin,
    { programmeId: programme.id, academicYearId: year.id, name: "2026 CS intake" },
    { requestId: "req-cert" },
  );
  const section = await createSection(
    admin,
    { cohortId: cohort.id, name: "A", capacity: 40 },
    { requestId: "req-cert" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 4 },
    { requestId: "req-cert" },
  );
  offeringId = (
    await createOffering(
      admin,
      { courseId: course.id, termId: term.id, sectionId: section.id, status: "PUBLISHED" },
      { requestId: "req-cert" },
    )
  ).id;
  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-cert" },
  );
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-cert" },
  );
  const classmateId = await addClassmate(north.tenantId, north.slug);
  classmate = await accountFor(classmateId, north.tenantId);
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `classmate@${north.slug}.example` },
    { requestId: "req-cert" },
  );

  const db = testDb();
  const weekOne = await db.courseModule.create({
    data: {
      tenantId: north.tenantId,
      courseOfferingId: offeringId,
      title: "Week 1",
      position: 1,
      status: "PUBLISHED",
    },
  });
  const first = await db.contentItem.create({
    data: {
      tenantId: north.tenantId,
      moduleId: weekOne.id,
      title: "Variables",
      kind: "RICH_TEXT",
      body: "<p>Variables hold values.</p>",
      position: 1,
      status: "PUBLISHED",
    },
  });
  const second = await db.contentItem.create({
    data: {
      tenantId: north.tenantId,
      moduleId: weekOne.id,
      title: "Control flow",
      kind: "RICH_TEXT",
      body: "<p>Branches and loops.</p>",
      position: 2,
      status: "PUBLISHED",
    },
  });
  itemOneId = first.id;
  itemTwoId = second.id;

  await db.assignment.create({
    data: {
      tenantId: north.tenantId,
      offeringId,
      title: "Week 1 exercises",
      pointsPossible: 10,
      submissionTypes: "TEXT",
      status: "PUBLISHED",
    },
  });
  await db.quiz.create({
    data: {
      tenantId: north.tenantId,
      offeringId,
      title: "Week 1 quiz",
      status: "PUBLISHED",
    },
  });
});

afterAll(async () => {
  await disconnectTestDb();
});

async function completeItem(itemId: string, userId: string) {
  await testDb().contentProgress.create({
    data: {
      tenantId: north.tenantId,
      contentItemId: itemId,
      userId,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
}

describeDb("completion rules and certificates (PostgreSQL)", () => {
  it("stores completion rules per offering, scoped to the teaching team", async () => {
    const saved = await saveCompletionRules(
      admin,
      offeringId,
      ruleInput({ minContentPercent: "50" }),
      { requestId: "req-cert" },
    );
    expect(saved).toMatchObject({
      requireAllPublishedContent: true,
      minContentPercent: 50,
      requirePublishedAssignments: false,
    });

    const read = await getOfferingCompletionRules(faculty, offeringId);
    expect(read.rules.minContentPercent).toBe(50);
    expect(read.summary[0]).toContain("every published lesson");

    const audit = await testDb().auditEvent.findFirst({
      where: { tenantId: north.tenantId, action: "certificate.rules_updated" },
    });
    expect(audit?.resourceId).toBe(offeringId);

    await expect(
      saveCompletionRules(outsider, offeringId, ruleInput(), { requestId: "req-cert" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      saveCompletionRules(student, offeringId, ruleInput(), { requestId: "req-cert" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("reports gaps and refuses issuance until every rule is met, then issues once", async () => {
    await saveCompletionRules(admin, offeringId, ruleInput(), { requestId: "req-cert" });

    await expect(issueCertificate(admin, offeringId, north.student.userId)).rejects.toBeInstanceOf(
      ConflictError,
    );

    await completeItem(itemOneId, north.student.userId);
    const workspace = await getOfferingCertificatesWorkspace(faculty, offeringId);
    const row = workspace.rows.find((entry) => entry.learnerUserId === north.student.userId);
    expect(row?.evaluation.eligible).toBe(false);
    expect(row?.evaluation.gaps.map((gap) => gap.code)).toEqual(["content_incomplete"]);
    expect(row?.facts.completedContentItems).toBe(1);
    expect(row?.facts.publishedContentItems).toBe(2);

    await completeItem(itemTwoId, north.student.userId);
    const first = await issueCertificate(admin, offeringId, north.student.userId, {
      requestId: "req-cert",
    });
    expect(first.created).toBe(true);
    expect(first.certificate.status).toBe("ISSUED");
    expect(first.certificate.certificateNumber).toMatch(/^CERT-\d{4}-[0-9A-F]{10}$/);
    expect(first.certificate.verificationToken.length).toBeGreaterThan(20);
    expect(first.certificate.completionSummary).toContain("all published lessons");

    const second = await issueCertificate(faculty, offeringId, north.student.userId);
    expect(second.created).toBe(false);
    expect(second.certificate.id).toBe(first.certificate.id);

    expect(
      await testDb().certificate.count({
        where: { tenantId: north.tenantId, userId: north.student.userId },
      }),
    ).toBe(1);
  });

  it("reissues with a new token, keeps revocation visible, and refuses a quiet second issuance", async () => {
    await saveCompletionRules(admin, offeringId, ruleInput({ minContentPercent: "100" }));
    await completeItem(itemOneId, north.student.userId);
    await completeItem(itemTwoId, north.student.userId);

    const issued = await issueCertificate(admin, offeringId, north.student.userId);
    const replaced = await reissueCertificate(
      admin,
      issued.certificate.id,
      { learnerName: "Nadia North (corrected)", reason: "Name spelled incorrectly" },
      { requestId: "req-cert" },
    );
    expect(replaced.id).not.toBe(issued.certificate.id);
    expect(replaced.verificationToken).not.toBe(issued.certificate.verificationToken);
    expect(replaced.reissuedFromId).toBe(issued.certificate.id);
    expect(replaced.learnerName).toBe("Nadia North (corrected)");

    const oldRow = await testDb().certificate.findUniqueOrThrow({
      where: { id: issued.certificate.id },
    });
    expect(oldRow.status).toBe("REISSUED");
    const oldVerification = await verifyCertificate(issued.certificate.verificationToken);
    expect(oldVerification?.status).toBe("REISSUED");

    const revoked = await revokeCertificate(
      admin,
      replaced.id,
      { reason: "Issued in error" },
      { requestId: "req-cert" },
    );
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedAt).not.toBeNull();

    const verification = await verifyCertificate(replaced.verificationToken);
    expect(verification?.status).toBe("REVOKED");
    expect(verification?.revokedAt).not.toBeNull();

    await expect(issueCertificate(admin, offeringId, north.student.userId)).rejects.toBeInstanceOf(
      ConflictError,
    );

    const corrected = await reissueCertificate(
      admin,
      replaced.id,
      { reason: "Corrected after revocation review" },
      { requestId: "req-cert" },
    );
    expect(corrected.status).toBe("ISSUED");
    const stillRevoked = await testDb().certificate.findUniqueOrThrow({
      where: { id: replaced.id },
    });
    expect(stillRevoked.status).toBe("REVOKED");
    expect(stillRevoked.revocationReason).toBe("Issued in error");

    const audits = await testDb().auditEvent.findMany({
      where: { tenantId: north.tenantId, resourceType: "certificate" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((event) => event.action)).toEqual([
      "certificate.issued",
      "certificate.reissued",
      "certificate.revoked",
      "certificate.reissued",
    ]);
    expect(audits[2]?.reason).toBe("Issued in error");
  });

  it("verifies publicly with only the minimum fields and returns null for unknown tokens", async () => {
    await completeItem(itemOneId, north.student.userId);
    await completeItem(itemTwoId, north.student.userId);
    const issued = await issueCertificate(admin, offeringId, north.student.userId);

    expect(await verifyCertificate("not-a-real-token")).toBeNull();

    const verification = await verifyCertificate(issued.certificate.verificationToken);
    expect(verification).toEqual({
      certificateNumber: issued.certificate.certificateNumber,
      learnerName: "student north",
      courseCode: "CS101",
      courseTitle: "Introduction to Programming",
      institutionName: "North University",
      issuerName: "North University",
      issuedAt: issued.certificate.issuedAt,
      status: "ISSUED",
      revokedAt: null,
    });
    expect(Object.keys(verification ?? {})).not.toContain("email");
    expect(Object.keys(verification ?? {})).not.toContain("userId");
  });

  it("shows a learner only their own award and keeps staff views inside the tenant", async () => {
    await completeItem(itemOneId, north.student.userId);
    await completeItem(itemTwoId, north.student.userId);
    await issueCertificate(admin, offeringId, north.student.userId);

    const mine = await listLearnerCertificates(student);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.verificationPath).toBe(`/verify/${mine[0]?.verificationToken}`);
    expect(await listLearnerCertificates(classmate)).toEqual([]);

    const cards = await listLearnerCompletion(classmate);
    expect(cards[0]?.certificate).toBeNull();
    expect(cards[0]?.evaluation.eligible).toBe(false);

    await expect(getOfferingCertificatesWorkspace(student, offeringId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(getOfferingCertificatesWorkspace(outsider, offeringId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );

    const staffView = await getOfferingCertificatesWorkspace(faculty, offeringId);
    expect(staffView.rows).toHaveLength(2);
    const studentRow = staffView.rows.find((row) => row.learnerUserId === north.student.userId);
    expect(studentRow?.certificate?.status).toBe("ISSUED");
  });

  it("does not gate course material on completion rules", async () => {
    await saveCompletionRules(
      admin,
      offeringId,
      ruleInput({ minContentPercent: "100", minGradePercent: "90" }),
    );

    const view = await getCourseView(student, offeringId);
    expect(view.mode).toBe("learner");
    expect(view.progress.total).toBeGreaterThanOrEqual(2);
    expect(view.modules[0]?.items).toHaveLength(2);
  });
});
