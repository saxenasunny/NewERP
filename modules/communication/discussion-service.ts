/**
 * Course discussions with moderation — Phase 9.
 *
 * A thread belongs to one offering and has a starter post plus replies. Learners
 * and staff of the offering can read every visible thread and reply while it is
 * open; moderators (`discussions.moderate` *and* the offering in scope) can pin,
 * lock, hide, and restore.
 *
 * Moderation never deletes: a hidden thread or reply stays in the table with who
 * hid it and when, so a mistyped complaint can be reinstated and the audit trail
 * still points at real content. Locking stops new replies without hiding the
 * discussion, which is what a heated but factual thread usually needs.
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import type { AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";
import { requireModerator, resolveAudience } from "@/modules/communication/audience";
import { notify } from "@/modules/notifications/dispatch";

import { DiscussionPostStatus, DiscussionThreadStatus } from "../../generated/prisma/client";

export type ThreadStatusKey = "open" | "locked" | "hidden";

export function threadStatusKey(status: DiscussionThreadStatus): ThreadStatusKey {
  if (status === DiscussionThreadStatus.LOCKED) return "locked";
  if (status === DiscussionThreadStatus.HIDDEN) return "hidden";
  return "open";
}

function threadStatusFromKey(key: ThreadStatusKey): DiscussionThreadStatus {
  if (key === "locked") return DiscussionThreadStatus.LOCKED;
  if (key === "hidden") return DiscussionThreadStatus.HIDDEN;
  return DiscussionThreadStatus.OPEN;
}

export type ThreadSummary = {
  id: string;
  title: string;
  authorName: string;
  authorUserId: string;
  status: ThreadStatusKey;
  pinned: boolean;
  postCount: number;
  lastActivityAt: Date;
  createdAt: Date;
};

export type PostView = {
  id: string;
  body: string;
  authorName: string;
  authorUserId: string;
  status: "visible" | "hidden";
  hiddenAt: Date | null;
  createdAt: Date;
};

export type ThreadDetail = {
  thread: ThreadSummary & { body: string };
  posts: PostView[];
  role: "staff" | "learner";
  canModerate: boolean;
  canReply: boolean;
  courseCode: string;
  courseTitle: string;
  termName: string;
};

export type ThreadList = {
  threads: ThreadSummary[];
  role: "staff" | "learner";
  canModerate: boolean;
  courseCode: string;
  courseTitle: string;
  termName: string;
};

const threadSchema = z.object({
  title: z.string().trim().min(3, "Give the thread a subject of at least 3 characters.").max(140),
  body: z.string().trim().min(1, "Write your question or comment.").max(10_000),
});

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a reply.").max(10_000),
});

export type ThreadInput = z.input<typeof threadSchema>;
export type ReplyInput = z.input<typeof replySchema>;

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

/**
 * Threads the caller may see. Learners never see hidden threads; staff keep them
 * in the list, badged, so moderation state is never invisible to the moderator.
 */
