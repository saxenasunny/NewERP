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
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/modules/notifications/notification-service";
import {
  deliverSessionChangeNotifications,
  getAttendanceRoster,
  listLearnerSessions,
  listSessions,
  markAttendance,
  scheduleSession,
  updateSession,
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
    "Skipping session tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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
    { requestId: "req-sessions" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-sessions" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-sessions" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "DRAFT" },
    { requestId: "req-sessions" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-sessions" },
  );

  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-sessions" },
  );
});

afterAll(async () => {
  await disconnectTestDb();
});

/** An active learner with their own account context. */
async function enrolExtraLearner(name: string, local: string): Promise<AccountContext> {
  const db = testDb();
  const user = await db.user.create({
    data: { email: `${local}@${north.slug}.example`, name, status: "ACTIVE", emailVerified: true },
  });
  await db.tenantMembership.create({
    data: { tenantId: north.tenantId, userId: user.id, status: "ACTIVE", joinedAt: new Date() },
  });
  const role = await db.role.findFirstOrThrow({
    where: { tenantId: north.tenantId, key: "student" },
  });
  await db.userRoleAssignment.create({
    data: { tenantId: north.tenantId, userId: user.id, roleId: role.id, scopeType: "TENANT" },
  });
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: user.email },
    { requestId: "req-sessions" },
  );
  return accountFor(user.id, north.tenantId);
}

/** A session that already took place, inside the default seven-day lock window. */
const STARTS = new Date(Date.now() - 3 * 86_400_000).toISOString();
const ENDS = new Date(Date.now() - 3 * 86_400_000 + 5_400_000).toISOString();

async function bookSession(title = "Week 1 lecture") {
  return scheduleSession(
    faculty,
    offeringId,
    { title, startsAt: STARTS, endsAt: ENDS, joinUrl: "https://meet.example.com/cs101" },
    { requestId: "req-sessions" },
  );
}

