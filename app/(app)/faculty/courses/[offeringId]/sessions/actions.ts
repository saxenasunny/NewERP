"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import {
  lockSessionAttendance,
  reopenSessionAttendance,
} from "@/modules/attendance/attendance-service";
import { closeCheckInCode, openCheckInCode } from "@/modules/attendance/check-in-service";
import { markAttendance, scheduleSession, updateSession } from "@/modules/sessions/session-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function base(offeringId: string): string {
  return `/faculty/courses/${offeringId}/sessions`;
}

export async function scheduleSessionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    scheduleSession(
      account,
      offeringId,
      {
        title: text(formData, "title"),
        ...(text(formData, "description") ? { description: text(formData, "description") } : {}),
        startsAt: text(formData, "startsAt"),
        endsAt: text(formData, "endsAt"),
        ...(text(formData, "joinUrl") ? { joinUrl: text(formData, "joinUrl") } : {}),
      },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(withMessage(base(offeringId), "notice", "Session scheduled."));
}

export async function updateSessionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const sessionId = text(formData, "sessionId");
  const cancelling = text(formData, "intent") === "cancel";

  const outcome = await attempt(async () =>
    updateSession(
      account,
      sessionId,
      cancelling
        ? { cancel: true }
        : {
            ...(text(formData, "startsAt") ? { startsAt: text(formData, "startsAt") } : {}),
            ...(text(formData, "endsAt") ? { endsAt: text(formData, "endsAt") } : {}),
          },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(
    withMessage(
      base(offeringId),
      "notice",
      cancelling
        ? "Session cancelled and the cohort notified."
        : "Session rescheduled and the cohort notified.",
    ),
  );
}

export async function lockAttendanceAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const sessionId = text(formData, "sessionId");

  const outcome = await attempt(async () =>
    lockSessionAttendance(account, sessionId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(`${base(offeringId)}/${sessionId}`, "error", outcome.message));
  }
  redirect(withMessage(`${base(offeringId)}/${sessionId}`, "notice", "Attendance locked."));
}

export async function reopenAttendanceAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const sessionId = text(formData, "sessionId");

  const outcome = await attempt(async () =>
    reopenSessionAttendance(account, sessionId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(`${base(offeringId)}/${sessionId}`, "error", outcome.message));
  }
  redirect(
    withMessage(`${base(offeringId)}/${sessionId}`, "notice", "Attendance reopened for editing."),
  );
}

export async function openCheckInAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const sessionId = text(formData, "sessionId");
  const minutes = text(formData, "minutes") || "10";

  const outcome = await attempt(async () =>
    openCheckInCode(account, sessionId, { minutes }, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(`${base(offeringId)}/${sessionId}`, "error", outcome.message));
  }
  redirect(
    withMessage(
      `${base(offeringId)}/${sessionId}`,
      "notice",
      "Check-in code open. Any earlier code for this session has stopped working.",
    ),
  );
}

export async function closeCheckInAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const sessionId = text(formData, "sessionId");

  const outcome = await attempt(async () =>
    closeCheckInCode(account, sessionId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(`${base(offeringId)}/${sessionId}`, "error", outcome.message));
  }
  redirect(withMessage(`${base(offeringId)}/${sessionId}`, "notice", "Check-in code closed."));
}

export async function markAttendanceAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const sessionId = text(formData, "sessionId");

  const records: { userId: string; status: "present" | "absent" | "late" | "excused" }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status_")) continue;
    const status = typeof value === "string" ? value : "";
    if (status !== "present" && status !== "absent" && status !== "late" && status !== "excused") {
      continue;
    }
    records.push({ userId: key.slice("status_".length), status });
  }

  const outcome = await attempt(async () =>
    markAttendance(account, sessionId, { records }, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(`${base(offeringId)}/${sessionId}`, "error", outcome.message));
  }
  redirect(
    withMessage(
      `${base(offeringId)}/${sessionId}`,
      "notice",
      `Attendance saved for ${records.length} learner(s).`,
    ),
  );
}
