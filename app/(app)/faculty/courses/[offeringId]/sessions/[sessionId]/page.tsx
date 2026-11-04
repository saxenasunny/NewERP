import type { Metadata } from "next";
import Link from "next/link";
import { toString as toQrSvg } from "qrcode";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCheckInState } from "@/modules/attendance/check-in-service";
import { getOfferingAccess } from "@/modules/content/content-service";
import { getAttendanceRoster } from "@/modules/sessions/session-service";

import {
  closeCheckInAction,
  lockAttendanceAction,
  markAttendanceAction,
  openCheckInAction,
  reopenAttendanceAction,
} from "../actions";

export const metadata: Metadata = { title: "Attendance" };

const STATUSES = ["present", "late", "absent", "excused"] as const;

export default async function SessionAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; sessionId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, sessionId }, { notice, error }] = await Promise.all([params, searchParams]);

  let access;
  let roster;
  try {
    access = await getOfferingAccess(account, offeringId);
    roster = await getAttendanceRoster(account, sessionId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Attendance" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "This session could not be loaded."}
        </Alert>
      </div>
    );
  }

  const lock = roster.session.lock;
  const isLocked = lock?.locked ?? roster.session.status === "cancelled";
  const canMark =
    access.canManage &&
    account.permissions.has("attendance.manage") &&
    roster.session.status !== "cancelled" &&
    !isLocked;
  const canReopen =
    access.canManage &&
    isLocked &&
    roster.session.status !== "cancelled" &&
    account.permissions.has("institution.settings.manage");

  // The code panel is staff-only and meaningless once attendance is closed, so
  // it is only loaded when it can actually be acted on.
  const checkIn = canMark ? await getCheckInState(account, sessionId) : null;
  const qrSvg = checkIn?.code
    ? await toQrSvg(checkIn.code.url, { type: "svg", margin: 1, width: 200 })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/faculty/courses" },
          { label: access.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Live sessions", href: `/faculty/courses/${offeringId}/sessions` },
          { label: "Attendance" },
        ]}
      />
      <PageHeader
        title={roster.session.title}
        description={`${roster.session.startsAt.toLocaleString("en-GB")} → ${roster.session.endsAt.toLocaleString("en-GB")}`}
        actions={
          roster.session.status !== "scheduled" ? (
            <StatusBadge tone="danger">{roster.session.status}</StatusBadge>
          ) : null
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

      <Alert tone="info" title="This session">
        {roster.session.tally.present} present · {roster.session.tally.late} late ·{" "}
        {roster.session.tally.absent} absent · {roster.session.tally.excused} excused ·{" "}
        {roster.session.tally.unmarked} unmarked. Saving again corrects the same records.
      </Alert>

      {isLocked ? (
        <Alert tone="warning" title="Attendance is locked">
          {lock?.reason === "manual"
            ? "Staff locked this session, so the record can no longer be edited."
            : lock?.reason === "policy"
              ? "The course policy closed attendance after the grace period."
              : "A cancelled session has no attendance."}
          {lock?.lockAt ? ` Locked since ${lock.lockAt.toLocaleString("en-GB")}.` : ""}
          {canReopen ? (
            <form action={reopenAttendanceAction} className="mt-3">
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="sessionId" value={sessionId} />
              <Button type="submit" variant="secondary" size="sm">
                Reopen for correction
              </Button>
            </form>
          ) : null}
        </Alert>
      ) : canMark ? (
        <div className="flex justify-end">
          <form action={lockAttendanceAction}>
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" variant="secondary" size="sm">
              Lock attendance now
            </Button>
          </form>
        </div>
      ) : null}

      {checkIn ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">QR check-in</h2>
            <span className="text-muted-foreground text-xs">
              {checkIn.checkedIn} {checkIn.checkedIn === 1 ? "learner" : "learners"} checked in by
              code
            </span>
          </div>

          {checkIn.code && qrSvg ? (
            <div className="flex flex-wrap items-start gap-4">
              <div
                className="[&>svg]:h-44 [&>svg]:w-44"
                // The markup is produced locally by the QR encoder from our own URL.
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <p>
                  Learners scan this code to mark themselves present. It expires at{" "}
                  {checkIn.code.expiresAt.toLocaleTimeString("en-GB")}, and generating a new code
                  stops this one working immediately.
                </p>
                <a href={checkIn.code.url} className="text-brand-800 text-xs break-all underline">
                  {checkIn.code.url}
                </a>
                <form action={closeCheckInAction}>
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <Button type="submit" variant="secondary" size="sm">
                    Close the code
                  </Button>
                </form>
              </div>
            </div>
          ) : (
            <form action={openCheckInAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="sessionId" value={sessionId} />
              <Select id="check-in-minutes" label="Valid for" name="minutes" defaultValue="10">
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">60 minutes</option>
              </Select>
              <Button type="submit" size="sm">
                Open check-in
              </Button>
            </form>
          )}

          <p className="text-muted-foreground text-xs">
            A scan only ever adds a row for the scanning learner. If a learner is already marked,
            scanning changes nothing and the existing mark is kept.
          </p>
        </section>
      ) : null}

      {roster.entries.length === 0 ? (
        <EmptyState
          title="Nobody is enrolled"
          description="Attendance can only be recorded for active enrolments in this course."
        />
      ) : canMark ? (
        <form action={markAttendanceAction} className="flex flex-col gap-4">
          <input type="hidden" name="offeringId" value={offeringId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <ul className="flex flex-col divide-y rounded-lg border">
            {roster.entries.map((entry) => (
              <li
                key={entry.userId}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{entry.name}</span>
                  <span className="text-muted-foreground text-xs">{entry.email}</span>
                </span>
                <Select
                  id={`status-${entry.userId}`}
                  label="Status"
                  name={`status_${entry.userId}`}
                  defaultValue={entry.status ?? "unmarked"}
                >
                  <option value="unmarked">Not marked</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button type="submit">Save attendance</Button>
          </div>
        </form>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {roster.entries.map((entry) => (
            <li
              key={entry.userId}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm"
            >
              <span>
                {entry.name} · {entry.email}
              </span>
              <span className="text-muted-foreground">{entry.status ?? "Not marked"}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">
        A learner sees only their own attendance.{" "}
        <Link href={`/faculty/courses/${offeringId}/sessions`} className="underline">
          Back to the schedule
        </Link>
        .
      </p>
    </div>
  );
}
