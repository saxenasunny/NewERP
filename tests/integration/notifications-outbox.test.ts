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
  createAnnouncement,
  deliverAnnouncement,
  publishAnnouncement,
} from "@/modules/communication/announcement-service";
import {
  getConversation,
  listConversations,
  sendMessage,
} from "@/modules/communication/message-service";
import {
  countPendingDeliveries,
  enqueueDeliveries,
  processDeliveryQueue,
} from "@/modules/notifications/delivery-queue";
import { countUnreadNotifications } from "@/modules/notifications/notification-service";
import { listPreferences, updatePreferences } from "@/modules/notifications/preference-service";

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
    "Skipping notification queue tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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
let classmate: AccountContext;
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
    { requestId: "req-outbox" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-outbox" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-outbox" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "DRAFT" },
    { requestId: "req-outbox" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-outbox" },
  );
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-outbox" },
  );

  const classmateUser = await testDb().user.create({
    data: { email: "classmate@north.example", name: "Class Mate", status: "ACTIVE" },
  });
  await testDb().tenantMembership.create({
    data: {
      tenantId: north.tenantId,
      userId: classmateUser.id,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });
  const role = await testDb().role.findFirstOrThrow({
    where: { tenantId: north.tenantId, key: "student" },
  });
  await testDb().userRoleAssignment.create({
    data: {
      tenantId: north.tenantId,
      userId: classmateUser.id,
      roleId: role.id,
      scopeType: "TENANT",
    },
  });
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: "classmate@north.example" },
    { requestId: "req-outbox" },
  );
  classmate = await accountFor(classmateUser.id, north.tenantId);
});

afterAll(async () => {
  await disconnectTestDb();
});

