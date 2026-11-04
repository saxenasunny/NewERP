"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  saveSubmissionDraft,
  submitAssignment,
  type SubmissionFile,
} from "@/modules/assignments/submission-service";

const PREFIXES = ["/student/assignments", "/student/courses"] as const;

function path(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/student/assignments");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

async function upload(formData: FormData): Promise<SubmissionFile | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return {
    fileName: file.name.replace(/[\\/]/g, "-").slice(0, 200),
    contentType: file.type || "application/octet-stream",
    data: Buffer.from(await file.arrayBuffer()),
  };
}

function inputFrom(formData: FormData) {
  return { assignmentId: text(formData, "assignmentId"), body: text(formData, "body") };
}

export async function saveDraftAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    saveSubmissionDraft(account, inputFrom(formData), await upload(formData), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Draft saved. Submit when you are ready.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function submitAssignmentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    submitAssignment(account, inputFrom(formData), await upload(formData), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(
          returnTo,
          "notice",
          outcome.value.created
            ? `Submitted${outcome.value.late ? " late" : ""}. Your receipt is below.`
            : "This submission was already recorded. Nothing was duplicated.",
        )
      : withMessage(returnTo, "error", outcome.message),
  );
}
