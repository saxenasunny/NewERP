import { NextResponse, type NextRequest } from "next/server";

import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

/**
 * Generates (or safely adopts) a request ID, forwards it to server code, and
 * records a single structured line per request. This is observability only —
 * never an authorization boundary (see docs/decisions/0002).
 */
export function proxy(request: NextRequest) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  log("info", "request", {
    requestId,
    method: request.method,
    path: request.nextUrl.pathname,
  });

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
