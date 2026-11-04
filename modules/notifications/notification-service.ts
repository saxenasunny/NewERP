/**
 * In-app notifications — Phase 9.
 *
 * A notification belongs to exactly one user in one institution. Callers supply
 * a `dedupeKey` describing the logical event (for example
 * `live_session:<id>:cancelled:<startsAt>`); the unique index on
 * (tenant, user, dedupe key) means a retried job finds the existing row and
 * skips it instead of sending the same message twice. The email side reuses the
 * returned "newly created" list for the same reason.
 *
 * Reading and clearing your own notifications needs no permission: the rows are
 * always scoped to the signed-in user by the query itself, never by an id the
 * caller supplies.
 */

import type { AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";

import { NotificationCategory } from "../../generated/prisma/client";

export type NotificationCategoryKey =
  "sessions" | "assignments" | "quizzes" | "grades" | "announcements" | "security" | "account";

export const NOTIFICATION_CATEGORY_KEYS: NotificationCategoryKey[] = [
  "sessions",
  "assignments",
  "quizzes",
  "grades",
  "announcements",
  "security",
  "account",
];

export function toNotificationCategory(category: NotificationCategoryKey): NotificationCategory {
  return TO_CATEGORY[category];
}

const TO_CATEGORY: Record<NotificationCategoryKey, NotificationCategory> = {
  sessions: NotificationCategory.SESSIONS,
  assignments: NotificationCategory.ASSIGNMENTS,
  quizzes: NotificationCategory.QUIZZES,
  grades: NotificationCategory.GRADES,
  announcements: NotificationCategory.ANNOUNCEMENTS,
  security: NotificationCategory.SECURITY,
  account: NotificationCategory.ACCOUNT,
};

export type NotificationSummary = {
  id: string;
  category: NotificationCategoryKey;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

function categoryKey(category: NotificationCategory): NotificationCategoryKey {
  return category.toLowerCase() as NotificationCategoryKey;
}

function toSummary(row: {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationSummary {
  return {
    id: row.id,
    category: categoryKey(row.category),
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * Creates one notification per recipient and returns the recipients that were
 * actually written. When `dedupeKey` is set, recipients that already hold that
 * key are skipped — that is what makes a retried job idempotent.
 */
export async function createNotifications(
  db: DatabaseClient,
  input: {
    tenantId: string;
    userIds: string[];
    category: NotificationCategoryKey;
    title: string;
    body: string;
    href?: string | null;
    dedupeKey?: string | null;
  },
): Promise<string[]> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return [];

  const dedupeKey = input.dedupeKey ?? null;
  let recipients = userIds;

  if (dedupeKey) {
    const existing = await db.notification.findMany({
      where: { tenantId: input.tenantId, dedupeKey, userId: { in: userIds } },
      select: { userId: true },
    });
    const seen = new Set(existing.map((row) => row.userId));
    recipients = userIds.filter((id) => !seen.has(id));
  }
  if (recipients.length === 0) return [];

  await db.notification.createMany({
    data: recipients.map((userId) => ({
      tenantId: input.tenantId,
      userId,
      category: TO_CATEGORY[input.category],
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      dedupeKey,
    })),
    skipDuplicates: true,
  });

  return recipients;
}

/** The signed-in user's own notifications, newest first. */
export async function listNotifications(
  account: AccountContext,
  options: { unreadOnly?: boolean; limit?: number } = {},
  db: DatabaseClient = getDb(),
): Promise<NotificationSummary[]> {
  const tenantId = tenantIdOf(account);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const rows = await db.notification.findMany({
    where: {
      tenantId,
      userId: account.user.id,
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  return rows.map(toSummary);
}

export async function countUnreadNotifications(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<number> {
  if (!account.tenant) return 0;
  return db.notification.count({
    where: { tenantId: account.tenant.tenantId, userId: account.user.id, readAt: null },
  });
}

/** Marks one of the caller's own notifications as read. */
export async function markNotificationRead(
  account: AccountContext,
  notificationId: string,
  db: DatabaseClient = getDb(),
): Promise<void> {
  const tenantId = tenantIdOf(account);

  const updated = await db.notification.updateMany({
    where: { id: notificationId, tenantId, userId: account.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  if (updated.count === 0) {
    const exists = await db.notification.findFirst({
      where: { id: notificationId, tenantId, userId: account.user.id },
      select: { id: true },
    });
    if (!exists) throw new ResourceNotFoundError("Notification not found.");
  }
}

export async function markAllNotificationsRead(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<number> {
  const tenantId = tenantIdOf(account);

  const updated = await db.notification.updateMany({
    where: { tenantId, userId: account.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count;
}

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}
