import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError, ResourceNotFoundError } from "@/lib/errors";
import { resetStorageCache } from "@/lib/storage";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import { createAcademicYear, createTerm } from "@/modules/academics/structure-service";
import { publishCourse } from "@/modules/content/content-service";
import {
  createAssignment,
  saveRubric,
  setAssignmentStatus,
  updateAssignment,
} from "@/modules/assignments/assignment-service";
import {
  getGradingWorkspace,
  releaseAllGrades,
  releaseGrade,
  saveGrade,
} from "@/modules/assignments/grading-service";
import {
  getLearnerAssignment,
  listLearnerAssignments,
  readSubmissionFile,
  saveSubmissionDraft,
  submitAssignment,
} from "@/modules/assignments/submission-service";

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
    "Skipping assignment tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);
const context = { requestId: "req-assignments" };

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

async function createExtraMember(
  fixture: TenantFixture,
  label: string,
  roleKey: "student" | "faculty" | "teaching_assistant",
): Promise<AccountContext> {
  const db = testDb();
  const email = `${label}@${fixture.slug}.example`;
  const user = await db.user.create({
    data: { email, name: `${label} member`, status: "ACTIVE", emailVerified: true },
  });
  await db.tenantMembership.create({
    data: { tenantId: fixture.tenantId, userId: user.id, status: "ACTIVE", joinedAt: new Date() },
  });
  const role = await db.role.findFirstOrThrow({
    where: { tenantId: fixture.tenantId, key: roleKey },
  });
  await db.userRoleAssignment.create({
    data: { tenantId: fixture.tenantId, userId: user.id, roleId: role.id, scopeType: "TENANT" },
  });
  return accountFor(user.id, fixture.tenantId);
}

let storageRoot: string;

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "lms-assignment-test-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_ROOT = storageRoot;
  resetStorageCache();
});

afterAll(async () => {
  delete process.env.STORAGE_DRIVER;
  delete process.env.STORAGE_LOCAL_ROOT;
  resetStorageCache();
  await rm(storageRoot, { recursive: true, force: true });
  await disconnectTestDb();
});

let north: TenantFixture;
let south: TenantFixture;
let admin: AccountContext;
let faculty: AccountContext;
let student: AccountContext;
let unenrolled: AccountContext;
let southStudent: AccountContext;
let offeringId: string;
let termId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });
  south = await createTenantFixture({ slug: "south", name: "South College", code: "SC" });

  admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);
  southStudent = await accountFor(south.student.userId, south.tenantId);
  unenrolled = await createExtraMember(north, "extra", "student");

  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    context,
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    context,
  );
  termId = term.id;

  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    context,
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId, status: "DRAFT" },
    context,
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    context,
  );
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    context,
  );

  // Learners reach an assignment only through a published offering.
  await publishCourse(faculty, offeringId, context);
});

async function createPublishedAssignment(
  overrides: Partial<{
    title: string;
    submissionType: "TEXT" | "FILE" | "LINK" | "TEXT_AND_FILE";
    pointsPossible: number;
    dueAt: string;
    allowLateSubmission: boolean;
    allowResubmission: boolean;
    maxAttempts: number;
  }> = {},
): Promise<string> {
  const created = await createAssignment(
    faculty,
    {
      offeringId,
      title: overrides.title ?? "FizzBuzz practice",
      instructions: "Print the numbers from 1 to 30, replacing multiples as described.",
      submissionType: overrides.submissionType ?? "TEXT",
      pointsPossible: overrides.pointsPossible ?? 10,
      dueAt: overrides.dueAt ?? "",
      allowLateSubmission: overrides.allowLateSubmission ?? true,
      allowResubmission: overrides.allowResubmission ?? false,
      maxAttempts: overrides.maxAttempts ?? 1,
    },
    context,
  );
  await setAssignmentStatus(faculty, { assignmentId: created.id, status: "PUBLISHED" }, context);
  return created.id;
}

