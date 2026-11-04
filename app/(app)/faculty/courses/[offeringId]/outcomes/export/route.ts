import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { buildObeEvidenceCsv } from "@/modules/obe/evidence";
import { getCourseObeEvidence } from "@/modules/obe/outcome-service";

export const dynamic = "force-dynamic";

/**
 * Downloadable OBE evidence document for one offering: the mappings, the policy
 * version they were measured against, and the statement that no attainment
 * value is computed. Permission checked by the service and never cached.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ offeringId: string }> },
) {
  const account = await getAccountContext();
  if (!account) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Sign in first." },
      { status: 401 },
    );
  }

  try {
    const { offeringId } = await params;
    const evidence = await getCourseObeEvidence(account, offeringId);
    const csv = buildObeEvidenceCsv(evidence);
    const safeCode = evidence.offering.courseCode.replace(/[^A-Za-z0-9-]+/g, "-");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="obe-evidence-${safeCode}.csv"`,
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
      { code: "INTERNAL_ERROR", message: "Could not build the OBE evidence export." },
      { status: 500 },
    );
  }
}
