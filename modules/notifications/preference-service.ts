/**
 * Notification preferences — Phase 9.
 *
 * Choices are per person, per category, and per channel. Nothing has to be
 * stored to mean "on": a missing row delivers in-app and by email, so the
 * settings page shows defaults for categories that were never touched.
 *
 * These are the caller's own settings, so there is no permission to check — every
 * query is scoped by the session's user and tenant, never by an id from a form.
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import type { AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { TenantSelectionRequiredError } from "@/lib/errors";

import {
  NOTIFICATION_CATEGORY_KEYS,
  toNotificationCategory,
  type NotificationCategoryKey,
} from "./notification-service";

export type PreferenceView = {
  category: NotificationCategoryKey;
  inApp: boolean;
  email: boolean;
};

const categorySchema = z.enum(
  NOTIFICATION_CATEGORY_KEYS as [NotificationCategoryKey, ...NotificationCategoryKey[]],
);

const preferencesSchema = z.object({
  preferences: z.array(
    z.object({
      category: categorySchema,
      inApp: z.boolean(),
      email: z.boolean(),
    }),
  ),
});

export type PreferencesInput = z.input<typeof preferencesSchema>;

/** Every category, in catalogue order, with the caller's effective choice. */
export async function listPreferences(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<PreferenceView[]> {
  const tenantId = tenantIdOf(account);

  const rows = await db.notificationPreference.findMany({
    where: { tenantId, userId: account.user.id },
    select: { category: true, inApp: true, email: true },
  });
  const byCategory = new Map(rows.map((row) => [row.category.toLowerCase(), row]));

  return NOTIFICATION_CATEGORY_KEYS.map((category) => {
    const row = byCategory.get(category);
    return { category, inApp: row?.inApp ?? true, email: row?.email ?? true };
  });
}

/**
 * Saves the whole grid. Categories omitted from the input keep their current
 * choice, so a partially rendered form cannot silently switch everything off.
 */
export async function updatePreferences(
  account: AccountContext,
  input: PreferencesInput,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<void> {
  const tenantId = tenantIdOf(account);
  const parsed = preferencesSchema.parse(input);
  if (parsed.preferences.length === 0) return;

  const before = await listPreferences(account, db);

  await db.$transaction(async (tx) => {
    for (const preference of parsed.preferences) {
      await tx.notificationPreference.upsert({
        where: {
          tenantId_userId_category: {
            tenantId,
            userId: account.user.id,
            category: toNotificationCategory(preference.category),
          },
        },
        create: {
          tenantId,
          userId: account.user.id,
          category: toNotificationCategory(preference.category),
          inApp: preference.inApp,
          email: preference.email,
        },
        update: { inApp: preference.inApp, email: preference.email },
      });
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "notification.preferences_updated",
      resourceType: "notification_preferences",
      resourceId: account.user.id,
      before: {
        preferences: before.map((row) => ({ ...row })),
      },
      after: {
        preferences: parsed.preferences.map((row) => ({ ...row })),
      },
      requestId: options.requestId ?? null,
    });
  });
}

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}
