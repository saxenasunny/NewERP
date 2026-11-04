/**
 * QR attendance — Phase 13.
 *
 * Staff open a short-lived check-in code for one session; the code is a signed
 * token carrying the session, a nonce, and an expiry. Learners who scan it are
 * marked present for themselves only.
 *
 * Anti-replay has two independent parts:
 *
 * 1. The token names a nonce stored on the session. Generating a new code (or
 *    closing the old one) replaces the nonce, so a previously captured token
 *    stops working even though its signature remains valid.
 * 2. `attendance_records` is unique on `(sessionId, userId)`. A learner who
 *    scans twice, or two requests racing, produces one row; the second attempt
 *    is reported as already recorded and never overwrites a staff correction.
 *
 * An existing record is never rewritten by a scan: if staff already marked the
 * learner absent, scanning the code does not silently turn it into present.
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { getServerEnv } from "@/lib/env";
import {
  ConflictError,
  InvalidLinkError,
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";
import {
  attendanceLockFor,
  parseAttendancePolicy,
  type AttendanceLock,
} from "@/modules/attendance/policy";
import {
  attendanceStatusKey,
  requireOfferingManagement,
  sessionStatusKey,
  type AttendanceStatusKey,
} from "@/modules/sessions/session-service";

import {
  AttendanceSource,
  AttendanceStatus,
  LiveSessionStatus,
} from "../../generated/prisma/client";

import {
  createNonce,
  deriveCheckInKey,
  signCheckInToken,
  verifyCheckInToken,
} from "./check-in-token";

export const MIN_CHECK_IN_MINUTES = 1;
export const MAX_CHECK_IN_MINUTES = 120;
export const DEFAULT_CHECK_IN_MINUTES = 10;

const minutesSchema = z.object({
  minutes: z.coerce
    .number({ message: "Enter the number of minutes as a whole number." })
    .int("Enter a whole number of minutes.")
    .min(MIN_CHECK_IN_MINUTES, `A check-in code lasts at least ${MIN_CHECK_IN_MINUTES} minute.`)
    .max(MAX_CHECK_IN_MINUTES, `A check-in code lasts at most ${MAX_CHECK_IN_MINUTES} minutes.`),
});

export type OpenCheckInInput = z.input<typeof minutesSchema>;

export type CheckInCode = {
  token: string;
  /** Absolute URL a QR code encodes; the learner must be signed in. */
  url: string;
  expiresAt: Date;
};

export type CheckInState = {
  /** The current code, or null when none is open. */
  code: CheckInCode | null;
  /** Records produced by a scan for this session. */
  checkedIn: number;
};

function signingKey(): Buffer {
  return deriveCheckInKey(getServerEnv().AUTH_SECRET);
}

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

function codeFor(session: {
  id: string;
  checkInNonce: string | null;
  checkInExpiresAt: Date | null;
}): CheckInCode {
  const nonce = session.checkInNonce;
  const expiresAt = session.checkInExpiresAt;
  if (!nonce || !expiresAt) throw new ConflictError("No check-in code is open for this session.");

  const token = signCheckInToken(
    { sessionId: session.id, nonce, expiresAt: Math.floor(expiresAt.getTime() / 1000) },
    signingKey(),
  );
  return {
    token,
    url: `${getServerEnv().APP_BASE_URL}/student/check-in/${token}`,
    expiresAt,
  };
}

async function loadStaffSession(account: AccountContext, sessionId: string, db: DatabaseClient) {
  const tenantId = tenantIdOf(account);
  const session = await db.liveSession.findFirst({
    where: { id: sessionId, tenantId },
    select: {
      id: true,
      offeringId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      attendanceLockedAt: true,
      attendanceReopenedAt: true,
      checkInNonce: true,
      checkInExpiresAt: true,
      offering: { select: { settings: true } },
    },
  });
  if (!session) throw new ResourceNotFoundError("Session not found.");

  const access = await requireOfferingManagement(account, session.offeringId, db);
  return { tenantId, session, access, policy: parseAttendancePolicy(session.offering.settings) };
}

