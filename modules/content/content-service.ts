import { randomUUID } from "node:crypto";

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import {
  ConflictError,
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";
import { getStorage, StorageObjectNotFoundError } from "@/lib/storage";

import { canAccessOfferingItem } from "./delivery-service";
import { cleanRichText, RICH_TEXT_MAX_LENGTH } from "./rich-text";
import { wouldCreateCycle } from "./visibility";

/**
 * Course authoring: modules and content items for one offering.
 *
 * Authorisation is two-layered. The actor needs a content permission
 * (`content.create` / `content.publish` / `content.delete`), and must be able
 * to manage this particular offering: assigned as an instructor, or an
 * institution administrator (`enrolments.manage` or `courses.update`). Holding
 * a content permission alone never grants access to another teacher's course.
 *
 * Published content is what learners see; drafts stay in the editor. Files are
 * written to private storage, and the database keeps only the key and metadata.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

export type OfferingAccess = {
  offeringId: string;
  tenantId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  academicYearName: string;
  sectionName: string | null;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  startsOn: Date | null;
  endsOn: Date | null;
  isInstructor: boolean;
  canManage: boolean;
  canPublish: boolean;
};

export async function getOfferingAccess(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<OfferingAccess> {
  const tenantId = tenantIdOf(account);
  const offering = await db.courseOffering.findFirst({
    where: { id: offeringId, tenantId },
    select: {
      id: true,
      courseId: true,
      status: true,
      startsOn: true,
      endsOn: true,
      course: { select: { code: true, title: true } },
      term: { select: { name: true, academicYear: { select: { name: true } } } },
      section: { select: { name: true } },
      instructors: { select: { userId: true } },
    },
  });
  if (!offering) throw new ResourceNotFoundError();

  const isInstructor = offering.instructors.some(
    (instructor) => instructor.userId === account.user.id,
  );
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");

  return {
    offeringId: offering.id,
    tenantId,
    courseId: offering.courseId,
    courseCode: offering.course.code,
    courseTitle: offering.course.title,
    termName: offering.term.name,
    academicYearName: offering.term.academicYear.name,
    sectionName: offering.section?.name ?? null,
    status: offering.status,
    startsOn: offering.startsOn,
    endsOn: offering.endsOn,
    isInstructor,
    canManage: isInstructor || isAdministrator,
    canPublish: isInstructor || isAdministrator,
  };
}

/** Access check used by every authoring mutation. */
async function requireOfferingManagement(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient,
): Promise<OfferingAccess> {
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }
  return access;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const titleSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(160, "Use at most 160 characters.");

const optionalText = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().trim().max(2000).optional(),
);

const optionalDateTime = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Use a valid date and time.")
    .transform((value) => new Date(value))
    .optional(),
);

const urlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an http(s) link.");

export const moduleInputSchema = z.object({
  offeringId: z.string().min(1),
  moduleId: z.string().min(1).optional(),
  title: titleSchema,
  description: optionalText,
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  prerequisiteModuleIds: z.array(z.string().min(1)).max(10).default([]),
});

export const itemInputSchema = z
  .object({
    offeringId: z.string().min(1),
    moduleId: z.string().min(1),
    itemId: z.string().min(1).optional(),
    title: titleSchema,
    kind: z.enum(["RICH_TEXT", "FILE", "LINK", "VIDEO_LINK"]),
    body: z.string().max(RICH_TEXT_MAX_LENGTH, "Keep the text under 40,000 characters.").optional(),
    url: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value === "" ? undefined : value))
      .refine((value) => value === undefined || urlSchema.safeParse(value).success, {
        message: "Use an http(s) link.",
      }),
    availableFrom: optionalDateTime,
    availableUntil: optionalDateTime,
    status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  })
  .superRefine((value, context) => {
    if (value.availableFrom && value.availableUntil && value.availableFrom > value.availableUntil) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["availableUntil"],
        message: "The closing time must be after the opening time.",
      });
    }
    if (value.kind === "RICH_TEXT" && !cleanRichText(value.body)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: "Add the lesson text.",
      });
    }
    if ((value.kind === "LINK" || value.kind === "VIDEO_LINK") && !value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Add the link learners should open.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type AuthoringItem = {
  id: string;
  title: string;
  kind: "RICH_TEXT" | "FILE" | "LINK" | "VIDEO_LINK";
  body: string | null;
  url: string | null;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  hasFile: boolean;
  position: number;
  status: "DRAFT" | "PUBLISHED";
  availableFrom: Date | null;
  availableUntil: Date | null;
};

export type AuthoringModule = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  status: "DRAFT" | "PUBLISHED";
  prerequisiteModuleIds: string[];
  items: AuthoringItem[];
};

