import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { PermissionDeniedError } from "@/lib/errors";
import { releaseGrade, saveGrade } from "@/modules/assignments/grading-service";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import { createAcademicYear, createTerm } from "@/modules/academics/structure-service";
import {
  excuseAssessment,
  getCourseGradebook,
  getLearnerGradebook,
  gradebookToCsv,
  getReleasePreview,
  releaseOfferingMarks,
  removeExcusal,
  saveGradingScheme,
} from "@/modules/gradebook/gradebook-service";

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
    "Skipping gradebook tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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

let north: TenantFixture;
let faculty: AccountContext;
let student: AccountContext;
let offeringId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });

  const admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);

  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    { requestId: "req-gradebook" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-gradebook" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-gradebook" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "DRAFT" },
    { requestId: "req-gradebook" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-gradebook" },
  );

  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-gradebook" },
  );
});

/** An active learner in this tenant, enrolled on the shared offering. */
async function enrolExtraLearner(name: string, local: string) {
  const db = testDb();
  const user = await db.user.create({
    data: { email: `${local}@${north.slug}.example`, name, status: "ACTIVE", emailVerified: true },
  });
  await db.tenantMembership.create({
    data: { tenantId: north.tenantId, userId: user.id, status: "ACTIVE", joinedAt: new Date() },
  });
  await enrolStudent(
    await accountFor(north.admin.userId, north.tenantId),
    { courseOfferingId: offeringId, email: user.email },
    { requestId: "req-gradebook" },
  );
  return user.id;
}

afterAll(async () => {
  await disconnectTestDb();
});

/** A published assignment with one submission and one grade. */
async function seedAssignment(params: {
  title: string;
  pointsPossible: number;
  score: number | null;
  released: boolean;
}) {
  const db = testDb();
  const assignment = await db.assignment.create({
    data: {
      tenantId: north.tenantId,
      offeringId,
      title: params.title,
      pointsPossible: params.pointsPossible,
      status: "PUBLISHED",
    },
  });

  if (params.score === null) return assignment;

  const submission = await db.assignmentSubmission.create({
    data: {
      tenantId: north.tenantId,
      assignmentId: assignment.id,
      userId: north.student.userId,
      status: "SUBMITTED",
      submittedAt: new Date(),
    },
  });

  await db.grade.create({
    data: {
      tenantId: north.tenantId,
      assignmentId: assignment.id,
      submissionId: submission.id,
      learnerUserId: north.student.userId,
      rawScore: params.score,
      pointsPossible: params.pointsPossible,
      gradeStatus: params.released ? "RELEASED" : "DRAFT",
      releasedAt: params.released ? new Date() : null,
    },
  });

  return assignment;
}

/** A published quiz worth `pointsPossible`, with one finished attempt. */
async function seedQuiz(params: {
  title: string;
  pointsPossible: number;
  score: number | null;
  releasedAt: Date | null;
}) {
  const db = testDb();
  const bank = await db.questionBank.create({
    data: { tenantId: north.tenantId, offeringId, title: `${params.title} bank` },
  });
  const question = await db.question.create({
    data: {
      tenantId: north.tenantId,
      bankId: bank.id,
      type: "ESSAY",
      title: `${params.title} question`,
      promptJson: { stem: "Explain recursion." },
      answerKeyJson: {},
      points: params.pointsPossible,
      status: "PUBLISHED",
      currentVersion: 1,
    },
  });

  const quiz = await db.quiz.create({
    data: {
      tenantId: north.tenantId,
      offeringId,
      title: params.title,
      status: "PUBLISHED",
      releasedAt: params.releasedAt,
      settings: { releasePolicy: params.releasedAt ? "manual" : "manual" },
    },
  });

  await db.quizQuestionRef.create({
    data: {
      tenantId: north.tenantId,
      quizId: quiz.id,
      questionId: question.id,
      position: 1,
    },
  });

  if (params.score !== null) {
    await db.quizAttempt.create({
      data: {
        tenantId: north.tenantId,
        quizId: quiz.id,
        userId: north.student.userId,
        attemptNumber: 1,
        status: "GRADED",
        startedAt: new Date(),
        submittedAt: new Date(),
        score: params.score,
        pointsPossible: params.pointsPossible,
      },
    });
  }

  return quiz;
}

