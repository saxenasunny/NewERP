/**
 * Live sessions and attendance — Phase 9 (first slice).
 *
 * A session is a scheduled meeting for one offering with an external join link;
 * the platform does not host the call. Attendance is one row per learner per
 * session, so marking again corrects the record instead of duplicating it.
 *
 * Authorisation is two-layered: the actor needs `sessions.manage` (or
 * `attendance.manage`) *and* must be entitled to this offering. Learners read
 * their own attendance only, and only for offerings they are enrolled in.
 *
 * Rescheduling or cancelling notifies the enrolled cohort once per learner, both
 * in-app and by email. Notification rows carry a dedupe key, so replaying the
 * same change (a retried job) does not notify anyone twice.
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import {
  ConflictError,
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import { getOfferingAccess } from "@/modules/content/content-service";
import {
  attendanceLockFor,
  parseAttendancePolicy,
  type AttendanceLock,
} from "@/modules/attendance/policy";
import { notify } from "@/modules/notifications/dispatch";

import { AttendanceStatus, LiveSessionStatus } from "../../generated/prisma/client";

export const MAX_SESSION_HOURS = 12;

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

export type SessionStatusKey = "scheduled" | "cancelled" | "completed";

export function sessionStatusKey(status: LiveSessionStatus): SessionStatusKey {
  if (status === LiveSessionStatus.CANCELLED) return "cancelled";
  if (status === LiveSessionStatus.COMPLETED) return "completed";
  return "scheduled";
}

export type AttendanceStatusKey = "present" | "absent" | "late" | "excused";

export function attendanceStatusKey(status: AttendanceStatus): AttendanceStatusKey {
  switch (status) {
    case AttendanceStatus.PRESENT:
      return "present";
    case AttendanceStatus.LATE:
      return "late";
    case AttendanceStatus.EXCUSED:
      return "excused";
    default:
      return "absent";
  }
}

function attendanceStatusFromKey(key: AttendanceStatusKey): AttendanceStatus {
  switch (key) {
    case "late":
      return AttendanceStatus.LATE;
    case "excused":
      return AttendanceStatus.EXCUSED;
    case "absent":
      return AttendanceStatus.ABSENT;
    default:
      return AttendanceStatus.PRESENT;
  }
}

export type SessionAttendanceTally = {
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
};

export type SessionSummary = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  joinUrl: string | null;
  status: SessionStatusKey;
  version: number;
  /** Staff view only: attendance recorded so far. */
  tally: SessionAttendanceTally;
  /** Whether attendance can still be edited, and why not. */
  lock?: AttendanceLock;
};

export type LearnerSession = SessionSummary & {
  /** This learner's own record; null means it has not been marked yet. */
  ownStatus: AttendanceStatusKey | null;
  ownNote: string | null;
};

export async function requireOfferingManagement(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient,
) {
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }
  return access;
}

export function emptyTally(): SessionAttendanceTally {
  return { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 };
}

/** Staff list: every session for the offering with its attendance tally. */
export async function listSessions(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<SessionSummary[]> {
  requirePermission(account, "attendance.read");
  const access = await requireOfferingManagement(account, offeringId, db);
  const tenantId = access.tenantId;

  const [sessions, enrolments, offering] = await Promise.all([
    db.liveSession.findMany({
      where: { tenantId, offeringId },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        joinUrl: true,
        status: true,
        version: true,
        attendanceLockedAt: true,
        attendanceReopenedAt: true,
        attendance: { select: { status: true } },
      },
    }),
    db.enrolment.count({ where: { tenantId, courseOfferingId: offeringId, status: "ACTIVE" } }),
    db.courseOffering.findFirst({
      where: { id: offeringId, tenantId },
      select: { settings: true },
    }),
  ]);
  const policy = parseAttendancePolicy(offering?.settings);
  const now = new Date();

  return sessions.map((session) => {
    const tally = emptyTally();
    for (const record of session.attendance) {
      tally[attendanceStatusKey(record.status)] += 1;
    }
    tally.unmarked = Math.max(0, enrolments - session.attendance.length);
    return {
      id: session.id,
      title: session.title,
      description: session.description,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      joinUrl: session.joinUrl,
      status: sessionStatusKey(session.status),
      version: session.version,
      tally,
      lock: attendanceLockFor(
        {
          status: sessionStatusKey(session.status),
          endsAt: session.endsAt,
          attendanceLockedAt: session.attendanceLockedAt,
          attendanceReopenedAt: session.attendanceReopenedAt,
        },
        policy,
        now,
      ),
    };
  });
}

