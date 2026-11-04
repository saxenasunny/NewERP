import { NextResponse } from "next/server";

import { checkDatabaseConnection } from "@/lib/db/client";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

export const dynamic = "force-dynamic";

/** Readiness probe: dependencies required to serve data are reachable. */
export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));
  const databaseUp = await checkDatabaseConnection();

  log(databaseUp ? "info" : "error", "health.readiness", {
    requestId,
    database: databaseUp ? "up" : "down",
  });

  return NextResponse.json(
    {
      status: databaseUp ? "ready" : "unavailable",
      checks: { database: databaseUp ? "up" : "down" },
      requestId,
      timestamp: new Date().toISOString(),
    },
    {
      status: databaseUp ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        [REQUEST_ID_HEADER]: requestId,
      },
    },
  );
}