describeDb("live sessions (PostgreSQL)", () => {
  it("schedules a session and records attendance for the cohort", async () => {
    const created = await bookSession();

    const [session] = await listSessions(faculty, offeringId);
    expect(session?.id).toBe(created.id);
    expect(session?.status).toBe("scheduled");
    expect(session?.joinUrl).toBe("https://meet.example.com/cs101");
    expect(session?.tally).toEqual({ present: 0, late: 0, absent: 0, excused: 0, unmarked: 1 });

    const roster = await getAttendanceRoster(faculty, created.id);
    expect(roster.entries).toHaveLength(1);
    expect(roster.entries[0]?.status).toBeNull();

    const tally = await markAttendance(
      faculty,
      created.id,
      { records: [{ userId: north.student.userId, status: "present" }] },
      { requestId: "req-sessions" },
    );
    expect(tally.present).toBe(1);
    expect(tally.unmarked).toBe(0);

    // Marking again corrects the same row instead of adding one.
    await markAttendance(
      faculty,
      created.id,
      { records: [{ userId: north.student.userId, status: "late", note: "Arrived at 09:20" }] },
      { requestId: "req-sessions" },
    );
    expect(await testDb().attendanceRecord.count()).toBe(1);

    const corrected = await getAttendanceRoster(faculty, created.id);
    expect(corrected.entries[0]).toMatchObject({ status: "late", note: "Arrived at 09:20" });
    expect(corrected.session.tally.late).toBe(1);

    const audit = await testDb().auditEvent.findMany({
      where: { action: { in: ["live_session.scheduled", "attendance.marked"] } },
      select: { action: true },
    });
    expect(audit.map((event) => event.action).sort()).toEqual([
      "attendance.marked",
      "attendance.marked",
      "live_session.scheduled",
    ]);
  });

  it("shows a learner only their own attendance", async () => {
    const other = await enrolExtraLearner("Bella Brooks", "bella");
    const created = await bookSession();

    await markAttendance(
      faculty,
      created.id,
      {
        records: [
          { userId: north.student.userId, status: "present" },
          { userId: other.user.id, status: "absent" },
        ],
      },
      { requestId: "req-sessions" },
    );

    const mine = await listLearnerSessions(student, offeringId);
    expect(mine.sessions).toHaveLength(1);
    expect(mine.sessions[0]?.ownStatus).toBe("present");
    expect(mine.summary).toMatchObject({ present: 1, absent: 0, unmarked: 0 });

    const theirs = await listLearnerSessions(other, offeringId);
    expect(theirs.sessions[0]?.ownStatus).toBe("absent");
    expect(theirs.summary).toMatchObject({ present: 0, absent: 1 });

    // A learner cannot read the cohort roster or the staff schedule.
    await expect(getAttendanceRoster(student, created.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(listSessions(student, offeringId)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("notifies the enrolled cohort when a session moves or is cancelled", async () => {
    const created = await bookSession();

    await updateSession(
      faculty,
      created.id,
      { startsAt: "2026-09-11T09:00:00.000Z", endsAt: "2026-09-11T10:30:00.000Z" },
      { requestId: "req-sessions" },
    );

    const rescheduled = await testDb().emailMessage.findMany({
      where: { to: `student@${north.slug}.example` },
      orderBy: { createdAt: "asc" },
      select: { subject: true, body: true },
    });
    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0]?.subject).toContain("rescheduled");
    expect(rescheduled[0]?.body).toContain("2026-09-11");

    // A retried job replays the same event; the dedupe key stops a second notice.
    const replay = await deliverSessionChangeNotifications(created.id, "rescheduled");
    expect(replay.notified).toBe(0);
    expect(await deliverSessionChangeNotifications(created.id, "rescheduled")).toEqual({
      notified: 0,
    });
    expect(await testDb().emailMessage.count()).toBe(1);
    expect(await testDb().notification.count()).toBe(1);

    await updateSession(faculty, created.id, { cancel: true }, { requestId: "req-sessions" });

    const [session] = await listSessions(faculty, offeringId);
    expect(session?.status).toBe("cancelled");
    expect(await testDb().emailMessage.count()).toBe(2);
    const cancelled = await testDb().emailMessage.findFirst({
      where: { to: `student@${north.slug}.example` },
      orderBy: { createdAt: "desc" },
      select: { subject: true },
    });
    expect(cancelled?.subject).toContain("cancelled");

    // A cancelled session takes no further attendance.
    await expect(
      markAttendance(
        faculty,
        created.id,
        { records: [{ userId: north.student.userId, status: "present" }] },
        { requestId: "req-sessions" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("delivers one in-app notice per learner that only they can read and clear", async () => {
    const other = await enrolExtraLearner("Bella Brooks", "bella");
    const created = await bookSession();

    await updateSession(
      faculty,
      created.id,
      { startsAt: "2026-09-12T09:00:00.000Z", endsAt: "2026-09-12T10:30:00.000Z" },
      { requestId: "req-sessions" },
    );

    const mine = await listNotifications(student);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ category: "sessions", readAt: null });
    expect(mine[0]?.href).toBe(`/student/courses/${offeringId}/sessions`);
    expect(mine[0]?.title).toContain("rescheduled");

    const theirs = await listNotifications(other);
    expect(theirs).toHaveLength(1);
    expect(await countUnreadNotifications(student)).toBe(1);
    expect(await countUnreadNotifications(faculty)).toBe(0);

    // Another learner's notification id is a 404, not a silent edit.
    await expect(markNotificationRead(other, mine[0]!.id)).rejects.toThrow();
    await markNotificationRead(student, mine[0]!.id);
    expect(await countUnreadNotifications(student)).toBe(0);
    expect((await listNotifications(student))[0]?.readAt).not.toBeNull();

    // Marking an already-read notice is harmless.
    await markNotificationRead(student, mine[0]!.id);
    expect(await markAllNotificationsRead(student)).toBe(0);

    // Only the caller's own rows are touched by "mark all".
    expect(await markAllNotificationsRead(other)).toBe(1);
    expect(await countUnreadNotifications(other)).toBe(0);
  });

  it("refuses scheduling from a learner and from a colleague, and rejects a bad window", async () => {
    await expect(
      scheduleSession(
        student,
        offeringId,
        { title: "Guest lecture", startsAt: STARTS, endsAt: ENDS },
        { requestId: "req-sessions" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const colleague = await testDb().user.create({
      data: {
        email: `colleague@${north.slug}.example`,
        name: "Colleague",
        status: "ACTIVE",
        emailVerified: true,
      },
    });
    await testDb().tenantMembership.create({
      data: {
        tenantId: north.tenantId,
        userId: colleague.id,
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
        userId: colleague.id,
        roleId: facultyRole.id,
        scopeType: "TENANT",
      },
    });
    const outsider = await accountFor(colleague.id, north.tenantId);
    await expect(
      scheduleSession(
        outsider,
        offeringId,
        { title: "Guest lecture", startsAt: STARTS, endsAt: ENDS },
        { requestId: "req-sessions" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      scheduleSession(
        faculty,
        offeringId,
        { title: "Wrong way round", startsAt: ENDS, endsAt: STARTS },
        { requestId: "req-sessions" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
