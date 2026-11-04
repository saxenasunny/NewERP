/**
 * Quiz Service — Phase 7
 *
 * Manages quiz CRUD, question-ref ordering, and publish/archive transitions.
 * The attempt lifecycle lives in attempt-engine.ts.
 *
 * Permission requirements:
 *   - assessments.manage  — create/update/delete/publish/archive quizzes
 *   - courses.read        — list/read quizzes (instructors, enrolled students)
 */

import {
  ConflictError,
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb } from "@/lib/db/client";
import { Prisma, QuizStatus } from "../../generated/prisma/client";
import { getCurrentVersion } from "./bank-service";
import { parseQuizSettings, toDecimal, type QuizSettings } from "./rules";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tid(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

const STATUS_BY_KEY: Record<"draft" | "published" | "archived", QuizStatus> = {
  draft: QuizStatus.DRAFT,
  published: QuizStatus.PUBLISHED,
  archived: QuizStatus.ARCHIVED,
};

/** The rules layer and the UI speak lower-case machine names. */
export function quizStatusToKey(status: QuizStatus): "draft" | "published" | "archived" {
  return status.toLowerCase() as "draft" | "published" | "archived";
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateQuizInput {
  courseOfferingId: string;
  title: string;
  instructions?: string;
  availableFrom?: Date | null;
  availableUntil?: Date | null;
  settings?: Partial<QuizSettings>;
}

export interface UpdateQuizInput {
  title?: string;
  instructions?: string | null;
  availableFrom?: Date | null;
  availableUntil?: Date | null;
  settings?: Partial<QuizSettings>;
}

export interface AddQuestionRefInput {
  questionId: string;
  pointsOverride?: number | null;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function getQuiz(account: AccountContext, quizId: string) {
  requirePermission(account, "courses.read");
  const tenantId = tid(account);
  const db = getDb();

  const quiz = await db.quiz.findFirst({
    where: { id: quizId, tenantId },
    include: {
      questions: {
        orderBy: { position: "asc" },
        include: {
          question: {
            select: {
              id: true,
              title: true,
              type: true,
              status: true,
              points: true,
              currentVersion: true,
            },
          },
        },
      },
      _count: { select: { attempts: true } },
    },
  });

  if (!quiz) throw new ResourceNotFoundError("Quiz not found.");
  return quiz;
}

/**
 * Learner-facing read: a published quiz in an offering the learner is
 * enrolled in. Drafts and other institutions resolve as not found.
 */
export async function getLearnerQuiz(account: AccountContext, quizId: string) {
  requirePermission(account, "courses.read");
  const tenantId = tid(account);
  const db = getDb();

  const quiz = await db.quiz.findFirst({
    where: {
      id: quizId,
      tenantId,
      status: QuizStatus.PUBLISHED,
      offering: {
        status: "PUBLISHED",
        enrolments: { some: { userId: account.user.id, status: "ACTIVE" } },
      },
    },
    include: { _count: { select: { questions: true, attempts: true } } },
  });

  if (!quiz) throw new ResourceNotFoundError("Quiz not found.");
  return quiz;
}

export async function listQuizzes(
  account: AccountContext,
  courseOfferingId: string,
  opts: { status?: "draft" | "published" | "archived" } = {},
) {
  requirePermission(account, "courses.read");
  const tenantId = tid(account);
  const db = getDb();

  return db.quiz.findMany({
    where: {
      tenantId,
      offeringId: courseOfferingId,
      ...(opts.status ? { status: STATUS_BY_KEY[opts.status] } : {}),
    },
    include: { _count: { select: { attempts: true, questions: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Published quizzes of one offering, for an enrolled learner. */
export async function listLearnerQuizzes(account: AccountContext, courseOfferingId: string) {
  requirePermission(account, "courses.read");
  const tenantId = tid(account);
  const db = getDb();

  return db.quiz.findMany({
    where: {
      tenantId,
      offeringId: courseOfferingId,
      status: QuizStatus.PUBLISHED,
      offering: {
        status: "PUBLISHED",
        enrolments: { some: { userId: account.user.id, status: "ACTIVE" } },
      },
    },
    include: { _count: { select: { questions: true, attempts: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createQuiz(account: AccountContext, input: CreateQuizInput) {
  requirePermission(account, "assessments.manage");
  const tenantId = tid(account);
  const db = getDb();

  const offering = await db.courseOffering.findFirst({
    where: { id: input.courseOfferingId, tenantId },
    select: { id: true },
  });
  if (!offering) throw new ResourceNotFoundError("Course offering not found.");

  const merged = { ...parseQuizSettings({}), ...(input.settings ?? {}) };

  return db.quiz.create({
    data: {
      tenantId,
      offeringId: offering.id,
      title: input.title.trim(),
      instructions: input.instructions ?? null,
      availableFrom: input.availableFrom ?? null,
      availableUntil: input.availableUntil ?? null,
      settings: merged as Prisma.InputJsonValue,
      status: QuizStatus.DRAFT,
      version: 1,
    },
  });
}

export async function updateQuiz(account: AccountContext, quizId: string, input: UpdateQuizInput) {
  requirePermission(account, "assessments.manage");
  const quiz = await getQuiz(account, quizId);

  if (quiz.status === QuizStatus.ARCHIVED) {
    throw new ConflictError("Archived quizzes cannot be edited.");
  }
  if (quiz.status === QuizStatus.PUBLISHED && quiz._count.attempts > 0) {
    throw new ConflictError(
      "This quiz has attempts. Archive it and create a new version to change settings.",
    );
  }

  const db = getDb();

  let settingsValue: Prisma.InputJsonValue | undefined;
  if (input.settings !== undefined) {
    const current = parseQuizSettings(quiz.settings);
    settingsValue = { ...current, ...input.settings } as Prisma.InputJsonValue;
  }

  return db.quiz.update({
    where: { id: quizId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
      ...(input.availableFrom !== undefined ? { availableFrom: input.availableFrom } : {}),
      ...(input.availableUntil !== undefined ? { availableUntil: input.availableUntil } : {}),
      ...(settingsValue !== undefined ? { settings: settingsValue } : {}),
    },
  });
}

export async function publishQuiz(account: AccountContext, quizId: string) {
  requirePermission(account, "assessments.manage");
  const quiz = await getQuiz(account, quizId);
  const db = getDb();

  if (quiz.status !== QuizStatus.DRAFT) {
    throw new ConflictError(`Quiz is already ${quizStatusToKey(quiz.status)}.`);
  }
  if (quiz.questions.length === 0) {
    throw new ConflictError("A quiz must have at least one question before publishing.");
  }

  const unpublished = quiz.questions.filter((ref) => ref.question.status !== "PUBLISHED");
  if (unpublished.length > 0) {
    const titles = unpublished.map((ref) => `"${ref.question.title}"`).join(", ");
    throw new ConflictError(
      `The following questions must be published before the quiz can go live: ${titles}`,
    );
  }

  return db.quiz.update({
    where: { id: quizId },
    data: { status: QuizStatus.PUBLISHED },
  });
}

export async function archiveQuiz(account: AccountContext, quizId: string) {
  requirePermission(account, "assessments.manage");
  const quiz = await getQuiz(account, quizId);
  const db = getDb();

  if (quiz.status === QuizStatus.ARCHIVED) {
    throw new ConflictError("Quiz is already archived.");
  }

  return db.quiz.update({
    where: { id: quizId },
    data: { status: QuizStatus.ARCHIVED },
  });
}

export async function deleteQuiz(account: AccountContext, quizId: string) {
  requirePermission(account, "assessments.manage");
  const quiz = await getQuiz(account, quizId);
  const db = getDb();

  if (quiz._count.attempts > 0) {
    throw new ConflictError(
      "This quiz has learner attempts and cannot be deleted. Archive it instead.",
    );
  }

  await db.quiz.delete({ where: { id: quizId } });
}

// ---------------------------------------------------------------------------
// Question refs (ordering the questions inside a quiz)
// ---------------------------------------------------------------------------

export async function addQuestionRef(
  account: AccountContext,
  quizId: string,
  input: AddQuestionRefInput,
) {
  requirePermission(account, "assessments.manage");
  const quiz = await getQuiz(account, quizId);
  const tenantId = tid(account);
  const db = getDb();

  if (quiz.status !== QuizStatus.DRAFT) {
    throw new ConflictError("Questions can only be added to draft quizzes.");
  }

  // Verifies the question is in this tenant and already published.
  await getCurrentVersion(tenantId, input.questionId);

  if (quiz.questions.some((ref) => ref.questionId === input.questionId)) {
    throw new ConflictError("This question is already in the quiz.");
  }

  const nextPosition = quiz.questions.length
    ? Math.max(...quiz.questions.map((ref) => ref.position)) + 1
    : 1;

  return db.quizQuestionRef.create({
    data: {
      tenantId,
      quizId,
      questionId: input.questionId,
      position: nextPosition,
      pointsOverride: input.pointsOverride != null ? toDecimal(input.pointsOverride) : null,
    },
  });
}

export async function removeQuestionRef(
  account: AccountContext,
  quizId: string,
  questionId: string,
) {
  requirePermission(account, "assessments.manage");
  const quiz = await getQuiz(account, quizId);
  const db = getDb();

  if (quiz.status !== QuizStatus.DRAFT) {
    throw new ConflictError("Questions can only be removed from draft quizzes.");
  }

  const ref = quiz.questions.find((candidate) => candidate.questionId === questionId);
  if (!ref) throw new ResourceNotFoundError("Question is not in this quiz.");

  await db.quizQuestionRef.delete({ where: { id: ref.id } });

  // Re-pack positions to stay contiguous (cosmetic, not load-bearing).
  const remaining = quiz.questions
    .filter((candidate) => candidate.questionId !== questionId)
    .sort((a, b) => a.position - b.position);

  if (remaining.length > 0) {
    await db.$transaction(
      remaining.map((candidate, idx) =>
        db.quizQuestionRef.update({
          where: { id: candidate.id },
          data: { position: idx + 1 },
        }),
      ),
    );
  }
}

export async function reorderQuestionRefs(
  account: AccountContext,
  quizId: string,
  orderedQuestionIds: string[],
) {
  requirePermission(account, "assessments.manage");
  const quiz = await getQuiz(account, quizId);
  const db = getDb();

  if (quiz.status !== QuizStatus.DRAFT) {
    throw new ConflictError("Question order can only be changed on draft quizzes.");
  }

  const existingIds = new Set(quiz.questions.map((ref) => ref.questionId));
  for (const id of orderedQuestionIds) {
    if (!existingIds.has(id)) {
      throw new ConflictError(`Question ${id} is not in this quiz.`);
    }
  }
  if (orderedQuestionIds.length !== quiz.questions.length) {
    throw new ConflictError("Reorder list must include every question exactly once.");
  }

  const refMap = new Map(quiz.questions.map((ref) => [ref.questionId, ref.id]));

  await db.$transaction(
    orderedQuestionIds.map((questionId, idx) =>
      db.quizQuestionRef.update({
        where: { id: refMap.get(questionId)! },
        data: { position: idx + 1 },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Manual result release (manual release policy only)
// ---------------------------------------------------------------------------

export async function releaseResults(account: AccountContext, quizId: string) {
  requirePermission(account, "grades.publish");
  const quiz = await getQuiz(account, quizId);
  const db = getDb();

  if (quiz.status !== QuizStatus.PUBLISHED) {
    throw new ConflictError("Only published quizzes can have results released.");
  }

  const settings = parseQuizSettings(quiz.settings);
  if (settings.releasePolicy !== "manual") {
    throw new ConflictError(
      "Manual release is only applicable when the release policy is set to 'manual'.",
    );
  }

  return db.quiz.update({
    where: { id: quizId },
    data: { releasedAt: new Date() },
  });
}

/** Instructors must hold a grading permission before opening the queue. */
export function requireGrading(account: AccountContext): void {
  if (!account.permissions.has("submissions.grade")) {
    throw new PermissionDeniedError("You do not have permission to grade this quiz.");
  }
}

export type Quiz = Awaited<ReturnType<typeof getQuiz>>;
