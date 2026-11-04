import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, ResourceNotFoundError } from "@/lib/errors";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import { createAcademicYear, createTerm } from "@/modules/academics/structure-service";
import {
  getCalendar,
  groupEventsByDay,
  parseCalendarWindow,
} from "@/modules/calendar/calendar-service";
import {
  runAssignmentDueReminders,
  runSessionReminders,
} from "@/modules/notifications/reminder-service";
import { scheduleSession } from "@/modules/sessions/session-service";

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
    "Skipping calendar tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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

const STARTS = "2026-09-10T09:00:00.000Z";
const ENDS = "2026-09-10T10:30:00.000Z";
const DAY = 86_400_000;

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
    { requestId: "req-calendar" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-calendar" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-calendar" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "PUBLISHED" },
    { requestId: "req-calendar" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-calendar" },
  );
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-calendar" },
  );
});

afterAll(async () => {
  await disconnectTestDb();
});

/** An assignment created directly: the calendar only reads deadlines. */
async function createAssignment(
  title: string,
  dueAt: string,
  status: "DRAFT" | "PUBLISHED" = "PUBLISHED",
  targetOfferingId: string = offeringId,
) {
  return testDb().assignment.create({
    data: {
      tenantId: north.tenantId,
      offeringId: targetOfferingId,
      title,
      dueAt: new Date(dueAt),
      status,
    },
    select: { id: true },
  });
}

async function createQuiz(
  title: string,
  availableUntil: string,
  status: "DRAFT" | "PUBLISHED" = "PUBLISHED",
) {
  return testDb().quiz.create({
    data: {
      tenantId: north.tenantId,
      offeringId,
      title,
      availableUntil: new Date(availableUntil),
      status,
    },
    select: { id: true },
  });
}

const WINDOW = parseCalendarWindow({
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-09-30T00:00:00.000Z",
});