export type ContentWorkspace = {
  access: OfferingAccess;
  modules: AuthoringModule[];
  counts: { modules: number; items: number; publishedItems: number; files: number };
};

export async function getContentWorkspace(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<ContentWorkspace> {
  requirePermission(account, "courses.read");
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  const modules = await db.courseModule.findMany({
    where: { offering: { id: offeringId, tenantId: access.tenantId } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      position: true,
      status: true,
      prerequisites: { select: { prerequisiteModuleId: true } },
      items: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          kind: true,
          body: true,
          url: true,
          fileName: true,
          fileSize: true,
          contentType: true,
          storageKey: true,
          position: true,
          status: true,
          availableFrom: true,
          availableUntil: true,
        },
      },
    },
  });

  const mapped: AuthoringModule[] = modules.map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    position: module.position,
    status: module.status,
    prerequisiteModuleIds: module.prerequisites.map(
      (prerequisite) => prerequisite.prerequisiteModuleId,
    ),
    items: module.items.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      body: item.body,
      url: item.url,
      fileName: item.fileName,
      fileSize: item.fileSize,
      contentType: item.contentType,
      hasFile: Boolean(item.storageKey),
      position: item.position,
      status: item.status,
      availableFrom: item.availableFrom,
      availableUntil: item.availableUntil,
    })),
  }));

  return {
    access,
    modules: mapped,
    counts: {
      modules: mapped.length,
      items: mapped.reduce((total, module) => total + module.items.length, 0),
      publishedItems: mapped.reduce(
        (total, module) =>
          total + module.items.filter((item) => item.status === "PUBLISHED").length,
        0,
      ),
      files: mapped.reduce(
        (total, module) => total + module.items.filter((item) => item.hasFile).length,
        0,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PositionDb = Pick<DatabaseClient, "courseModule" | "contentItem">;

async function nextPosition(
  db: PositionDb,
  model: "module" | "item",
  parentId: string,
): Promise<number> {
  const last =
    model === "module"
      ? await db.courseModule.findFirst({
          where: { courseOfferingId: parentId },
          orderBy: { position: "desc" },
          select: { position: true },
        })
      : await db.contentItem.findFirst({
          where: { moduleId: parentId },
          orderBy: { position: "desc" },
          select: { position: true },
        });
  return (last?.position ?? 0) + 1;
}

async function assertModuleInOffering(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
  moduleId: string,
): Promise<void> {
  const courseModule = await db.courseModule.findFirst({
    where: { id: moduleId, tenantId, courseOfferingId: offeringId },
    select: { id: true },
  });
  if (!courseModule) throw new ResourceNotFoundError("That module does not belong to this course.");
}

/** Rejects prerequisite edges that would loop or cross offerings. */
async function validatePrerequisites(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
  moduleId: string | null,
  prerequisiteIds: string[],
): Promise<string[]> {
  const unique = [...new Set(prerequisiteIds)];
  if (unique.length === 0) return [];

  const found = await db.courseModule.findMany({
    where: { id: { in: unique }, tenantId, courseOfferingId: offeringId },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new ResourceNotFoundError("A prerequisite module does not belong to this course.");
  }
  if (!moduleId) return unique;

  // Existing edges within this offering, then check each proposed edge.
  const existing = await db.modulePrerequisite.findMany({
    where: { tenantId, module: { courseOfferingId: offeringId } },
    select: { moduleId: true, prerequisiteModuleId: true },
  });
  const edges = new Map<string, string[]>();
  for (const edge of existing) {
    edges.set(edge.moduleId, [...(edges.get(edge.moduleId) ?? []), edge.prerequisiteModuleId]);
  }

  for (const prerequisiteId of unique) {
    if (wouldCreateCycle(edges, moduleId, prerequisiteId)) {
      throw new ConflictError("Those requirements would create a loop between modules.");
    }
    edges.set(moduleId, [...(edges.get(moduleId) ?? []), prerequisiteId]);
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export async function createModule(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "content.create");
  const parsed = moduleInputSchema.parse(input);
  const access = await requireOfferingManagement(account, parsed.offeringId, db);
  const prerequisites = await validatePrerequisites(
    db,
    access.tenantId,
    access.offeringId,
    null,
    parsed.prerequisiteModuleIds,
  );

  return db.$transaction(async (tx) => {
    const created = await tx.courseModule.create({
      data: {
        tenantId: access.tenantId,
        courseOfferingId: access.offeringId,
        title: parsed.title,
        description: parsed.description ?? null,
        status: parsed.status,
        position: await nextPosition(tx, "module", access.offeringId),
        prerequisites: {
          create: prerequisites.map((prerequisiteModuleId) => ({
            tenantId: access.tenantId,
            prerequisiteModuleId,
          })),
        },
      },
      select: { id: true },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.module_created",
      resourceType: "course_module",
      resourceId: created.id,
      after: { offeringId: access.offeringId, title: parsed.title, status: parsed.status },
      requestId: context.requestId,
    });
    return created;
  });
}

export async function updateModule(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "content.create");
  const parsed = moduleInputSchema.parse(input);
  if (!parsed.moduleId) throw new ResourceNotFoundError();
  const access = await requireOfferingManagement(account, parsed.offeringId, db);

  const existing = await db.courseModule.findFirst({
    where: { id: parsed.moduleId, tenantId: access.tenantId, courseOfferingId: access.offeringId },
    select: { id: true, title: true, status: true, description: true },
  });
  if (!existing) throw new ResourceNotFoundError();

  const prerequisites = await validatePrerequisites(
    db,
    access.tenantId,
    access.offeringId,
    existing.id,
    parsed.prerequisiteModuleIds,
  );

  await db.$transaction(async (tx) => {
    await tx.courseModule.update({
      where: { id: existing.id },
      data: {
        title: parsed.title,
        description: parsed.description ?? null,
        status: parsed.status,
        prerequisites: {
          deleteMany: {},
          create: prerequisites.map((prerequisiteModuleId) => ({
            tenantId: access.tenantId,
            prerequisiteModuleId,
          })),
        },
      },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.module_updated",
      resourceType: "course_module",
      resourceId: existing.id,
      before: { title: existing.title, status: existing.status },
      after: { title: parsed.title, status: parsed.status, prerequisites },
      requestId: context.requestId,
    });
  });
}

export async function deleteModule(
  account: AccountContext,
  input: { offeringId: string; moduleId: string },
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "content.delete");
  const access = await requireOfferingManagement(account, input.offeringId, db);

  const courseModule = await db.courseModule.findFirst({
    where: { id: input.moduleId, tenantId: access.tenantId, courseOfferingId: access.offeringId },
    select: { id: true, title: true, items: { select: { storageKey: true } } },
  });
  if (!courseModule) throw new ResourceNotFoundError();

  await db.$transaction(async (tx) => {
    await tx.modulePrerequisite.deleteMany({
      where: {
        tenantId: access.tenantId,
        OR: [{ moduleId: courseModule.id }, { prerequisiteModuleId: courseModule.id }],
      },
    });
    await tx.courseModule.delete({ where: { id: courseModule.id } });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.module_deleted",
      resourceType: "course_module",
      resourceId: courseModule.id,
      before: { title: courseModule.title },
      requestId: context.requestId,
    });
  });

  await deleteStoredFiles(
    courseModule.items.map((item) => item.storageKey).filter(Boolean) as string[],
  );
}

export async function moveModule(
  account: AccountContext,
  input: { offeringId: string; moduleId: string; direction: "up" | "down" },
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "content.create");
  const access = await requireOfferingManagement(account, input.offeringId, db);

  const siblings = await db.courseModule.findMany({
    where: { tenantId: access.tenantId, courseOfferingId: access.offeringId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, position: true },
  });
  const index = siblings.findIndex((candidate) => candidate.id === input.moduleId);
  if (index === -1) throw new ResourceNotFoundError();

  const neighbourIndex = input.direction === "up" ? index - 1 : index + 1;
  const neighbour = siblings[neighbourIndex];
  if (!neighbour) return;

  const current = siblings[index]!;
  await db.$transaction(async (tx) => {
    await tx.courseModule.update({
      where: { id: current.id },
      data: { position: neighbour.position },
    });
    await tx.courseModule.update({
      where: { id: neighbour.id },
      data: { position: current.position },
    });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.module_reordered",
      resourceType: "course_module",
      resourceId: current.id,
      after: { direction: input.direction },
      requestId: context.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// Content items
// ---------------------------------------------------------------------------

export type FileUpload = {
  fileName: string;
  contentType: string;
  data: Buffer;
};

function storageKeyFor(tenantId: string, offeringId: string): string {
  return `tenants/${tenantId}/offerings/${offeringId}/items/${randomUUID()}`;
}

function assertUpload(file: FileUpload): void {
  if (file.data.byteLength === 0) throw new ConflictError("That file is empty.");
  if (file.data.byteLength > MAX_FILE_BYTES) {
    throw new ConflictError("Files must be 25 MB or smaller.");
  }
}

async function deleteStoredFiles(keys: readonly string[]): Promise<void> {
  const storage = getStorage();
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
      } catch {
        // A failed cleanup must not fail the database change; the row is gone
        // either way and the object is unreachable without its key.
      }
    }),
  );
}

