"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import {
  createAnnouncement,
  publishAnnouncement,
  updateAnnouncement,
  withdrawAnnouncement,
} from "@/modules/communication/announcement-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function base(offeringId: string): string {
  return `/faculty/courses/${offeringId}/announcements`;
}

function announcementInput(formData: FormData) {
  return {
    title: text(formData, "title"),
    body: text(formData, "body"),
    pinned: formData.get("pinned") === "on",
  };
}

export async function createAnnouncementAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const publish = text(formData, "intent") === "publish";

  const outcome = await attempt(async () =>
    createAnnouncement(account, offeringId, announcementInput(formData), {
      publish,
      requestId: await currentRequestId(),
    }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(
    withMessage(
      base(offeringId),
      "notice",
      publish ? "Announcement published and the cohort notified." : "Draft saved.",
    ),
  );
}

export async function updateAnnouncementAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const announcementId = text(formData, "announcementId");

  const outcome = await attempt(async () =>
    updateAnnouncement(account, announcementId, announcementInput(formData), {
      requestId: await currentRequestId(),
    }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(withMessage(base(offeringId), "notice", "Announcement updated."));
}

export async function publishAnnouncementAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const announcementId = text(formData, "announcementId");

  const outcome = await attempt(async () =>
    publishAnnouncement(account, announcementId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(
    withMessage(
      base(offeringId),
      "notice",
      `Announcement published; ${outcome.value.notified} learner(s) notified.`,
    ),
  );
}

export async function withdrawAnnouncementAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const announcementId = text(formData, "announcementId");

  const outcome = await attempt(async () =>
    withdrawAnnouncement(account, announcementId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(withMessage(base(offeringId), "notice", "Announcement withdrawn from the cohort."));
}
