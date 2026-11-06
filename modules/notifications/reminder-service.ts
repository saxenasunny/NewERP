/**
 * Reminder jobs — Phase 9.
 *
 * Two jobs live here: "your session starts soon" and "this assignment is due
 * soon". Both are safe to run as often as you like. Every recipient's notice
 * carries a dedupe key derived from the thing being reminded about and its
 * timestamp, so a retried or duplicated run creates nothing new and queues no
 * second email.
 *
 * These functions take no account: they are a system job, not a user action, so
 * nothing here is authorised by a permission. They only ever read sessions and
 * assignments that are already visible to the cohort.
 */

import { getDb, type DatabaseClient } from "@/lib/db/client";
import { log } from "@/lib/observability/logger";

import { notify } from "./dispatch";

export const DEFAULT_SESSION_LEAD_MINUTES = 60;
export const DEFAULT_ASSIGNMENT_LEAD_MINUTES = 24 * 60;
const MAX_LEAD_MINUTES = 7 * 24 * 60;
const DEFAULT_LIMIT = 50;

export type ReminderRunSummary = {
  /** Sessions or deadlines considered by this run. */
  processed: number;
  /** Learners who received a new notice (in-app and email). */
  recipients: number;
  /** Notices already delivered by an earlier run, so this run sent nothing. */
  skipped: number;
};

function clampLead(minutes: number | undefined, fallback: number): number {
  if (!Number.isFinite(minutes ?? fallback)) return fallback;
  return Math.min(Math.max(Math.trunc(minutes ?? fallback), 1), MAX_LEAD_MINUTES);
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? DEFAULT_LIMIT)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), 200);
}

/**
 * Sends a reminder to the active cohort of every session starting inside the
 * lead window. Re-running the job within the same window sends nothing.
 */
export async function runSessionReminders(
  options: { now?: Date; leadMinutes?: number; limit?: number } = {},
  db: DatabaseClient = getDb(),
): Promise<ReminderRunSummary> {
  const now = options.now ?? new Date();
  const leadMinutes = clampLead(options.leadMinutes, DEFAULT_SESSION_LEAD_MINUTES);
  const until = new Date(now.getTime() + leadMinutes * 60_000);

  const sessions = await db.liveSession.findMany({
    where: {
      status: "SCHEDULED",
      startsAt: { gt: now, lte: until },
    },
    orderBy: { startsAt: "asc" },
    take: clampLimit(options.limit),
    select: {
      id: true,
      tenantId: true,
      offeringId: true,
      title: true,
      startsAt: true,
      joinUrl: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
    },
  });

  const summary: ReminderRunSummary = { processed: sessions.length, recipients: 0, skipped: 0 };

  for (const session of sessions) {
    const [learners, instructors] = await Promise.all([
      db.enrolment.findMany({
        where: {
          tenantId: session.tenantId,
          courseOfferingId: session.offeringId,
          status: "ACTIVE",
        },
        select: { userId: true, user: { select: { name: true, email: true } } },
      }),
      db.courseInstructor.findMany({
        where: {
          courseOfferingId: session.offeringId,
        },
        select: { userId: true, user: { select: { name: true, email: true } } },
      }),
    ]);

    const recipientMap = new Map<string, { userId: string; name: string; email: string }>();
    for (const l of learners) {
      if (l.user?.email) {
        recipientMap.set(l.userId, { userId: l.userId, name: l.user.name, email: l.user.email });
      }
    }
    for (const i of instructors) {
      if (i.user?.email) {
        recipientMap.set(i.userId, { userId: i.userId, name: i.user.name, email: i.user.email });
      }
    }
    const recipients = Array.from(recipientMap.values());
    if (recipients.length === 0) continue;

    let fresh: string[] = [];
    try {
      const result = await notify(db, {
        tenantId: session.tenantId,
        category: "sessions",
        template: "session.reminder",
        recipients,
        payload: {
          href: `/student/courses/${session.offeringId}/sessions`,
          courseCode: session.offering.course.code,
          courseTitle: session.offering.course.title,
          sessionTitle: session.title,
          startsAt: session.startsAt.toISOString(),
          joinUrl: session.joinUrl,
        },
        dedupeKey: `session_reminder:${session.id}:${session.startsAt.toISOString()}:${leadMinutes}`,
      });
      fresh = result.inApp;
    } catch (error) {
      log("error", "reminder.notification_failed", {
        sessionId: session.id,
        reason: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }

    summary.recipients += fresh.length;
    summary.skipped += recipients.length - fresh.length;
  }

  return summary;
}

/**
 * Sends a reminder to every learner with an upcoming published assignment
 * deadline inside the lead window. Re-running the job sends nothing twice.
 */
export async function runAssignmentDueReminders(
  options: { now?: Date; leadMinutes?: number; limit?: number } = {},
  db: DatabaseClient = getDb(),
): Promise<ReminderRunSummary> {
  const now = options.now ?? new Date();
  const leadMinutes = clampLead(options.leadMinutes, DEFAULT_ASSIGNMENT_LEAD_MINUTES);
  const until = new Date(now.getTime() + leadMinutes * 60_000);

  const assignments = await db.assignment.findMany({
    where: {
      status: "PUBLISHED",
      dueAt: { gt: now, lte: until },
    },
    orderBy: { dueAt: "asc" },
    take: clampLimit(options.limit),
    select: {
      id: true,
      tenantId: true,
      offeringId: true,
      title: true,
      dueAt: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
    },
  });

  const summary: ReminderRunSummary = { processed: assignments.length, recipients: 0, skipped: 0 };

  for (const assignment of assignments) {
    if (!assignment.dueAt) continue;

    const learners = await db.enrolment.findMany({
      where: {
        tenantId: assignment.tenantId,
        courseOfferingId: assignment.offeringId,
        status: "ACTIVE",
      },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });
    if (learners.length === 0) continue;

    let fresh: string[] = [];
    try {
      const result = await notify(db, {
        tenantId: assignment.tenantId,
        category: "assignments",
        template: "assignment.due",
        recipients: learners.map((learner) => ({
          userId: learner.userId,
          name: learner.user.name,
          email: learner.user.email,
        })),
        payload: {
          href: `/student/courses/${assignment.offeringId}/assignments/${assignment.id}`,
          courseCode: assignment.offering.course.code,
          courseTitle: assignment.offering.course.title,
          assignmentTitle: assignment.title,
          dueAt: assignment.dueAt.toISOString(),
        },
        dedupeKey: `assignment_due:${assignment.id}:${assignment.dueAt.toISOString()}:${leadMinutes}`,
      });
      fresh = result.inApp;
    } catch (error) {
      log("error", "reminder.notification_failed", {
        assignmentId: assignment.id,
        reason: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }

    summary.recipients += fresh.length;
    summary.skipped += learners.length - fresh.length;
  }

  return summary;
}
