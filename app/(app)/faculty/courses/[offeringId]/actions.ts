"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  copyCourseContent,
  createItem,
  createModule,
  deleteItem,
  deleteModule,
  moveItem,
  moveModule,
  publishCourse,
  unpublishCourse,
  updateItem,
  updateModule,
  type FileUpload,
} from "@/modules/content/content-service";

const PREFIXES = ["/faculty/courses"] as const;

function path(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/faculty/courses");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function prerequisites(formData: FormData): string[] {
  return formData.getAll("prerequisiteModuleIds").map(String).filter(Boolean);
}

async function upload(formData: FormData): Promise<FileUpload | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return {
    fileName: file.name.replace(/[\\/]/g, "-").slice(0, 200),
    contentType: file.type || "application/octet-stream",
    data: Buffer.from(await file.arrayBuffer()),
  };
}

export async function createModuleAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createModule(
      account,
      {
        offeringId: text(formData, "offeringId"),
        title: text(formData, "title"),
        description: text(formData, "description"),
        status: text(formData, "status") || "DRAFT",
        prerequisiteModuleIds: prerequisites(formData),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Module added.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateModuleAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateModule(
      account,
      {
        offeringId: text(formData, "offeringId"),
        moduleId: text(formData, "moduleId"),
        title: text(formData, "title"),
        description: text(formData, "description"),
        status: text(formData, "status") || "DRAFT",
        prerequisiteModuleIds: prerequisites(formData),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Module saved.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function deleteModuleAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    deleteModule(
      account,
      { offeringId: text(formData, "offeringId"), moduleId: text(formData, "moduleId") },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Module deleted.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function moveModuleAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const direction = text(formData, "direction") === "up" ? "up" : "down";

  const outcome = await attempt(async () =>
    moveModule(
      account,
      {
        offeringId: text(formData, "offeringId"),
        moduleId: text(formData, "moduleId"),
        direction,
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(outcome.ok ? returnTo : withMessage(returnTo, "error", outcome.message));
}

export async function createItemAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createItem(
      account,
      {
        offeringId: text(formData, "offeringId"),
        moduleId: text(formData, "moduleId"),
        title: text(formData, "title"),
        kind: text(formData, "kind") || "RICH_TEXT",
        body: text(formData, "body"),
        url: text(formData, "url"),
        availableFrom: text(formData, "availableFrom"),
        availableUntil: text(formData, "availableUntil"),
        status: text(formData, "status") || "DRAFT",
      },
      await upload(formData),
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Item added.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateItemAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateItem(
      account,
      {
        offeringId: text(formData, "offeringId"),
        moduleId: text(formData, "moduleId"),
        itemId: text(formData, "itemId"),
        title: text(formData, "title"),
        kind: text(formData, "kind") || "RICH_TEXT",
        body: text(formData, "body"),
        url: text(formData, "url"),
        availableFrom: text(formData, "availableFrom"),
        availableUntil: text(formData, "availableUntil"),
        status: text(formData, "status") || "DRAFT",
      },
      await upload(formData),
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Item saved.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    deleteItem(
      account,
      { offeringId: text(formData, "offeringId"), itemId: text(formData, "itemId") },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Item deleted.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function moveItemAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const direction = text(formData, "direction") === "up" ? "up" : "down";

  const outcome = await attempt(async () =>
    moveItem(
      account,
      { offeringId: text(formData, "offeringId"), itemId: text(formData, "itemId"), direction },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(outcome.ok ? returnTo : withMessage(returnTo, "error", outcome.message));
}

export async function publishCourseAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    publishCourse(account, text(formData, "offeringId"), { requestId: await currentRequestId() }),
  );

  redirect(
    outcome.ok
      ? withMessage(
          returnTo,
          "notice",
          `Course published: ${outcome.value.modules} module(s) and ${outcome.value.items} item(s) are now visible to enrolled learners.`,
        )
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function unpublishCourseAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    unpublishCourse(account, text(formData, "offeringId"), { requestId: await currentRequestId() }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Course unpublished. Learners can no longer open it.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function copyCourseAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    copyCourseContent(
      account,
      {
        sourceOfferingId: text(formData, "sourceOfferingId"),
        targetOfferingId: text(formData, "offeringId"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(
          returnTo,
          "notice",
          `Copied ${outcome.value.modules} module(s) and ${outcome.value.items} item(s). Enrolments and learner progress were not copied.`,
        )
      : withMessage(returnTo, "error", outcome.message),
  );
}
