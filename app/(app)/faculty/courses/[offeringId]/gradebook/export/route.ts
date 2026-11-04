import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCourseGradebook, gradebookToCsv } from "@/modules/gradebook/gradebook-service";

export const dynamic = "force-dynamic";

/**
 * Downloadable gradebook for one offering. Permission checked by the service
 * (grades.read plus instructor/administrator access) and never cached: the file
 * contains learner identifiers and marks.
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
    // The file always covers the whole cohort, never just the current page.
    const gradebook = await getCourseGradebook(account, offeringId, { paginate: false });
    const csv = gradebookToCsv(gradebook);
    const safeCode = gradebook.courseCode.replace(/[^A-Za-z0-9-]+/g, "-");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="gradebook-${safeCode}.csv"`,
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
      { code: "INTERNAL_ERROR", message: "Could not build the gradebook." },
      { status: 500 },
    );
  }
}
