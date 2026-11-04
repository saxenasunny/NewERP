"use server";

import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import { sendMessage } from "@/modules/communication/message-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function sendMessageAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const recipientUserId = text(formData, "recipientUserId");
  const base = `/student/courses/${offeringId}/messages?with=${encodeURIComponent(recipientUserId)}`;

  const outcome = await attempt(async () =>
    sendMessage(account, offeringId, { recipientUserId, body: text(formData, "body") }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base, "error", outcome.message));
  }
  redirect(withMessage(base, "notice", "Message sent."));
}
