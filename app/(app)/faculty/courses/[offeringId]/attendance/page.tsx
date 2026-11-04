import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { formatAttendanceRate } from "@/modules/attendance/policy";
import { getAttendanceReport } from "@/modules/attendance/attendance-service";
import { getOfferingAccess } from "@/modules/content/content-service";

import { setAttendancePolicyAction } from "./actions";

export const metadata: Metadata = { title: "Attendance report" };

const LOCK_TONES: Record<string, BadgeTone> = {
  open: "info",
  policy: "neutral",
  manual: "warning",
  cancelled: "danger",
};

export default async function CourseAttendanceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let access;
  let report;
  try {
    access = await getOfferingAccess(account, offeringId);
    report = await getAttendanceReport(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Attendance report" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "The attendance report could not be loaded."}
        </Alert>
      </div>
    );
  }

  const canManagePolicy = access.canManage && account.permissions.has("attendance.manage");

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/faculty/courses" },
          { label: access.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Attendance report" },
        ]}
      />
      <PageHeader
        title={`${access.courseCode} attendance`}
        description={`${access.courseTitle} · ${access.termName}. Only sessions that have already ended are counted; missing records stay visible as unmarked.`}
        actions={
          <Link
            href={`/faculty/courses/${offeringId}/attendance/export`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Download CSV
          </Link>
        }
      />

      {notice ? (
        <Alert tone="success" title="Saved">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">Delivered sessions</p>
          <p className="text-2xl font-semibold">{report.sessions.length}</p>
          <p className="text-muted-foreground text-xs">
            {report.upcomingSessions} still to come · cancelled sessions excluded
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">Cohort attendance</p>
          <p className="text-2xl font-semibold">{formatAttendanceRate(report.rate)}</p>
          <p className="text-muted-foreground text-xs">
            Present plus late, out of recorded statuses; excused absences excluded
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">Unmarked records</p>
          <p className="text-2xl font-semibold">{report.totals.unmarked}</p>
          <p className="text-muted-foreground text-xs">
            Missing data never counts as an absence in the rate
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">Learners</p>
          <p className="text-2xl font-semibold">{report.rows.length}</p>
          <p className="text-muted-foreground text-xs">Active enrolments only</p>
        </div>
      </section>

      {canManagePolicy ? (
        <section className="rounded-lg border p-5">
          <h2 className="mb-1 text-base font-semibold">Attendance lock</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Attendance becomes read-only this many hours after a session ends. A course
            administrator can reopen a single session when a correction is needed.
          </p>
          <form action={setAttendancePolicyAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="offeringId" value={offeringId} />
            <Input
              id="attendance-lock-hours"
              label="Lock after (hours)"
              name="lockAfterHours"
              type="number"
              min={0}
              max={2160}
              step={1}
              defaultValue={String(report.policy.lockAfterHours)}
              hint="168 hours is one week; 0 locks as soon as the session ends."
            />
            <Button type="submit" variant="secondary">
              Save policy
            </Button>
          </form>
        </section>
      ) : (
        <Alert tone="info" title="Attendance lock">
          Attendance closes {report.policy.lockAfterHours} hours after a session ends.
        </Alert>
      )}

      {report.sessions.length === 0 ? (
        <EmptyState
          title="No sessions have ended yet"
          description="Attendance appears here once a scheduled session is over."
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Per learner</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Learner
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Present
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Late
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Absent
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Excused
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Unmarked
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.userId} className="border-t">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="block font-medium">{row.name}</span>
                      <span className="text-muted-foreground text-xs">{row.email}</span>
                    </th>
                    <td className="px-3 py-2 text-right">{row.present}</td>
                    <td className="px-3 py-2 text-right">{row.late}</td>
                    <td className="px-3 py-2 text-right">{row.absent}</td>
                    <td className="px-3 py-2 text-right">{row.excused}</td>
                    <td className="px-3 py-2 text-right">{row.unmarked}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatAttendanceRate(row.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/50 border-t font-medium">
                <tr>
                  <th scope="row" className="px-3 py-2 text-left">
                    All learners
                  </th>
                  <td className="px-3 py-2 text-right">{report.totals.present}</td>
                  <td className="px-3 py-2 text-right">{report.totals.late}</td>
                  <td className="px-3 py-2 text-right">{report.totals.absent}</td>
                  <td className="px-3 py-2 text-right">{report.totals.excused}</td>
                  <td className="px-3 py-2 text-right">{report.totals.unmarked}</td>
                  <td className="px-3 py-2 text-right">{formatAttendanceRate(report.rate)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Sessions counted</h2>
        <ul className="flex flex-col gap-2">
          {report.sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <span className="flex flex-col">
                <span className="font-medium">{session.title}</span>
                <span className="text-muted-foreground text-xs">
                  {session.startsAt.toLocaleString("en-GB")} →{" "}
                  {session.endsAt.toLocaleString("en-GB")}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <StatusBadge tone={LOCK_TONES[session.lock.reason] ?? "neutral"}>
                  {session.lock.locked ? `locked: ${session.lock.reason}` : "open"}
                </StatusBadge>
                <Link
                  href={`/faculty/courses/${offeringId}/sessions/${session.id}`}
                  className="text-brand-800 font-medium hover:underline"
                >
                  Attendance
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
