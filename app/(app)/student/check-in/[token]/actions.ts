"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import { checkIn } from "@/modules/attendance/check-in-service";

export async function checkInAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const token = String(formData.get("token") ?? "").trim();
  const path = `/student/check-in/${token}`;

  let alreadyRecorded = false;
  const outcome = await attempt(async () => {
    const result = await checkIn(account, token, { requestId: await currentRequestId() });
    alreadyRecorded = result.alreadyRecorded;
    return result;
  });

  if (!outcome.ok) {
    redirect(withMessage(path, "error", outcome.message));
  }
  redirect(
    withMessage(
      path,
      "notice",
      alreadyRecorded
        ? "You were already checked in, so nothing changed."
        : "You are marked present for this session.",
    ),
  );
}