/** The open code for staff display, or null once it has expired or was closed. */
export async function getCheckInState(
  account: AccountContext,
  sessionId: string,
  db: DatabaseClient = getDb(),
): Promise<CheckInState> {
  requirePermission(account, "attendance.read");
  const { tenantId, session } = await loadStaffSession(account, sessionId, db);

  const checkedIn = await db.attendanceRecord.count({
    where: { tenantId, sessionId: session.id, source: AttendanceSource.QR },
  });

  const active =
    session.checkInNonce &&
    session.checkInExpiresAt &&
    session.checkInExpiresAt.getTime() > Date.now();

  return { code: active ? codeFor(session) : null, checkedIn };
}

/**
 * Opens (or rotates) the session's code. Rotating is deliberate: a code that
 * leaked into a group chat dies the moment the lecturer presses the button
 * again.
 */
export async function openCheckInCode(
  account: AccountContext,
  sessionId: string,
  input: OpenCheckInInput,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<CheckInCode> {
  requirePermission(account, "attendance.manage");
  const { tenantId, session, policy } = await loadStaffSession(account, sessionId, db);
  const parsed = minutesSchema.parse(input);

  if (session.status === LiveSessionStatus.CANCELLED) {
    throw new ConflictError("A cancelled session cannot be checked into.");
  }

  const lock: AttendanceLock = attendanceLockFor(
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
      "Attendance for this session is closed; reopen it before issuing a code.",
    );
  }

  const expiresAt = new Date(Date.now() + parsed.minutes * 60_000);
  const nonce = createNonce();

  await db.$transaction(async (tx) => {
    await tx.liveSession.update({
      where: { id: session.id },
      data: { checkInNonce: nonce, checkInExpiresAt: expiresAt },
    });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "attendance.check_in_opened",
      resourceType: "live_session",
      resourceId: session.id,
      after: { minutes: parsed.minutes, expiresAt: expiresAt.toISOString() },
      requestId: context.requestId,
    });
  });

  return codeFor({ id: session.id, checkInNonce: nonce, checkInExpiresAt: expiresAt });
}

