import { NextResponse } from "next/server";

import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

export const dynamic = "force-dynamic";

/** Liveness probe: the process can serve requests. Readiness is separate. */
export function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));

  return NextResponse.json(
    {
      status: "ok",
      service: "lms-platform",
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
}
