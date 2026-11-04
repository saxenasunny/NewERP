"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import { createCourse, setCourseStatus, updateCourse } from "@/modules/academics/course-service";

const PREFIXES = ["/admin/courses"] as const;

function path(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/admin/courses");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function createCourseAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createCourse(
      account,
      {
        code: text(formData, "code"),
        title: text(formData, "title"),
        description: text(formData, "description"),
        credits: text(formData, "credits"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Course added to the catalogue.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateCourseAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateCourse(
      account,
      text(formData, "id"),
      {
        code: text(formData, "code"),
        title: text(formData, "title"),
        description: text(formData, "description"),
        credits: text(formData, "credits"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Course updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function setCourseStatusAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const status = text(formData, "status");

  const outcome = await attempt(async () =>
    setCourseStatus(account, text(formData, "id"), status as "DRAFT" | "ACTIVE" | "ARCHIVED", {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", `Course marked ${status.toLowerCase()}.`)
      : withMessage(returnTo, "error", outcome.message),
  );
}
