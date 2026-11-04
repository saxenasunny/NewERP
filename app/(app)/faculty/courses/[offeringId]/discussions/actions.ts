"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import {
  createThread,
  replyToThread,
  setPostStatus,
  setThreadPinned,
  setThreadStatus,
  type ThreadStatusKey,
} from "@/modules/communication/discussion-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function base(offeringId: string): string {
  return `/faculty/courses/${offeringId}/discussions`;
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
  redirect(withMessage(`${base(offeringId)}/${outcome.value.id}`, "notice", "Thread started."));
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

export async function moderateThreadAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const threadId = text(formData, "threadId");
  const intent = text(formData, "intent");

  const outcome = await attempt(async () => {
    const requestId = await currentRequestId();
    if (intent === "pin") await setThreadPinned(account, threadId, true, { requestId });
    else if (intent === "unpin") await setThreadPinned(account, threadId, false, { requestId });
    else {
      const status: ThreadStatusKey =
        intent === "lock" ? "locked" : intent === "hide" ? "hidden" : "open";
      await setThreadStatus(account, threadId, status, { requestId });
    }
  });

  const returnTo = `${base(offeringId)}/${threadId}`;
  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }
  redirect(withMessage(returnTo, "notice", "Discussion updated."));
}

export async function moderatePostAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const threadId = text(formData, "threadId");
  const postId = text(formData, "postId");
  const intent = text(formData, "intent");

  const outcome = await attempt(async () =>
    setPostStatus(account, postId, intent === "hide" ? "hidden" : "visible", {
      requestId: await currentRequestId(),
    }),
  );

  const returnTo = `${base(offeringId)}/${threadId}`;
  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }
  redirect(withMessage(returnTo, "notice", "Reply updated."));
}
