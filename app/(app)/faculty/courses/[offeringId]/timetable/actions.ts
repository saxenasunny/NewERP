"use server";

import { redirect } from "next/navigation";
import { requireAccountContext } from "@/lib/auth/account";
import { failureMessage } from "@/lib/forms/server-action";
import {
  createTimetableSlot,
  deleteTimetableSlot,
  DayOfWeek,
  SlotType,
} from "@/modules/timetable/timetable-service";

type Attempt<T> = { ok: true; value: T } | { ok: false; message: string };

async function attempt<T>(work: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

function withMessage(path: string, key: "notice" | "error", message: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(message)}`;
}

export async function createSlotAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = String(formData.get("offeringId") ?? "");
  const instructorUserId = String(formData.get("instructorUserId") ?? "");
  const roomId = String(formData.get("roomId") ?? "").trim() || null;
  const dayOfWeek = String(formData.get("dayOfWeek") ?? "") as DayOfWeek;
  const periodNumber = parseInt(String(formData.get("periodNumber") ?? "1"), 10);
  const startTime = String(formData.get("startTime") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim();
  const slotType = (String(formData.get("slotType") ?? "LECTURE") as SlotType) || SlotType.LECTURE;

  const returnPath = `/faculty/courses/${offeringId}/timetable`;

  const outcome = await attempt(async () => {
    return createTimetableSlot(account, {
      offeringId,
      instructorUserId,
      roomId,
      dayOfWeek,
      periodNumber,
      startTime,
      endTime,
      slotType,
    });
  });

  if (!outcome.ok) {
    redirect(withMessage(returnPath, "error", outcome.message));
  }

  redirect(withMessage(returnPath, "notice", `Class slot added on ${dayOfWeek} (Period ${periodNumber}).`));
}

export async function deleteSlotAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = String(formData.get("offeringId") ?? "");
  const slotId = String(formData.get("slotId") ?? "");

  const returnPath = `/faculty/courses/${offeringId}/timetable`;

  const outcome = await attempt(async () => {
    return deleteTimetableSlot(account, slotId);
  });

  if (!outcome.ok) {
    redirect(withMessage(returnPath, "error", outcome.message));
  }

  redirect(withMessage(returnPath, "notice", "Class slot removed."));
}
