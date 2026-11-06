/**
 * Attendance Health & 75% Rule Engine — Phase 15.
 *
 * Implements real-time attendance health tracking, the mandatory 75% minimum
 * university attendance threshold (DigiiCampus / UGC compliance), debarment
 * risk indicators, and recovery calculators (how many consecutive classes must
 * be attended to restore safe status, or how many can be missed safely).
 */

import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";
import { requireOfferingManagement } from "@/modules/sessions/session-service";
import { AttendanceStatus, LiveSessionStatus } from "../../generated/prisma/client";

export const SAFE_ATTENDANCE_THRESHOLD = 0.75; // 75.0%
export const WARNING_ATTENDANCE_THRESHOLD = 0.7; // 70.0%

export type AttendanceHealthStatus = "safe" | "warning" | "critical" | "unrecorded";

export type AttendanceHealth = {
  percentage: number | null;
  formattedPercentage: string;
  status: AttendanceHealthStatus;
  attended: number;
  recorded: number;
  absent: number;
  excused: number;
  unmarked: number;
  totalConducted: number;
  classesNeededToSafe: number;
  classesCanMiss: number;
  isDebarred: boolean;
  message: string;
};

export type CourseAttendanceHealth = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  academicYearName: string;
  termName: string;
  health: AttendanceHealth;
};

export type LearnerAttendanceSummary = {
  overall: AttendanceHealth;
  courses: CourseAttendanceHealth[];
};

export type CohortRiskLearner = {
  userId: string;
  name: string;
  email: string;
  institutionalId: string | null;
  health: AttendanceHealth;
};

export type CohortRiskSummary = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  totalLearners: number;
  safeCount: number;
  warningCount: number;
  criticalCount: number;
  learners: CohortRiskLearner[];
};

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

/**
 * Pure calculation function for attendance health metrics.
 *
 * Formula:
 * - Rate = Attended / Recorded
 * - If Rate >= 75%: Safe (can miss floor((4*Attended - 3*Recorded)/3) classes safely)
 * - If 70% <= Rate < 75%: Warning (must attend ceil(3*Recorded - 4*Attended) classes consecutively)
 * - If Rate < 70%: Critical / Debarment Risk
 */
export function computeAttendanceHealth(options: {
  attended: number;
  recorded: number;
  absent?: number;
  excused?: number;
  unmarked?: number;
  totalConducted?: number;
}): AttendanceHealth {
  const {
    attended,
    recorded,
    absent = Math.max(0, recorded - attended),
    excused = 0,
    unmarked = 0,
    totalConducted = recorded + unmarked,
  } = options;

  if (recorded <= 0) {
    return {
      percentage: null,
      formattedPercentage: "N/A",
      status: "unrecorded",
      attended: 0,
      recorded: 0,
      absent: 0,
      excused: 0,
      unmarked,
      totalConducted,
      classesNeededToSafe: 0,
      classesCanMiss: 0,
      isDebarred: false,
      message: "No attendance recorded yet for this course.",
    };
  }

  const rate = attended / recorded;
  const percentage = Math.round(rate * 1000) / 10; // e.g. 78.5
  const formattedPercentage = `${percentage.toFixed(1)}%`;

  if (rate >= SAFE_ATTENDANCE_THRESHOLD) {
    // Formula: floor((4*attended - 3*recorded) / 3)
    const canMiss = Math.max(0, Math.floor((4 * attended - 3 * recorded) / 3));
    return {
      percentage,
      formattedPercentage,
      status: "safe",
      attended,
      recorded,
      absent,
      excused,
      unmarked,
      totalConducted,
      classesNeededToSafe: 0,
      classesCanMiss: canMiss,
      isDebarred: false,
      message:
        canMiss > 0
          ? `Safe! You can miss up to ${canMiss} class${canMiss > 1 ? "es" : ""} and remain above 75%.`
          : "Good standing. Maintain attendance above 75%.",
    };
  }

  // Under 75%: calculate consecutive classes needed
  // Formula: ceil(3*recorded - 4*attended)
  const needed = Math.max(1, Math.ceil(3 * recorded - 4 * attended));
  const isCritical = rate < WARNING_ATTENDANCE_THRESHOLD;

  return {
    percentage,
    formattedPercentage,
    status: isCritical ? "critical" : "warning",
    attended,
    recorded,
    absent,
    excused,
    unmarked,
    totalConducted,
    classesNeededToSafe: needed,
    classesCanMiss: 0,
    isDebarred: isCritical,
    message: isCritical
      ? `Critical! Attendance is below 70%. Attend next ${needed} class${needed > 1 ? "es" : ""} to avoid exam debarment.`
      : `Warning: Below 75% threshold. Attend next ${needed} class${needed > 1 ? "es" : ""} to reach safe standing.`,
  };
}

