import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { readItemFile } from "@/modules/content/content-service";
import { AppError, toApiError } from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";
import { StorageNotConfiguredError } from "@/lib/storage";

export const dynamic = "force-dynamic";

const FILENAME_FALLBACK = "course-material";

/** Escapes a filename for `Content-Disposition` without allowing header injection. */
function disposition(fileName: string): string {
  const safe = fileName.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || FILENAME_FALLBACK;
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Private course-file download.
 *
 * The route is deliberately not a public static path: it resolves the session,
 * then asks the content service whether this actor may read this item (tenant,
 * enrolment, publication, availability, and prerequisite locks). Only then does
 * it read bytes from storage. Cross-tenant and missing items are both 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
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

    const { itemId } = await params;
    const file = await readItemFile(account, itemId);

    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": file.contentType,
        "Content-Length": String(file.data.byteLength),
        "Content-Disposition": disposition(file.fileName),
        // The response is a download, never a rendered document.
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      log("error", "content.file_storage_unconfigured", { requestId });
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
      log("error", "content.file_download_failed", {
        requestId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toApiError(error, requestId);
    return NextResponse.json(body, { status, headers });
  }
}