describeDb("notification preferences and the delivery queue (PostgreSQL)", () => {
  it("delivers in both channels by default and honours a muted channel", async () => {
    await createAnnouncement(
      faculty,
      offeringId,
      { title: "Lab moved", body: "Lab 3 moves to Thursday." },
      { publish: true, requestId: "req-outbox" },
    );

    expect(await countUnreadNotifications(student)).toBe(1);
    expect(await testDb().emailMessage.count({ where: { to: student.user.email } })).toBe(1);
    const delivery = await testDb().notificationDelivery.findFirstOrThrow({
      where: { userId: student.user.id },
    });
    expect(delivery).toMatchObject({
      status: "SENT",
      attempts: 1,
      template: "announcement.published",
    });
    expect(delivery.sentAt).toBeInstanceOf(Date);

    // Mute the in-app channel for this category only.
    await updatePreferences(
      student,
      { preferences: [{ category: "announcements", inApp: false, email: true }] },
      { requestId: "req-outbox" },
    );

    await createAnnouncement(
      faculty,
      offeringId,
      { title: "Second notice", body: "No bell badge for this one." },
      { publish: true, requestId: "req-outbox" },
    );

    expect(await countUnreadNotifications(student)).toBe(1);
    expect(await testDb().notificationDelivery.count({ where: { userId: student.user.id } })).toBe(
      2,
    );
    expect(await testDb().emailMessage.count({ where: { to: student.user.email } })).toBe(2);

    const audit = await testDb().auditEvent.findFirst({
      where: { action: "notification.preferences_updated" },
      select: { before: true, after: true },
    });
    expect(audit).not.toBeNull();
  });

  it("skips the email entirely when the person turns it off", async () => {
    await updatePreferences(
      student,
      { preferences: [{ category: "announcements", inApp: true, email: false }] },
      { requestId: "req-outbox" },
    );

    const preferences = await listPreferences(student);
    expect(preferences.find((row) => row.category === "announcements")).toEqual({
      category: "announcements",
      inApp: true,
      email: false,
    });

    await createAnnouncement(
      faculty,
      offeringId,
      { title: "Email-free notice", body: "Only in the app." },
      { publish: true, requestId: "req-outbox" },
    );

    expect(await countUnreadNotifications(student)).toBe(1);
    expect(await testDb().notificationDelivery.count({ where: { userId: student.user.id } })).toBe(
      0,
    );
    expect(await testDb().emailMessage.count({ where: { to: student.user.email } })).toBe(0);
  });

  it("queues one email per event and none on a replay", async () => {
    const announcement = await createAnnouncement(
      faculty,
      offeringId,
      { title: "Replayed notice", body: "Deliver me twice." },
      { publish: false, requestId: "req-outbox" },
    );
    await publishAnnouncement(faculty, announcement.id, { requestId: "req-outbox" });

    expect(await testDb().emailMessage.count()).toBe(2); // two learners
    expect(await deliverAnnouncement(announcement.id)).toEqual({ notified: 0 });
    expect(await testDb().emailMessage.count()).toBe(2);
    expect(await testDb().notificationDelivery.count()).toBe(2);
  });

  it("holds an unusable queued message instead of sending it, and retries nothing early", async () => {
    const [deliveryId] = await enqueueDeliveries(testDb(), [
      {
        tenantId: north.tenantId,
        userId: student.user.id,
        category: "ANNOUNCEMENTS",
        template: "announcement.published",
        payload: { href: "/student/courses/x/announcements" },
        dedupeKey: "broken-payload",
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    ]);

    const summary = await processDeliveryQueue({ now: new Date() });
    expect(summary).toMatchObject({ attempted: 1, sent: 0, skipped: 1 });

    const held = await testDb().notificationDelivery.findFirstOrThrow({
      where: { id: deliveryId },
    });
    expect(held.status).toBe("SKIPPED");
    expect(held.nextAttemptAt).toBeNull();
    expect(held.lastError).toContain("Unusable template payload");
    expect(await testDb().emailMessage.count()).toBe(0);

    await enqueueDeliveries(testDb(), [
      {
        tenantId: north.tenantId,
        userId: student.user.id,
        category: "ANNOUNCEMENTS",
        template: "discussion.reply",
        payload: {
          href: "/student/courses/x/discussions/1",
          recipientName: "student north",
          authorName: "Faculty north",
          threadTitle: "Thread",
          replyBody: "Body",
        },
        dedupeKey: "future-attempt",
        nextAttemptAt: new Date(Date.now() + 60 * 60_000),
      },
    ]);

    expect(await countPendingDeliveries(testDb())).toEqual({ due: 0, stuck: 0 });
    expect((await processDeliveryQueue({ now: new Date() })).attempted).toBe(0);

    const later = new Date(Date.now() + 2 * 60 * 60_000);
    expect((await processDeliveryQueue({ now: later })).sent).toBe(1);
    expect(await testDb().emailMessage.count()).toBe(1);
  });
});

describeDb("course direct messages (PostgreSQL)", () => {
  it("carries a learner's question to the instructor and clears it when read", async () => {
    const sent = await sendMessage(student, offeringId, {
      recipientUserId: faculty.user.id,
      body: "Could you check my lab submission?",
    });

    expect(await countUnreadNotifications(faculty)).toBe(1);
    expect(await testDb().notificationDelivery.count()).toBe(0);

    const staffList = await listConversations(faculty, offeringId);
    const contact = staffList.contacts.find((row) => row.userId === student.user.id);
    expect(contact).toMatchObject({ unread: 1, role: "learner" });
    expect(contact?.lastPreview).toContain("Could you check");

    const conversation = await getConversation(faculty, offeringId, student.user.id);
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]).toMatchObject({
      mine: false,
      body: "Could you check my lab submission?",
    });

    const afterReading = await listConversations(faculty, offeringId);
    expect(afterReading.contacts.find((row) => row.userId === student.user.id)?.unread).toBe(0);

    const notice = await testDb().notification.findFirstOrThrow({
      where: { userId: faculty.user.id },
      select: { dedupeKey: true, href: true },
    });
    expect(notice.dedupeKey).toBe(`direct_message:${sent.id}`);
    expect(notice.href).toBe(`/faculty/courses/${offeringId}/messages?with=${student.user.id}`);
  });

  it("lets staff reply and refuses messages that leave the course", async () => {
    await sendMessage(faculty, offeringId, {
      recipientUserId: student.user.id,
      body: "Yes — bring it to Thursday's lab.",
    });
    expect(await countUnreadNotifications(student)).toBe(1);

    const learnerView = await getConversation(student, offeringId, faculty.user.id);
    expect(learnerView.contact.role).toBe("staff");
    expect(learnerView.messages.map((message) => message.mine)).toEqual([false]);

    await expect(
      sendMessage(student, offeringId, { recipientUserId: student.user.id, body: "Note to self." }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      sendMessage(classmate, offeringId, {
        recipientUserId: student.user.id,
        body: "Hi classmate.",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    await expect(listConversations(outsider, offeringId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );

    await expect(
      sendMessage(student, offeringId, { recipientUserId: faculty.user.id, body: "   " }),
    ).rejects.toThrow();
    expect(await testDb().directMessage.count()).toBe(1);
  });
});
