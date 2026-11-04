/**
 * Who may read and write a course's communication — Phase 9.
 *
 * The communication surfaces have three audiences, and they are decided from the
 * caller rather than from the URL:
 *
 * - staff, who manage the offering and may see drafts, hidden threads, and
 *   hidden replies;
 * - learners, who are actively enrolled and see published material only;
 * - everyone else, who gets a 404 rather than a permission error so an outsider
 *   cannot probe which offerings exist.
 */

import type { AccountContext } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/account";
import type { DatabaseClient } from "@/lib/db/client";
import { ResourceNotFoundError } from "@/lib/errors";
import { getOfferingAccess } from "@/modules/content/content-service";
import { requireOfferingManagement } from "@/modules/sessions/session-service";

export type CommunicationAudience = {
  tenantId: string;
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  role: "staff" | "learner";
  /** Staff who manage the offering, or a moderator with the offering in scope. */
  canModerate: boolean;
};

/** Reader of a course's announcements and discussions. */
export async function resolveAudience(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient,
): Promise<CommunicationAudience> {
  requirePermission(account, "courses.read");
  const access = await getOfferingAccess(account, offeringId, db);

  if (access.canManage) {
    return {
      tenantId: access.tenantId,
      offeringId: access.offeringId,
      courseCode: access.courseCode,
      courseTitle: access.courseTitle,
      termName: access.termName,
      role: "staff",
      canModerate: account.permissions.has("discussions.moderate"),
    };
  }

  const enrolment = await db.enrolment.findFirst({
    where: {
      tenantId: access.tenantId,
      courseOfferingId: access.offeringId,
      userId: account.user.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!enrolment) throw new ResourceNotFoundError("Course not found.");

  return {
    tenantId: access.tenantId,
    offeringId: access.offeringId,
    courseCode: access.courseCode,
    courseTitle: access.courseTitle,
    termName: access.termName,
    role: "learner",
    canModerate: false,
  };
}

/** Author of a course announcement: staff only, and only with the permission. */
export async function requireAnnouncementAuthor(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient,
): Promise<CommunicationAudience> {
  requirePermission(account, "announcements.manage");
  const access = await requireOfferingManagement(account, offeringId, db);
  return {
    tenantId: access.tenantId,
    offeringId: access.offeringId,
    courseCode: access.courseCode,
    courseTitle: access.courseTitle,
    termName: access.termName,
    role: "staff",
    canModerate: account.permissions.has("discussions.moderate"),
  };
}

/** A moderator of a course discussion: the permission *and* the offering. */
export async function requireModerator(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient,
): Promise<CommunicationAudience> {
  requirePermission(account, "discussions.moderate");
  const access = await requireOfferingManagement(account, offeringId, db);
  return {
    tenantId: access.tenantId,
    offeringId: access.offeringId,
    courseCode: access.courseCode,
    courseTitle: access.courseTitle,
    termName: access.termName,
    role: "staff",
    canModerate: true,
  };
}

/** Active learners of an offering, with the address a notice goes to. */
export async function activeLearners(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
): Promise<{ userId: string; name: string; email: string }[]> {
  const rows = await db.enrolment.findMany({
    where: { tenantId, courseOfferingId: offeringId, status: "ACTIVE" },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  return rows.map((row) => ({ userId: row.userId, name: row.user.name, email: row.user.email }));
}