export async function createItem(
  account: AccountContext,
  input: unknown,
  file: FileUpload | null,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "content.create");
  const parsed = itemInputSchema.parse(input);
  const access = await requireOfferingManagement(account, parsed.offeringId, db);
  await assertModuleInOffering(db, access.tenantId, access.offeringId, parsed.moduleId);

  if (parsed.kind === "FILE") {
    if (!file) throw new ConflictError("Choose a file to upload.");
    assertUpload(file);
  }

  let storageKey: string | null = null;
  if (parsed.kind === "FILE" && file) {
    storageKey = storageKeyFor(access.tenantId, access.offeringId);
    await getStorage().put(storageKey, file.data);
  }

  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.contentItem.create({
        data: {
          tenantId: access.tenantId,
          moduleId: parsed.moduleId,
          title: parsed.title,
          kind: parsed.kind,
          body: parsed.kind === "RICH_TEXT" ? cleanRichText(parsed.body ?? "") : null,
          url: parsed.kind === "LINK" || parsed.kind === "VIDEO_LINK" ? (parsed.url ?? null) : null,
          storageKey,
          fileName: parsed.kind === "FILE" ? (file?.fileName ?? null) : null,
          fileSize: parsed.kind === "FILE" ? (file?.data.byteLength ?? null) : null,
          contentType: parsed.kind === "FILE" ? (file?.contentType ?? null) : null,
          status: parsed.status,
          availableFrom: parsed.availableFrom ?? null,
          availableUntil: parsed.availableUntil ?? null,
          position: await nextPosition(tx, "item", parsed.moduleId),
        },
        select: { id: true },
      });

      await recordAuditEvent(tx, {
        tenantId: access.tenantId,
        actorUserId: account.user.id,
        action: "content.item_created",
        resourceType: "content_item",
        resourceId: created.id,
        after: {
          offeringId: access.offeringId,
          moduleId: parsed.moduleId,
          kind: parsed.kind,
          status: parsed.status,
        },
        requestId: context.requestId,
      });
      return created;
    });
  } catch (error) {
    if (storageKey) await deleteStoredFiles([storageKey]);
    throw error;
  }
}