/**
 * Returns complete attendance health summary for the authenticated student across all enrolled courses.
 */
export async function getLearnerAttendanceSummary(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<LearnerAttendanceSummary> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);

  const enrolments = await db.enrolment.findMany({
    where: {
      tenantId,
      userId: account.user.id,
      status: "ACTIVE",
    },
    include: {
      offering: {
        include: {
          course: { select: { code: true, title: true } },
          term: {
            select: {
              name: true,
              academicYear: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (enrolments.length === 0) {
    const emptyHealth = computeAttendanceHealth({ attended: 0, recorded: 0 });
    return { overall: emptyHealth, courses: [] };
  }

  const offeringIds = enrolments.map((e) => e.courseOfferingId);

  // Fetch all non-cancelled sessions for these offerings
  const sessions = await db.liveSession.findMany({
    where: {
      tenantId,
      offeringId: { in: offeringIds },
      status: { not: LiveSessionStatus.CANCELLED },
    },
    select: {
      id: true,
      offeringId: true,
      startsAt: true,
      status: true,
      attendance: {
        where: { userId: account.user.id },
        select: { status: true },
      },
    },
  });

  const sessionsByOffering = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const current = sessionsByOffering.get(session.offeringId) ?? [];
    current.push(session);
    sessionsByOffering.set(session.offeringId, current);
  }

  let totalAttended = 0;
  let totalRecorded = 0;
  let totalAbsent = 0;
  let totalExcused = 0;
  let totalUnmarked = 0;

  const courses: CourseAttendanceHealth[] = enrolments.map((enrolment) => {
    const offeringSessions = sessionsByOffering.get(enrolment.courseOfferingId) ?? [];
    let coursePresent = 0;
    let courseLate = 0;
    let courseAbsent = 0;
    let courseExcused = 0;
    let courseUnmarked = 0;

    for (const session of offeringSessions) {
      const record = session.attendance[0];
      if (!record) {
        courseUnmarked += 1;
      } else {
        switch (record.status) {
          case AttendanceStatus.PRESENT:
            coursePresent += 1;
            break;
          case AttendanceStatus.LATE:
            courseLate += 1;
            break;
          case AttendanceStatus.EXCUSED:
            courseExcused += 1;
            break;
          case AttendanceStatus.ABSENT:
          default:
            courseAbsent += 1;
            break;
        }
      }
    }

    const courseAttended = coursePresent + courseLate + courseExcused;
    const courseRecorded = courseAttended + courseAbsent;

    totalAttended += courseAttended;
    totalRecorded += courseRecorded;
    totalAbsent += courseAbsent;
    totalExcused += courseExcused;
    totalUnmarked += courseUnmarked;

    const health = computeAttendanceHealth({
      attended: courseAttended,
      recorded: courseRecorded,
      absent: courseAbsent,
      excused: courseExcused,
      unmarked: courseUnmarked,
      totalConducted: offeringSessions.length,
    });

    return {
      offeringId: enrolment.courseOfferingId,
      courseCode: enrolment.offering.course.code,
      courseTitle: enrolment.offering.course.title,
      academicYearName: enrolment.offering.term.academicYear.name,
      termName: enrolment.offering.term.name,
      health,
    };
  });

  const overall = computeAttendanceHealth({
    attended: totalAttended,
    recorded: totalRecorded,
    absent: totalAbsent,
    excused: totalExcused,
    unmarked: totalUnmarked,
  });

  return { overall, courses };
}

/**
 * Returns attendance health for a single course offering for the current learner.
 */
export async function getLearnerCourseAttendanceHealth(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<AttendanceHealth> {
  const tenantId = tenantIdOf(account);
  const sessions = await db.liveSession.findMany({
    where: {
      tenantId,
      offeringId,
      status: { not: LiveSessionStatus.CANCELLED },
    },
    select: {
      id: true,
      attendance: {
        where: { userId: account.user.id },
        select: { status: true },
      },
    },
  });

  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  let unmarked = 0;

  for (const session of sessions) {
    const record = session.attendance[0];
    if (!record) {
      unmarked += 1;
    } else {
      switch (record.status) {
        case AttendanceStatus.PRESENT:
          present += 1;
          break;
        case AttendanceStatus.LATE:
          late += 1;
          break;
        case AttendanceStatus.EXCUSED:
          excused += 1;
          break;
        case AttendanceStatus.ABSENT:
        default:
          absent += 1;
          break;
      }
    }
  }

  const attended = present + late + excused;
  const recorded = attended + absent;

  return computeAttendanceHealth({
    attended,
    recorded,
    absent,
    excused,
    unmarked,
    totalConducted: sessions.length,
  });
}

/**
 * Returns the cohort attendance risk roster for a course offering (Faculty/Admin view).
 * Identifies students below the 75% threshold and ranks them by debarment risk.
 */
export async function getCohortAttendanceRiskRoster(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<CohortRiskSummary> {
  requirePermission(account, "attendance.read");
  const access = await requireOfferingManagement(account, offeringId, db);

  const [offering, enrolments, sessions] = await Promise.all([
    db.courseOffering.findFirst({
      where: { id: offeringId, tenantId: access.tenantId },
      select: {
        course: { select: { code: true, title: true } },
      },
    }),
    db.enrolment.findMany({
      where: {
        tenantId: access.tenantId,
        courseOfferingId: offeringId,
        status: "ACTIVE",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            memberships: {
              where: { tenantId: access.tenantId },
              select: { institutionalId: true },
            },
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    }),
    db.liveSession.findMany({
      where: {
        tenantId: access.tenantId,
        offeringId,
        status: { not: LiveSessionStatus.CANCELLED },
      },
      select: {
        id: true,
        attendance: { select: { userId: true, status: true } },
      },
    }),
  ]);

  if (!offering) throw new ResourceNotFoundError("Course offering not found.");

  // Map attendance records per user
  const attendanceByUser = new Map<string, AttendanceStatus[]>();
  for (const session of sessions) {
    for (const record of session.attendance) {
      const records = attendanceByUser.get(record.userId) ?? [];
      records.push(record.status);
      attendanceByUser.set(record.userId, records);
    }
  }

  let safeCount = 0;
  let warningCount = 0;
  let criticalCount = 0;

  const learners: CohortRiskLearner[] = enrolments.map((enrolment) => {
    const userRecords = attendanceByUser.get(enrolment.userId) ?? [];
    let present = 0;
    let late = 0;
    let excused = 0;
    let absent = 0;

    for (const st of userRecords) {
      if (st === AttendanceStatus.PRESENT) present += 1;
      else if (st === AttendanceStatus.LATE) late += 1;
      else if (st === AttendanceStatus.EXCUSED) excused += 1;
      else absent += 1;
    }

    const attended = present + late + excused;
    const recorded = attended + absent;
    const unmarked = Math.max(0, sessions.length - userRecords.length);

    const health = computeAttendanceHealth({
      attended,
      recorded,
      absent,
      excused,
      unmarked,
      totalConducted: sessions.length,
    });

    if (health.status === "safe" || health.status === "unrecorded") safeCount += 1;
    else if (health.status === "warning") warningCount += 1;
    else if (health.status === "critical") criticalCount += 1;

    return {
      userId: enrolment.userId,
      name: enrolment.user.name,
      email: enrolment.user.email,
      institutionalId: enrolment.user.memberships[0]?.institutionalId ?? null,
      health,
    };
  });

  // Sort: Critical first, then Warning, then Safe
  learners.sort((a, b) => {
    const score = (status: AttendanceHealthStatus) =>
      status === "critical" ? 0 : status === "warning" ? 1 : status === "safe" ? 2 : 3;
    const diff = score(a.health.status) - score(b.health.status);
    if (diff !== 0) return diff;
    return (a.health.percentage ?? 100) - (b.health.percentage ?? 100);
  });

  return {
    offeringId,
    courseCode: offering.course.code,
    courseTitle: offering.course.title,
    totalLearners: learners.length,
    safeCount,
    warningCount,
    criticalCount,
    learners,
  };
}
