import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { log } from "@/lib/observability/logger";
import {
  countPendingDeliveries,
  processDeliveryQueue,
} from "@/modules/notifications/delivery-queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const summary = await processDeliveryQueue({}, db);
    const remaining = await countPendingDeliveries(db);

    log("info", "cron.notifications", { summary, remaining });

    return NextResponse.json({
      success: true,
      ranAt: new Date().toISOString(),
      summary,
      remaining,
    });
  } catch (error) {
    log("error", "cron.notifications_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
