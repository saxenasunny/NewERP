/**
 * Course announcements — Phase 9.
 *
 * An announcement belongs to one offering. Staff draft it, publish it, and can
 * withdraw it; learners see published rows only. Publishing notifies the
 * enrolled cohort once per learner, in-app and by email, and the notification
 * rows carry a dedupe key derived from the announcement, so a retried delivery
 * (or a second publish) notifies nobody twice.
 *
 * Editing or withdrawing already-released text is recorded in the audit trail
 * with the previous values, because a learner may already have read it.
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import type { AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import {
  activeLearners,
  requireAnnouncementAuthor,
  resolveAudience,
} from "@/modules/communication/audience";
import { notify } from "@/modules/notifications/dispatch";

import { AnnouncementStatus } from "../../generated/prisma/client";

export type AnnouncementStatusKey = "draft" | "published" | "withdrawn";

export function announcementStatusKey(status: AnnouncementStatus): AnnouncementStatusKey {
  if (status === AnnouncementStatus.PUBLISHED) return "published";
  if (status === AnnouncementStatus.WITHDRAWN) return "withdrawn";
  return "draft";
}

export type AnnouncementView = {
  id: string;
  title: string;
  body: string;
  status: AnnouncementStatusKey;
  pinned: boolean;
  authorName: string;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
};

export type AnnouncementList = {
  announcements: AnnouncementView[];
  role: "staff" | "learner";
  courseCode: string;
  courseTitle: string;
  termName: string;
};

const announcementSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give the announcement a title of at least 3 characters.")
    .max(140),
  body: z.string().trim().min(1, "Write the announcement text.").max(20_000),
  pinned: z.boolean().optional(),
});

export type AnnouncementInput = z.input<typeof announcementSchema>;

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

function toView(row: {
  id: string;
  title: string;
  body: string;
  status: AnnouncementStatus;
  pinned: boolean;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  author: { name: string };
}): AnnouncementView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: announcementStatusKey(row.status),
    pinned: row.pinned,
    authorName: row.author.name,
    publishedAt: row.publishedAt,
    withdrawnAt: row.withdrawnAt,
    createdAt: row.createdAt,
  };
}

const viewSelect = {
  id: true,
  title: true,
  body: true,
  status: true,
  pinned: true,
  publishedAt: true,
  withdrawnAt: true,
  createdAt: true,
  author: { select: { name: true } },
} as const;

/**
 * Staff see every announcement for the offering with drafts last in effect;
 * learners see published rows only, newest first, with pinned items on top.
 */
export async function listAnnouncements(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<AnnouncementList> {
  const audience = await resolveAudience(account, offeringId, db);

  const rows = await db.announcement.findMany({
    where: {
      tenantId: audience.tenantId,
      offeringId: audience.offeringId,
      ...(audience.role === "learner" ? { status: AnnouncementStatus.PUBLISHED } : {}),
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: viewSelect,
  });

  return {
    announcements: rows.map(toView),
    role: audience.role,
    courseCode: audience.courseCode,
    courseTitle: audience.courseTitle,
    termName: audience.termName,
  };
}

/** One announcement the caller may read, or a 404. */
export async function getAnnouncement(
  account: AccountContext,
  announcementId: string,
  db: DatabaseClient = getDb(),
): Promise<{ announcement: AnnouncementView; role: "staff" | "learner" }> {
  const row = await db.announcement.findFirst({
    where: { id: announcementId, tenantId: tenantIdOf(account) },
    select: { ...viewSelect, offeringId: true },
  });
  if (!row) throw new ResourceNotFoundError("Announcement not found.");

  const audience = await resolveAudience(account, row.offeringId, db);
  if (audience.role === "learner" && row.status !== AnnouncementStatus.PUBLISHED) {
    throw new ResourceNotFoundError("Announcement not found.");
  }
  return { announcement: toView(row), role: audience.role };
}

/**
 * Creates an announcement, publishing it immediately when `publish` is set.
 * Publishing and its audit row commit together; delivery failures are logged
 * and never roll the announcement back.
 */
export async function createAnnouncement(
  account: AccountContext,
  offeringId: string,
  input: AnnouncementInput,
  options: { publish: boolean; requestId?: string | null },
  db: DatabaseClient = getDb(),
): Promise<AnnouncementView> {
  const audience = await requireAnnouncementAuthor(account, offeringId, db);
  const parsed = announcementSchema.parse(input);
  const publish = options.publish;

  const created = await db.$transaction(async (tx) => {
    const announcement = await tx.announcement.create({
      data: {
        tenantId: audience.tenantId,
        offeringId: audience.offeringId,
        authorUserId: account.user.id,
        title: parsed.title,
        body: parsed.body,
        pinned: parsed.pinned ?? false,
        status: publish ? AnnouncementStatus.PUBLISHED : AnnouncementStatus.DRAFT,
        publishedAt: publish ? new Date() : null,
      },
      select: viewSelect,
    });

    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: publish ? "announcement.published" : "announcement.drafted",
      resourceType: "announcement",
      resourceId: announcement.id,
      after: { title: parsed.title, pinned: parsed.pinned ?? false },
      requestId: options.requestId ?? null,
    });

    return announcement;
  });

  if (publish) await deliverAnnouncement(created.id, db);

  return toView(created);
}

