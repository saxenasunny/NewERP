import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import {
  ConflictError,
  InvalidLinkError,
  PermissionDeniedError,
  ResourceNotFoundError,
} from "@/lib/errors";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import { createAcademicYear, createTerm } from "@/modules/academics/structure-service";
import {
  checkIn,
  closeCheckInCode,
  getCheckInState,
  getCheckInView,
  openCheckInCode,
} from "@/modules/attendance/check-in-service";
import { markAttendance, scheduleSession } from "@/modules/sessions/session-service";

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
    "Skipping check-in tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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
let admin: AccountContext;
let faculty: AccountContext;
let student: AccountContext;
let offeringId: string;

/** A session that started five minutes ago and ends in fifty-five. */
async function sessionSoon(title: string) {
  const startsAt = new Date(Date.now() - 5 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  return scheduleSession(
    faculty,
    offeringId,
    { title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    { requestId: "req-check-in" },
  );
}

async function memberAccount(
  fixture: TenantFixture,
  local: string,
  roleKey: string,
): Promise<AccountContext> {
  const db = testDb();
  const user = await db.user.create({
    data: {
      email: `${local}@${fixture.slug}.example`,
      name: `Member ${local}`,
      status: "ACTIVE",
      emailVerified: true,
    },
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

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });
  admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);

  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    { requestId: "req-check-in" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-check-in" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-check-in" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "PUBLISHED" },
    { requestId: "req-check-in" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-check-in" },
  );
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-check-in" },
  );
});

afterAll(async () => {
  await disconnectTestDb();
});

