import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { AppError, toApiError } from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

export const dynamic = "force-dynamic";

/**
 * The authenticated identity behind the session cookie. The first versioned
 * endpoint every API consumer can call: 401 without a valid session, and a
 * `Cache-Control: private, no-store` response because it is personalized.
 */
export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));

  try {
    const account = await getAccountContext();
    if (!account) {
      return NextResponse.json(
        { code: "UNAUTHENTICATED", message: "Authentication required.", requestId },
        {
          status: 401,
          headers: {
            "Cache-Control": "private, no-store",
            [REQUEST_ID_HEADER]: requestId,
          },
        },
      );
    }

    return NextResponse.json(
      {
        user: {
          id: account.user.id,
          email: account.user.email,
          name: account.user.name,
          timezone: account.user.timezone,
          locale: account.user.locale,
        },
        session: {
          id: account.sessionId,
          expiresAt: account.sessionExpiresAt.toISOString(),
        },
        activeInstitution: account.tenant
          ? { id: account.tenant.tenantId, name: account.tenant.institutionName }
          : null,
        roles: account.roleKeys,
        requestId,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          [REQUEST_ID_HEADER]: requestId,
        },
      },
    );
  } catch (error) {
    if (!(error instanceof AppError)) {
      log("error", "api.request_failed", {
        requestId,
        path: "/api/v1/me",
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toApiError(error, requestId);
    return NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store", [REQUEST_ID_HEADER]: requestId },
    });
  }
}
