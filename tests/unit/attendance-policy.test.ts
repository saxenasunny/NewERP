import { describe, expect, it } from "vitest";

import {
  attendanceLockFor,
  attendanceRate,
  DEFAULT_ATTENDANCE_POLICY,
  formatAttendanceRate,
  parseAttendancePolicy,
  withAttendancePolicy,
} from "@/modules/attendance/policy";

const DAY = 86_400_000;
const ENDS = new Date("2026-09-10T10:00:00.000Z");

describe("attendance policy", () => {
  it("falls back to the default for missing, malformed, or out-of-range settings", () => {
    for (const value of [
      undefined,
      null,
      "168",
      [],
      {},
      { attendance: "week" },
      { attendance: { lockAfterHours: -1 } },
      { attendance: { lockAfterHours: 5000 } },
      { attendance: { lockAfterHours: 1.5 } },
    ]) {
      expect(parseAttendancePolicy(value)).toEqual(DEFAULT_ATTENDANCE_POLICY);
    }
  });

  it("accepts a whole number of hours, including zero", () => {
    expect(parseAttendancePolicy({ attendance: { lockAfterHours: 0 } })).toEqual({
      lockAfterHours: 0,
    });
    expect(parseAttendancePolicy({ attendance: { lockAfterHours: 72 } })).toEqual({
      lockAfterHours: 72,
    });
    expect(parseAttendancePolicy({ attendance: { lockAfterHours: "48" } })).toEqual({
      lockAfterHours: 48,
    });
  });

  it("writes the policy without losing the other offering settings", () => {
    expect(withAttendancePolicy({ grading: { scheme: "x" } }, { lockAfterHours: 24 })).toEqual({
      grading: { scheme: "x" },
      attendance: { lockAfterHours: 24 },
    });
    expect(withAttendancePolicy(null, { lockAfterHours: 24 })).toEqual({
      attendance: { lockAfterHours: 24 },
    });
  });

  it("stays open until the policy window closes", () => {
    const policy = { lockAfterHours: 24 };
    const open = attendanceLockFor(
      { status: "scheduled", endsAt: ENDS },
      policy,
      new Date(ENDS.getTime() + 3_600_000),
    );
    expect(open).toEqual({
      locked: false,
      lockAt: new Date(ENDS.getTime() + DAY),
      reason: "open",
    });

    const locked = attendanceLockFor(
      { status: "scheduled", endsAt: ENDS },
      policy,
      new Date(ENDS.getTime() + DAY),
    );
    expect(locked.locked).toBe(true);
    expect(locked.reason).toBe("policy");
    expect(locked.lockAt).toEqual(new Date(ENDS.getTime() + DAY));
  });

  it("locks a cancelled session regardless of the policy", () => {
    const lock = attendanceLockFor({ status: "cancelled", endsAt: ENDS }, { lockAfterHours: 0 });
    expect(lock).toEqual({ locked: true, lockAt: null, reason: "cancelled" });
  });

  it("honours a manual lock and lets an administrator reopen it", () => {
    const policy = { lockAfterHours: 168 };
    const manuallyLocked = attendanceLockFor(
      {
        status: "scheduled",
        endsAt: ENDS,
        attendanceLockedAt: new Date(ENDS.getTime() + 3_600_000),
      },
      policy,
      new Date(ENDS.getTime() + 2 * 3_600_000),
    );
    expect(manuallyLocked.reason).toBe("manual");

    const reopened = attendanceLockFor(
      {
        status: "scheduled",
        endsAt: ENDS,
        attendanceLockedAt: new Date(ENDS.getTime() + 3_600_000),
        attendanceReopenedAt: new Date(ENDS.getTime() + 2 * 3_600_000),
      },
      policy,
      new Date(ENDS.getTime() + 2 * 3_600_000),
    );
    expect(reopened.locked).toBe(false);
  });

  it("does not let an earlier reopen undo a later manual lock", () => {
    const lock = attendanceLockFor(
      {
        status: "scheduled",
        endsAt: ENDS,
        attendanceLockedAt: new Date(ENDS.getTime() + 10 * 3_600_000),
        attendanceReopenedAt: new Date(ENDS.getTime() + 5 * 3_600_000),
      },
      { lockAfterHours: 168 },
      new Date(ENDS.getTime() + 11 * 3_600_000),
    );
    expect(lock).toEqual({
      locked: true,
      lockAt: new Date(ENDS.getTime() + 10 * 3_600_000),
      reason: "manual",
    });
  });

  it("keeps a reopen in force after the policy window has already passed", () => {
    const lock = attendanceLockFor(
      {
        status: "scheduled",
        endsAt: ENDS,
        attendanceReopenedAt: new Date(ENDS.getTime() + 20 * DAY),
      },
      { lockAfterHours: 24 },
      new Date(ENDS.getTime() + 21 * DAY),
    );
    expect(lock.locked).toBe(false);
  });

  it("computes rates from recorded statuses only", () => {
    expect(attendanceRate(0, 0)).toBeNull();
    expect(attendanceRate(3, 4)).toBe(0.75);
    expect(attendanceRate(2, 3)).toBe(0.6667);
    expect(formatAttendanceRate(null)).toBe("—");
    expect(formatAttendanceRate(0.75)).toBe("75.0%");
  });
});
