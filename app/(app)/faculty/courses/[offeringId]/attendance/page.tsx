import type { Metadata } from "next";
import Link from "next/link";

import { AttendanceHealthBadge } from "@/components/attendance/attendance-health-badge";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCohortAttendanceRiskRoster } from "@/modules/attendance/health-service";
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
  searchParams: Promise<{ notice?: string; error?: string; filter?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error, filter }] = await Promise.all([params, searchParams]);

  let access;
  let report;
  let riskSummary;
  try {
    const [fetchedAccess, fetchedReport, fetchedRisk] = await Promise.all([
      getOfferingAccess(account, offeringId),
      getAttendanceReport(account, offeringId),
      getCohortAttendanceRiskRoster(account, offeringId),
    ]);
    access = fetchedAccess;
    report = fetchedReport;
    riskSummary = fetchedRisk;
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
  const riskByUserId = new Map(riskSummary.learners.map((l) => [l.userId, l]));
  const atRiskTotal = riskSummary.warningCount + riskSummary.criticalCount;

  // Filter rows if user selected at-risk filter
  const displayedRows = filter === "at-risk"
    ? report.rows.filter((row) => {
        const risk = riskByUserId.get(row.userId);
        return risk && (risk.health.status === "warning" || risk.health.status === "critical");
      })
    : report.rows;

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

      {/* 75% Rule Compliance & Exam Debarment Risk Section */}
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold flex items-center gap-2">
              <span>⚖️</span> Mandatory 75% Attendance Compliance (Exam Eligibility)
            </h2>
            <p className="text-ink-muted text-xs mt-0.5">
              Students with attendance below 75.0% are debarred from end-semester examinations under university regulations.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-700">
              <span>✓</span> Safe (≥75%): {riskSummary.safeCount}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-700">
              <span>⚠️</span> Warning (70-74.9%): {riskSummary.warningCount}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-bold text-rose-700">
              <span>🚨</span> Debarred Risk (&lt;70%): {riskSummary.criticalCount}
            </span>
          </div>
        </div>

        {atRiskTotal > 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
            <span className="text-base">⚠️</span>
            <div className="flex-1">
              <p className="font-bold">
                {atRiskTotal} student{atRiskTotal > 1 ? "s are" : " is"} currently at risk of examination debarment.
              </p>
              <p className="mt-0.5 text-amber-800 text-[11px]">
                Review the roster below to send recovery notices or arrange remedial sessions before the eligibility list is finalized.
              </p>
            </div>
          </div>
        ) : null}
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
        <section className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-ink">Per learner attendance & eligibility</h2>
              <p className="text-ink-muted text-xs">
                Showing {displayedRows.length} student{displayedRows.length !== 1 ? "s" : ""}
                {filter === "at-risk" ? " (filtered to at-risk / debarred only)" : ""}
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 p-1 bg-surface-muted rounded-xl border border-border text-xs">
              <Link
                href={`/faculty/courses/${offeringId}/attendance`}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                  filter !== "at-risk"
                    ? "bg-surface text-ink shadow-xs"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                All Students ({report.rows.length})
              </Link>
              <Link
                href={`/faculty/courses/${offeringId}/attendance?filter=at-risk`}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                  filter === "at-risk"
                    ? "bg-rose-50 text-rose-700 font-bold shadow-xs border border-rose-200"
                    : "text-ink-muted hover:text-rose-700"
                }`}
              >
                At Risk / Debarred ({atRiskTotal})
              </Link>
            </div>
          </div>

          {displayedRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
              {filter === "at-risk"
                ? "No students are currently below 75% attendance. All students meet the examination threshold!"
                : "No student records found."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left">
                  <tr>
                    <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
                      Learner & ID
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink">
                      Present
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink">
                      Late
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink">
                      Absent
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink">
                      Excused
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink">
                      Rate
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 text-left font-semibold text-ink">
                      Health Status
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 text-left font-semibold text-ink">
                      75% Rule Advice
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayedRows.map((row) => {
                    const risk = riskByUserId.get(row.userId);
                    const health = risk?.health;
                    const isAtRisk = health && (health.status === "warning" || health.status === "critical");

                    return (
                      <tr
                        key={row.userId}
                        className={`transition-colors ${
                          isAtRisk
                            ? health.status === "critical"
                              ? "bg-rose-50/40 hover:bg-rose-50/70"
                              : "bg-amber-50/40 hover:bg-amber-50/70"
                            : "hover:bg-surface-muted/50"
                        }`}
                      >
                        <th scope="row" className="px-3.5 py-3 text-left font-normal">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-ink">{row.name}</span>
                            <div className="flex items-center gap-2 text-xs text-ink-muted">
                              <span>{row.email}</span>
                              {risk?.institutionalId ? (
                                <span className="font-mono bg-surface-muted px-1.5 py-0.2 rounded border border-border text-[11px]">
                                  {risk.institutionalId}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </th>
                        <td className="px-3 py-3 text-right">{row.present}</td>
                        <td className="px-3 py-3 text-right">{row.late}</td>
                        <td className="px-3 py-3 text-right">{row.absent}</td>
                        <td className="px-3 py-3 text-right">{row.excused}</td>
                        <td className="px-3 py-3 text-right font-bold text-ink">
                          {formatAttendanceRate(row.rate)}
                        </td>
                        <td className="px-3.5 py-3 text-left">
                          {health ? (
                            <AttendanceHealthBadge health={health} showPercentage={false} />
                          ) : (
                            <span className="text-xs text-ink-muted">—</span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-left">
                          {health ? (
                            <span
                              className={`text-xs ${
                                health.status === "critical"
                                  ? "font-bold text-rose-700"
                                  : health.status === "warning"
                                  ? "font-semibold text-amber-700"
                                  : "text-ink-muted"
                              }`}
                            >
                              {health.status === "safe"
                                ? health.classesCanMiss > 0
                                  ? `Can safely miss ${health.classesCanMiss} class${health.classesCanMiss > 1 ? "es" : ""}`
                                  : "At threshold"
                                : health.status === "warning" || health.status === "critical"
                                ? `Needs +${health.classesNeededToSafe} consecutive classes`
                                : "—"}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-surface-muted border-t border-border font-semibold text-ink">
                  <tr>
                    <th scope="row" className="px-3.5 py-2.5 text-left">
                      Cohort Total
                    </th>
                    <td className="px-3 py-2.5 text-right">{report.totals.present}</td>
                    <td className="px-3 py-2.5 text-right">{report.totals.late}</td>
                    <td className="px-3 py-2.5 text-right">{report.totals.absent}</td>
                    <td className="px-3 py-2.5 text-right">{report.totals.excused}</td>
                    <td className="px-3 py-2.5 text-right">{formatAttendanceRate(report.rate)}</td>
                    <td colSpan={2} className="px-3.5 py-2.5 text-left text-xs text-ink-muted">
                      {riskSummary.safeCount} eligible · {atRiskTotal} below 75%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
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