export async function updateItem(
  account: AccountContext,
  input: unknown,
  file: FileUpload | null,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "content.create");
  const parsed = itemInputSchema.parse(input);
  if (!parsed.itemId) throw new ResourceNotFoundError();
  const access = await requireOfferingManagement(account, parsed.offeringId, db);

  const existing = await db.contentItem.findFirst({
    where: { id: parsed.itemId, tenantId: access.tenantId, moduleId: parsed.moduleId },
    select: {
      id: true,
      kind: true,
      storageKey: true,
      fileName: true,
      status: true,
      module: { select: { courseOfferingId: true } },
    },
  });
  if (!existing || existing.module.courseOfferingId !== access.offeringId) {
    throw new ResourceNotFoundError();
  }

  if (parsed.kind === "FILE" && !file && existing.kind !== "FILE") {
    throw new ConflictError("Choose a file to upload.");
  }
  if (parsed.kind === "FILE" && !file && !existing.storageKey) {
    throw new ConflictError("Choose a file to upload.");
  }
  if (file) assertUpload(file);

  const replacingFile = parsed.kind === "FILE" && Boolean(file);
  const newStorageKey = replacingFile ? storageKeyFor(access.tenantId, access.offeringId) : null;
  if (newStorageKey && file) await getStorage().put(newStorageKey, file.data);

  try {
    await db.$transaction(async (tx) => {
      await tx.contentItem.update({
        where: { id: existing.id },
        data: {
          title: parsed.title,
          kind: parsed.kind,
          body: parsed.kind === "RICH_TEXT" ? cleanRichText(parsed.body ?? "") : null,
          url: parsed.kind === "LINK" || parsed.kind === "VIDEO_LINK" ? (parsed.url ?? null) : null,
          status: parsed.status,
          availableFrom: parsed.availableFrom ?? null,
          availableUntil: parsed.availableUntil ?? null,
          ...(replacingFile && file
            ? {
                storageKey: newStorageKey,
                fileName: file.fileName,
                fileSize: file.data.byteLength,
                contentType: file.contentType,
              }
            : {}),
        },
      });

      await recordAuditEvent(tx, {
        tenantId: access.tenantId,
        actorUserId: account.user.id,
        action: "content.item_updated",
        resourceType: "content_item",
        resourceId: existing.id,
        before: { status: existing.status, kind: existing.kind },
        after: { status: parsed.status, kind: parsed.kind },
        requestId: context.requestId,
      });
    });
  } catch (error) {
    if (newStorageKey) await deleteStoredFiles([newStorageKey]);
    throw error;
  }

  if (replacingFile && existing.storageKey) await deleteStoredFiles([existing.storageKey]);
}

