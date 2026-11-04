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
import {
  copyCourseContent,
  createItem,
  createModule,
  deleteItem,
  getContentWorkspace,
  getOfferingAccess,
  moveItem,
  moveModule,
  publishCourse,
  readItemFile,
  updateModule,
} from "@/modules/content/content-service";
import {
  getCourseView,
  listLearnerCourses,
  recordItemViewed,
  setItemCompleted,
} from "@/modules/content/delivery-service";

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
    "Skipping course content tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

const context = { requestId: "req-content" };

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

/** Adds an active member with the given institution role. */
async function createExtraMember(
  fixture: TenantFixture,
  label: string,
  roleKey: "student" | "faculty",
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

async function createExtraStudent(fixture: TenantFixture, label: string) {
  return createExtraMember(fixture, label, "student");
}

let storageRoot: string;

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "lms-content-test-"));
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
let offeringId: string;
let termId: string;
let unenrolled: AccountContext;
let southStudent: AccountContext;

async function createCourseOffering(account: AccountContext, code: string, title: string) {
  const course = await createCourse(account, { code, title, credits: 3 }, context);
  const offering = await createOffering(
    account,
    { courseId: course.id, termId, status: "DRAFT" },
    context,
  );
  return offering.id;
}

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });
  south = await createTenantFixture({ slug: "south", name: "South College", code: "SC" });

  admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);
  southStudent = await accountFor(south.student.userId, south.tenantId);
  unenrolled = await createExtraStudent(north, "extra");

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
  offeringId = await createCourseOffering(admin, "CS101", "Introduction to Programming");
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
});

