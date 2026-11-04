/**
 * Attendance policy administration and reports — Phase 9.
 *
 * The lock rule itself lives in `./policy`; this module stores the course
 * setting, lets staff freeze or reopen a session, and builds the course
 * attendance report with its CSV export.
 *
 * Authorisation: reading the policy or the report needs `attendance.read` plus
 * `reports.course.read` and management access to the offering. Changing the
 * policy needs `attendance.manage`; reopening a locked session needs
 * `institution.settings.manage`, so a correction after the lock is an
 * administrator decision rather than a silent edit.
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError } from "@/lib/errors";
import {
  attendanceLockFor,
  attendanceRate,
  MAX_LOCK_AFTER_HOURS,
  MIN_LOCK_AFTER_HOURS,
  parseAttendancePolicy,
  withAttendancePolicy,
  type AttendanceLock,
  type AttendancePolicy,
} from "@/modules/attendance/policy";
import {
  attendanceStatusKey,
  requireOfferingManagement,
  sessionStatusKey,
  type AttendanceStatusKey,
} from "@/modules/sessions/session-service";

import { LiveSessionStatus } from "../../generated/prisma/client";

/** The policy currently in force for one offering. */
export async function getAttendancePolicy(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<AttendancePolicy> {
  requirePermission(account, "attendance.read");
  const access = await requireOfferingManagement(account, offeringId, db);

  const offering = await db.courseOffering.findFirst({
    where: { id: access.offeringId, tenantId: access.tenantId },
    select: { settings: true },
  });
  if (!offering) throw new ResourceNotFoundError("Course not found.");

  return parseAttendancePolicy(offering.settings);
}

const policySchema = z.object({
  lockAfterHours: z.coerce
    .number({ message: "Enter the number of hours as a whole number." })
    .int("Enter a whole number of hours.")
    .min(MIN_LOCK_AFTER_HOURS, "The lock cannot be negative.")
    .max(MAX_LOCK_AFTER_HOURS, `The lock cannot be more than ${MAX_LOCK_AFTER_HOURS} hours.`),
});

export type SetAttendancePolicyInput = z.input<typeof policySchema>;

/** Stores the lock window in the offering settings, keeping other settings. */
export async function setAttendancePolicy(
  account: AccountContext,
  offeringId: string,
  input: SetAttendancePolicyInput,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<AttendancePolicy> {
  requirePermission(account, "attendance.manage");
  const access = await requireOfferingManagement(account, offeringId, db);
  const parsed = policySchema.parse(input);

  return db.$transaction(async (tx) => {
    const offering = await tx.courseOffering.findFirst({
      where: { id: access.offeringId, tenantId: access.tenantId },
      select: { settings: true },
    });
    if (!offering) throw new ResourceNotFoundError("Course not found.");

    const before = parseAttendancePolicy(offering.settings);
    const after: AttendancePolicy = { lockAfterHours: parsed.lockAfterHours };

    await tx.courseOffering.update({
      where: { id: access.offeringId },
      data: { settings: withAttendancePolicy(offering.settings, after) as object },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "attendance.policy_updated",
      resourceType: "course_offering",
      resourceId: access.offeringId,
      before: { lockAfterHours: before.lockAfterHours },
      after: { lockAfterHours: after.lockAfterHours },
      requestId: context.requestId,
    });

    return after;
  });
}

async function loadSessionForLock(account: AccountContext, sessionId: string, db: DatabaseClient) {
  if (!account.tenant) throw new ResourceNotFoundError("Session not found.");
  const tenantId = account.tenant.tenantId;

  const session = await db.liveSession.findFirst({
    where: { id: sessionId, tenantId },
    select: {
      id: true,
      offeringId: true,
      status: true,
      endsAt: true,
      attendanceLockedAt: true,
      attendanceReopenedAt: true,
      offering: { select: { settings: true } },
    },
  });
  if (!session) throw new ResourceNotFoundError("Session not found.");

  const access = await requireOfferingManagement(account, session.offeringId, db);
  return { tenantId, session, access, policy: parseAttendancePolicy(session.offering.settings) };
}

/** Freezes a session's attendance immediately, before the policy would. */
export async function lockSessionAttendance(
  account: AccountContext,
  sessionId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<AttendanceLock> {
  requirePermission(account, "attendance.manage");
  const { tenantId, session } = await loadSessionForLock(account, sessionId, db);

  if (session.status === LiveSessionStatus.CANCELLED) {
    throw new ConflictError("A cancelled session has no attendance to lock.");
  }

  const lockedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.liveSession.update({
      where: { id: session.id },
      data: { attendanceLockedAt: lockedAt },
    });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "attendance.locked",
      resourceType: "live_session",
      resourceId: session.id,
      after: { lockedAt: lockedAt.toISOString() },
      requestId: context.requestId,
    });
  });

  return { locked: true, lockAt: lockedAt, reason: "manual" };
}

