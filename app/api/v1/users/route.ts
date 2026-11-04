import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { AppError, TenantSelectionRequiredError, toApiError } from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";
import { listMembers } from "@/modules/identity/user-service";

export const dynamic = "force-dynamic";

/**
 * Tenant-scoped people directory.
 *
 * Authentication (401), institution selection (409), and the `users.read`
 * permission (403) are enforced on the server by the same code paths as the
 * UI. Rows are always filtered by the session's institution — no tenant
 * identifier is accepted from the request.
 */
export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = {
    "Cache-Control": "private, no-store",
    [REQUEST_ID_HEADER]: requestId,
  };

  try {
    const account = await getAccountContext();
    if (!account) {
      return NextResponse.json(
        { code: "UNAUTHENTICATED", message: "Authentication required.", requestId },
        { status: 401, headers },
      );
    }

    if (!account.tenant) throw new TenantSelectionRequiredError();

    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;

    // listMembers enforces the users.read permission and tenant scoping.
    const members = await listMembers(account, { query, limit });

    return NextResponse.json(
      {
        items: members.map((member) => ({
          id: member.userId,
          name: member.name,
          email: member.email,
          status: member.accountStatus,
          membershipStatus: member.status,
          joinedAt: member.joinedAt?.toISOString() ?? null,
          roles: member.roles.map((role) => ({ key: role.roleKey, name: role.roleName })),
        })),
        count: members.length,
        requestId,
      },
      { headers },
    );
  } catch (error) {
    if (!(error instanceof AppError)) {
      log("error", "api.request_failed", {
        requestId,
        path: "/api/v1/users",
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toApiError(error, requestId);
    return NextResponse.json(body, { status, headers });
  }
}
