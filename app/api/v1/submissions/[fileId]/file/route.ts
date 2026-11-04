import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { AppError, toApiError } from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";
import { StorageNotConfiguredError } from "@/lib/storage";
import { readSubmissionFile } from "@/modules/assignments/submission-service";

export const dynamic = "force-dynamic";

const FILENAME_FALLBACK = "submission";

function disposition(fileName: string): string {
  const safe = fileName.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || FILENAME_FALLBACK;
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Private download for a submitted file.
 *
 * The learner who owns the submission and teaching staff on that offering may
 * read it; everyone else gets 403, and another institution's file is 404. The
 * check lives in the service, not in the route.
 */
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
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

    const { fileId } = await params;
    const file = await readSubmissionFile(account, fileId);

    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": file.contentType,
        "Content-Length": String(file.data.byteLength),
        "Content-Disposition": disposition(file.fileName),
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      log("error", "submission.file_storage_unconfigured", { requestId });
      return NextResponse.json(
        {
          code: "STORAGE_NOT_CONFIGURED",
          message: "File storage is not configured. Ask an administrator to set it up.",
          requestId,
        },
        { status: 503, headers },
      );
    }

    if (!(error instanceof AppError)) {
      log("error", "submission.file_download_failed", {
        requestId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toApiError(error, requestId);
    return NextResponse.json(body, { status, headers });
  }
}