/** Learner list: the same schedule, with only their own attendance attached. */
export async function listLearnerSessions(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<{ sessions: LearnerSession[]; summary: SessionAttendanceTally }> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);

  const enrolment = await db.enrolment.findFirst({
    where: {
      tenantId,
      courseOfferingId: offeringId,
      userId: account.user.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!enrolment) throw new ResourceNotFoundError("Course not found.");

  const sessions = await db.liveSession.findMany({
    where: { tenantId, offeringId },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      joinUrl: true,
      status: true,
      version: true,
      attendance: {
        where: { userId: account.user.id },
        select: { status: true, note: true },
      },
    },
  });

  const summary = emptyTally();
  const mapped: LearnerSession[] = sessions.map((session) => {
    const own = session.attendance[0];
    if (own) summary[attendanceStatusKey(own.status)] += 1;
    else summary.unmarked += 1;

    return {
      id: session.id,
      title: session.title,
      description: session.description,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      joinUrl: session.joinUrl,
      status: sessionStatusKey(session.status),
      version: session.version,
      tally: emptyTally(),
      ownStatus: own ? attendanceStatusKey(own.status) : null,
      ownNote: own?.note ?? null,
    };
  });

  return { sessions: mapped, summary };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const joinUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "The meeting link must start with http:// or https://",
  );

const scheduleSchema = z.object({
  title: z.string().trim().min(3, "Give the session a title of at least 3 characters.").max(120),
  description: z.string().trim().max(2000).optional(),
  startsAt: z.coerce.date({ message: "Enter a valid start date and time." }),
  endsAt: z.coerce.date({ message: "Enter a valid end date and time." }),
  joinUrl: joinUrlSchema.optional(),
});

/** Form input: timestamps arrive as strings and are coerced by the schema. */
export type ScheduleSessionInput = z.input<typeof scheduleSchema>;

function checkWindow(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ConflictError("The session must end after it starts.");
  }
  const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
  if (hours > MAX_SESSION_HOURS) {
    throw new ConflictError(`A session cannot run longer than ${MAX_SESSION_HOURS} hours.`);
  }
}

export async function scheduleSession(
  account: AccountContext,
  offeringId: string,
  input: ScheduleSessionInput,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "sessions.manage");
  const access = await requireOfferingManagement(account, offeringId, db);
  const parsed = scheduleSchema.parse(input);
  checkWindow(parsed.startsAt, parsed.endsAt);

  return db.$transaction(async (tx) => {
    const session = await tx.liveSession.create({
      data: {
        tenantId: access.tenantId,
        offeringId,
        title: parsed.title,
        description: parsed.description ?? null,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        joinUrl: parsed.joinUrl ?? null,
        status: LiveSessionStatus.SCHEDULED,
        createdByUserId: account.user.id,
      },
      select: { id: true },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "live_session.scheduled",
      resourceType: "live_session",
      resourceId: session.id,
      after: { title: parsed.title, startsAt: parsed.startsAt.toISOString() },
      requestId: context.requestId,
    });

    return session;
  });
}

const updateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give the session a title of at least 3 characters.")
    .max(120)
    .optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  startsAt: z.coerce.date({ message: "Enter a valid start date and time." }).optional(),
  endsAt: z.coerce.date({ message: "Enter a valid end date and time." }).optional(),
  joinUrl: joinUrlSchema.nullable().optional(),
  cancel: z.boolean().optional(),
});

export type UpdateSessionInput = z.input<typeof updateSchema>;

/**
 * Reschedule, edit, or cancel one session. A cancelled session stays visible to
 * the cohort, and the enrolled learners are told about the change.
 */