export async function deleteItem(
  account: AccountContext,
  input: { offeringId: string; itemId: string },
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "content.delete");
  const access = await requireOfferingManagement(account, input.offeringId, db);

  const item = await db.contentItem.findFirst({
    where: {
      id: input.itemId,
      tenantId: access.tenantId,
      module: { courseOfferingId: access.offeringId },
    },
    select: { id: true, title: true, storageKey: true },
  });
  if (!item) throw new ResourceNotFoundError();

  await db.$transaction(async (tx) => {
    await tx.contentItem.delete({ where: { id: item.id } });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.item_deleted",
      resourceType: "content_item",
      resourceId: item.id,
      before: { title: item.title },
      requestId: context.requestId,
    });
  });

  if (item.storageKey) await deleteStoredFiles([item.storageKey]);
}

export async function moveItem(
  account: AccountContext,
  input: { offeringId: string; itemId: string; direction: "up" | "down" },
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "content.create");
  const access = await requireOfferingManagement(account, input.offeringId, db);

  const item = await db.contentItem.findFirst({
    where: {
      id: input.itemId,
      tenantId: access.tenantId,
      module: { courseOfferingId: access.offeringId },
    },
    select: { id: true, moduleId: true },
  });
  if (!item) throw new ResourceNotFoundError();

  const siblings = await db.contentItem.findMany({
    where: { tenantId: access.tenantId, moduleId: item.moduleId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, position: true },
  });
  const index = siblings.findIndex((sibling) => sibling.id === item.id);
  if (index === -1) throw new ResourceNotFoundError();

  const neighbour = siblings[input.direction === "up" ? index - 1 : index + 1];
  if (!neighbour) return;
  const current = siblings[index]!;

  await db.$transaction(async (tx) => {
    await tx.contentItem.update({
      where: { id: current.id },
      data: { position: neighbour.position },
    });
    await tx.contentItem.update({
      where: { id: neighbour.id },
      data: { position: current.position },
    });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.item_reordered",
      resourceType: "content_item",
      resourceId: current.id,
      after: { direction: input.direction },
      requestId: context.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// Publishing and copying
// ---------------------------------------------------------------------------

export type PublishSummary = { modules: number; items: number };

/**
 * Publishes the whole course delivery: the offering itself, every module, and
 * every item. Authorised for an assigned instructor with `content.publish`, so
 * teaching staff can release a course without an administrator editing rows.
 */
export async function publishCourse(
  account: AccountContext,
  offeringId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<PublishSummary> {
  requirePermission(account, "content.publish");
  const access = await requireOfferingManagement(account, offeringId, db);

  const counts = await db.$transaction(async (tx) => {
    const modules = await tx.courseModule.findMany({
      where: { tenantId: access.tenantId, courseOfferingId: access.offeringId },
      select: { id: true },
    });
    await tx.contentItem.updateMany({
      where: { tenantId: access.tenantId, moduleId: { in: modules.map((module) => module.id) } },
      data: { status: "PUBLISHED" },
    });
    await tx.courseModule.updateMany({
      where: { tenantId: access.tenantId, courseOfferingId: access.offeringId },
      data: { status: "PUBLISHED" },
    });
    await tx.courseOffering.update({
      where: { id: access.offeringId },
      data: { status: "PUBLISHED" },
    });
    const items = await tx.contentItem.count({
      where: { tenantId: access.tenantId, moduleId: { in: modules.map((module) => module.id) } },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.course_published",
      resourceType: "course_offering",
      resourceId: access.offeringId,
      before: { offeringStatus: access.status },
      after: { modules: modules.length, items },
      requestId: context.requestId,
    });
    return { modules: modules.length, items };
  });

  return counts;
}

/** Unpublishes the offering without touching the content, so learners lose access. */
export async function unpublishCourse(
  account: AccountContext,
  offeringId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "content.publish");
  const access = await requireOfferingManagement(account, offeringId, db);

  await db.$transaction(async (tx) => {
    await tx.courseOffering.update({
      where: { id: access.offeringId },
      data: { status: "DRAFT" },
    });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "content.course_unpublished",
      resourceType: "course_offering",
      resourceId: access.offeringId,
      before: { offeringStatus: access.status },
      after: { offeringStatus: "DRAFT" },
      requestId: context.requestId,
    });
  });
}

