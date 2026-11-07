/**
 * Calendar and agenda — Phase 9.
 *
 * The calendar is a read-only projection over three existing sources: scheduled
 * live sessions, assignment due dates, and quiz closing dates. It stores nothing
 * of its own, so it can never disagree with the underlying record.
 *
 * Scope is derived from the caller, never from a query parameter: teaching staff
 * see the offerings they manage, learners see the offerings they are actively
 * enrolled in. Asking for an offering outside that scope is a 404, exactly as if
 * it did not exist.
 *
 * The window is bounded (see `MAX_CALENDAR_DAYS`) so a single request cannot ask
 * the database for years of events.
 */

import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";

export const MAX_CALENDAR_DAYS = 62;
export const DEFAULT_CALENDAR_DAYS = 31;

export type CalendarScope = "staff" | "learner";
export type CalendarEventKind = "session" | "assignment" | "quiz";
export type CalendarEventState = "scheduled" | "cancelled" | "open" | "closed";

export type CalendarEvent = {
  id: string;
  kind: CalendarEventKind;
  title: string;
  courseCode: string;
  courseTitle: string;
  offeringId: string;
  /** Sessions start and end; deadlines have a single instant. */
  startsAt: Date;
  endsAt: Date | null;
  href: string;
  state: CalendarEventState;
};

export type CalendarView = {
  scope: CalendarScope;
  from: Date;
  to: Date;
  events: CalendarEvent[];
};

export type CalendarWindow = { from: Date; to: Date };

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

const DAY_MS = 86_400_000;

/**
 * Normalises the requested window. Invalid or reversed dates are a conflict
 * (the caller sent a bad range), and the span is clamped to `MAX_CALENDAR_DAYS`.
 */
export function parseCalendarWindow(input: {
  from?: string | null;
  to?: string | null;
  now?: Date;
}): CalendarWindow {
  const now = input.now ?? new Date();
  const from = input.from ? new Date(input.from) : startOfDay(now);
  const to = input.to
    ? new Date(input.to)
    : new Date(from.getTime() + DEFAULT_CALENDAR_DAYS * DAY_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ConflictError("Enter a valid calendar range.");
  }
  if (to.getTime() < from.getTime()) {
    throw new ConflictError("The end of the range must come after its start.");
  }
  if (to.getTime() - from.getTime() > MAX_CALENDAR_DAYS * DAY_MS) {
    throw new ConflictError(`A calendar range cannot span more than ${MAX_CALENDAR_DAYS} days.`);
  }

  return { from, to };
}

