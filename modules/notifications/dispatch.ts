/**
 * Notification dispatch — Phase 9.
 *
 * One call describes a logical event: who should hear about it, which template
 * renders it, and the dedupe key that identifies it. This module applies each
 * recipient's channel preferences, writes the in-app notices, queues the emails,
 * and attempts the queue immediately so a healthy transport delivers in the same
 * request. Anything the transport refuses stays queued for retry.
 *
 * Preferences are read per recipient and category. A missing row means "on" in
 * both channels, so people who never opened the settings page get everything.
 */

import { after } from "next/server";

import type { DatabaseClient } from "@/lib/db/client";

import {
  createNotifications,
  toNotificationCategory,
  type NotificationCategoryKey,
} from "./notification-service";
import { enqueueDeliveries, processDeliveryQueue } from "./delivery-queue";
import { renderNotification, type NotificationTemplateKey } from "./templates";

export type NotificationRecipient = { userId: string; name: string; email: string };

export type NotifyInput = {
  tenantId: string;
  category: NotificationCategoryKey;
  template: NotificationTemplateKey;
  recipients: NotificationRecipient[];
  /** Template fields except `recipientName`, which is filled in per recipient. */
  payload: Record<string, unknown> & { href: string };
  dedupeKey: string;
  /** Set false for personal content that should stay inside the app. */
  email?: boolean;
};

export type NotifyResult = {
  /** Recipients who received a new in-app notice (already deduped). */
  inApp: string[];
  /** Recipients whose email is now queued or was already sent. */
  emailed: string[];
};

export async function notify(db: DatabaseClient, input: NotifyInput): Promise<NotifyResult> {
  const recipients = dedupeRecipients(input.recipients);
  if (recipients.length === 0) return { inApp: [], emailed: [] };

  const category = toNotificationCategory(input.category);
  const preferences = await db.notificationPreference.findMany({
    where: {
      tenantId: input.tenantId,
      category,
      userId: { in: recipients.map((recipient) => recipient.userId) },
    },
    select: { userId: true, inApp: true, email: true },
  });
  const byUser = new Map(preferences.map((row) => [row.userId, row]));

  const inAppEnabled = recipients.filter(
    (recipient) => byUser.get(recipient.userId)?.inApp !== false,
  );
  const emailEnabled =
    input.email === false
      ? []
      : recipients.filter((recipient) => byUser.get(recipient.userId)?.email !== false);

  let inApp: string[] = [];
  if (inAppEnabled.length > 0) {
    const rendered = renderForInApp(input);
    inApp = await createNotifications(db, {
      tenantId: input.tenantId,
      userIds: inAppEnabled.map((recipient) => recipient.userId),
      category: input.category,
      title: rendered.title,
      body: rendered.body,
      href: input.payload.href,
      dedupeKey: input.dedupeKey,
    });
  }

  if (emailEnabled.length === 0) return { inApp, emailed: [] };

  const deliveryIds = await enqueueDeliveries(
    db,
    emailEnabled.map((recipient) => ({
      tenantId: input.tenantId,
      userId: recipient.userId,
      category,
      template: input.template,
      payload: { ...input.payload, recipientName: recipient.name },
      dedupeKey: input.dedupeKey,
    })),
  );

  if (deliveryIds.length > 0) {
    try {
      after(async () => {
        await processDeliveryQueue({ deliveryIds }, db);
      });
    } catch {
      await processDeliveryQueue({ deliveryIds }, db);
    }
  }

  return { inApp, emailed: emailEnabled.map((recipient) => recipient.userId) };
}

function dedupeRecipients(recipients: NotificationRecipient[]): NotificationRecipient[] {
  const seen = new Set<string>();
  const unique: NotificationRecipient[] = [];
  for (const recipient of recipients) {
    if (!recipient.userId || seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    unique.push(recipient);
  }
  return unique;
}

function renderForInApp(input: NotifyInput): { title: string; body: string } {
  // The in-app text never includes the greeting, so a placeholder name is fine.
  return renderNotification(input.template, { ...input.payload, recipientName: "there" });
}
