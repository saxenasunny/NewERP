import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getOfferingAccess } from "@/modules/content/content-service";
import { listSessions, type SessionStatusKey } from "@/modules/sessions/session-service";

import { scheduleSessionAction, updateSessionAction } from "./actions";

export const metadata: Metadata = { title: "Live sessions" };

const STATUS_TONES: Record<SessionStatusKey, BadgeTone> = {
  scheduled: "info",
  cancelled: "danger",
  completed: "neutral",
};

/** `datetime-local` value for a stored instant, in the server's wall clock. */
function toInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default async function FacultySessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let access;
  let sessions;
  try {
    access = await getOfferingAccess(account, offeringId);
    sessions = await listSessions(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Live sessions" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "The session schedule could not be loaded."}
        </Alert>
      </div>
    );
  }

  const canManage = access.canManage && account.permissions.has("sessions.manage");

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/faculty/courses" },
          { label: access.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Live sessions" },
        ]}
      />
      <PageHeader
        title={`${access.courseCode} live sessions`}
        description={`${access.courseTitle} · ${access.termName}. Scheduling, rescheduling, and cancelling each notify the enrolled cohort.`}
        actions={
          <Link
            href={`/faculty/courses/${offeringId}/attendance`}
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Attendance report
          </Link>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      ) : null}

      {canManage ? (
        <section className="rounded-lg border p-5">
          <h2 className="mb-1 text-base font-semibold">Schedule a session</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            The meeting link is where the class actually happens; the platform stores it and shows
            it to the cohort.
          </p>
          <form action={scheduleSessionAction} className="flex flex-col gap-4">
            <input type="hidden" name="offeringId" value={offeringId} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input id="session-title" label="Title" name="title" required minLength={3} />
              <Input
                id="session-starts"
                label="Starts"
                name="startsAt"
                type="datetime-local"
                required
              />
              <Input id="session-ends" label="Ends" name="endsAt" type="datetime-local" required />
            </div>
            <Input
              id="session-join-url"
              label="Meeting link"
              name="joinUrl"
              placeholder="https://meet.example.com/room"
              hint="Optional, but learners cannot join without it."
            />
            <Textarea id="session-description" label="Description" name="description" rows={2} />
            <div className="flex justify-end">
              <Button type="submit">Schedule session</Button>
            </div>
          </form>
        </section>
      ) : null}

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions scheduled"
          description="Schedule the first live class to give learners a time and a meeting link."
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Schedule</h2>
          <ul className="flex flex-col gap-3">
            {sessions.map((session) => (
              <li key={session.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {session.title}
                      <StatusBadge tone={STATUS_TONES[session.status]}>
                        {session.status}
                      </StatusBadge>
                      {session.lock && session.lock.reason !== "open" ? (
                        <StatusBadge
                          tone={session.lock.reason === "cancelled" ? "danger" : "warning"}
                        >
                          attendance {session.lock.reason === "cancelled" ? "closed" : "locked"}
                        </StatusBadge>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {session.startsAt.toLocaleString("en-GB")} →{" "}
                      {session.endsAt.toLocaleString("en-GB")}
                    </span>
                    {session.joinUrl ? (
                      <a
                        href={session.joinUrl}
                        className="text-brand-800 text-sm font-medium hover:underline"
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        Open meeting link
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-sm">No meeting link yet.</span>
                    )}
                    <span className="text-muted-foreground text-sm">
                      Attendance: {session.tally.present} present · {session.tally.late} late ·{" "}
                      {session.tally.absent} absent · {session.tally.excused} excused ·{" "}
                      {session.tally.unmarked} unmarked
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/faculty/courses/${offeringId}/sessions/${session.id}`}
                      className="text-brand-800 text-sm font-medium hover:underline"
                    >
                      Take attendance
                    </Link>
                  </div>
                </div>

                {canManage && session.status === "scheduled" ? (
                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
                    <form action={updateSessionAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="offeringId" value={offeringId} />
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input type="hidden" name="intent" value="reschedule" />
                      <Input
                        id={`session-starts-${session.id}`}
                        label="New start"
                        name="startsAt"
                        type="datetime-local"
                        defaultValue={toInputValue(session.startsAt)}
                      />
                      <Input
                        id={`session-ends-${session.id}`}
                        label="New end"
                        name="endsAt"
                        type="datetime-local"
                        defaultValue={toInputValue(session.endsAt)}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Reschedule
                      </Button>
                    </form>
                    <form action={updateSessionAction}>
                      <input type="hidden" name="offeringId" value={offeringId} />
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input type="hidden" name="intent" value="cancel" />
                      <Button type="submit" variant="danger" size="sm">
                        Cancel session
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
