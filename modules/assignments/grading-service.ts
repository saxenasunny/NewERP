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
import { sendMail } from "@/lib/mail/send";
import { log } from "@/lib/observability/logger";

import { getAssignmentDetail, type AssignmentDetail } from "./assignment-service";
import type { SubmissionFileView } from "./submission-service";
import type { GradeStatus, SubmissionStatus } from "./rules";

/**
 * Grading queue, rubric scoring, feedback, release, and audit history.
 *
 * Saving a grade drafts it; only `grades.publish` releases it to the learner.
 * Editing a released grade needs `grades.update` **and** a written reason, and
 * every change appends a `grade_change_events` row so the log answers "who
 * changed what, when, and why".
 */

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

async function requireGradingAccess(
  account: AccountContext,
  assignmentId: string,
  db: DatabaseClient,
): Promise<{ tenantId: string; detail: AssignmentDetail }> {
  requirePermission(account, "submissions.grade");
  const tenantId = tenantIdOf(account);
  const detail = await getAssignmentDetail(account, assignmentId, db);
  return { tenantId, detail };
}

export type GradeEntryView = {
  id: string;
  rawScore: number | null;
  pointsPossible: number;
  status: GradeStatus;
  releasedAt: Date | null;
  gradedAt: Date | null;
  feedback: string | null;
  rubricScores: Array<{ criterionId: string; score: number | null; feedback: string | null }>;
  history: GradeHistoryEntry[];
};

export type GradingEntry = {
  submissionId: string;
  learnerName: string;
  learnerEmail: string;
  status: SubmissionStatus;
  submittedAt: Date | null;
  late: boolean;
  attemptNumber: number;
  body: string | null;
  files: SubmissionFileView[];
  grade: GradeEntryView | null;
};

export type GradingWorkspace = {
  assignment: AssignmentDetail;
  entries: GradingEntry[];
  summary: { learners: number; submitted: number; awaitingGrading: number; released: number };
};

/** The grading queue for one assignment: every submission, graded or not. */
export async function getGradingWorkspace(
  account: AccountContext,
  assignmentId: string,
  db: DatabaseClient = getDb(),
): Promise<GradingWorkspace> {
  const { tenantId, detail } = await requireGradingAccess(account, assignmentId, db);

  const rows = await db.assignmentSubmission.findMany({
    where: { tenantId, assignmentId: detail.id },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      status: true,
      submittedAt: true,
      lateFlag: true,
      attemptNumber: true,
      user: { select: { name: true, email: true } },
      textVersions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true },
      },
      fileLinks: {
        orderBy: { createdAt: "asc" },
        select: { id: true, fileName: true, fileSize: true, contentType: true },
      },
      grades: {
        select: {
          id: true,
          rawScore: true,
          pointsPossible: true,
          gradeStatus: true,
          releasedAt: true,
          gradedAt: true,
          feedback: { select: { body: true } },
          rubricScores: {
            select: { rubricCriterionId: true, score: true, feedback: true },
          },
        },
      },
    },
  });

  const gradeIds = rows.flatMap((row) => row.grades.map((grade) => grade.id));
  const events = gradeIds.length
    ? await db.gradeChangeEvent.findMany({
        where: { tenantId, gradeId: { in: gradeIds } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          gradeId: true,
          createdAt: true,
          oldRawScore: true,
          newRawScore: true,
          oldStatus: true,
          newStatus: true,
          reason: true,
          actorUserId: true,
        },
      })
    : [];
  const actorIds = [
    ...new Set(events.map((event) => event.actorUserId).filter(Boolean)),
  ] as string[];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const namesById = new Map(actors.map((actor) => [actor.id, actor.name]));
  const historyByGrade = new Map<string, GradeHistoryEntry[]>();
  for (const event of events) {
    const list = historyByGrade.get(event.gradeId) ?? [];
    list.push({
      id: event.id,
      createdAt: event.createdAt,
      oldRawScore: event.oldRawScore === null ? null : Number(event.oldRawScore),
      newRawScore: event.newRawScore === null ? null : Number(event.newRawScore),
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
      reason: event.reason,
      actorName: event.actorUserId ? (namesById.get(event.actorUserId) ?? null) : null,
    });
    historyByGrade.set(event.gradeId, list);
  }

  const entries: GradingEntry[] = rows.map((row) => {
    const grade = row.grades[0] ?? null;
    return {
      submissionId: row.id,
      learnerName: row.user.name,
      learnerEmail: row.user.email,
      status: row.status,
      submittedAt: row.submittedAt,
      late: row.lateFlag,
      attemptNumber: row.attemptNumber,
      body: row.textVersions[0]?.body ?? null,
      files: row.fileLinks.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        contentType: file.contentType,
      })),
      grade: grade
        ? {
            id: grade.id,
            rawScore: grade.rawScore === null ? null : Number(grade.rawScore),
            pointsPossible: Number(grade.pointsPossible),
            status: grade.gradeStatus,
            releasedAt: grade.releasedAt,
            gradedAt: grade.gradedAt,
            feedback: grade.feedback[0]?.body ?? null,
            rubricScores: grade.rubricScores.map((score) => ({
              criterionId: score.rubricCriterionId,
              score: score.score === null ? null : Number(score.score),
              feedback: score.feedback,
            })),
            history: historyByGrade.get(grade.id) ?? [],
          }
        : null,
    };
  });

  return {
    assignment: detail,
    entries,
    summary: {
      learners: detail.learnerCount,
      submitted: entries.filter((entry) => entry.status !== "DRAFT").length,
      awaitingGrading: entries.filter(
        (entry) => entry.status === "SUBMITTED" || entry.status === "LATE",
      ).length,
      released: entries.filter((entry) => entry.grade?.status === "RELEASED").length,
    },
  };
}