/**
 * Copies modules, items, prerequisites, and file objects from one offering to
 * another in the same institution. It deliberately copies nothing else:
 * enrolments, instructors, progress, and (later) grades/submissions stay with
 * the original delivery.
 */
export async function copyCourseContent(
  account: AccountContext,
  input: { sourceOfferingId: string; targetOfferingId: string },
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ modules: number; items: number }> {
  requirePermission(account, "content.create");
  if (input.sourceOfferingId === input.targetOfferingId) {
    throw new ConflictError("Choose a different course to copy into.");
  }
  const source = await requireOfferingManagement(account, input.sourceOfferingId, db);
  const target = await requireOfferingManagement(account, input.targetOfferingId, db);

  const existing = await db.courseModule.count({
    where: { tenantId: target.tenantId, courseOfferingId: target.offeringId },
  });
  if (existing > 0) {
    throw new ConflictError("The target course already has content. Copy into an empty course.");
  }

  const modules = await db.courseModule.findMany({
    where: { tenantId: source.tenantId, courseOfferingId: source.offeringId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      position: true,
      status: true,
      prerequisites: { select: { prerequisiteModuleId: true } },
      items: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          title: true,
          kind: true,
          body: true,
          url: true,
          storageKey: true,
          fileName: true,
          fileSize: true,
          contentType: true,
          position: true,
          status: true,
          availableFrom: true,
          availableUntil: true,
        },
      },
    },
  });

  const storage = getStorage();
  const copiedKeys: string[] = [];

  try {
    return await db.$transaction(async (tx) => {
      const idMap = new Map<string, string>();
      let itemCount = 0;

      for (const sourceModule of modules) {
        const created = await tx.courseModule.create({
          data: {
            tenantId: target.tenantId,
            courseOfferingId: target.offeringId,
            title: sourceModule.title,
            description: sourceModule.description,
            position: sourceModule.position,
            status: sourceModule.status,
          },
          select: { id: true },
        });
        idMap.set(sourceModule.id, created.id);

        for (const item of sourceModule.items) {
          let storageKey: string | null = null;
          if (item.storageKey) {
            storageKey = storageKeyFor(target.tenantId, target.offeringId);
            await storage.copy(item.storageKey, storageKey);
            copiedKeys.push(storageKey);
          }
          await tx.contentItem.create({
            data: {
              tenantId: target.tenantId,
              moduleId: created.id,
              title: item.title,
              kind: item.kind,
              body: item.body,
              url: item.url,
              storageKey,
              fileName: item.fileName,
              fileSize: item.fileSize,
              contentType: item.contentType,
              position: item.position,
              status: item.status,
              availableFrom: item.availableFrom,
              availableUntil: item.availableUntil,
            },
          });
          itemCount += 1;
        }
      }

      // Edges only make sense once both endpoints exist; the map covers that.
      for (const sourceModule of modules) {
        const targetModuleId = idMap.get(sourceModule.id);
        if (!targetModuleId) continue;
        const prerequisiteIds = sourceModule.prerequisites
          .map((prerequisite) => idMap.get(prerequisite.prerequisiteModuleId))
          .filter((id): id is string => Boolean(id));
        if (prerequisiteIds.length === 0) continue;
        await tx.modulePrerequisite.createMany({
          data: prerequisiteIds.map((prerequisiteModuleId) => ({
            tenantId: target.tenantId,
            moduleId: targetModuleId,
            prerequisiteModuleId,
          })),
        });
      }

      await recordAuditEvent(tx, {
        tenantId: target.tenantId,
        actorUserId: account.user.id,
        action: "content.course_copied",
        resourceType: "course_offering",
        resourceId: target.offeringId,
        after: {
          sourceOfferingId: source.offeringId,
          modules: modules.length,
          items: itemCount,
        },
        requestId: context.requestId,
      });

      return { modules: modules.length, items: itemCount };
    });
  } catch (error) {
    await deleteStoredFiles(copiedKeys);
    throw error;
  }
}

