import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { log } from "@/lib/observability/logger";
import {
  runAssignmentDueReminders,
  runSessionReminders,
} from "@/modules/notifications/reminder-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const now = new Date();
    const sessions = await runSessionReminders({ now }, db);
    const assignments = await runAssignmentDueReminders({ now }, db);

    log("info", "cron.reminders", { sessions, assignments });

    return NextResponse.json({
      success: true,
      ranAt: now.toISOString(),
      sessions,
      assignments,
    });
  } catch (error) {
    log("error", "cron.reminders_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