describeDb("QR attendance check-in (PostgreSQL)", () => {
  it("opens a code, records one scan, and reports a replay without a second row", async () => {
    const { id } = await sessionSoon("Week 1");

    const code = await openCheckInCode(faculty, id, { minutes: 10 }, { requestId: "req-check-in" });
    expect(code.url).toContain("/student/check-in/v1.");
    expect(code.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const view = await getCheckInView(student, code.token);
    expect(view).toMatchObject({
      sessionId: id,
      title: "Week 1",
      courseCode: "CS101",
      ownStatus: null,
      ownSource: null,
    });

    const first = await checkIn(student, code.token, { requestId: "req-check-in" });
    expect(first).toMatchObject({ alreadyRecorded: false, status: "present", source: "qr" });

    const replay = await checkIn(student, code.token, { requestId: "req-check-in" });
    expect(replay).toMatchObject({ alreadyRecorded: true, status: "present", source: "qr" });

    const rows = await testDb().attendanceRecord.findMany({
      where: { sessionId: id, userId: north.student.userId },
      select: { status: true, source: true },
    });
    expect(rows).toEqual([{ status: "PRESENT", source: "QR" }]);

    expect((await getCheckInState(faculty, id)).checkedIn).toBe(1);

    const events = await testDb().auditEvent.findMany({
      where: { action: { in: ["attendance.check_in_opened", "attendance.checked_in"] } },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual([
      "attendance.check_in_opened",
      "attendance.checked_in",
    ]);
  });

  it("invalidates the previous code when a new one is generated or the code is closed", async () => {
    const { id } = await sessionSoon("Week 2");

    const first = await openCheckInCode(
      faculty,
      id,
      { minutes: 15 },
      { requestId: "req-check-in" },
    );
    const second = await openCheckInCode(
      faculty,
      id,
      { minutes: 15 },
      { requestId: "req-check-in" },
    );
    expect(second.token).not.toBe(first.token);

    await expect(getCheckInView(student, first.token)).rejects.toBeInstanceOf(InvalidLinkError);
    expect((await getCheckInView(student, second.token)).ownStatus).toBeNull();

    await closeCheckInCode(faculty, id, { requestId: "req-check-in" });
    await expect(getCheckInView(student, second.token)).rejects.toBeInstanceOf(InvalidLinkError);
    expect(await getCheckInState(faculty, id)).toMatchObject({ code: null });
  });

  it("refuses an expired code even though its signature is still valid", async () => {
    const { id } = await sessionSoon("Week 3");
    const code = await openCheckInCode(faculty, id, { minutes: 5 }, { requestId: "req-check-in" });

    await testDb().liveSession.update({
      where: { id },
      data: { checkInExpiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(getCheckInView(student, code.token)).rejects.toThrow(/expired/i);
    expect((await getCheckInState(faculty, id)).code).toBeNull();
  });

  it("never overwrites a staff marking and never rewrites its note", async () => {
    const { id } = await sessionSoon("Week 4");

    await markAttendance(
      faculty,
      id,
      {
        records: [{ userId: north.student.userId, status: "absent", note: "Called in sick" }],
      },
      { requestId: "req-check-in" },
    );

    const code = await openCheckInCode(faculty, id, { minutes: 10 }, { requestId: "req-check-in" });
    const result = await checkIn(student, code.token, { requestId: "req-check-in" });

    expect(result).toMatchObject({ alreadyRecorded: true, status: "absent", source: "staff" });

    const rows = await testDb().attendanceRecord.findMany({
      where: { sessionId: id, userId: north.student.userId },
      select: { status: true, source: true, note: true },
    });
    expect(rows).toEqual([{ status: "ABSENT", source: "STAFF", note: "Called in sick" }]);
  });

  it("refuses outsiders, other institutions, cancelled sessions, and locked attendance", async () => {
    const { id } = await sessionSoon("Week 5");
    const outsider = await memberAccount(north, "student2", "student");
    const code = await openCheckInCode(faculty, id, { minutes: 10 }, { requestId: "req-check-in" });

    await expect(
      checkIn(outsider, code.token, { requestId: "req-check-in" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const south = await createTenantFixture({ slug: "south", name: "South College", code: "SC" });
    const southFaculty = await accountFor(south.faculty.userId, south.tenantId);
    await expect(
      openCheckInCode(southFaculty, id, { minutes: 10 }, { requestId: "req-check-in" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      getCheckInView(await accountFor(south.student.userId, south.tenantId), code.token),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    await testDb().liveSession.update({ where: { id }, data: { attendanceLockedAt: new Date() } });
    await expect(
      checkIn(student, code.token, { requestId: "req-check-in" }),
    ).rejects.toBeInstanceOf(ConflictError);

    await testDb().liveSession.update({
      where: { id },
      data: { attendanceLockedAt: null, status: "CANCELLED", cancelledAt: new Date() },
    });
    await expect(
      checkIn(student, code.token, { requestId: "req-check-in" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      openCheckInCode(faculty, id, { minutes: 10 }, { requestId: "req-check-in" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a forged or truncated token without touching the database", async () => {
    const { id } = await sessionSoon("Week 6");
    await openCheckInCode(faculty, id, { minutes: 10 }, { requestId: "req-check-in" });

    await expect(getCheckInView(student, "v1.abc.def")).rejects.toBeInstanceOf(InvalidLinkError);
    await expect(getCheckInView(student, "")).rejects.toBeInstanceOf(InvalidLinkError);
    expect(await testDb().attendanceRecord.count()).toBe(0);
  });

  it("validates the code lifetime and refuses a non-teaching member", async () => {
    const { id } = await sessionSoon("Week 7");
    const colleague = await memberAccount(north, "colleague", "faculty");

    await expect(
      openCheckInCode(faculty, id, { minutes: 0 }, { requestId: "req-check-in" }),
    ).rejects.toThrow();
    await expect(
      openCheckInCode(faculty, id, { minutes: 500 }, { requestId: "req-check-in" }),
    ).rejects.toThrow();
    await expect(
      openCheckInCode(colleague, id, { minutes: 10 }, { requestId: "req-check-in" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      openCheckInCode(student, id, { minutes: 10 }, { requestId: "req-check-in" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