describeDb("calendar (PostgreSQL)", () => {
  it("shows a learner their sessions, deadlines, and quiz closings only", async () => {
    await scheduleSession(
      faculty,
      offeringId,
      { title: "Week 1 lecture", startsAt: STARTS, endsAt: ENDS },
      { requestId: "req-calendar" },
    );
    const assignment = await createAssignment("Essay 1", "2026-09-12T17:00:00.000Z");
    await createAssignment("Hidden draft", "2026-09-13T17:00:00.000Z", "DRAFT");
    const quiz = await createQuiz("Quiz 1", "2026-09-20T12:00:00.000Z");

    const calendar = await getCalendar(student, WINDOW);

    expect(calendar.scope).toBe("learner");
    expect(calendar.events.map((event) => event.kind)).toEqual(["session", "assignment", "quiz"]);

    const [session, due, closes] = calendar.events;
    expect(session).toMatchObject({
      title: "Week 1 lecture",
      courseCode: "CS101",
      state: "scheduled",
      href: `/student/courses/${offeringId}/sessions`,
    });
    expect(due).toMatchObject({
      id: assignment.id,
      state: "open",
      href: `/student/courses/${offeringId}/assignments/${assignment.id}`,
    });
    expect(due?.endsAt).toBeNull();
    expect(closes).toMatchObject({
      id: quiz.id,
      state: "open",
      href: `/student/courses/${offeringId}/quizzes/${quiz.id}`,
    });

    // Drafts are invisible to learners; staff see them on their own calendar.
    const staff = await getCalendar(faculty, WINDOW);
    expect(staff.scope).toBe("staff");
    expect(staff.events.filter((event) => event.kind === "assignment")).toHaveLength(2);
  });

  it("keeps other courses out of a learner's calendar and refuses them by id", async () => {
    const otherCourse = await createCourse(
      admin,
      { code: "MA101", title: "Calculus", credits: 3 },
      { requestId: "req-calendar" },
    );
    const terms = await testDb().term.findMany({ where: { tenantId: north.tenantId } });
    const otherOffering = await createOffering(
      admin,
      { courseId: otherCourse.id, termId: terms[0]!.id, status: "PUBLISHED" },
      { requestId: "req-calendar" },
    );
    await scheduleSession(
      admin,
      otherOffering.id,
      { title: "Calculus lecture", startsAt: STARTS, endsAt: ENDS },
      { requestId: "req-calendar" },
    );

    const calendar = await getCalendar(student, WINDOW);
    expect(calendar.events).toHaveLength(0);

    await expect(
      getCalendar(student, WINDOW, { offeringId: otherOffering.id }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("stops an unassigned colleague from reading a course calendar by id", async () => {
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
    const role = await testDb().role.findFirstOrThrow({
      where: { tenantId: north.tenantId, key: "faculty" },
    });
    await testDb().userRoleAssignment.create({
      data: {
        tenantId: north.tenantId,
        userId: colleague.id,
        roleId: role.id,
        scopeType: "TENANT",
      },
    });
    const outsider = await accountFor(colleague.id, north.tenantId);

    await expect(getCalendar(outsider, WINDOW, { offeringId })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect((await getCalendar(outsider, WINDOW)).events).toHaveLength(0);
  });

  it("groups events by day and rejects an oversized or reversed range", () => {
    const window = parseCalendarWindow({ from: "2026-09-01", to: "2026-09-10" });
    expect(window.from.getTime()).toBeLessThan(window.to.getTime());

    expect(() => parseCalendarWindow({ from: "2026-09-10", to: "2026-09-01" })).toThrow(
      ConflictError,
    );
    expect(() =>
      parseCalendarWindow({
        from: "2026-09-01T00:00:00.000Z",
        to: new Date(Date.parse("2026-09-01T00:00:00.000Z") + 90 * DAY).toISOString(),
      }),
    ).toThrow(ConflictError);

    const grouped = groupEventsByDay([
      {
        id: "a",
        kind: "session",
        title: "One",
        courseCode: "CS101",
        courseTitle: "Programming",
        offeringId: "offering",
        startsAt: new Date("2026-09-10T09:00:00.000Z"),
        endsAt: null,
        href: "/x",
        state: "scheduled",
      },
      {
        id: "b",
        kind: "assignment",
        title: "Two",
        courseCode: "CS101",
        courseTitle: "Programming",
        offeringId: "offering",
        startsAt: new Date("2026-09-10T17:00:00.000Z"),
        endsAt: null,
        href: "/y",
        state: "open",
      },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.events).toHaveLength(2);
  });
});

describeDb("reminder jobs (PostgreSQL)", () => {
  it("reminds a cohort once about a session that starts soon", async () => {
    await scheduleSession(
      faculty,
      offeringId,
      { title: "Week 1 lecture", startsAt: STARTS, endsAt: ENDS },
      { requestId: "req-calendar" },
    );

    const now = new Date("2026-09-10T08:20:00.000Z");
    const first = await runSessionReminders({ now, leadMinutes: 60 });
    expect(first).toEqual({ processed: 1, recipients: 1, skipped: 0 });

    const notice = await testDb().notification.findFirstOrThrow({
      where: { userId: north.student.userId },
      select: { title: true, body: true, dedupeKey: true, href: true },
    });
    expect(notice.title).toContain("starting soon");
    expect(notice.dedupeKey).toContain("session_reminder:");

    // A retried run inside the same window sends nothing and writes nothing.
    const replay = await runSessionReminders({ now, leadMinutes: 60 });
    expect(replay).toEqual({ processed: 1, recipients: 0, skipped: 1 });
    expect(await testDb().notification.count()).toBe(1);
    expect(await testDb().emailMessage.count()).toBe(1);

    // A later window (session already started) is not a reminder target.
    const after = await runSessionReminders({ now: new Date(STARTS), leadMinutes: 60 });
    expect(after.processed).toBe(0);
  });

  it("reminds a cohort once about an assignment due soon", async () => {
    await createAssignment("Essay 1", "2026-09-11T09:00:00.000Z");
    await createAssignment("Unpublished essay", "2026-09-11T09:00:00.000Z", "DRAFT");

    const now = new Date("2026-09-10T09:00:00.000Z");
    const first = await runAssignmentDueReminders({ now, leadMinutes: 24 * 60 });
    expect(first).toEqual({ processed: 1, recipients: 1, skipped: 0 });

    const notice = await testDb().notification.findFirstOrThrow({
      where: { userId: north.student.userId },
      select: { category: true, dedupeKey: true },
    });
    expect(notice.category).toBe("ASSIGNMENTS");
    expect(notice.dedupeKey).toContain("assignment_due:");

    const replay = await runAssignmentDueReminders({ now, leadMinutes: 24 * 60 });
    expect(replay).toEqual({ processed: 1, recipients: 0, skipped: 1 });
    expect(await testDb().emailMessage.count()).toBe(1);

    // The draft in the same window was never a reminder target.
    expect(await testDb().notification.count()).toBe(1);
  });
});
