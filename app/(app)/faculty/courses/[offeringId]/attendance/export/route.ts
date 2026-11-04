import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  attendanceReportToCsv,
  getAttendanceReport,
} from "@/modules/attendance/attendance-service";

export const dynamic = "force-dynamic";

/**
 * Downloadable attendance report for one offering. Permission checked by the
 * service (`attendance.read` and `reports.course.read` plus instructor or
 * administrator access) and never cached: the file names learners.
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
    const report = await getAttendanceReport(account, offeringId);
    const csv = attendanceReportToCsv(report);
    const safeCode = report.courseCode.replace(/[^A-Za-z0-9-]+/g, "-");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${safeCode}.csv"`,
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
      { code: "INTERNAL_ERROR", message: "Could not build the attendance report." },
      { status: 500 },
    );
  }
}
