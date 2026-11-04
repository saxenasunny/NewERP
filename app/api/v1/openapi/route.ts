import { NextResponse } from "next/server";

import { openApiDocument } from "@/lib/api/openapi";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

export const dynamic = "force-dynamic";

/** The API description is public documentation; it contains no tenant data. */
export function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));

  return NextResponse.json(openApiDocument, {
    headers: {
      "Cache-Control": "public, max-age=300",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