const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z
    .union([z.number(), z.string()])
    .transform((value) => (typeof value === "string" ? Number(value.trim()) : value))
    .pipe(z.number().min(0).max(1000))
    .nullable(),
);

const gradeSchema = z.object({
  submissionId: z.string().min(1),
  rawScore: optionalNumber,
  feedback: z
    .string()
    .trim()
    .max(20000, "Keep the feedback under 20,000 characters.")
    .optional()
    .transform((value) => (value ? value : null)),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : null)),
  rubricScores: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        score: optionalNumber,
        feedback: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .transform((value) => (value ? value : null)),
      }),
    )
    .max(50)
    .default([]),
});

export type SaveGradeInput = z.input<typeof gradeSchema>;

/**
 * Creates or updates a drafted grade. A released grade may only be changed with
 * `grades.update` and an audit reason.
 */
export async function saveGrade(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ gradeId: string; status: GradeStatus }> {
  requirePermission(account, "submissions.grade");
  const parsed = gradeSchema.parse(input);
  const tenantId = tenantIdOf(account);

  const submission = await db.assignmentSubmission.findFirst({
    where: { id: parsed.submissionId, tenantId },
    select: {
      id: true,
      userId: true,
      status: true,
      assignment: {
        select: {
          id: true,
          title: true,
          pointsPossible: true,
          offering: {
            select: {
              id: true,
              instructors: { select: { userId: true } },
            },
          },
          rubric: { select: { id: true, pointsPossible: true, title: true } },
        },
      },
      grades: { select: { id: true, rawScore: true, gradeStatus: true } },
    },
  });
  if (!submission) throw new ResourceNotFoundError();

  const isInstructor = submission.assignment.offering.instructors.some(
    (instructor) => instructor.userId === account.user.id,
  );
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");
  if (!isInstructor && !isAdministrator) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }
  if (submission.status === "DRAFT") {
    throw new ConflictError("This learner has not submitted anything yet.");
  }

  const points = Number(submission.assignment.pointsPossible);
  if (parsed.rawScore !== null && parsed.rawScore > points) {
    throw new ConflictError(`Enter a score between 0 and ${points}.`);
  }

  const rubricById = new Map(
    submission.assignment.rubric.map((criterion) => [
      criterion.id,
      Number(criterion.pointsPossible),
    ]),
  );
  for (const entry of parsed.rubricScores) {
    const criterionPoints = rubricById.get(entry.criterionId);
    if (criterionPoints === undefined) {
      throw new ResourceNotFoundError("That rubric criterion is not part of this assignment.");
    }
    if (entry.score !== null && entry.score > criterionPoints) {
      throw new ConflictError(`A rubric score cannot exceed ${criterionPoints} points.`);
    }
  }

  const existing = submission.grades[0] ?? null;
  const overriding = existing?.gradeStatus === "RELEASED";
  if (overriding) {
    requirePermission(account, "grades.update");
    if (!parsed.reason || parsed.reason.length < 3) {
      throw new ConflictError("Explain why the released grade is being changed.");
    }
  }

  const now = new Date();

  return db.$transaction(async (tx) => {
    const grade = await tx.grade.upsert({
      where: {
        assignmentId_learnerUserId: {
          assignmentId: submission.assignment.id,
          learnerUserId: submission.userId,
        },
      },
      update: {
        rawScore: parsed.rawScore,
        pointsPossible: points,
        gradeStatus: "DRAFT",
        gradedByUserId: account.user.id,
        gradedAt: now,
        version: { increment: 1 },
      },
      create: {
        tenantId,
        assignmentId: submission.assignment.id,
        submissionId: submission.id,
        learnerUserId: submission.userId,
        rawScore: parsed.rawScore,
        pointsPossible: points,
        gradeStatus: "DRAFT",
        gradedByUserId: account.user.id,
        gradedAt: now,
      },
      select: { id: true, version: true },
    });

    await tx.gradeFeedback.deleteMany({ where: { gradeId: grade.id } });
    if (parsed.feedback) {
      await tx.gradeFeedback.create({
        data: { tenantId, gradeId: grade.id, body: parsed.feedback },
      });
    }

    await tx.rubricCriterionScore.deleteMany({ where: { gradeId: grade.id } });
    const scored = parsed.rubricScores.filter(
      (entry) => entry.score !== null || entry.feedback !== null,
    );
    if (scored.length > 0) {
      await tx.rubricCriterionScore.createMany({
        data: scored.map((entry) => ({
          tenantId,
          rubricCriterionId: entry.criterionId,
          gradeId: grade.id,
          score: entry.score,
          feedback: entry.feedback,
        })),
      });
    }

    await tx.gradeChangeEvent.create({
      data: {
        tenantId,
        gradeId: grade.id,
        actorUserId: account.user.id,
        oldRawScore: existing?.rawScore ?? null,
        newRawScore: parsed.rawScore,
        oldStatus: existing?.gradeStatus ?? null,
        newStatus: "DRAFT",
        reason: parsed.reason,
        requestId: context.requestId,
      },
    });

    await tx.assignmentSubmission.update({
      where: { id: submission.id },
      data: { status: "GRADED" },
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: overriding ? "grade.overridden" : "grade.saved",
      resourceType: "grade",
      resourceId: grade.id,
      before: existing
        ? {
            rawScore: existing.rawScore === null ? null : Number(existing.rawScore),
            status: existing.gradeStatus,
          }
        : null,
      after: { rawScore: parsed.rawScore, status: "DRAFT", pointsPossible: points },
      reason: parsed.reason,
      requestId: context.requestId,
    });

    return { gradeId: grade.id, status: "DRAFT" as const };
  });
}