export async function updateSession(
  account: AccountContext,
  sessionId: string,
  input: UpdateSessionInput,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ status: SessionStatusKey }> {
  requirePermission(account, "sessions.manage");
  const tenantId = tenantIdOf(account);
  const parsed = updateSchema.parse(input);

  const existing = await db.liveSession.findFirst({
    where: { id: sessionId, tenantId },
    select: {
      id: true,
      offeringId: true,
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      joinUrl: true,
      status: true,
      version: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
    },
  });
  if (!existing) throw new ResourceNotFoundError("Session not found.");

  await requireOfferingManagement(account, existing.offeringId, db);

  if (existing.status === LiveSessionStatus.CANCELLED) {
    throw new ConflictError("That session is already cancelled.");
  }
  if (existing.status === LiveSessionStatus.COMPLETED) {
    throw new ConflictError("That session has already taken place.");
  }

  const cancelling = parsed.cancel === true;
  const startsAt = parsed.startsAt ?? existing.startsAt;
  const endsAt = parsed.endsAt ?? existing.endsAt;
  if (!cancelling) checkWindow(startsAt, endsAt);

  const rescheduled =
    !cancelling &&
    (startsAt.getTime() !== existing.startsAt.getTime() ||
      endsAt.getTime() !== existing.endsAt.getTime());

  await db.$transaction(async (tx) => {
    await tx.liveSession.update({
      where: { id: existing.id },
      data: {
        ...(cancelling
          ? { status: LiveSessionStatus.CANCELLED, cancelledAt: new Date() }
          : {
              ...(parsed.title ? { title: parsed.title } : {}),
              ...(parsed.description !== undefined ? { description: parsed.description } : {}),
              ...(parsed.startsAt ? { startsAt } : {}),
              ...(parsed.endsAt ? { endsAt } : {}),
              ...(parsed.joinUrl !== undefined ? { joinUrl: parsed.joinUrl } : {}),
            }),
        version: { increment: 1 },
      },
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: cancelling ? "live_session.cancelled" : "live_session.updated",
      resourceType: "live_session",
      resourceId: existing.id,
      before: {
        title: existing.title,
        startsAt: existing.startsAt.toISOString(),
        endsAt: existing.endsAt.toISOString(),
        status: sessionStatusKey(existing.status),
      },
      after: cancelling
        ? { status: "cancelled" }
        : {
            title: parsed.title ?? existing.title,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
      requestId: context.requestId,
    });
  });

  if (cancelling || rescheduled) {
    await notifyCohort(db, {
      tenantId,
      sessionId: existing.id,
      offeringId: existing.offeringId,
      courseCode: existing.offering.course.code,
      courseTitle: existing.offering.course.title,
      title: parsed.title ?? existing.title,
      startsAt,
      endsAt,
      changed: cancelling ? "cancelled" : "rescheduled",
    });
  }

  return { status: cancelling ? "cancelled" : sessionStatusKey(existing.status) };
}

/**
 * Tells every active learner about a schedule change. Each learner receives one
 * in-app notification and one email per logical event; the dedupe key is derived
 * from the session state, so replaying the same change (a retried job) finds the
 * existing notification and sends nothing.
 *
 * Failures are logged, never thrown: the schedule change is already committed
 * and must not be rolled back by a notification problem.
 */
async function notifyCohort(
  db: DatabaseClient,
  input: {
    tenantId: string;
    sessionId: string;
    offeringId: string;
    courseCode: string;
    courseTitle: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    changed: "cancelled" | "rescheduled";
  },
): Promise<{ notified: number }> {
  const learners = await db.enrolment.findMany({
    where: {
      tenantId: input.tenantId,
      courseOfferingId: input.offeringId,
      status: "ACTIVE",
    },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  if (learners.length === 0) return { notified: 0 };

  try {
    const result = await notify(db, {
      tenantId: input.tenantId,
      category: "sessions",
      template: "session.changed",
      recipients: learners.map((learner) => ({
        userId: learner.userId,
        name: learner.user.name,
        email: learner.user.email,
      })),
      payload: {
        href: `/student/courses/${input.offeringId}/sessions`,
        courseCode: input.courseCode,
        courseTitle: input.courseTitle,
        sessionTitle: input.title,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        change: input.changed,
      },
      dedupeKey: `live_session:${input.sessionId}:${input.changed}:${input.startsAt.toISOString()}`,
    });
    return { notified: result.inApp.length };
  } catch (error) {
    // Without the ledger we cannot prove idempotence, so report nobody notified
    // rather than pretending the cohort was told.
    log("error", "live_session.notification_failed", {
      offeringId: input.offeringId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { notified: 0 };
  }
}

/**
 * Re-sends the notice for a session's current state. Background retries call
 * this; the dedupe key makes repeated calls harmless.
 */
export async function deliverSessionChangeNotifications(
  sessionId: string,
  changed: "cancelled" | "rescheduled",
  db: DatabaseClient = getDb(),
): Promise<{ notified: number }> {
  const session = await db.liveSession.findFirst({
    where: { id: sessionId },
    select: {
      id: true,
      tenantId: true,
      offeringId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
    },
  });
  if (!session) throw new ResourceNotFoundError("Session not found.");

  return notifyCohort(db, {
    tenantId: session.tenantId,
    sessionId: session.id,
    offeringId: session.offeringId,
    courseCode: session.offering.course.code,
    courseTitle: session.offering.course.title,
    title: session.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    changed,
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export type AttendanceRosterEntry = {
  userId: string;
  name: string;
  email: string;
  status: AttendanceStatusKey | null;
  note: string | null;
};

export type AttendanceRoster = {
  session: SessionSummary;
  entries: AttendanceRosterEntry[];
};

async function loadSessionForStaff(account: AccountContext, sessionId: string, db: DatabaseClient) {
  const tenantId = tenantIdOf(account);
  const session = await db.liveSession.findFirst({
    where: { id: sessionId, tenantId },
    select: {
      id: true,
      offeringId: true,
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      joinUrl: true,
      status: true,
      version: true,
      attendanceLockedAt: true,
      attendanceReopenedAt: true,
      offering: { select: { settings: true } },
    },
  });
  if (!session) throw new ResourceNotFoundError("Session not found.");

  const access = await requireOfferingManagement(account, session.offeringId, db);
  const policy = parseAttendancePolicy(session.offering.settings);
  return { tenantId, access, session, policy };
}

/** Every enrolled learner with the attendance already recorded for the session. */
export async function getAttendanceRoster(
  account: AccountContext,
  sessionId: string,
  db: DatabaseClient = getDb(),
): Promise<AttendanceRoster> {
  requirePermission(account, "attendance.read");
  const { tenantId, session, policy } = await loadSessionForStaff(account, sessionId, db);

  const enrolments = await db.enrolment.findMany({
    where: { tenantId, courseOfferingId: session.offeringId, status: "ACTIVE" },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });

  const records = await db.attendanceRecord.findMany({
    where: { tenantId, sessionId: session.id },
    select: { userId: true, status: true, note: true },
  });
  const byUser = new Map(records.map((record) => [record.userId, record]));

  const entries = enrolments.map((enrolment) => {
    const record = byUser.get(enrolment.user.id);
    return {
      userId: enrolment.user.id,
      name: enrolment.user.name,
      email: enrolment.user.email,
      status: record ? attendanceStatusKey(record.status) : null,
      note: record?.note ?? null,
    };
  });

  const tally = emptyTally();
  for (const entry of entries) {
    if (entry.status) tally[entry.status] += 1;
    else tally.unmarked += 1;
  }

  const status = sessionStatusKey(session.status);
  return {
    session: {
      id: session.id,
      title: session.title,
      description: session.description,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      joinUrl: session.joinUrl,
      status,
      version: session.version,
      tally,
      lock: attendanceLockFor(
        {
          status,
          endsAt: session.endsAt,
          attendanceLockedAt: session.attendanceLockedAt,
          attendanceReopenedAt: session.attendanceReopenedAt,
        },
        policy,
      ),
    },
    entries,
  };
}

const markSchema = z.object({
  records: z
    .array(
      z.object({
        userId: z.string().trim().min(1),
        status: z.enum(["present", "absent", "late", "excused"]),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1, "Choose at least one learner."),
});

export type MarkAttendanceInput = z.infer<typeof markSchema>;

/**
 * Record or correct attendance for one session. Marking is an upsert, so a
 * second save corrects the same rows; only enrolled learners can be marked.
 */
export async function markAttendance(
  account: AccountContext,
  sessionId: string,
  input: MarkAttendanceInput,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<SessionAttendanceTally> {
  requirePermission(account, "attendance.manage");
  const { tenantId, session, policy } = await loadSessionForStaff(account, sessionId, db);
  const parsed = markSchema.parse(input);

  if (session.status === LiveSessionStatus.CANCELLED) {
    throw new ConflictError("A cancelled session has no attendance.");
  }

  const lock = attendanceLockFor(
    {
      status: sessionStatusKey(session.status),
      endsAt: session.endsAt,
      attendanceLockedAt: session.attendanceLockedAt,
      attendanceReopenedAt: session.attendanceReopenedAt,
    },
    policy,
  );
  if (lock.locked) {
    throw new ConflictError(
      lock.reason === "manual"
        ? "Attendance for this session was locked. Ask an administrator to reopen it."
        : `Attendance closes ${policy.lockAfterHours} hour(s) after the session. Ask an administrator to reopen it.`,
    );
  }

  const userIds = [...new Set(parsed.records.map((record) => record.userId))];
  const enrolled = await db.enrolment.findMany({
    where: {
      tenantId,
      courseOfferingId: session.offeringId,
      userId: { in: userIds },
      status: "ACTIVE",
    },
    select: { userId: true },
  });
  const enrolledIds = new Set(enrolled.map((row) => row.userId));
  const unknown = userIds.filter((userId) => !enrolledIds.has(userId));
  if (unknown.length > 0) {
    throw new ConflictError(
      "Attendance can only be recorded for learners enrolled in this course.",
    );
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const record of parsed.records) {
      const status = attendanceStatusFromKey(record.status);
      await tx.attendanceRecord.upsert({
        where: { sessionId_userId: { sessionId: session.id, userId: record.userId } },
        create: {
          tenantId,
          sessionId: session.id,
          userId: record.userId,
          status,
          note: record.note ?? null,
          markedByUserId: account.user.id,
          markedAt: now,
        },
        update: {
          status,
          note: record.note ?? null,
          markedByUserId: account.user.id,
          markedAt: now,
        },
      });
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "attendance.marked",
      resourceType: "live_session",
      resourceId: session.id,
      after: { learners: parsed.records.length },
      requestId: context.requestId,
    });
  });

  const tally = emptyTally();
  const rows = await db.attendanceRecord.findMany({
    where: { tenantId, sessionId: session.id },
    select: { status: true },
  });
  for (const row of rows) tally[attendanceStatusKey(row.status)] += 1;
  return tally;
}
