import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getOfferingAccess } from "@/modules/content/content-service";
import { listLearnerSessions, type AttendanceStatusKey } from "@/modules/sessions/session-service";

export const metadata: Metadata = { title: "Live sessions" };

const ATTENDANCE_TONES: Record<AttendanceStatusKey, BadgeTone> = {
  present: "success",
  late: "warning",
  absent: "danger",
  excused: "info",
};

export default async function LearnerSessionsPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const account = await requireAccountContext();
  const { offeringId } = await params;

  let access;
  let schedule;
  try {
    access = await getOfferingAccess(account, offeringId);
    schedule = await listLearnerSessions(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Live sessions" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "This schedule could not be loaded."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/student/courses" },
          { label: access.courseCode, href: `/student/courses/${offeringId}` },
          { label: "Live sessions" },
        ]}
      />
      <PageHeader
        title={`${access.courseCode} live sessions`}
        description={`${access.courseTitle} · ${access.termName}`}
      />

      <Alert tone="info" title="Your attendance">
        {schedule.summary.present} present · {schedule.summary.late} late ·{" "}
        {schedule.summary.absent} absent · {schedule.summary.excused} excused ·{" "}
        {schedule.summary.unmarked} not marked yet. Only your own attendance is shown.
      </Alert>

      {schedule.sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Your lecturer has not scheduled a live class for this course."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {schedule.sessions.map((session) => (
            <li key={session.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{session.title}</span>
                  <span className="text-muted-foreground text-sm">
                    {session.startsAt.toLocaleString("en-GB")} →{" "}
                    {session.endsAt.toLocaleString("en-GB")}
                  </span>
                  {session.description ? (
                    <span className="text-sm">{session.description}</span>
                  ) : null}
                  {session.joinUrl && session.status === "scheduled" ? (
                    <a
                      href={session.joinUrl}
                      className="text-brand-800 text-sm font-medium hover:underline"
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Join the session
                    </a>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {session.status === "cancelled" ? (
                    <StatusBadge tone="danger">cancelled</StatusBadge>
                  ) : null}
                  {session.ownStatus ? (
                    <StatusBadge tone={ATTENDANCE_TONES[session.ownStatus]}>
                      {session.ownStatus}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">not marked</StatusBadge>
                  )}
                  {session.ownNote ? (
                    <span className="text-muted-foreground text-xs">{session.ownNote}</span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