async function loadGradeForRelease(account: AccountContext, gradeId: string, db: DatabaseClient) {
  const tenantId = tenantIdOf(account);
  const grade = await db.grade.findFirst({
    where: { id: gradeId, tenantId },
    select: {
      id: true,
      rawScore: true,
      pointsPossible: true,
      gradeStatus: true,
      releasedAt: true,
      learner: { select: { id: true, name: true, email: true } },
      assignment: {
        select: {
          id: true,
          title: true,
          offering: { select: { id: true, instructors: { select: { userId: true } } } },
        },
      },
    },
  });
  if (!grade) throw new ResourceNotFoundError();

  const isInstructor = grade.assignment.offering.instructors.some(
    (instructor) => instructor.userId === account.user.id,
  );
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");
  if (!isInstructor && !isAdministrator) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  return { tenantId, grade };
}

/** Releases one draft grade to its learner and notifies them. */
export async function releaseGrade(
  account: AccountContext,
  gradeId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ released: boolean }> {
  requirePermission(account, "grades.publish");
  const { tenantId, grade } = await loadGradeForRelease(account, gradeId, db);

  if (grade.rawScore === null) {
    throw new ConflictError("Enter a score before releasing the grade.");
  }
  if (grade.gradeStatus === "RELEASED") return { released: false };

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.grade.update({
      where: { id: grade.id },
      data: {
        gradeStatus: "RELEASED",
        releasedAt: now,
        version: { increment: 1 },
      },
    });

    await tx.gradeChangeEvent.create({
      data: {
        tenantId,
        gradeId: grade.id,
        actorUserId: account.user.id,
        oldRawScore: Number(grade.rawScore),
        newRawScore: Number(grade.rawScore),
        oldStatus: grade.gradeStatus,
        newStatus: "RELEASED",
        requestId: context.requestId,
      },
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "grade.released",
      resourceType: "grade",
      resourceId: grade.id,
      before: { status: grade.gradeStatus },
      after: { status: "RELEASED", rawScore: Number(grade.rawScore) },
      requestId: context.requestId,
    });
  });

  // Notification is best-effort: the release itself has already been committed,
  // and in production there is no mail provider (the message row records that).
  try {
    await sendMail({
      to: grade.learner.email,
      subject: `Grade released: ${grade.assignment.title}`,
      body: [
        `Hello ${grade.learner.name},`,
        "",
        `Your grade for "${grade.assignment.title}" has been released.`,
        `Score: ${Number(grade.rawScore)} out of ${Number(grade.pointsPossible)}.`,
        "",
        "Open the assignment in the LMS to read your feedback.",
      ].join("\n"),
    });
  } catch (error) {
    log("error", "grade.release_notification_failed", {
      gradeId: grade.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  return { released: true };
}

/** Releases every scored draft grade for one assignment. */
export async function releaseAllGrades(
  account: AccountContext,
  assignmentId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ released: number }> {
  requirePermission(account, "grades.publish");
  const { tenantId, detail } = await requireGradingAccess(account, assignmentId, db);

  const pending = await db.grade.findMany({
    where: {
      tenantId,
      assignmentId: detail.id,
      gradeStatus: "DRAFT",
      rawScore: { not: null },
    },
    select: { id: true },
  });

  let released = 0;
  for (const grade of pending) {
    const result = await releaseGrade(account, grade.id, context, db);
    if (result.released) released += 1;
  }
  return { released };
}

export type GradeHistoryEntry = {
  id: string;
  createdAt: Date;
  oldRawScore: number | null;
  newRawScore: number | null;
  oldStatus: GradeStatus | null;
  newStatus: GradeStatus | null;
  reason: string | null;
  actorName: string | null;
};

/** Append-only history of one grade, for the teacher's audit panel. */
export async function getGradeHistory(
  account: AccountContext,
  gradeId: string,
  db: DatabaseClient = getDb(),
): Promise<GradeHistoryEntry[]> {
  requirePermission(account, "grades.read");
  const { tenantId, grade } = await loadGradeForRelease(account, gradeId, db);

  const events = await db.gradeChangeEvent.findMany({
    where: { tenantId, gradeId: grade.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      oldRawScore: true,
      newRawScore: true,
      oldStatus: true,
      newStatus: true,
      reason: true,
      actorUserId: true,
    },
  });

  const actorIds = [
    ...new Set(events.map((event) => event.actorUserId).filter(Boolean)),
  ] as string[];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const namesById = new Map(actors.map((actor) => [actor.id, actor.name]));

  return events.map((event) => ({
    id: event.id,
    createdAt: event.createdAt,
    oldRawScore: event.oldRawScore === null ? null : Number(event.oldRawScore),
    newRawScore: event.newRawScore === null ? null : Number(event.newRawScore),
    oldStatus: event.oldStatus,
    newStatus: event.newStatus,
    reason: event.reason,
    actorName: event.actorUserId ? (namesById.get(event.actorUserId) ?? null) : null,
  }));
}