describeDb("gradebook (PostgreSQL)", () => {
  it("reconciles marks with the stored assignment grades and quiz attempts", async () => {
    // 8/10 released, a draft grade, and a missing assessment.
    await seedAssignment({ title: "Worksheet 1", pointsPossible: 10, score: 8, released: true });
    await seedAssignment({ title: "Worksheet 2", pointsPossible: 10, score: 6, released: false });
    await seedAssignment({
      title: "Worksheet 3",
      pointsPossible: 10,
      score: null,
      released: false,
    });
    await seedQuiz({
      title: "Week 1 quiz",
      pointsPossible: 20,
      score: 10,
      releasedAt: new Date(),
    });

    const gradebook = await getCourseGradebook(faculty, offeringId);
    expect(gradebook.columns.map((column) => column.title)).toEqual([
      "Worksheet 1",
      "Worksheet 2",
      "Worksheet 3",
      "Week 1 quiz",
    ]);

    const row = gradebook.learners[0]!;
    // Only the released assignment (8/10) and the released quiz (10/20) count:
    // 18 of 30 counted points = 60%.
    expect(row.cells[gradebook.columns[0]!.id]).toEqual({ state: "scored", score: 8 });
    expect(row.result.earned).toBe(18);
    expect(row.result.possible).toBe(30);
    expect(row.result.percentage).toBe(60);
    expect(row.result.letter).toBe("D");

    // The draft grade is reported as ungraded, not as zero.
    const draftColumn = gradebook.columns[1]!;
    expect(row.cells[draftColumn.id]).toEqual({ state: "ungraded" });

    // Nothing submitted is reported as missing, not as zero.
    const missingColumn = gradebook.columns[2]!;
    expect(row.cells[missingColumn.id]).toEqual({ state: "missing" });
    expect(row.result.counts).toMatchObject({ missing: 1, ungraded: 1, scored: 2 });
    expect(row.result.complete).toBe(false);
    expect(row.result.outcome).toBe("incomplete");
    expect(gradebook.incompleteCount).toBe(1);
  });

  it("treats a released mark as visible and hides the rest from the learner", async () => {
    await seedAssignment({ title: "Worksheet 1", pointsPossible: 10, score: 9, released: true });
    await seedAssignment({ title: "Worksheet 2", pointsPossible: 10, score: 4, released: false });
    await seedQuiz({
      title: "Week 1 quiz",
      pointsPossible: 10,
      score: 5,
      releasedAt: null,
    });

    const { gradebook, own } = await getLearnerGradebook(student, offeringId);

    // Only the released assignment is visible.
    expect(gradebook.columns).toHaveLength(1);
    expect(gradebook.columns[0]!.title).toBe("Worksheet 1");
    expect(own.result.percentage).toBe(90);
    expect(own.result.earned).toBe(9);
    expect(own.result.possible).toBe(10);
    expect(own.cells[gradebook.columns[0]!.id]).toEqual({ state: "scored", score: 9 });

    // A higher score in a hidden column never leaks into the visible result.
    expect(own.result.outcome).toBe("no_result");
  });

  it("refuses a colleague who does not teach the offering", async () => {
    const outsider = await testDb().user.create({
      data: {
        email: `outsider@${north.slug}.example`,
        name: "Outsider",
        status: "ACTIVE",
        emailVerified: true,
      },
    });
    await testDb().tenantMembership.create({
      data: {
        tenantId: north.tenantId,
        userId: outsider.id,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
    const facultyRole = await testDb().role.findFirstOrThrow({
      where: { tenantId: north.tenantId, key: "faculty" },
    });
    await testDb().userRoleAssignment.create({
      data: {
        tenantId: north.tenantId,
        userId: outsider.id,
        roleId: facultyRole.id,
        scopeType: "TENANT",
      },
    });
    const outsiderAccount = await accountFor(outsider.id, north.tenantId);

    await expect(getCourseGradebook(outsiderAccount, offeringId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("exports CSV with clear headers and keeps missing distinct from zero", async () => {
    await seedAssignment({ title: "Worksheet 1", pointsPossible: 10, score: 0, released: true });
    await seedAssignment({ title: "Worksheet 2", pointsPossible: 10, score: null, released: true });

    const gradebook = await getCourseGradebook(faculty, offeringId);
    const csv = gradebookToCsv(gradebook);
    const [header, row] = csv.split("\r\n");

    expect(header).toContain("Learner");
    expect(header).toContain("Worksheet 1 (assignment, /10)");
    expect(header).toContain("Worksheet 2 (assignment, /10)");
    expect(header).toContain("Percentage");

    // A zero mark and a missing submission must not read the same.
    expect(row).toContain(",0,");
    expect(row).toContain(",Missing,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describeDb("gradebook configuration (PostgreSQL)", () => {
  it("applies a persisted weighted scheme, pass mark, and rounding", async () => {
    const exam = await seedAssignment({
      title: "Exam",
      pointsPossible: 100,
      score: 80,
      released: true,
    });
    const coursework = await seedAssignment({
      title: "Coursework",
      pointsPossible: 50,
      score: 30,
      released: true,
    });

    await saveGradingScheme(faculty, offeringId, {
      mode: "weighted",
      passMark: 60,
      rounding: 0,
      treatMissingAsZero: false,
      weights: [
        { kind: "assignment", refId: exam.id, weight: 30 },
        { kind: "assignment", refId: coursework.id, weight: 70 },
      ],
    });

    const gradebook = await getCourseGradebook(faculty, offeringId);
    const row = gradebook.learners[0]!;

    // 30% at 80 + 70% at 60 = 66, rounded to a whole number.
    expect(gradebook.scheme).toMatchObject({ mode: "weighted", passMark: 60, rounding: 0 });
    expect(gradebook.schemeVersion).toBe(1);
    expect(row.result.percentage).toBe(66);
    expect(row.result.letter).toBe("D");
    expect(row.result.outcome).toBe("passed");
    expect(gradebook.columns.map((column) => column.weight)).toEqual([30, 70]);
  });

  it("recalculates after a scheme change without rewriting marks", async () => {
    await seedAssignment({ title: "Worksheet", pointsPossible: 10, score: 8, released: true });

    const first = await getCourseGradebook(faculty, offeringId);
    expect(first.learners[0]!.result.outcome).toBe("no_result");
    expect(first.learners[0]!.result.percentage).toBe(80);

    await saveGradingScheme(faculty, offeringId, {
      mode: "points",
      passMark: 85,
      rounding: 2,
      treatMissingAsZero: false,
    });

    const second = await getCourseGradebook(faculty, offeringId);
    expect(second.schemeVersion).toBe(1);
    expect(second.learners[0]!.result.percentage).toBe(80);
    expect(second.learners[0]!.result.outcome).toBe("failed");

    await saveGradingScheme(faculty, offeringId, {
      mode: "points",
      passMark: 70,
      rounding: 2,
      treatMissingAsZero: false,
    });

    const third = await getCourseGradebook(faculty, offeringId);
    expect(third.schemeVersion).toBe(2);
    expect(third.learners[0]!.result.outcome).toBe("passed");

    // The stored mark is untouched by configuration changes.
    const stored = await testDb().grade.findFirstOrThrow({ where: { tenantId: north.tenantId } });
    expect(Number(stored.rawScore)).toBe(8);
  });

  it("removes an excused assessment from both sides of the total", async () => {
    const released = await seedAssignment({
      title: "Worksheet 1",
      pointsPossible: 10,
      score: 5,
      released: true,
    });
    const excusedTarget = await seedAssignment({
      title: "Worksheet 2",
      pointsPossible: 90,
      score: 0,
      released: true,
    });

    const before = await getCourseGradebook(faculty, offeringId);
    expect(before.learners[0]!.result.percentage).toBe(5);
    expect(before.learners[0]!.result.possible).toBe(100);

    const excusal = await excuseAssessment(faculty, offeringId, {
      userId: north.student.userId,
      kind: "assignment",
      refId: excusedTarget.id,
      reason: "Medical leave",
    });

    const after = await getCourseGradebook(faculty, offeringId);
    const row = after.learners[0]!;
    expect(row.cells[`assignment:${excusedTarget.id}`]).toEqual({ state: "excused" });
    expect(row.cells[`assignment:${released.id}`]).toEqual({ state: "scored", score: 5 });
    expect(row.result.possible).toBe(10);
    expect(row.result.percentage).toBe(50);
    expect(row.result.counts.excused).toBe(1);
    expect(after.excusals).toHaveLength(1);

    // The audit trail records the actor and reason.
    const audit = await testDb().auditEvent.findFirstOrThrow({
      where: { action: "assessment_excused" },
    });
    expect(audit.reason).toBe("Medical leave");

    await removeExcusal(faculty, offeringId, excusal.id);
    const restored = await getCourseGradebook(faculty, offeringId);
    expect(restored.learners[0]!.result.possible).toBe(100);
    expect(restored.excusals).toHaveLength(0);
  });

  it("refuses a scheme change or excusal from a colleague", async () => {
    const outsider = await testDb().user.create({
      data: {
        email: `outsider2@${north.slug}.example`,
        name: "Outsider Two",
        status: "ACTIVE",
        emailVerified: true,
      },
    });
    await testDb().tenantMembership.create({
      data: {
        tenantId: north.tenantId,
        userId: outsider.id,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
    const facultyRole = await testDb().role.findFirstOrThrow({
      where: { tenantId: north.tenantId, key: "faculty" },
    });
    await testDb().userRoleAssignment.create({
      data: {
        tenantId: north.tenantId,
        userId: outsider.id,
        roleId: facultyRole.id,
        scopeType: "TENANT",
      },
    });
    const outsiderAccount = await accountFor(outsider.id, north.tenantId);

    await expect(
      saveGradingScheme(outsiderAccount, offeringId, {
        mode: "points",
        passMark: 50,
        rounding: 2,
        treatMissingAsZero: false,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      excuseAssessment(outsiderAccount, offeringId, {
        userId: north.student.userId,
        kind: "assignment",
        refId: "whatever",
        reason: "Not my course",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describeDb("gradebook reporting (PostgreSQL)", () => {
  it("pages the cohort server-side and reports the full total", async () => {
    await enrolExtraLearner("Aaron Adams", "aaron");
    await enrolExtraLearner("Bella Brooks", "bella");
    await enrolExtraLearner("Cara Chen", "cara");

    const first = await getCourseGradebook(faculty, offeringId, { page: 1, pageSize: 2 });
    expect(first.learners).toHaveLength(2);
    expect(first.paging).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    expect(first.learners.map((learner) => learner.name)).toEqual(["Aaron Adams", "Bella Brooks"]);
    // Pickers still see the whole cohort, not just this page.
    expect(first.learnerOptions).toHaveLength(4);

    const second = await getCourseGradebook(faculty, offeringId, { page: 2, pageSize: 2 });
    expect(second.learners.map((learner) => learner.name)).toEqual(["Cara Chen", "student north"]);
    expect(second.paging.page).toBe(2);
  });

  it("filters learners by name or email before paging", async () => {
    await enrolExtraLearner("Bella Brooks", "bella");

    const byName = await getCourseGradebook(faculty, offeringId, { search: "bella" });
    expect(byName.learners.map((learner) => learner.name)).toEqual(["Bella Brooks"]);
    expect(byName.paging.total).toBe(1);

    const byEmail = await getCourseGradebook(faculty, offeringId, { search: "student@" });
    expect(byEmail.learners.map((learner) => learner.name)).toEqual(["student north"]);

    const none = await getCourseGradebook(faculty, offeringId, { search: "nobody" });
    expect(none.learners).toHaveLength(0);
    expect(none.paging.total).toBe(0);
  });

  it("reports a changed grade as soon as it is saved", async () => {
    const assignment = await seedAssignment({
      title: "Essay",
      pointsPossible: 10,
      score: null,
      released: false,
    });
    const submission = await testDb().assignmentSubmission.create({
      data: {
        tenantId: north.tenantId,
        assignmentId: assignment.id,
        userId: north.student.userId,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    const first = await saveGrade(
      faculty,
      { submissionId: submission.id, rawScore: 4 },
      { requestId: "req-gradebook" },
    );
    await releaseGrade(faculty, first.gradeId, { requestId: "req-gradebook" });

    const before = await getCourseGradebook(faculty, offeringId);
    expect(before.learners[0]!.result.percentage).toBe(40);

    const second = await saveGrade(
      faculty,
      { submissionId: submission.id, rawScore: 8, reason: "Second marker reviewed the essay" },
      { requestId: "req-gradebook" },
    );

    // A changed mark goes back to draft, so it counts again only once re-released.
    const changed = await getCourseGradebook(faculty, offeringId);
    expect(changed.learners[0]!.result.percentage).toBeNull();

    await releaseGrade(faculty, second.gradeId, { requestId: "req-gradebook" });

    const after = await getCourseGradebook(faculty, offeringId);
    expect(after.learners[0]!.result.percentage).toBe(80);
    // A regrade replaces the mark rather than adding a competing column.
    expect(after.columns).toHaveLength(1);
    expect(await testDb().grade.count({ where: { assignmentId: assignment.id } })).toBe(1);
  });

  it("keeps the export covering the whole cohort", async () => {
    await enrolExtraLearner("Aaron Adams", "aaron");
    await enrolExtraLearner("Bella Brooks", "bella");

    const paged = await getCourseGradebook(faculty, offeringId, { pageSize: 1 });
    expect(paged.learners).toHaveLength(1);

    const exported = await getCourseGradebook(faculty, offeringId, { paginate: false });
    expect(exported.learners).toHaveLength(3);
    const csv = gradebookToCsv(exported);
    for (const name of ["Aaron Adams", "Bella Brooks", "student north"]) {
      expect(csv).toContain(name);
    }
  });
});

describeDb("gradebook offering release (PostgreSQL)", () => {
  /** A staff member in this tenant who does not teach the shared offering. */
  async function colleagueAccount(local: string): Promise<AccountContext> {
    const db = testDb();
    const user = await db.user.create({
      data: {
        email: `${local}@${north.slug}.example`,
        name: `Colleague ${local}`,
        status: "ACTIVE",
        emailVerified: true,
      },
    });
    await db.tenantMembership.create({
      data: { tenantId: north.tenantId, userId: user.id, status: "ACTIVE", joinedAt: new Date() },
    });
    const role = await db.role.findFirstOrThrow({
      where: { tenantId: north.tenantId, key: "faculty" },
    });
    await db.userRoleAssignment.create({
      data: {
        tenantId: north.tenantId,
        userId: user.id,
        roleId: role.id,
        scopeType: "TENANT",
      },
    });
    return accountFor(user.id, north.tenantId);
  }

  /** A published assignment with one submission that has no mark yet. */
  async function seedUnmarkedSubmission(title: string) {
    const assignment = await seedAssignment({
      title,
      pointsPossible: 20,
      score: null,
      released: false,
    });
    await testDb().assignmentSubmission.create({
      data: {
        tenantId: north.tenantId,
        assignmentId: assignment.id,
        userId: north.student.userId,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });
    return assignment;
  }

  it("previews the batch without publishing anything", async () => {
    await seedAssignment({ title: "Quiz 1", pointsPossible: 10, score: 5, released: false });
    await seedAssignment({ title: "Quiz 2", pointsPossible: 10, score: 7, released: true });
    await seedQuiz({ title: "Midterm quiz", pointsPossible: 5, score: 4, releasedAt: null });
    await seedUnmarkedSubmission("Essay");

    const preview = await getReleasePreview(faculty, offeringId);

    expect(preview.readyTotal).toBe(1);
    expect(preview.awaitingMarkTotal).toBe(1);
    expect(preview.releasedColumns).toBe(1);
    expect(preview.unreleasedColumns).toBe(3);

    const quiz = preview.columns.find((column) => column.kind === "quiz");
    expect(quiz?.batched).toBe(false);
    const unmarked = preview.columns.find((column) => column.title === "Essay");
    expect(unmarked?.ready).toBe(0);
    expect(unmarked?.awaitingMark).toBe(1);

    // A preview is read-only.
    expect(await testDb().grade.count({ where: { gradeStatus: "RELEASED" } })).toBe(1);
  });

  it("releases every scored draft mark and audits the batch once", async () => {
    await seedAssignment({ title: "Quiz 1", pointsPossible: 10, score: 5, released: false });
    await seedAssignment({ title: "Quiz 2", pointsPossible: 10, score: 7, released: false });
    await seedUnmarkedSubmission("Essay");

    const outcome = await releaseOfferingMarks(faculty, offeringId, { requestId: "req-release" });
    expect(outcome).toEqual({ released: 2, learners: 1 });

    const released = await testDb().grade.findMany({
      where: { gradeStatus: "RELEASED" },
      select: { rawScore: true, releasedAt: true },
    });
    expect(released).toHaveLength(2);
    expect(released.every((grade) => grade.releasedAt !== null)).toBe(true);

    expect(
      await testDb().gradeChangeEvent.count({
        where: { newStatus: "RELEASED", requestId: "req-release" },
      }),
    ).toBe(2);

    const audit = await testDb().auditEvent.findFirst({
      where: { action: "gradebook.offering_released" },
      select: { after: true, resourceId: true },
    });
    expect(audit?.resourceId).toBe(offeringId);
    expect(audit?.after).toMatchObject({ grades: 2, learners: 1, assessments: 2 });

    // The learner now sees a result; the unmarked essay stays outstanding and the
    // second release has nothing left to publish.
    const own = await getLearnerGradebook(student, offeringId);
    expect(own.own.result.percentage).toBe(60);
    expect(await releaseOfferingMarks(faculty, offeringId, { requestId: "req-release" })).toEqual({
      released: 0,
      learners: 0,
    });
  });

  it("refuses a learner and a colleague who does not teach the offering", async () => {
    await seedAssignment({ title: "Quiz 1", pointsPossible: 10, score: 5, released: false });

    await expect(
      releaseOfferingMarks(student, offeringId, { requestId: "req-release" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const colleague = await colleagueAccount("colleague");
    await expect(getReleasePreview(colleague, offeringId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      releaseOfferingMarks(colleague, offeringId, { requestId: "req-release" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await testDb().grade.count({ where: { gradeStatus: "RELEASED" } })).toBe(0);
  });
});