/** Edits the text of an announcement; the previous values stay in the audit log. */
export async function updateAnnouncement(
  account: AccountContext,
  announcementId: string,
  input: AnnouncementInput,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<AnnouncementView> {
  const existing = await db.announcement.findFirst({
    where: { id: announcementId, tenantId: tenantIdOf(account) },
    select: { id: true, offeringId: true, title: true, body: true, pinned: true, status: true },
  });
  if (!existing) throw new ResourceNotFoundError("Announcement not found.");

  const audience = await requireAnnouncementAuthor(account, existing.offeringId, db);
  if (existing.status === AnnouncementStatus.WITHDRAWN) {
    throw new ConflictError("A withdrawn announcement cannot be edited.");
  }
  const parsed = announcementSchema.parse(input);

  const updated = await db.$transaction(async (tx) => {
    const announcement = await tx.announcement.update({
      where: { id: existing.id },
      data: { title: parsed.title, body: parsed.body, pinned: parsed.pinned ?? false },
      select: viewSelect,
    });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "announcement.updated",
      resourceType: "announcement",
      resourceId: existing.id,
      before: { title: existing.title, body: existing.body, pinned: existing.pinned },
      after: { title: parsed.title, body: parsed.body, pinned: parsed.pinned ?? false },
      requestId: options.requestId ?? null,
    });
    return announcement;
  });

  return toView(updated);
}

/** Publishes a draft to the cohort. Withdrawn announcements stay withdrawn. */
export async function publishAnnouncement(
  account: AccountContext,
  announcementId: string,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<{ notified: number }> {
  const existing = await db.announcement.findFirst({
    where: { id: announcementId, tenantId: tenantIdOf(account) },
    select: { id: true, offeringId: true, status: true, title: true },
  });
  if (!existing) throw new ResourceNotFoundError("Announcement not found.");

  const audience = await requireAnnouncementAuthor(account, existing.offeringId, db);
  if (existing.status === AnnouncementStatus.PUBLISHED) return { notified: 0 };
  if (existing.status === AnnouncementStatus.WITHDRAWN) {
    throw new ConflictError("A withdrawn announcement cannot be republished.");
  }

  const publishedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.announcement.update({
      where: { id: existing.id },
      data: { status: AnnouncementStatus.PUBLISHED, publishedAt },
    });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "announcement.published",
      resourceType: "announcement",
      resourceId: existing.id,
      after: { title: existing.title, publishedAt: publishedAt.toISOString() },
      requestId: options.requestId ?? null,
    });
  });

  return deliverAnnouncement(existing.id, db);
}

/** Removes a published announcement from the cohort's view. */
export async function withdrawAnnouncement(
  account: AccountContext,
  announcementId: string,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<void> {
  const existing = await db.announcement.findFirst({
    where: { id: announcementId, tenantId: tenantIdOf(account) },
    select: { id: true, offeringId: true, status: true, title: true },
  });
  if (!existing) throw new ResourceNotFoundError("Announcement not found.");

  const audience = await requireAnnouncementAuthor(account, existing.offeringId, db);
  if (existing.status !== AnnouncementStatus.PUBLISHED) {
    throw new ConflictError("Only a published announcement can be withdrawn.");
  }

  const withdrawnAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.announcement.update({
      where: { id: existing.id },
      data: { status: AnnouncementStatus.WITHDRAWN, withdrawnAt },
    });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "announcement.withdrawn",
      resourceType: "announcement",
      resourceId: existing.id,
      before: { title: existing.title, status: "published" },
      after: { status: "withdrawn", withdrawnAt: withdrawnAt.toISOString() },
      requestId: options.requestId ?? null,
    });
  });
}

/**
 * Sends the cohort one notification and one email per learner for a published
 * announcement. Re-running it is harmless: the in-app notice and the queued
 * email are both keyed on the announcement, so a replay sends nothing twice.
 */
export async function deliverAnnouncement(
  announcementId: string,
  db: DatabaseClient = getDb(),
): Promise<{ notified: number }> {
  const announcement = await db.announcement.findFirst({
    where: { id: announcementId },
    select: {
      id: true,
      tenantId: true,
      offeringId: true,
      title: true,
      body: true,
      status: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
    },
  });
  if (!announcement) throw new ResourceNotFoundError("Announcement not found.");
  if (announcement.status !== AnnouncementStatus.PUBLISHED) return { notified: 0 };

  const learners = await activeLearners(db, announcement.tenantId, announcement.offeringId);
  if (learners.length === 0) return { notified: 0 };

  const dedupeKey = `announcement:${announcement.id}:published`;
  const courseCode = announcement.offering.course.code;
  const href = `/student/courses/${announcement.offeringId}/announcements`;
  try {
    const result = await notify(db, {
      tenantId: announcement.tenantId,
      category: "announcements",
      template: "announcement.published",
      recipients: learners,
      payload: {
        href,
        courseCode,
        courseTitle: announcement.offering.course.title,
        announcementTitle: announcement.title,
        announcementBody: announcement.body,
      },
      dedupeKey,
    });
    return { notified: result.inApp.length };
  } catch (error) {
    // Without the ledger we cannot prove idempotence; report nobody notified
    // rather than claiming the cohort was told.
    log("error", "announcement.notification_failed", {
      announcementId: announcement.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { notified: 0 };
  }
}
