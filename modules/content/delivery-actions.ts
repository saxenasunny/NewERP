"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";

import { setItemCompleted } from "./delivery-service";

const PREFIXES = ["/student/courses", "/faculty/courses"] as const;

function target(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/student/courses");
}

export async function completeItemAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = target(formData);

  const outcome = await attempt(async () =>
    setItemCompleted(account, String(formData.get("itemId") ?? ""), true, {
      requestId: await currentRequestId(),
    }),
  );

  redirect(outcome.ok ? returnTo : withMessage(returnTo, "error", outcome.message));
}

export async function reopenItemAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = target(formData);

  const outcome = await attempt(async () =>
    setItemCompleted(account, String(formData.get("itemId") ?? ""), false, {
      requestId: await currentRequestId(),
    }),
  );

  redirect(outcome.ok ? returnTo : withMessage(returnTo, "error", outcome.message));
}
