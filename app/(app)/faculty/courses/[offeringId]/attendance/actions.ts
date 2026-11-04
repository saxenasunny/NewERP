"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import { setAttendancePolicy } from "@/modules/attendance/attendance-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function setAttendancePolicyAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const base = `/faculty/courses/${offeringId}/attendance`;

  const outcome = await attempt(async () =>
    setAttendancePolicy(
      account,
      offeringId,
      { lockAfterHours: text(formData, "lockAfterHours") },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(base, "error", outcome.message));
  }
  redirect(withMessage(base, "notice", "Attendance lock policy saved."));
}