export async function listThreads(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<ThreadList> {
  const audience = await resolveAudience(account, offeringId, db);

  const rows = await db.discussionThread.findMany({
    where: {
      tenantId: audience.tenantId,
      offeringId: audience.offeringId,
      ...(audience.role === "learner" ? { status: { not: DiscussionThreadStatus.HIDDEN } } : {}),
    },
    orderBy: [{ pinned: "desc" }, { lastActivityAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      authorUserId: true,
      status: true,
      pinned: true,
      postCount: true,
      lastActivityAt: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });

  return {
    threads: rows.map((row) => ({
      id: row.id,
      title: row.title,
      authorName: row.author.name,
      authorUserId: row.authorUserId,
      status: threadStatusKey(row.status),
      pinned: row.pinned,
      postCount: row.postCount,
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
    })),
    role: audience.role,
    canModerate: audience.canModerate,
    courseCode: audience.courseCode,
    courseTitle: audience.courseTitle,
    termName: audience.termName,
  };
}

/** One thread and its visible replies, or a 404 for outsiders and hidden threads. */
export async function getThread(
  account: AccountContext,
  threadId: string,
  db: DatabaseClient = getDb(),
): Promise<ThreadDetail> {
  const row = await db.discussionThread.findFirst({
    where: { id: threadId, tenantId: tenantIdOf(account) },
    select: {
      id: true,
      offeringId: true,
      title: true,
      body: true,
      authorUserId: true,
      status: true,
      pinned: true,
      postCount: true,
      lastActivityAt: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });
  if (!row) throw new ResourceNotFoundError("Discussion not found.");

  const audience = await resolveAudience(account, row.offeringId, db);
  const hidden = row.status === DiscussionThreadStatus.HIDDEN;
  if (hidden && audience.role === "learner")
    throw new ResourceNotFoundError("Discussion not found.");

  const posts = await db.discussionPost.findMany({
    where: {
      tenantId: audience.tenantId,
      threadId: row.id,
      ...(audience.role === "learner" ? { status: DiscussionPostStatus.VISIBLE } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      body: true,
      authorUserId: true,
      status: true,
      hiddenAt: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });

  return {
    thread: {
      id: row.id,
      title: row.title,
      body: row.body,
      authorName: row.author.name,
      authorUserId: row.authorUserId,
      status: threadStatusKey(row.status),
      pinned: row.pinned,
      postCount: row.postCount,
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
    },
    posts: posts.map((post) => ({
      id: post.id,
      body: post.body,
      authorName: post.author.name,
      authorUserId: post.authorUserId,
      status: post.status === DiscussionPostStatus.HIDDEN ? "hidden" : "visible",
      hiddenAt: post.hiddenAt,
      createdAt: post.createdAt,
    })),
    role: audience.role,
    canModerate: audience.canModerate,
    canReply: row.status === DiscussionThreadStatus.OPEN,
    courseCode: audience.courseCode,
    courseTitle: audience.courseTitle,
    termName: audience.termName,
  };
}

/** Starts a thread. Staff and enrolled learners of the offering may do so. */
export async function createThread(
  account: AccountContext,
  offeringId: string,
  input: ThreadInput,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  const audience = await resolveAudience(account, offeringId, db);
  const parsed = threadSchema.parse(input);

  const thread = await db.$transaction(async (tx) => {
    const created = await tx.discussionThread.create({
      data: {
        tenantId: audience.tenantId,
        offeringId: audience.offeringId,
        authorUserId: account.user.id,
        title: parsed.title,
        body: parsed.body,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "discussion.thread_created",
      resourceType: "discussion_thread",
      resourceId: created.id,
      after: { title: parsed.title, offeringId: audience.offeringId },
      requestId: options.requestId ?? null,
    });
    return created;
  });

  return { id: thread.id };
}

/**
 * Adds a reply. A locked thread refuses new replies (409) but stays readable, and
 * the thread's author is notified once per reply — a reply to your own thread
 * does not notify you.
 */
export async function replyToThread(
  account: AccountContext,
  threadId: string,
  input: ReplyInput,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  const parsed = replySchema.parse(input);
  const thread = await db.discussionThread.findFirst({
    where: { id: threadId, tenantId: tenantIdOf(account) },
    select: {
      id: true,
      tenantId: true,
      offeringId: true,
      authorUserId: true,
      title: true,
      status: true,
    },
  });
  if (!thread) throw new ResourceNotFoundError("Discussion not found.");

  const audience = await resolveAudience(account, thread.offeringId, db);
  if (thread.status === DiscussionThreadStatus.HIDDEN) {
    throw new ResourceNotFoundError("Discussion not found.");
  }
  if (thread.status === DiscussionThreadStatus.LOCKED) {
    throw new ConflictError("This discussion is locked; a moderator must reopen it.");
  }

  const post = await db.$transaction(async (tx) => {
    const created = await tx.discussionPost.create({
      data: {
        tenantId: audience.tenantId,
        threadId: thread.id,
        authorUserId: account.user.id,
        body: parsed.body,
      },
      select: { id: true },
    });
    await tx.discussionThread.update({
      where: { id: thread.id },
      data: { postCount: { increment: 1 }, lastActivityAt: new Date() },
    });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "discussion.reply_created",
      resourceType: "discussion_post",
      resourceId: created.id,
      after: { threadId: thread.id },
      requestId: options.requestId ?? null,
    });
    return created;
  });

  if (thread.authorUserId !== account.user.id) {
    const recipient = await db.user.findFirst({
      where: { id: thread.authorUserId },
      select: { id: true, name: true, email: true },
    });
    if (recipient) {
      const staffAuthor = await db.courseInstructor.findFirst({
        where: { courseOfferingId: thread.offeringId, userId: recipient.id },
        select: { id: true },
      });
      const author = await db.user.findFirstOrThrow({
        where: { id: account.user.id },
        select: { name: true },
      });
      await notify(db, {
        tenantId: audience.tenantId,
        category: "announcements",
        template: "discussion.reply",
        recipients: [{ userId: recipient.id, name: recipient.name, email: recipient.email }],
        payload: {
          href: staffAuthor
            ? `/faculty/courses/${thread.offeringId}/discussions/${thread.id}`
            : `/student/courses/${thread.offeringId}/discussions/${thread.id}`,
          authorName: author.name,
          threadTitle: thread.title,
          replyBody: parsed.body,
        },
        dedupeKey: `discussion_post:${post.id}`,
        email: false,
      });
    }
  }

  return { id: post.id };
}

/** Pins or unpins a thread so it stays on top of the list. */
export async function setThreadPinned(
  account: AccountContext,
  threadId: string,
  pinned: boolean,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<void> {
  const existing = await db.discussionThread.findFirst({
    where: { id: threadId, tenantId: tenantIdOf(account) },
    select: { id: true, offeringId: true, pinned: true },
  });
  if (!existing) throw new ResourceNotFoundError("Discussion not found.");

  const audience = await requireModerator(account, existing.offeringId, db);
  if (existing.pinned === pinned) return;

  await db.$transaction(async (tx) => {
    await tx.discussionThread.update({ where: { id: existing.id }, data: { pinned } });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "discussion.thread_pinned",
      resourceType: "discussion_thread",
      resourceId: existing.id,
      before: { pinned: existing.pinned },
      after: { pinned },
      requestId: options.requestId ?? null,
    });
  });
}

/**
 * Moves a thread between open, locked, and hidden. Locking and hiding both write
 * an audit row naming the moderator.
 */
export async function setThreadStatus(
  account: AccountContext,
  threadId: string,
  status: ThreadStatusKey,
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<void> {
  const existing = await db.discussionThread.findFirst({
    where: { id: threadId, tenantId: tenantIdOf(account) },
    select: { id: true, offeringId: true, status: true, title: true },
  });
  if (!existing) throw new ResourceNotFoundError("Discussion not found.");

  const audience = await requireModerator(account, existing.offeringId, db);
  const next = threadStatusFromKey(status);
  if (existing.status === next) return;

  await db.$transaction(async (tx) => {
    await tx.discussionThread.update({ where: { id: existing.id }, data: { status: next } });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "discussion.thread_moderated",
      resourceType: "discussion_thread",
      resourceId: existing.id,
      before: { status: threadStatusKey(existing.status), title: existing.title },
      after: { status },
      requestId: options.requestId ?? null,
    });
  });
}

/** Hides or restores one reply. The row and its author stay for the record. */
export async function setPostStatus(
  account: AccountContext,
  postId: string,
  status: "visible" | "hidden",
  options: { requestId?: string | null } = {},
  db: DatabaseClient = getDb(),
): Promise<void> {
  const existing = await db.discussionPost.findFirst({
    where: { id: postId, tenantId: tenantIdOf(account) },
    select: {
      id: true,
      status: true,
      thread: { select: { id: true, offeringId: true, lastActivityAt: true } },
    },
  });
  if (!existing) throw new ResourceNotFoundError("Reply not found.");

  const audience = await requireModerator(account, existing.thread.offeringId, db);
  const next = status === "hidden" ? DiscussionPostStatus.HIDDEN : DiscussionPostStatus.VISIBLE;
  if (existing.status === next) return;

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.discussionPost.update({
      where: { id: existing.id },
      data: {
        status: next,
        hiddenAt: next === DiscussionPostStatus.HIDDEN ? now : null,
        hiddenByUserId: next === DiscussionPostStatus.HIDDEN ? account.user.id : null,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: audience.tenantId,
      actorUserId: account.user.id,
      action: "discussion.post_moderated",
      resourceType: "discussion_post",
      resourceId: existing.id,
      before: { status: existing.status === DiscussionPostStatus.HIDDEN ? "hidden" : "visible" },
      after: { status, threadId: existing.thread.id },
      requestId: options.requestId ?? null,
    });
  });
}
