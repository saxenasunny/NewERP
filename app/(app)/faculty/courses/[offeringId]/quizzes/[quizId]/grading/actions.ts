"use server";

import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import { gradeEssayItem } from "@/modules/quizzes/attempt-engine";

const PREFIXES = ["/faculty/courses"] as const;

function path(fd: FormData): string {
  return safeReturnTo(fd.get("returnTo"), PREFIXES, "/faculty/courses");
}
function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "");
}

export async function gradeEssayAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(() =>
    gradeEssayItem(account, text(formData, "attemptId"), {
      attemptItemId: text(formData, "attemptItemId"),
      score: Number(text(formData, "score")),
      feedback: text(formData, "feedback") || undefined,
    }),
  );

  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Grade saved."));
}
