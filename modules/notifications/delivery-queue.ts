/**
 * Durable notification delivery queue — Phase 9.
 *
 * In-app notices are rows in `notifications`; email is queued in
 * `notification_deliveries` and sent by this module. A queued message carries
 * its template name and payload, so a retry hours later renders the same text
 * without the caller being available, and a queue row is keyed on the same
 * dedupe key as its in-app sibling, so a replayed job enqueues nothing.
 *
 * Failures never escape: the thing being announced is already committed, and a
 * mail problem must not roll it back. A failed attempt is recorded with its
 * error, retried with exponential backoff, and finally left `failed` with a null
 * `next_attempt_at` so an operator can see exactly which messages did not go
 * out. `npm run jobs:notifications` drains what is due.
 */

import { getDb, type DatabaseClient } from "@/lib/db/client";
import { sendMail } from "@/lib/mail/send";
import { log } from "@/lib/observability/logger";

import {
  NotificationDeliveryStatus,
  type NotificationCategory,
  type Prisma,
} from "../../generated/prisma/client";
import { renderNotification, type NotificationTemplateKey } from "./templates";

export const MAX_DELIVERY_ATTEMPTS = 5;
export const BASE_RETRY_DELAY_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60_000;
const DEFAULT_LIMIT = 100;

export type DeliveryRequest = {
  tenantId: string;
  userId: string;
  category: NotificationCategory;
  template: NotificationTemplateKey;
  payload: Record<string, unknown>;
  dedupeKey: string;
  /** Defaults to now, so a fresh row is picked up by the next run. */
  nextAttemptAt?: Date;
};

/** Backoff after the given number of failed attempts: 5, 10, 20, 40 minutes. */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(attempts - 1, 0);
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

/**
 * Queues one email per request. Requests whose dedupe key already exists are
 * skipped, so a replayed job cannot send a second copy.
 */
export async function enqueueDeliveries(
  db: DatabaseClient,
  requests: DeliveryRequest[],
): Promise<string[]> {
  if (requests.length === 0) return [];

  const now = new Date();
  await db.notificationDelivery.createMany({
    data: requests.map((request) => ({
      tenantId: request.tenantId,
      userId: request.userId,
      category: request.category,
      template: request.template,
      payload: request.payload as unknown as Prisma.InputJsonValue,
      dedupeKey: request.dedupeKey,
      status: NotificationDeliveryStatus.PENDING,
      nextAttemptAt: request.nextAttemptAt ?? now,
      updatedAt: now,
    })),
    skipDuplicates: true,
  });

  // Return the rows that exist *and* still need sending, so an inline attempt
  // after enqueueing does not re-send what an earlier run delivered.
  const rows = await db.notificationDelivery.findMany({
    where: {
      tenantId: { in: [...new Set(requests.map((request) => request.tenantId))] },
      userId: { in: [...new Set(requests.map((request) => request.userId))] },
      dedupeKey: { in: requests.map((request) => request.dedupeKey) },
      status: NotificationDeliveryStatus.PENDING,
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export type DeliveryRunSummary = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Sends every due message (or the ones named by `deliveryIds`). Safe to run
 * repeatedly: a message is only attempted while it is pending or failed and its
 * backoff has elapsed.
 */
export async function processDeliveryQueue(
  options: { now?: Date; limit?: number; deliveryIds?: string[] } = {},
  db: DatabaseClient = getDb(),
): Promise<DeliveryRunSummary> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 500);

  const rows = await db.notificationDelivery.findMany({
    where: options.deliveryIds
      ? { id: { in: options.deliveryIds } }
      : {
          status: { in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED] },
          nextAttemptAt: { not: null, lte: now },
        },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      template: true,
      payload: true,
      attempts: true,
      status: true,
      user: { select: { email: true } },
    },
  });

  const summary: DeliveryRunSummary = { attempted: 0, sent: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    if (
      row.status === NotificationDeliveryStatus.SENT ||
      row.status === NotificationDeliveryStatus.SKIPPED
    ) {
      continue;
    }
    summary.attempted += 1;

    let rendered: ReturnType<typeof renderNotification>;
    try {
      rendered = renderNotification(row.template as NotificationTemplateKey, row.payload);
    } catch (error) {
      summary.skipped += 1;
      await db.notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: NotificationDeliveryStatus.SKIPPED,
          nextAttemptAt: null,
          lastError: `Unusable template payload: ${error instanceof Error ? error.message : "unknown"}`,
          updatedAt: now,
        },
      });
      log("error", "notification.delivery_skipped", { deliveryId: row.id, template: row.template });
      continue;
    }

    let delivered = false;
    let failure: string | null = null;
    try {
      const result = await sendMail({
        to: row.user.email,
        subject: rendered.subject,
        body: rendered.emailBody,
      });
      delivered = result.delivered;
      if (!result.delivered) failure = "The email transport did not deliver the message.";
    } catch (error) {
      failure = error instanceof Error ? error.message : "The email transport failed.";
    }

    const attempts = row.attempts + 1;

    if (delivered) {
      summary.sent += 1;
      await db.notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          attempts,
          sentAt: now,
          lastError: null,
          nextAttemptAt: null,
          updatedAt: now,
        },
      });
      continue;
    }

    summary.failed += 1;
    const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        attempts,
        lastError: failure,
        nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryDelayMs(attempts)),
        updatedAt: now,
      },
    });
    log("error", "notification.delivery_failed", {
      deliveryId: row.id,
      attempts,
      exhausted,
      reason: failure ?? "unknown",
    });
  }

  return summary;
}

/** Messages that still have a future attempt, or that ran out of attempts. */
export async function countPendingDeliveries(
  db: DatabaseClient = getDb(),
): Promise<{ due: number; stuck: number }> {
  const now = new Date();
  const [due, stuck] = await Promise.all([
    db.notificationDelivery.count({
      where: {
        status: { in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED] },
        nextAttemptAt: { not: null, lte: now },
      },
    }),
    db.notificationDelivery.count({
      where: { status: NotificationDeliveryStatus.FAILED, nextAttemptAt: null },
    }),
  ]);
  return { due, stuck };
}
