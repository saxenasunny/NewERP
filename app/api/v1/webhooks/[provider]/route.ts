import { NextResponse } from "next/server";

import { toApiError } from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";
import { receiveWebhook } from "@/modules/integrations/webhooks";

export const dynamic = "force-dynamic";

/**
 * POST a signed provider event. The body is read as text so the HMAC covers the
 * exact bytes the provider signed; parsing happens only after verification.
 */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = {
    "Cache-Control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  };
  const { provider } = await context.params;

  try {
    const body = await request.text();
    const result = await receiveWebhook({
      provider,
      headers: request.headers,
      body,
      externalId: request.headers.get("x-webhook-id"),
    });

    if (result.status === "rejected") {
      const status =
        result.reason === "unknown_provider"
          ? 404
          : result.reason === "provider_unconfigured"
            ? 503
            : result.reason.startsWith("missing_signature") ||
                result.reason === "malformed_timestamp" ||
                result.reason === "stale_timestamp" ||
                result.reason === "mismatch"
              ? 401
              : 400;

      log("warn", "webhook.rejected", {
        requestId,
        provider,
        reason: result.reason,
      });

      return NextResponse.json(
        {
          code: "WEBHOOK_REJECTED",
          message:
            result.reason === "provider_unconfigured"
              ? "This webhook provider is not configured."
              : "The webhook could not be accepted.",
          reason: result.reason,
          requestId,
        },
        { status, headers },
      );
    }

    return NextResponse.json(
      { status: result.status, eventId: result.eventId, requestId },
      { status: result.status === "accepted" ? 202 : 200, headers },
    );
  } catch (error) {
    log("error", "webhook.failed", {
      requestId,
      provider,
      reason: error instanceof Error ? error.message : "unknown",
    });
    const { status, body } = toApiError(error, requestId);
    return NextResponse.json(body, { status, headers });
  }
}