/**
 * Lifts both the policy lock and any manual lock for one session. Restricted to
 * administrators: the record is already closed for everyone else.
 */
export async function reopenSessionAttendance(
  account: AccountContext,
  sessionId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<AttendanceLock> {
  requirePermission(account, "institution.settings.manage");
  const { tenantId, session, policy } = await loadSessionForLock(account, sessionId, db);

  if (session.status === LiveSessionStatus.CANCELLED) {
    throw new ConflictError("A cancelled session has no attendance.");
  }

  const current = attendanceLockFor(
    {
      status: sessionStatusKey(session.status),
      endsAt: session.endsAt,
      attendanceLockedAt: session.attendanceLockedAt,
      attendanceReopenedAt: session.attendanceReopenedAt,
    },
    policy,
  );
  if (!current.locked) throw new ConflictError("Attendance for this session is already open.");

  const reopenedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.liveSession.update({
      where: { id: session.id },
      data: { attendanceReopenedAt: reopenedAt, attendanceReopenedByUserId: account.user.id },
    });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "attendance.reopened",
      resourceType: "live_session",
      resourceId: session.id,
      before: { lockedAt: current.lockAt?.toISOString() ?? null, reason: current.reason },
      after: { reopenedAt: reopenedAt.toISOString() },
      requestId: context.requestId,
    });
  });

  return attendanceLockFor(
    {
      status: sessionStatusKey(session.status),
      endsAt: session.endsAt,
      attendanceLockedAt: session.attendanceLockedAt,
      attendanceReopenedAt: reopenedAt,
    },
    policy,
  );
}

// ---------------------------------------------------------------------------
// Course attendance report
// ---------------------------------------------------------------------------

export type AttendanceReportSession = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: ReturnType<typeof sessionStatusKey>;
  lock: AttendanceLock;
};

export type AttendanceReportRow = {
  userId: string;
  name: string;
  email: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Delivered sessions with no record for this learner. */
  unmarked: number;
  /** Present plus late. */
  attended: number;
  /** Sessions that count towards the rate: attended plus absent. */
  recorded: number;
  rate: number | null;
};

export type AttendanceReport = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  policy: AttendancePolicy;
  /** Sessions that have already ended; cancelled ones are excluded. */
  sessions: AttendanceReportSession[];
  upcomingSessions: number;
  rows: AttendanceReportRow[];
  totals: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    unmarked: number;
    attended: number;
    recorded: number;
  };
  rate: number | null;
  generatedAt: Date;
};

/**
 * Per-learner attendance for one course, counting only sessions that have
 * already happened. Missing records are reported as unmarked rather than as
 * absences, so a teacher who forgot to mark a class does not silently depress
 * everyone's rate.
 */
