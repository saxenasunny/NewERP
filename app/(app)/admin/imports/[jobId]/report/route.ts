import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getImportJob, importReportCsv } from "@/modules/imports/import-service";

/**
 * Downloadable per-row report for one import run. Tenant-scoped, permission
 * checked, and never cached: it contains learner identifiers.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const account = await getAccountContext();
  if (!account) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Sign in first." },
      { status: 401 },
    );
  }

  try {
    const { jobId } = await params;
    const job = await getImportJob(account, jobId);
    const csv = importReportCsv({
      fileName: job.fileName,
      kind: job.kind,
      rows: job.rows,
    });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-report-${job.id}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.httpStatus },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Could not build the report." },
      { status: 500 },
    );
  }
}
