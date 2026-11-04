import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError } from "@/lib/errors";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import { createAcademicYear, createTerm } from "@/modules/academics/structure-service";
import {
  attendanceReportToCsv,
  getAttendancePolicy,
  getAttendanceReport,
  lockSessionAttendance,
  reopenSessionAttendance,
  setAttendancePolicy,
} from "@/modules/attendance/attendance-service";
import {
  getAttendanceRoster,
  markAttendance,
  scheduleSession,
} from "@/modules/sessions/session-service";

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
    "Skipping attendance lock tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

const DAY = 86_400_000;

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
let admin: AccountContext;
let faculty: AccountContext;
let student: AccountContext;
let secondStudent: AccountContext;
let offeringId: string;

/** A session that ended `daysAgo` days ago (one hour long). */
async function pastSession(title: string, daysAgo: number) {
  const startsAt = new Date(Date.now() - daysAgo * DAY);
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  return scheduleSession(
    faculty,
    offeringId,
    { title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    { requestId: "req-attendance" },
  );
}

async function memberAccount(local: string, roleKey: string): Promise<AccountContext> {
  const db = testDb();
  const user = await db.user.create({
    data: {
      email: `${local}@${north.slug}.example`,
      name: `Member ${local}`,
      status: "ACTIVE",
      emailVerified: true,
    },
  });
  await db.tenantMembership.create({
    data: { tenantId: north.tenantId, userId: user.id, status: "ACTIVE", joinedAt: new Date() },
  });
  const role = await db.role.findFirstOrThrow({
    where: { tenantId: north.tenantId, key: roleKey },
  });
  await db.userRoleAssignment.create({
    data: { tenantId: north.tenantId, userId: user.id, roleId: role.id, scopeType: "TENANT" },
  });
  return accountFor(user.id, north.tenantId);
}

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });
  admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);
  secondStudent = await memberAccount("student2", "student");

  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    { requestId: "req-attendance" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-attendance" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-attendance" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "PUBLISHED" },
    { requestId: "req-attendance" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-attendance" },
  );
  for (const email of [`student@${north.slug}.example`, `student2@${north.slug}.example`]) {
    await enrolStudent(
      admin,
      { courseOfferingId: offeringId, email },
      { requestId: "req-attendance" },
    );
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

describeDb("attendance lock and reports (PostgreSQL)", () => {
  it("locks attendance once the policy window has passed", async () => {
    const { id } = await pastSession("Week 1", 10);

    const roster = await getAttendanceRoster(faculty, id);
    expect(roster.session.lock).toMatchObject({ locked: true, reason: "policy" });
    expect(roster.session.lock?.lockAt).toBeInstanceOf(Date);

    await expect(
      markAttendance(
        faculty,
        id,
        { records: [{ userId: north.student.userId, status: "present" }] },
        { requestId: "req-attendance" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps a recent session editable and locks it when the policy tightens", async () => {
    const { id } = await pastSession("Week 2", 2);

    const tally = await markAttendance(
      faculty,
      id,
      { records: [{ userId: north.student.userId, status: "present" }] },
      { requestId: "req-attendance" },
    );
    expect(tally.present).toBe(1);

    await setAttendancePolicy(
      faculty,
      offeringId,
      { lockAfterHours: 0 },
      { requestId: "req-attendance" },
    );
    expect(await getAttendancePolicy(faculty, offeringId)).toEqual({ lockAfterHours: 0 });

    await expect(
      markAttendance(
        faculty,
        id,
        { records: [{ userId: north.student.userId, status: "late" }] },
        { requestId: "req-attendance" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps other offering settings when the policy is saved", async () => {
    await testDb().courseOffering.update({
      where: { id: offeringId },
      data: { settings: { grading: { scheme: "weighted" } } },
    });

    await setAttendancePolicy(
      admin,
      offeringId,
      { lockAfterHours: 48 },
      { requestId: "req-attendance" },
    );

    const offering = await testDb().courseOffering.findUniqueOrThrow({
      where: { id: offeringId },
      select: { settings: true },
    });
    expect(offering.settings).toEqual({
      grading: { scheme: "weighted" },
      attendance: { lockAfterHours: 48 },
    });

    const events = await testDb().auditEvent.findMany({
      where: { action: "attendance.policy_updated" },
      select: { after: true },
    });
    expect(events).toHaveLength(1);
  });

  it("lets staff lock a session and only an administrator reopen it", async () => {
    const { id } = await pastSession("Week 3", 1);

    const locked = await lockSessionAttendance(faculty, id, { requestId: "req-attendance" });
    expect(locked).toMatchObject({ locked: true, reason: "manual" });

    await expect(
      markAttendance(
        faculty,
        id,
        { records: [{ userId: north.student.userId, status: "present" }] },
        { requestId: "req-attendance" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      reopenSessionAttendance(faculty, id, { requestId: "req-attendance" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const reopened = await reopenSessionAttendance(admin, id, { requestId: "req-attendance" });
    expect(reopened.locked).toBe(false);

    const tally = await markAttendance(
      faculty,
      id,
      { records: [{ userId: north.student.userId, status: "late" }] },
      { requestId: "req-attendance" },
    );
    expect(tally.late).toBe(1);

    await expect(
      reopenSessionAttendance(admin, id, { requestId: "req-attendance" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const actions = await testDb().auditEvent.findMany({
      where: { action: { in: ["attendance.locked", "attendance.reopened"] } },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((event) => event.action)).toEqual([
      "attendance.locked",
      "attendance.reopened",
    ]);
  });

  it("counts delivered sessions only and surfaces missing records", async () => {
    const first = await pastSession("Week 1", 5);
    const second = await pastSession("Week 2", 4);
    const third = await pastSession("Week 3", 3);

    const future = new Date(Date.now() + 3 * DAY);
    await scheduleSession(
      faculty,
      offeringId,
      {
        title: "Week 4",
        startsAt: future.toISOString(),
        endsAt: new Date(future.getTime() + 3_600_000).toISOString(),
      },
      { requestId: "req-attendance" },
    );

    const cancelled = await pastSession("Week 0", 6);
    await testDb().liveSession.update({
      where: { id: cancelled.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await markAttendance(
      faculty,
      first.id,
      {
        records: [
          { userId: north.student.userId, status: "present" },
          { userId: secondStudent.user.id, status: "absent" },
        ],
      },
      { requestId: "req-attendance" },
    );
    await markAttendance(
      faculty,
      second.id,
      {
        records: [
          { userId: north.student.userId, status: "late" },
          { userId: secondStudent.user.id, status: "excused" },
        ],
      },
      { requestId: "req-attendance" },
    );

    const report = await getAttendanceReport(admin, offeringId);

    expect(report.sessions.map((session) => session.title)).toEqual(["Week 1", "Week 2", "Week 3"]);
    expect(report.upcomingSessions).toBe(1);

    const learner = report.rows.find((row) => row.userId === north.student.userId);
    expect(learner).toMatchObject({
      present: 1,
      late: 1,
      absent: 0,
      excused: 0,
      unmarked: 1,
      attended: 2,
      recorded: 2,
      rate: 1,
    });

    const excusedLearner = report.rows.find((row) => row.userId === secondStudent.user.id);
    expect(excusedLearner).toMatchObject({
      present: 0,
      late: 0,
      absent: 1,
      excused: 1,
      unmarked: 1,
      attended: 0,
      recorded: 1,
      rate: 0,
    });

    expect(report.totals).toMatchObject({
      present: 1,
      late: 1,
      absent: 1,
      excused: 1,
      unmarked: 2,
    });
    expect(report.rate).toBe(0.6667);

    const csv = attendanceReportToCsv(report);
    expect(csv.split("\r\n")[0]).toContain("Attendance rate");
    expect(csv).toContain("66.67%");
    expect(csv).toContain("All learners");
    expect(csv.trim().split("\r\n")).toHaveLength(3 + 1);
  });

  it("reports a null rate when nothing has been recorded", async () => {
    await pastSession("Week 1", 4);
    const report = await getAttendanceReport(admin, offeringId);
    expect(report.rate).toBeNull();
    expect(report.rows.every((row) => row.rate === null)).toBe(true);
    expect(report.totals.unmarked).toBe(2);
  });

  it("refuses the report, the policy, and the reopen to outsiders", async () => {
    const { id } = await pastSession("Week 1", 9);
    const colleague = await memberAccount("colleague", "faculty");

    await expect(getAttendanceReport(student, offeringId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(getAttendanceReport(colleague, offeringId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      setAttendancePolicy(
        student,
        offeringId,
        { lockAfterHours: 0 },
        { requestId: "req-attendance" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      reopenSessionAttendance(colleague, id, { requestId: "req-attendance" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rejects a lock window outside the allowed range", async () => {
    await expect(
      setAttendancePolicy(
        faculty,
        offeringId,
        { lockAfterHours: -5 },
        { requestId: "req-attendance" },
      ),
    ).rejects.toThrow();
    await expect(
      setAttendancePolicy(
        faculty,
        offeringId,
        { lockAfterHours: 5000 },
        { requestId: "req-attendance" },
      ),
    ).rejects.toThrow();
    expect(await getAttendancePolicy(faculty, offeringId)).toEqual({ lockAfterHours: 168 });
  });
});