function startOfDay(date: Date | string | null | undefined): Date {
  if (!date) return new Date();
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** True when the actor teaches or administers at least one offering. */
export function calendarScopeOf(account: AccountContext): CalendarScope {
  return account.permissions.has("sessions.manage") ? "staff" : "learner";
}

type AccessibleOffering = {
  id: string;
  courseCode: string;
  courseTitle: string;
};

async function accessibleOfferings(
  account: AccountContext,
  scope: CalendarScope,
  offeringId: string | undefined,
  db: DatabaseClient,
): Promise<AccessibleOffering[]> {
  const tenantId = tenantIdOf(account);
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");

  const scopeWhere =
    scope === "staff"
      ? isAdministrator
        ? {}
        : { instructors: { some: { userId: account.user.id } } }
      : { enrolments: { some: { userId: account.user.id, status: "ACTIVE" as const } } };

  const offerings = await db.courseOffering.findMany({
    where: {
      tenantId,
      ...scopeWhere,
      ...(offeringId ? { id: offeringId } : {}),
    },
    select: { id: true, course: { select: { code: true, title: true } } },
  });

  // A named offering the caller cannot see is indistinguishable from a missing one.
  if (offeringId && offerings.length === 0) throw new ResourceNotFoundError();

  return offerings.map((offering) => ({
    id: offering.id,
    courseCode: offering.course.code,
    courseTitle: offering.course.title,
  }));
}

/**
 * Every session, assignment deadline, and quiz deadline in the window that the
 * caller is entitled to see, ordered by start.
 */
export async function getCalendar(
  account: AccountContext,
  window: CalendarWindow,
  options: { offeringId?: string } = {},
  db: DatabaseClient = getDb(),
): Promise<CalendarView> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const scope = calendarScopeOf(account);

  const offerings = await accessibleOfferings(account, scope, options.offeringId, db);
  const offeringById = new Map(offerings.map((offering) => [offering.id, offering]));
  const offeringIds = offerings.map((offering) => offering.id);

  if (offeringIds.length === 0) {
    return { scope, from: window.from, to: window.to, events: [] };
  }

  const span = { gte: window.from, lte: window.to };
  // Learners never see drafts; staff see their own unpublished work too.
  const publishedOnly = scope === "staff" ? {} : { status: "PUBLISHED" as const };

  const [sessions, assignments, quizzes] = await Promise.all([
    db.liveSession.findMany({
      where: { tenantId, offeringId: { in: offeringIds }, startsAt: span },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        offeringId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    }),
    db.assignment.findMany({
      where: { tenantId, offeringId: { in: offeringIds }, dueAt: span, ...publishedOnly },
      orderBy: { dueAt: "asc" },
      select: { id: true, offeringId: true, title: true, dueAt: true, status: true },
    }),
    db.quiz.findMany({
      where: {
        tenantId,
        offeringId: { in: offeringIds },
        availableUntil: span,
        ...publishedOnly,
      },
      orderBy: { availableUntil: "asc" },
      select: {
        id: true,
        offeringId: true,
        title: true,
        availableUntil: true,
        status: true,
      },
    }),
  ]);

  const events: CalendarEvent[] = [];

  for (const session of sessions) {
    const offering = offeringById.get(session.offeringId);
    if (!offering) continue;
    events.push({
      id: session.id,
      kind: "session",
      title: session.title,
      courseCode: offering.courseCode,
      courseTitle: offering.courseTitle,
      offeringId: session.offeringId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      href:
        scope === "staff"
          ? `/faculty/courses/${session.offeringId}/sessions/${session.id}`
          : `/student/courses/${session.offeringId}/sessions`,
      state:
        session.status === "CANCELLED"
          ? "cancelled"
          : session.status === "COMPLETED"
            ? "closed"
            : "scheduled",
    });
  }

  for (const assignment of assignments) {
    const offering = offeringById.get(assignment.offeringId);
    if (!offering || !assignment.dueAt) continue;
    events.push({
      id: assignment.id,
      kind: "assignment",
      title: assignment.title,
      courseCode: offering.courseCode,
      courseTitle: offering.courseTitle,
      offeringId: assignment.offeringId,
      startsAt: assignment.dueAt,
      endsAt: null,
      href:
        scope === "staff"
          ? `/faculty/courses/${assignment.offeringId}/assignments/${assignment.id}`
          : `/student/courses/${assignment.offeringId}/assignments/${assignment.id}`,
      state: assignment.status === "PUBLISHED" ? "open" : "closed",
    });
  }

  for (const quiz of quizzes) {
    const offering = offeringById.get(quiz.offeringId);
    if (!offering || !quiz.availableUntil) continue;
    events.push({
      id: quiz.id,
      kind: "quiz",
      title: quiz.title,
      courseCode: offering.courseCode,
      courseTitle: offering.courseTitle,
      offeringId: quiz.offeringId,
      startsAt: quiz.availableUntil,
      endsAt: null,
      href:
        scope === "staff"
          ? `/faculty/courses/${quiz.offeringId}/quizzes/${quiz.id}`
          : `/student/courses/${quiz.offeringId}/quizzes/${quiz.id}`,
      state: quiz.status === "PUBLISHED" ? "open" : "closed",
    });
  }

  events.sort((left, right) => {
    const l = (left.startsAt instanceof Date ? left.startsAt : new Date(left.startsAt)).getTime();
    const r = (right.startsAt instanceof Date ? right.startsAt : new Date(right.startsAt)).getTime();
    return l - r;
  });

  return { scope, from: window.from, to: window.to, events };
}

/** Groups events by the calendar day they fall on, preserving order. */
export function groupEventsByDay(events: CalendarEvent[]): Array<{
  key: string;
  date: Date;
  events: CalendarEvent[];
}> {
  const days = new Map<string, { date: Date; events: CalendarEvent[] }>();

  for (const event of events) {
    const key = dayKey(event.startsAt);
    const existing = days.get(key);
    if (existing) {
      existing.events.push(event);
    } else {
      days.set(key, { date: startOfDay(event.startsAt), events: [event] });
    }
  }

  return [...days.entries()].map(([key, value]) => ({ key, ...value }));
}

/** Stable `YYYY-MM-DD` key for a local day, used for grouping and links. */
export function dayKey(date: Date | string | null | undefined): string {
  if (!date) return "1970-01-01";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "1970-01-01";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
