"use server";

import { redirect } from "next/navigation";
import { requireAccountContext } from "@/lib/auth/account";
import { failureMessage } from "@/lib/forms/server-action";
import { createRoom, deleteRoom } from "@/modules/timetable/timetable-service";

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

export async function createRoomAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const code = String(formData.get("code") ?? "").trim();
  const building = String(formData.get("building") ?? "").trim();
  const floor = parseInt(String(formData.get("floor") ?? "1"), 10);
  const capacity = parseInt(String(formData.get("capacity") ?? "60"), 10);
  const isLab = formData.get("isLab") === "true" || formData.get("isLab") === "on";

  const outcome = await attempt(async () => {
    return createRoom(account, {
      code,
      building,
      floor: isNaN(floor) ? 1 : floor,
      capacity: isNaN(capacity) ? 60 : capacity,
      isLab,
    });
  });

  if (!outcome.ok) {
    redirect(withMessage("/admin/rooms", "error", outcome.message));
  }

  redirect(withMessage("/admin/rooms", "notice", `Room "${code}" created successfully.`));
}

export async function deleteRoomAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const roomId = String(formData.get("roomId") ?? "");

  const outcome = await attempt(async () => {
    return deleteRoom(account, roomId);
  });

  if (!outcome.ok) {
    redirect(withMessage("/admin/rooms", "error", outcome.message));
  }

  redirect(withMessage("/admin/rooms", "notice", "Room deleted successfully."));
}
