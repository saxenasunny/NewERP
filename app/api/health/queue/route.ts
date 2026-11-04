import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";
import { countPendingDeliveries } from "@/modules/notifications/delivery-queue";

export const dynamic = "force-dynamic";

/**
 * Queue monitoring for operators. Counts only — no recipient, subject, or payload
 * is exposed. `stuck` counts messages that exhausted their retries and will not
 * be attempted again without intervention.
 */
export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));

  try {
    const { due, stuck } = await countPendingDeliveries();
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const sentLast24Hours = await getDb().notificationDelivery.count({
      where: { sentAt: { gte: since } },
    });

    log(stuck > 0 ? "warn" : "info", "health.queue", { requestId, due, stuck });

    return NextResponse.json(
      {
        status: stuck > 0 ? "degraded" : "ok",
        due,
        stuck,
        sentLast24Hours,
        requestId,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          [REQUEST_ID_HEADER]: requestId,
        },
      },
    );
  } catch (error) {
    log("error", "health.queue_failed", {
      requestId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { status: "unavailable", requestId },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", [REQUEST_ID_HEADER]: requestId },
      },
    );
  }
}