/** Closes the code. Idempotent: closing twice is not an error. */
export async function closeCheckInCode(
  account: AccountContext,
  sessionId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "attendance.manage");
  const { tenantId, session } = await loadStaffSession(account, sessionId, db);
  if (!session.checkInNonce && !session.checkInExpiresAt) return;

  await db.$transaction(async (tx) => {
    await tx.liveSession.update({
      where: { id: session.id },
      data: { checkInNonce: null, checkInExpiresAt: null },
    });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "attendance.check_in_closed",
      resourceType: "live_session",
      resourceId: session.id,
      requestId: context.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// Learner side
// ---------------------------------------------------------------------------

export type CheckInView = {
  sessionId: string;
  title: string;
  courseCode: string;
  courseTitle: string;
  startsAt: Date;
  endsAt: Date;
  ownStatus: AttendanceStatusKey | null;
  ownMarkedAt: Date | null;
  ownSource: "staff" | "qr" | null;
};

export type CheckInResult = {
  alreadyRecorded: boolean;
  status: AttendanceStatusKey;
  markedAt: Date;
  source: "staff" | "qr";
};

type ResolvedCheckIn = {
  tenantId: string;
  session: {
    id: string;
    offeringId: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    attendance: { status: AttendanceStatus; markedAt: Date; source: AttendanceSource }[];
    offering: { course: { code: string; title: string } };
  };
};

/**
 * Validates the token against the session's stored nonce, the clock, the
 * session state, the attendance lock, and the learner's enrolment. Every
 * failure is an expected error with a message the page can show; none of them
 * writes anything.
 */
async function resolveCheckIn(
  account: AccountContext,
  token: string,
  db: DatabaseClient,
): Promise<ResolvedCheckIn> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);

  const verification = verifyCheckInToken(token, signingKey());
  if (!verification.valid) {
    throw new InvalidLinkError(
      verification.reason === "expired"
        ? "This check-in code has expired. Ask your lecturer for a new one."
        : "This check-in link is not valid.",
    );
  }

  const session = await db.liveSession.findFirst({
    where: { id: verification.payload.sessionId, tenantId },
    select: {
      id: true,
      offeringId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      attendanceLockedAt: true,
      attendanceReopenedAt: true,
      checkInNonce: true,
      checkInExpiresAt: true,
      offering: {
        select: { settings: true, course: { select: { code: true, title: true } } },
      },
      attendance: {
        where: { userId: account.user.id },
        select: { status: true, markedAt: true, source: true },
      },
    },
  });
  if (!session) throw new ResourceNotFoundError("This check-in code is not valid.");

  if (!session.checkInNonce || session.checkInNonce !== verification.payload.nonce) {
    throw new InvalidLinkError("This check-in code is no longer active.");
  }
  if (!session.checkInExpiresAt || session.checkInExpiresAt.getTime() <= Date.now()) {
    throw new InvalidLinkError("This check-in code has expired. Ask your lecturer for a new one.");
  }
  if (session.status === LiveSessionStatus.CANCELLED) {
    throw new ConflictError("This session was cancelled.");
  }

  const lock = attendanceLockFor(
    {
      status: sessionStatusKey(session.status),
      endsAt: session.endsAt,
      attendanceLockedAt: session.attendanceLockedAt,
      attendanceReopenedAt: session.attendanceReopenedAt,
    },
    parseAttendancePolicy(session.offering.settings),
  );
  if (lock.locked) {
    throw new ConflictError("Attendance for this session is closed.");
  }

  const enrolment = await db.enrolment.findFirst({
    where: {
      tenantId,
      courseOfferingId: session.offeringId,
      userId: account.user.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!enrolment) throw new PermissionDeniedError("You are not enrolled in this course.");

  return { tenantId, session };
}

function sourceKey(source: AttendanceSource): "staff" | "qr" {
  return source === AttendanceSource.QR ? "qr" : "staff";
}

/** What the learner sees before pressing the button. */
export async function getCheckInView(
  account: AccountContext,
  token: string,
  db: DatabaseClient = getDb(),
): Promise<CheckInView> {
  const { session } = await resolveCheckIn(account, token, db);
  const own = session.attendance[0];
  return {
    sessionId: session.id,
    title: session.title,
    courseCode: session.offering.course.code,
    courseTitle: session.offering.course.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    ownStatus: own ? attendanceStatusKey(own.status) : null,
    ownMarkedAt: own?.markedAt ?? null,
    ownSource: own ? sourceKey(own.source) : null,
  };
}

/**
 * Records the learner present. An existing row (staff-marked, or an earlier
 * scan) is reported and left untouched; a concurrent duplicate is caught on the
 * unique index and treated the same way.
 */
export async function checkIn(
  account: AccountContext,
  token: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<CheckInResult> {
  const { tenantId, session } = await resolveCheckIn(account, token, db);
  const own = session.attendance[0];
  if (own) {
    return {
      alreadyRecorded: true,
      status: attendanceStatusKey(own.status),
      markedAt: own.markedAt,
      source: sourceKey(own.source),
    };
  }

  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      await tx.attendanceRecord.create({
        data: {
          tenantId,
          sessionId: session.id,
          userId: account.user.id,
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.QR,
          markedAt: now,
        },
      });
      await recordAuditEvent(tx, {
        tenantId,
        actorUserId: account.user.id,
        action: "attendance.checked_in",
        resourceType: "live_session",
        resourceId: session.id,
        after: { method: "qr", status: "present" },
        requestId: context.requestId,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await db.attendanceRecord.findFirst({
        where: { sessionId: session.id, userId: account.user.id },
        select: { status: true, markedAt: true, source: true },
      });
      if (!existing) throw error;
      return {
        alreadyRecorded: true,
        status: attendanceStatusKey(existing.status),
        markedAt: existing.markedAt,
        source: sourceKey(existing.source),
      };
    }
    throw error;
  }

  return { alreadyRecorded: false, status: "present", markedAt: now, source: "qr" };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
