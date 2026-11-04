import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError, ResourceNotFoundError } from "@/lib/errors";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import { createAcademicYear, createTerm } from "@/modules/academics/structure-service";
import {
  createAnnouncement,
  deliverAnnouncement,
  listAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
  withdrawAnnouncement,
} from "@/modules/communication/announcement-service";
import {
  createThread,
  getThread,
  listThreads,
  replyToThread,
  setPostStatus,
  setThreadPinned,
  setThreadStatus,
} from "@/modules/communication/discussion-service";
import { countUnreadNotifications } from "@/modules/notifications/notification-service";

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
    "Skipping communication tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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
let south: TenantFixture;
let admin: AccountContext;
let faculty: AccountContext;
let student: AccountContext;
let outsider: AccountContext;
let offeringId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });
  south = await createTenantFixture({ slug: "south", name: "South College", code: "SC" });

  admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);
  outsider = await accountFor(south.faculty.userId, south.tenantId);

  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    { requestId: "req-communication" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-communication" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-communication" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "DRAFT" },
    { requestId: "req-communication" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-communication" },
  );
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-communication" },
  );
});

afterAll(async () => {
  await disconnectTestDb();
});

describeDb("course communication (PostgreSQL)", () => {
  it("publishes an announcement to the cohort exactly once", async () => {
    const created = await createAnnouncement(
      faculty,
      offeringId,
      { title: "Lab moved to Thursday", body: "Lab 3 moves to Thursday 10:00 in B204." },
      { publish: true, requestId: "req-communication" },
    );
    expect(created.status).toBe("published");
    expect(created.publishedAt).toBeInstanceOf(Date);

    const learnerList = await listAnnouncements(student, offeringId);
    expect(learnerList.announcements.map((row) => row.title)).toEqual(["Lab moved to Thursday"]);
    expect(await countUnreadNotifications(student)).toBe(1);

    // Replaying delivery finds the existing notification and emails nobody.
    expect(await deliverAnnouncement(created.id)).toEqual({ notified: 0 });
    expect(await countUnreadNotifications(student)).toBe(1);

    const notices = await testDb().notification.findMany({ select: { dedupeKey: true } });
    expect(notices).toEqual([{ dedupeKey: `announcement:${created.id}:published` }]);
  });

  it("keeps drafts from learners and makes withdrawal final", async () => {
    const draft = await createAnnouncement(
      faculty,
      offeringId,
      { title: "Draft only", body: "Not ready yet." },
      { publish: false, requestId: "req-communication" },
    );
    expect(draft.status).toBe("draft");
    expect((await listAnnouncements(student, offeringId)).announcements).toEqual([]);
    expect((await listAnnouncements(faculty, offeringId)).announcements).toHaveLength(1);
    expect(await countUnreadNotifications(student)).toBe(0);

    await publishAnnouncement(faculty, draft.id, { requestId: "req-communication" });
    expect((await listAnnouncements(student, offeringId)).announcements).toHaveLength(1);

    await withdrawAnnouncement(faculty, draft.id, { requestId: "req-communication" });
    expect((await listAnnouncements(student, offeringId)).announcements).toEqual([]);

    const staffList = await listAnnouncements(faculty, offeringId);
    expect(staffList.announcements[0]).toMatchObject({ status: "withdrawn" });
    expect(staffList.announcements[0]?.withdrawnAt).toBeInstanceOf(Date);

    await expect(
      updateAnnouncement(
        faculty,
        draft.id,
        { title: "Edited after withdrawal", body: "Should not happen." },
        { requestId: "req-communication" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      publishAnnouncement(faculty, draft.id, { requestId: "req-communication" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses publishing to a learner and hides the course from an outsider", async () => {
    await expect(
      createAnnouncement(
        student,
        offeringId,
        { title: "Learner notice", body: "Learners cannot publish." },
        { publish: true, requestId: "req-communication" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(listAnnouncements(outsider, offeringId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    await expect(listThreads(outsider, offeringId)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("opens a thread, notifies the author of a reply, and refuses replies once locked", async () => {
    const { id: threadId } = await createThread(
      student,
      offeringId,
      { title: "Recursion in lab 4", body: "Should the base case come first?" },
      { requestId: "req-communication" },
    );

    await replyToThread(
      faculty,
      threadId,
      { body: "Yes — write the base case before the recursive step." },
      { requestId: "req-communication" },
    );

    expect(await countUnreadNotifications(student)).toBe(1);
    const learnerView = await getThread(student, threadId);
    expect(learnerView.posts).toHaveLength(1);
    expect(learnerView.canReply).toBe(true);

    await setThreadStatus(faculty, threadId, "locked", { requestId: "req-communication" });
    await expect(
      replyToThread(student, threadId, { body: "One more question." }, { requestId: "req" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const locked = await getThread(student, threadId);
    expect(locked.thread.status).toBe("locked");
    expect(locked.canReply).toBe(false);

    await setThreadStatus(faculty, threadId, "open", { requestId: "req-communication" });
    await replyToThread(student, threadId, { body: "Thanks." }, { requestId: "req" });
    const reopened = await getThread(faculty, threadId);
    expect(reopened.posts).toHaveLength(2);
    expect(reopened.thread.postCount).toBe(2);
  });

  it("moderates by hiding and restoring rather than deleting", async () => {
    const { id: threadId } = await createThread(
      student,
      offeringId,
      { title: "Group project partners", body: "Looking for a partner." },
      { requestId: "req-communication" },
    );
    await replyToThread(
      student,
      threadId,
      { body: "A reply that will be hidden." },
      { requestId: "req-communication" },
    );

    await setThreadPinned(faculty, threadId, true, { requestId: "req-communication" });
    expect((await listThreads(student, offeringId)).threads[0]?.pinned).toBe(true);

    await setThreadStatus(faculty, threadId, "hidden", { requestId: "req-communication" });
    expect((await listThreads(student, offeringId)).threads).toEqual([]);
    await expect(getThread(student, threadId)).rejects.toBeInstanceOf(ResourceNotFoundError);

    const staffView = await getThread(faculty, threadId);
    expect(staffView.thread.status).toBe("hidden");

    await setThreadStatus(faculty, threadId, "open", { requestId: "req-communication" });
    const visible = await getThread(student, threadId);
    const postId = visible.posts[0]?.id;
    expect(postId).toBeTruthy();

    await setPostStatus(faculty, postId!, "hidden", { requestId: "req-communication" });
    expect((await getThread(student, threadId)).posts).toEqual([]);
    const moderated = await getThread(faculty, threadId);
    expect(moderated.posts[0]).toMatchObject({ status: "hidden" });
    expect(moderated.posts[0]?.hiddenAt).toBeInstanceOf(Date);

    await setPostStatus(faculty, postId!, "visible", { requestId: "req-communication" });
    expect((await getThread(student, threadId)).posts).toHaveLength(1);
    expect(await testDb().discussionPost.count()).toBe(1);
  });

  it("refuses moderation without the permission and records the decisions", async () => {
    const { id: threadId } = await createThread(
      student,
      offeringId,
      { title: "Exam format", body: "Will the exam be open book?" },
      { requestId: "req-communication" },
    );

    await expect(
      setThreadStatus(student, threadId, "hidden", { requestId: "req" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      setThreadPinned(student, threadId, true, { requestId: "req" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await createAnnouncement(
      faculty,
      offeringId,
      { title: "Exam briefing", body: "Open book, 90 minutes." },
      { publish: true, requestId: "req-communication" },
    );
    await setThreadStatus(faculty, threadId, "locked", { requestId: "req-communication" });

    const actions = (
      await testDb().auditEvent.findMany({
        where: {
          action: {
            in: [
              "announcement.published",
              "discussion.thread_created",
              "discussion.thread_moderated",
            ],
          },
        },
        select: { action: true, actorUserId: true },
      })
    ).map((event) => event.action);
    expect(actions.sort()).toEqual([
      "announcement.published",
      "discussion.thread_created",
      "discussion.thread_moderated",
    ]);
  });
});
