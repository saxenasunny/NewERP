"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import { createThread, replyToThread } from "@/modules/communication/discussion-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function base(offeringId: string): string {
  return `/student/courses/${offeringId}/discussions`;
}

export async function createThreadAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    createThread(
      account,
      offeringId,
      { title: text(formData, "title"), body: text(formData, "body") },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(withMessage(`${base(offeringId)}/${outcome.value.id}`, "notice", "Thread posted."));
}

export async function replyAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const threadId = text(formData, "threadId");

  const outcome = await attempt(async () =>
    replyToThread(
      account,
      threadId,
      { body: text(formData, "body") },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(`${base(offeringId)}/${threadId}`, "error", outcome.message));
  }
  redirect(withMessage(`${base(offeringId)}/${threadId}`, "notice", "Reply posted."));
}
