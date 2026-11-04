"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/modules/notifications/notification-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const id = text(formData, "notificationId");

  const outcome = await attempt(async () => markNotificationRead(account, id));
  if (!outcome.ok) redirect(withMessage("/notifications", "error", outcome.message));

  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const account = await requireAccountContext();

  const outcome = await attempt(async () => markAllNotificationsRead(account));
  if (!outcome.ok) redirect(withMessage("/notifications", "error", outcome.message));

  revalidatePath("/notifications");
}
