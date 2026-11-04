/**
 * Attendance lock policy — Phase 9.
 *
 * Two things can freeze a session's attendance: the course policy (attendance
 * becomes read-only a number of hours after the session ends) and an explicit
 * lock recorded by staff. An administrator can reopen a locked session, and the
 * audit trail records who did it and when.
 *
 * This module is pure: no database, no permissions. The services and the UI both
 * call it, so the button a teacher sees and the rule the server enforces cannot
 * drift apart.
 */

export type AttendancePolicy = {
  /** Hours after a session ends before its attendance becomes read-only. */
  lockAfterHours: number;
};

/** One week: late corrections are normal, month-old silent edits are not. */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = { lockAfterHours: 168 };

export const MAX_LOCK_AFTER_HOURS = 2160; // 90 days
export const MIN_LOCK_AFTER_HOURS = 0;

/** Reads `settings.attendance` defensively; unknown shapes fall back to defaults. */
export function parseAttendancePolicy(settings: unknown): AttendancePolicy {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { ...DEFAULT_ATTENDANCE_POLICY };
  }
  const attendance = (settings as Record<string, unknown>).attendance;
  if (!attendance || typeof attendance !== "object" || Array.isArray(attendance)) {
    return { ...DEFAULT_ATTENDANCE_POLICY };
  }
  const raw = (attendance as Record<string, unknown>).lockAfterHours;
  const hours = Number(raw);
  if (!Number.isInteger(hours) || hours < MIN_LOCK_AFTER_HOURS || hours > MAX_LOCK_AFTER_HOURS) {
    return { ...DEFAULT_ATTENDANCE_POLICY };
  }
  return { lockAfterHours: hours };
}

/** The stored settings with this module's section replaced, nothing else lost. */
export function withAttendancePolicy(settings: unknown, policy: AttendancePolicy): unknown {
  const base =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  return { ...base, attendance: { ...policy } };
}

export type AttendanceLockReason = "cancelled" | "policy" | "manual" | "open";

export type AttendanceLock = {
  locked: boolean;
  /** When the lock took effect, or will, when it comes from the policy. */
  lockAt: Date | null;
  reason: AttendanceLockReason;
};

export type LockableSession = {
  status: "scheduled" | "cancelled" | "completed";
  endsAt: Date;
  attendanceLockedAt?: Date | null;
  attendanceReopenedAt?: Date | null;
};

/**
 * Decides whether attendance may still be edited. A reopen only lifts locks that
 * were already in force when it happened, so a later manual lock still holds.
 */
export function attendanceLockFor(
  session: LockableSession,
  policy: AttendancePolicy,
  now: Date = new Date(),
): AttendanceLock {
  if (session.status === "cancelled") {
    return { locked: true, lockAt: null, reason: "cancelled" };
  }

  const reopenedAt = session.attendanceReopenedAt ?? null;
  const manualLockAt = session.attendanceLockedAt ?? null;
  const policyLockAt = new Date(session.endsAt.getTime() + policy.lockAfterHours * 3_600_000);

  if (manualLockAt && (!reopenedAt || manualLockAt > reopenedAt)) {
    return { locked: true, lockAt: manualLockAt, reason: "manual" };
  }
  if (now.getTime() >= policyLockAt.getTime() && (!reopenedAt || reopenedAt < policyLockAt)) {
    return { locked: true, lockAt: policyLockAt, reason: "policy" };
  }
  return { locked: false, lockAt: policyLockAt, reason: "open" };
}

/**
 * Attendance rate for one learner or a whole cohort.
 *
 * Only sessions with a recorded present/late/absent status count, so missing
 * data stays visible instead of silently lowering the rate; excused absences are
 * excluded from the denominator. Returns null when nothing has been recorded.
 */
export function attendanceRate(attended: number, recorded: number): number | null {
  if (recorded <= 0) return null;
  return Math.round((attended / recorded) * 10_000) / 10_000;
}

export function formatAttendanceRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}