describeDb("course content authoring and delivery (PostgreSQL)", () => {
  it("lets an assigned instructor build and publish a course, and refuses a stranger", async () => {
    const courseModule = await createModule(
      faculty,
      {
        offeringId,
        title: "Week 1",
        description: "Getting started",
        status: "PUBLISHED",
        prerequisiteModuleIds: [],
      },
      context,
    );
    await createItem(
      faculty,
      {
        offeringId,
        moduleId: courseModule.id,
        title: "Welcome",
        kind: "RICH_TEXT",
        body: "<p>Hello <strong>class</strong>.</p>",
        status: "PUBLISHED",
      },
      null,
      context,
    );

    const published = await publishCourse(faculty, offeringId, context);
    expect(published).toEqual({ modules: 1, items: 1 });

    const stored = await testDb().courseOffering.findUniqueOrThrow({
      where: { id: offeringId },
      select: { status: true },
    });
    expect(stored.status).toBe("PUBLISHED");

    const workspace = await getContentWorkspace(faculty, offeringId);
    expect(workspace.counts).toEqual({ modules: 1, items: 1, publishedItems: 1, files: 0 });

    // A faculty member from another institution sees nothing at all.
    const southAdmin = await accountFor(south.admin.userId, south.tenantId);
    await expect(getContentWorkspace(southAdmin, offeringId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    // A colleague who is not assigned to this offering is refused, even though
    // the faculty role itself grants `content.create`.
    const colleague = await createExtraMember(north, "colleague", "faculty");
    expect(colleague.permissions.has("content.create")).toBe(true);
    await expect(
      createModule(
        colleague,
        { offeringId, title: "Unauthorised", prerequisiteModuleIds: [] },
        context,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("shows learners only published, open lessons and keeps drafts in the editor", async () => {
    const courseModule = await createModule(
      faculty,
      { offeringId, title: "Module", status: "DRAFT", prerequisiteModuleIds: [] },
      context,
    );
    const open = await createItem(
      faculty,
      {
        offeringId,
        moduleId: courseModule.id,
        title: "Open lesson",
        kind: "RICH_TEXT",
        body: "<p>Available now.</p>",
        status: "PUBLISHED",
      },
      null,
      context,
    );
    await createItem(
      faculty,
      {
        offeringId,
        moduleId: courseModule.id,
        title: "Future lesson",
        kind: "RICH_TEXT",
        body: "<p>Not yet.</p>",
        status: "PUBLISHED",
        availableFrom: new Date(Date.now() + 86_400_000).toISOString(),
      },
      null,
      context,
    );

    await publishCourse(faculty, offeringId, context);

    // Created after publication, so it stays a draft.
    const draft = await createItem(
      faculty,
      {
        offeringId,
        moduleId: courseModule.id,
        title: "Draft lesson",
        kind: "RICH_TEXT",
        body: "<p>Only staff see this.</p>",
        status: "DRAFT",
      },
      null,
      context,
    );

    const view = await getCourseView(student, offeringId);
    expect(view.mode).toBe("learner");
    const titles = view.modules.flatMap((m) => m.items.map((item) => item.title));
    expect(titles).toEqual(["Open lesson", "Future lesson"]);
    expect(titles).not.toContain("Draft lesson");
    expect(view.activeItem?.id).toBe(open.id);
    expect(view.activeItem?.body).toContain("Available now");

    // A direct link to the draft or the future lesson reveals no content.
    const draftRequest = await getCourseView(student, offeringId, { itemId: draft.id });
    expect(draftRequest.activeItem).toBeNull();
    await expect(
      recordItemViewed(student, draft.id).catch((error: unknown) => error),
    ).resolves.toBeInstanceOf(PermissionDeniedError);

    const workspace = await getContentWorkspace(faculty, offeringId);
    expect(workspace.counts.items).toBe(3);
    // Publishing ran before the draft was created, so two of the three items are out.
    expect(workspace.counts.publishedItems).toBe(2);
  });

  it("locks a module behind its prerequisite and unlocks it after completion", async () => {
    const first = await createModule(
      faculty,
      { offeringId, title: "Foundations", status: "PUBLISHED", prerequisiteModuleIds: [] },
      context,
    );
    const firstItem = await createItem(
      faculty,
      {
        offeringId,
        moduleId: first.id,
        title: "Lesson one",
        kind: "RICH_TEXT",
        body: "<p>One.</p>",
        status: "PUBLISHED",
      },
      null,
      context,
    );
    const second = await createModule(
      faculty,
      {
        offeringId,
        title: "Advanced",
        status: "PUBLISHED",
        prerequisiteModuleIds: [first.id],
      },
      context,
    );
    const secondItem = await createItem(
      faculty,
      {
        offeringId,
        moduleId: second.id,
        title: "Lesson two",
        kind: "RICH_TEXT",
        body: "<p>Two.</p>",
        status: "PUBLISHED",
      },
      null,
      context,
    );
    await publishCourse(faculty, offeringId, context);

    const locked = await getCourseView(student, offeringId);
    const advanced = locked.modules.find((m) => m.id === second.id);
    expect(advanced?.locked).toBe(true);
    expect(advanced?.unmetPrerequisiteTitles).toEqual(["Foundations"]);
    const blocked = await getCourseView(student, offeringId, { itemId: secondItem.id });
    expect(blocked.activeItem).toBeNull();

    await setItemCompleted(student, firstItem.id, true, context);

    const unlocked = await getCourseView(student, offeringId);
    expect(unlocked.modules.find((m) => m.id === second.id)?.locked).toBe(false);
    const allowed = await getCourseView(student, offeringId, { itemId: secondItem.id });
    expect(allowed.activeItem?.id).toBe(secondItem.id);
    expect(allowed.activeItem?.body).toContain("Two.");
  });

  it("keeps module and item ordering across writes", async () => {
    const a = await createModule(
      faculty,
      { offeringId, title: "Alpha", prerequisiteModuleIds: [] },
      context,
    );
    const b = await createModule(
      faculty,
      { offeringId, title: "Beta", prerequisiteModuleIds: [] },
      context,
    );
    await createItem(
      faculty,
      { offeringId, moduleId: a.id, title: "A1", kind: "RICH_TEXT", body: "<p>a</p>" },
      null,
      context,
    );
    const itemB = await createItem(
      faculty,
      { offeringId, moduleId: a.id, title: "A2", kind: "RICH_TEXT", body: "<p>b</p>" },
      null,
      context,
    );

    await moveModule(faculty, { offeringId, moduleId: b.id, direction: "up" }, context);
    let workspace = await getContentWorkspace(faculty, offeringId);
    expect(workspace.modules.map((entry) => entry.title)).toEqual(["Beta", "Alpha"]);

    await moveItem(faculty, { offeringId, itemId: itemB.id, direction: "up" }, context);
    workspace = await getContentWorkspace(faculty, offeringId);
    const moduleA = workspace.modules.find((entry) => entry.id === a.id);
    expect(moduleA?.items.map((item) => item.title)).toEqual(["A2", "A1"]);
    expect(moduleA?.items[0]?.position).toBe(1);
  });

  it("rejects a prerequisite that would create a loop", async () => {
    const first = await createModule(
      faculty,
      { offeringId, title: "First", prerequisiteModuleIds: [] },
      context,
    );
    const second = await createModule(
      faculty,
      { offeringId, title: "Second", prerequisiteModuleIds: [first.id] },
      context,
    );

    await expect(
      updateModule(
        faculty,
        {
          offeringId,
          moduleId: first.id,
          title: "First",
          status: "DRAFT",
          prerequisiteModuleIds: [second.id],
        },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("authorises private file downloads by tenant, enrolment, and publication", async () => {
    const courseModule = await createModule(
      faculty,
      { offeringId, title: "Materials", status: "DRAFT", prerequisiteModuleIds: [] },
      context,
    );
    const fileItem = await createItem(
      faculty,
      {
        offeringId,
        moduleId: courseModule.id,
        title: "Lecture notes",
        kind: "FILE",
        status: "PUBLISHED",
      },
      { fileName: "notes.txt", contentType: "text/plain", data: Buffer.from("private notes") },
      context,
    );
    await publishCourse(faculty, offeringId, context);

    const downloaded = await readItemFile(student, fileItem.id);
    expect(downloaded.data.toString()).toBe("private notes");
    expect(downloaded.fileName).toBe("notes.txt");
    expect(downloaded.contentType).toBe("text/plain");

    // Staff can open their own course material.
    await expect(readItemFile(faculty, fileItem.id)).resolves.toBeDefined();

    // An enrolled learner in another institution is told the file does not exist.
    await expect(readItemFile(southStudent, fileItem.id)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    // A member of this institution who is not enrolled may not read it.
    await expect(readItemFile(unenrolled, fileItem.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );

    // Deleting the item removes the row and the stored object.
    await deleteItem(faculty, { offeringId, itemId: fileItem.id }, context);
    await expect(readItemFile(student, fileItem.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("withholds unpublished courses from learners but lets staff preview them", async () => {
    const courseModule = await createModule(
      faculty,
      { offeringId, title: "Draft module", status: "DRAFT", prerequisiteModuleIds: [] },
      context,
    );
    await createItem(
      faculty,
      {
        offeringId,
        moduleId: courseModule.id,
        title: "Draft lesson",
        kind: "RICH_TEXT",
        body: "<p>Draft.</p>",
        status: "DRAFT",
      },
      null,
      context,
    );

    await expect(getCourseView(student, offeringId)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(await listLearnerCourses(student)).toEqual([]);

    const preview = await getCourseView(faculty, offeringId, { mode: "preview" });
    expect(preview.mode).toBe("preview");
    expect(preview.modules[0]?.items[0]?.title).toBe("Draft lesson");

    await expect(getCourseView(unenrolled, offeringId, { mode: "preview" })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("records progress and learning events once per lesson", async () => {
    const courseModule = await createModule(
      faculty,
      { offeringId, title: "Module", status: "DRAFT", prerequisiteModuleIds: [] },
      context,
    );
    const item = await createItem(
      faculty,
      {
        offeringId,
        moduleId: courseModule.id,
        title: "Lesson",
        kind: "RICH_TEXT",
        body: "<p>Body.</p>",
        status: "PUBLISHED",
      },
      null,
      context,
    );
    await publishCourse(faculty, offeringId, context);

    await recordItemViewed(student, item.id);
    await recordItemViewed(student, item.id);
    await setItemCompleted(student, item.id, true, context);

    const progress = await testDb().contentProgress.findMany({
      where: { contentItemId: item.id, userId: student.user.id },
    });
    expect(progress).toHaveLength(1);
    expect(progress[0]?.status).toBe("COMPLETED");
    expect(progress[0]?.firstViewedAt).toBeInstanceOf(Date);
    expect(progress[0]?.completedAt).toBeInstanceOf(Date);

    const events = await testDb().learningEvent.findMany({
      where: { contentItemId: item.id, userId: student.user.id },
      orderBy: { createdAt: "asc" },
      select: { type: true },
    });
    expect(events.map((event) => event.type)).toEqual([
      "content.viewed",
      "content.viewed",
      "content.completed",
    ]);

    const view = await getCourseView(student, offeringId);
    expect(view.progress).toEqual({ completed: 1, total: 1 });
  });

  it("copies modules and items but never enrolments or learner progress", async () => {
    const sourceModule = await createModule(
      faculty,
      { offeringId, title: "Source module", status: "DRAFT", prerequisiteModuleIds: [] },
      context,
    );
    const sourceItem = await createItem(
      faculty,
      {
        offeringId,
        moduleId: sourceModule.id,
        title: "Source lesson",
        kind: "RICH_TEXT",
        body: "<p>Copy me.</p>",
        status: "PUBLISHED",
      },
      null,
      context,
    );
    await publishCourse(faculty, offeringId, context);
    await setItemCompleted(student, sourceItem.id, true, context);

    const targetOfferingId = await createCourseOffering(admin, "CS102", "Data Structures");
    await addInstructor(
      admin,
      {
        courseOfferingId: targetOfferingId,
        email: `faculty@${north.slug}.example`,
        assignmentRole: "PRIMARY",
      },
      context,
    );

    const result = await copyCourseContent(
      faculty,
      { sourceOfferingId: offeringId, targetOfferingId },
      context,
    );
    expect(result).toEqual({ modules: 1, items: 1 });

    const target = await getContentWorkspace(faculty, targetOfferingId);
    expect(target.modules.map((entry) => entry.title)).toEqual(["Source module"]);
    expect(target.modules[0]?.items.map((item) => item.title)).toEqual(["Source lesson"]);

    const db = testDb();
    expect(await db.enrolment.count({ where: { courseOfferingId: targetOfferingId } })).toBe(0);
    const copiedItems = await db.contentItem.findMany({
      where: { module: { courseOfferingId: targetOfferingId } },
      select: { id: true },
    });
    expect(
      await db.contentProgress.count({
        where: { contentItemId: { in: copiedItems.map((item) => item.id) } },
      }),
    ).toBe(0);

    // Copying twice is refused rather than duplicating content.
    await expect(
      copyCourseContent(faculty, { sourceOfferingId: offeringId, targetOfferingId }, context),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("reports whether the viewer can manage an offering", async () => {
    expect((await getOfferingAccess(faculty, offeringId)).canManage).toBe(true);
    expect((await getOfferingAccess(unenrolled, offeringId)).canManage).toBe(false);
    expect((await getOfferingAccess(admin, offeringId)).canManage).toBe(true);
  });
});