export async function getAttendanceReport(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
  now: Date = new Date(),
): Promise<AttendanceReport> {
  requirePermission(account, "attendance.read");
  requirePermission(account, "reports.course.read");
  const access = await requireOfferingManagement(account, offeringId, db);
  const tenantId = access.tenantId;

  const [offering, sessions, enrolments] = await Promise.all([
    db.courseOffering.findFirst({
      where: { id: access.offeringId, tenantId },
      select: { settings: true },
    }),
    db.liveSession.findMany({
      where: { tenantId, offeringId: access.offeringId },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        status: true,
        attendanceLockedAt: true,
        attendanceReopenedAt: true,
      },
    }),
    db.enrolment.findMany({
      where: { tenantId, courseOfferingId: access.offeringId, status: "ACTIVE" },
      orderBy: { user: { name: "asc" } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);

  if (!offering) throw new ResourceNotFoundError("Course not found.");
  const policy = parseAttendancePolicy(offering.settings);

  const delivered = sessions.filter(
    (session) =>
      session.status !== LiveSessionStatus.CANCELLED && session.endsAt.getTime() <= now.getTime(),
  );
  const upcomingSessions = sessions.filter(
    (session) =>
      session.status === LiveSessionStatus.SCHEDULED && session.endsAt.getTime() > now.getTime(),
  ).length;

  const reportSessions: AttendanceReportSession[] = delivered.map((session) => {
    const status = sessionStatusKey(session.status);
    return {
      id: session.id,
      title: session.title,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status,
      lock: attendanceLockFor(
        {
          status,
          endsAt: session.endsAt,
          attendanceLockedAt: session.attendanceLockedAt,
          attendanceReopenedAt: session.attendanceReopenedAt,
        },
        policy,
        now,
      ),
    };
  });

  const deliveredIds = new Set(delivered.map((session) => session.id));
  const records = deliveredIds.size
    ? await db.attendanceRecord.findMany({
        where: { tenantId, sessionId: { in: [...deliveredIds] } },
        select: { sessionId: true, userId: true, status: true },
      })
    : [];

  const byLearner = new Map<string, Map<string, AttendanceStatusKey>>();
  for (const record of records) {
    const forSession = byLearner.get(record.userId) ?? new Map<string, AttendanceStatusKey>();
    forSession.set(record.sessionId, attendanceStatusKey(record.status));
    byLearner.set(record.userId, forSession);
  }

  const rows: AttendanceReportRow[] = enrolments.map((enrolment) => {
    const own = byLearner.get(enrolment.userId) ?? new Map<string, AttendanceStatusKey>();
    const counts: Record<AttendanceStatusKey, number> = {
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
    };
    let unmarked = 0;
    for (const session of delivered) {
      const status = own.get(session.id);
      if (status) counts[status] += 1;
      else unmarked += 1;
    }
    const attended = counts.present + counts.late;
    const recorded = attended + counts.absent;

    return {
      userId: enrolment.userId,
      name: enrolment.user.name,
      email: enrolment.user.email,
      present: counts.present,
      late: counts.late,
      absent: counts.absent,
      excused: counts.excused,
      unmarked,
      attended,
      recorded,
      rate: attendanceRate(attended, recorded),
    };
  });

  const totals = rows.reduce(
    (sum, row) => ({
      present: sum.present + row.present,
      late: sum.late + row.late,
      absent: sum.absent + row.absent,
      excused: sum.excused + row.excused,
      unmarked: sum.unmarked + row.unmarked,
      attended: sum.attended + row.attended,
      recorded: sum.recorded + row.recorded,
    }),
    { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0, attended: 0, recorded: 0 },
  );

  return {
    offeringId: access.offeringId,
    courseCode: access.courseCode,
    courseTitle: access.courseTitle,
    termName: access.termName,
    policy,
    sessions: reportSessions,
    upcomingSessions,
    rows,
    totals,
    rate: attendanceRate(totals.attended, totals.recorded),
    generatedAt: now,
  };
}

/** CSV mirror of the report: one row per learner, then a cohort total. */
export function attendanceReportToCsv(report: AttendanceReport): string {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const header = [
    "Learner",
    "Email",
    `Delivered sessions (${report.sessions.length})`,
    "Present",
    "Late",
    "Absent",
    "Excused",
    "Unmarked",
    "Recorded",
    "Attendance rate",
  ];

  const rateText = (rate: number | null): string =>
    rate === null ? "" : `${(rate * 100).toFixed(2)}%`;

  const rows = report.rows.map((row) =>
    [
      row.name,
      row.email,
      String(report.sessions.length),
      String(row.present),
      String(row.late),
      String(row.absent),
      String(row.excused),
      String(row.unmarked),
      String(row.recorded),
      rateText(row.rate),
    ].map(escape),
  );

  const total = [
    "All learners",
    "",
    String(report.sessions.length),
    String(report.totals.present),
    String(report.totals.late),
    String(report.totals.absent),
    String(report.totals.excused),
    String(report.totals.unmarked),
    String(report.totals.recorded),
    rateText(report.rate),
  ].map(escape);

  return `${[header.map(escape).join(","), ...rows.map((row) => row.join(",")), total.join(",")].join("\r\n")}\r\n`;
}