describeDb("assignments, submissions, and grading (PostgreSQL)", () => {
  it("lets an assigned instructor author and publish, and hides drafts from learners", async () => {
    const created = await createAssignment(
      faculty,
      {
        offeringId,
        title: "Reading response",
        instructions: "Summarise the first chapter in 200 words.",
        submissionType: "TEXT",
        pointsPossible: 10,
        dueAt: "",
        allowLateSubmission: false,
        allowResubmission: false,
        maxAttempts: 1,
      },
      context,
    );

    await expect(getLearnerAssignment(student, created.id)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(await listLearnerAssignments(student)).toEqual([]);

    await setAssignmentStatus(faculty, { assignmentId: created.id, status: "PUBLISHED" }, context);

    const view = await getLearnerAssignment(student, created.id);
    expect(view.title).toBe("Reading response");
    expect(view.canSubmit).toBe(true);
    expect(view.mode).toBe("learner");

    // A colleague with the same role is refused, and another institution sees 404.
    const colleague = await createExtraMember(north, "colleague", "faculty");
    await expect(
      createAssignment(
        colleague,
        {
          offeringId,
          title: "Unauthorised",
          pointsPossible: 10,
          submissionType: "TEXT",
          allowLateSubmission: false,
          allowResubmission: false,
          maxAttempts: 1,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const southAdmin = await accountFor(south.admin.userId, south.tenantId);
    await expect(getLearnerAssignment(southAdmin, created.id)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );

    await expect(
      updateAssignment(
        faculty,
        {
          offeringId,
          assignmentId: created.id,
          title: "Reading response (revised)",
          instructions: "Summarise the first chapter in 200 words.",
          submissionType: "TEXT",
          pointsPossible: 15,
          dueAt: "",
          allowLateSubmission: false,
          allowResubmission: false,
          maxAttempts: 1,
        },
        context,
      ),
    ).resolves.toBeUndefined();
  });

  it("saves a draft, submits once, and treats a retry as the same receipt", async () => {
    const assignmentId = await createPublishedAssignment();

    await saveSubmissionDraft(student, { assignmentId, body: "My first answer" }, null, context);

    const view = await getLearnerAssignment(student, assignmentId);
    expect(view.submission?.status).toBe("DRAFT");
    expect(view.submission?.body).toBe("My first answer");
    expect(view.state).toBe("open");

    const receipt = await submitAssignment(
      student,
      { assignmentId, body: "My first answer" },
      null,
      context,
    );
    expect(receipt.created).toBe(true);
    expect(receipt.status).toBe("SUBMITTED");
    expect(receipt.attemptNumber).toBe(1);
    expect(receipt.late).toBe(false);

    // Pressing submit again with the same work must not create a second attempt.
    const retry = await submitAssignment(
      student,
      { assignmentId, body: "My first answer" },
      null,
      context,
    );
    expect(retry.created).toBe(false);
    expect(retry.attemptNumber).toBe(1);

    const rows = await testDb().assignmentSubmission.findMany({
      where: { assignmentId, userId: student.user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attemptNumber).toBe(1);
    expect(rows[0]?.status).toBe("SUBMITTED");

    // Different work after submission is refused when resubmission is off.
    await expect(
      submitAssignment(student, { assignmentId, body: "Changed answer" }, null, context),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("applies the late policy and the attempt limit", async () => {
    const pastDue = new Date(Date.now() - 86_400_000).toISOString();

    const closed = await createPublishedAssignment({
      title: "No late work",
      dueAt: pastDue,
      allowLateSubmission: false,
    });
    await expect(
      submitAssignment(student, { assignmentId: closed, body: "Late answer" }, null, context),
    ).rejects.toBeInstanceOf(ConflictError);

    const lateAllowed = await createPublishedAssignment({
      title: "Late accepted",
      dueAt: pastDue,
      allowLateSubmission: true,
    });
    const lateReceipt = await submitAssignment(
      student,
      { assignmentId: lateAllowed, body: "Late but accepted" },
      null,
      context,
    );
    expect(lateReceipt.status).toBe("LATE");
    expect(lateReceipt.late).toBe(true);

    const resubmittable = await createPublishedAssignment({
      title: "Two attempts",
      allowResubmission: true,
      maxAttempts: 2,
    });
    await submitAssignment(student, { assignmentId: resubmittable, body: "One" }, null, context);
    const second = await submitAssignment(
      student,
      { assignmentId: resubmittable, body: "Two" },
      null,
      context,
    );
    expect(second.attemptNumber).toBe(2);

    await expect(
      submitAssignment(student, { assignmentId: resubmittable, body: "Three" }, null, context),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps unreleased grades hidden and publishes them on release", async () => {
    const assignmentId = await createPublishedAssignment();
    const receipt = await submitAssignment(
      student,
      { assignmentId, body: "FizzBuzz written out" },
      null,
      context,
    );

    const saved = await saveGrade(
      faculty,
      {
        submissionId: receipt.submissionId,
        rawScore: 8,
        feedback: "Clear structure. Check the combined case.",
      },
      context,
    );
    expect(saved.status).toBe("DRAFT");

    let view = await getLearnerAssignment(student, assignmentId);
    expect(view.grade).toBeNull();
    expect(view.state).toBe("submitted");

    const queue = await getGradingWorkspace(faculty, assignmentId);
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0]?.grade?.status).toBe("DRAFT");

    const released = await releaseGrade(faculty, saved.gradeId, context);
    expect(released.released).toBe(true);

    view = await getLearnerAssignment(student, assignmentId);
    expect(view.state).toBe("graded");
    expect(view.grade?.rawScore).toBe(8);
    expect(view.grade?.percent).toBe(80);
    expect(view.grade?.feedback).toContain("Clear structure");

    const list = await listLearnerAssignments(student);
    expect(list[0]?.percent).toBe(80);

    // Releasing twice does not create another release.
    expect(await releaseGrade(faculty, saved.gradeId, context)).toEqual({ released: false });

    const events = await testDb().gradeChangeEvent.findMany({
      where: { gradeId: saved.gradeId },
      orderBy: { createdAt: "asc" },
      select: { newStatus: true },
    });
    expect(events.map((event) => event.newStatus)).toEqual(["DRAFT", "RELEASED"]);
  });

  it("requires grades.update and a reason to change a released grade", async () => {
    const assignmentId = await createPublishedAssignment();
    const receipt = await submitAssignment(
      student,
      { assignmentId, body: "Attempt one" },
      null,
      context,
    );
    const saved = await saveGrade(
      faculty,
      { submissionId: receipt.submissionId, rawScore: 6, feedback: "Passing." },
      context,
    );
    await releaseGrade(faculty, saved.gradeId, context);

    // Without a reason the override is refused.
    await expect(
      saveGrade(faculty, { submissionId: receipt.submissionId, rawScore: 9 }, context),
    ).rejects.toBeInstanceOf(ConflictError);

    // A teaching assistant may grade drafts but may not change a released grade.
    const assistant = await createExtraMember(north, "ta", "teaching_assistant");
    await addInstructor(
      admin,
      {
        courseOfferingId: offeringId,
        email: `ta@${north.slug}.example`,
        assignmentRole: "TEACHING_ASSISTANT",
      },
      context,
    );
    expect(assistant.permissions.has("grades.update")).toBe(false);
    await expect(
      saveGrade(
        assistant,
        {
          submissionId: receipt.submissionId,
          rawScore: 9,
          reason: "Second look at the rubric",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const override = await saveGrade(
      faculty,
      {
        submissionId: receipt.submissionId,
        rawScore: 9,
        feedback: "Raised after appeal.",
        reason: "Appeal upheld: the FizzBuzz case was handled correctly.",
      },
      context,
    );
    expect(override.status).toBe("DRAFT");

    // The changed grade goes back to draft until the teacher releases it again.
    const hidden = await getLearnerAssignment(student, assignmentId);
    expect(hidden.grade).toBeNull();

    await releaseGrade(faculty, override.gradeId, context);
    const shown = await getLearnerAssignment(student, assignmentId);
    expect(shown.grade?.rawScore).toBe(9);

    const audit = await testDb().auditEvent.findMany({
      where: { resourceId: override.gradeId },
      orderBy: { createdAt: "asc" },
      select: { action: true, reason: true },
    });
    expect(audit.map((event) => event.action)).toContain("grade.overridden");
    expect(audit.find((event) => event.action === "grade.overridden")?.reason).toContain("Appeal");
  });

  it("scores a rubric and refuses rubric changes once grades exist", async () => {
    const assignmentId = await createPublishedAssignment({ pointsPossible: 10 });
    await saveRubric(
      faculty,
      {
        assignmentId,
        criteria: [
          { title: "Correct loop", pointsPossible: 3, description: "1 to 30 exactly once." },
          {
            title: "Combined case",
            pointsPossible: 7,
            description: "FizzBuzz before Fizz or Buzz.",
          },
        ],
      },
      context,
    );

    const detail = await getGradingWorkspace(faculty, assignmentId);
    expect(detail.assignment.rubric).toHaveLength(2);
    const [loop, combined] = detail.assignment.rubric;

    const receipt = await submitAssignment(
      student,
      { assignmentId, body: "Program submitted" },
      null,
      context,
    );
    const saved = await saveGrade(
      faculty,
      {
        submissionId: receipt.submissionId,
        rawScore: 8,
        feedback: "Nearly perfect.",
        rubricScores: [
          { criterionId: loop!.id, score: 3, feedback: "Correct." },
          { criterionId: combined!.id, score: 5, feedback: "One branch missing." },
        ],
      },
      context,
    );
    await releaseGrade(faculty, saved.gradeId, context);

    const view = await getLearnerAssignment(student, assignmentId);
    expect(view.grade?.rubricScores).toHaveLength(2);
    expect(
      view.grade?.rubricScores.find((score) => score.criterionId === combined!.id)?.feedback,
    ).toBe("One branch missing.");

    await expect(
      saveRubric(
        faculty,
        { assignmentId, criteria: [{ title: "Replacement", pointsPossible: 10 }] },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("authorises submission files for the owner and staff only", async () => {
    const assignmentId = await createPublishedAssignment({
      title: "File submission",
      submissionType: "FILE",
    });

    await expect(
      submitAssignment(student, { assignmentId, body: "" }, null, context),
    ).rejects.toBeInstanceOf(ConflictError);

    await submitAssignment(
      student,
      { assignmentId, body: "" },
      { fileName: "answer.txt", contentType: "text/plain", data: Buffer.from("my answer") },
      context,
    );

    const file = await testDb().submissionFileLink.findFirstOrThrow({
      where: { submission: { assignmentId } },
    });

    const downloaded = await readSubmissionFile(student, file.id);
    expect(downloaded.data.toString()).toBe("my answer");
    expect(downloaded.fileName).toBe("answer.txt");

    await expect(readSubmissionFile(faculty, file.id)).resolves.toBeDefined();
    await expect(readSubmissionFile(unenrolled, file.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(readSubmissionFile(southStudent, file.id)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("releases every scored grade for an assignment", async () => {
    const assignmentId = await createPublishedAssignment();
    const peer = await createExtraMember(north, "peer", "student");
    await enrolStudent(
      admin,
      { courseOfferingId: offeringId, email: `peer@${north.slug}.example` },
      context,
    );

    const first = await submitAssignment(
      student,
      { assignmentId, body: "First learner" },
      null,
      context,
    );
    const second = await submitAssignment(
      peer,
      { assignmentId, body: "Second learner" },
      null,
      context,
    );

    await saveGrade(faculty, { submissionId: first.submissionId, rawScore: 5 }, context);
    await saveGrade(faculty, { submissionId: second.submissionId, rawScore: 7 }, context);

    const released = await releaseAllGrades(faculty, assignmentId, context);
    expect(released.released).toBe(2);

    expect((await getLearnerAssignment(student, assignmentId)).grade?.rawScore).toBe(5);
    expect((await getLearnerAssignment(peer, assignmentId)).grade?.rawScore).toBe(7);
  });
});
