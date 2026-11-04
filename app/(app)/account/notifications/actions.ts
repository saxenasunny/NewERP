"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import { NOTIFICATION_CATEGORY_KEYS } from "@/modules/notifications/notification-service";
import { updatePreferences } from "@/modules/notifications/preference-service";

const PAGE = "/account/notifications";

export async function updateNotificationPreferencesAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();

  const preferences = NOTIFICATION_CATEGORY_KEYS.map((category) => ({
    category,
    inApp: formData.get(`inApp-${category}`) === "on",
    email: formData.get(`email-${category}`) === "on",
  }));

  const outcome = await attempt(async () =>
    updatePreferences(account, { preferences }, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(PAGE, "error", outcome.message));
  }
  redirect(withMessage(PAGE, "notice", "preferences-saved"));
}