export type ManagedCourse = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  academicYearName: string;
  sectionName: string | null;
  offeringStatus: "DRAFT" | "PUBLISHED" | "CLOSED";
  moduleCount: number;
  itemCount: number;
  learnerCount: number;
};

/**
 * Courses the signed-in teacher can author: offerings they are assigned to, and
 * every offering in the institution for administrators.
 */
export async function listManagedCourses(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<ManagedCourse[]> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");

  const offerings = await db.courseOffering.findMany({
    where: {
      tenantId,
      ...(isAdministrator ? {} : { instructors: { some: { userId: account.user.id } } }),
    },
    orderBy: [{ term: { startsOn: "desc" } }, { course: { code: "asc" } }],
    select: {
      id: true,
      status: true,
      course: { select: { code: true, title: true } },
      term: { select: { name: true, academicYear: { select: { name: true } } } },
      section: { select: { name: true } },
      _count: { select: { enrolments: { where: { status: "ACTIVE" } } } },
      modules: {
        select: { status: true, _count: { select: { items: true } } },
      },
    },
  });

  return offerings.map((offering) => {
    const itemCount = offering.modules.reduce((total, module) => total + module._count.items, 0);
    return {
      offeringId: offering.id,
      courseCode: offering.course.code,
      courseTitle: offering.course.title,
      termName: offering.term.name,
      academicYearName: offering.term.academicYear.name,
      sectionName: offering.section?.name ?? null,
      offeringStatus: offering.status,
      moduleCount: offering.modules.length,
      itemCount,
      learnerCount: offering._count.enrolments,
    };
  });
}

/** Storage access for the authorised download route. */
export async function readItemFile(
  account: AccountContext,
  itemId: string,
  db: DatabaseClient = getDb(),
): Promise<{ fileName: string; contentType: string; data: Buffer }> {
  const tenantId = tenantIdOf(account);
  const item = await db.contentItem.findFirst({
    where: { id: itemId, tenantId },
    select: {
      id: true,
      kind: true,
      storageKey: true,
      fileName: true,
      contentType: true,
      status: true,
      module: { select: { courseOfferingId: true } },
    },
  });
  if (!item || item.kind !== "FILE" || !item.storageKey) throw new ResourceNotFoundError();

  const allowed = await canAccessOfferingItem(account, item.module.courseOfferingId, item.id, db);
  if (!allowed) throw new PermissionDeniedError("You cannot open this file.");

  try {
    const data = await getStorage().get(item.storageKey);
    return {
      fileName: item.fileName ?? "course-material",
      contentType: item.contentType ?? "application/octet-stream",
      data,
    };
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new ResourceNotFoundError("The stored file is missing.");
    }
    throw error;
  }
}
