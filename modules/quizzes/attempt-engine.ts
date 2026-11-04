/**
 * Attempt Engine — Phase 7
 *
 * Handles the full attempt lifecycle:
 *   start (or resume)  →  autosave  →  finalise (submit | timeout)
 *   →  score objective items  →  grade essays (manual)  →  per-item grade write
 *
 * Key invariants (from ADR 0008):
 *   - Attempts are numbered per (quiz, user); a second in-progress attempt is
 *     refused rather than created.
 *   - Finalise is idempotent: if the attempt is already terminal, returns the
 *     stored row without re-scoring.
 *   - Answer keys travel only in instructor-facing payloads; learner DTOs strip them.
 *   - The server owns the clock: deadline_at is computed at start; autosave after
 *     the deadline triggers a timed-out finalisation.
 *
 * Permissions:
 *   - submissions.submit  — start, autosave, submit (student)
 *   - submissions.grade   — grade essays (faculty/TA)
 */

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb } from "@/lib/db/client";
import {
  ConflictError,
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";
import {
  Prisma,
  QuestionType,
  QuizAttemptStatus,
  QuizEventType,
} from "../../generated/prisma/client";
import { questionTypeToKey } from "./bank-service";
import { getQuiz, requireGrading } from "./quiz-service";
import {
  aggregateScore,
  autosaveAllowed,
  checkAttemptEligibility,
  computeDeadline,
  fromDecimal,
  getResultVisibility,
  isPastDeadline,
  parseQuizSettings,
  scoreItem,
  shuffleForAttempt,
  toDecimal,
  type AnswerKey,
  type QuizSettings,
  type StudentAnswer,
} from "./rules";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tid(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

type AttemptStatusKey = "in_progress" | "submitted" | "timed_out" | "graded";

/** Prisma uses UPPER_CASE members; the rules layer uses lower-case keys. */
function attemptStatusKey(status: QuizAttemptStatus): AttemptStatusKey {
  return status.toLowerCase() as AttemptStatusKey;
}

const ATTEMPT_INCLUDE = {
  items: {
    orderBy: { position: "asc" as const },
    include: { answer: true, questionVersion: true },
  },
  quiz: true,
} satisfies Prisma.QuizAttemptInclude;

type AttemptWithItems = Prisma.QuizAttemptGetPayload<{ include: typeof ATTEMPT_INCLUDE }>;

/** Options for a question live in the prompt snapshot, not the answer key. */
function promptOptions(promptJson: unknown): { id: string; text: string }[] {
  const prompt = promptJson as { options?: unknown } | null;
  if (!Array.isArray(prompt?.options)) return [];
  return prompt.options.filter(
    (option): option is { id: string; text: string } =>
      typeof option === "object" &&
      option !== null &&
      typeof (option as { id?: unknown }).id === "string" &&
      typeof (option as { text?: unknown }).text === "string",
  );
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface AutosaveAnswerInput {
  attemptItemId: string;
  answerJson: object;
}

export interface GradeEssayInput {
  attemptItemId: string;
  score: number;
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Learner-facing attempt view (answer keys stripped)
// ---------------------------------------------------------------------------

export interface AttemptItemView {
  id: string;
  position: number;
  /** The snapshotted question prompt (no answer key). */
  promptJson: object;
  /** Lower-case question type, matching the rules layer. */
  type: string;
  pointsPossible: number;
  optionOrder: string[];
  /** Options in the order this attempt shows them. */
  options: { id: string; text: string }[];
  /** The learner's own saved answer, so a reload restores it. */
  answer: StudentAnswer;
  /** Present only if results are visible. */
  score?: number | null;
  feedback?: string | null;
}

export interface AttemptView {
  id: string;
  quizId: string;
  attemptNumber: number;
  status: string;
  startedAt: Date;
  deadlineAt: Date | null;
  submittedAt: Date | null;
  score: number | null;
  pointsPossible: number;
  items: AttemptItemView[];
  showResults: boolean;
  showAnswerKey: boolean;
}

// ---------------------------------------------------------------------------
// Start / resume
// ---------------------------------------------------------------------------

/**
 * Start a new attempt, or resume the existing in-progress one.
 *
 * On start: snapshots current published question versions, applies shuffle,
 * creates attempt items and empty answer rows.
 *
 * On resume: returns the existing attempt with its saved answers.
 */
export async function startAttempt(account: AccountContext, quizId: string): Promise<AttemptView> {
  requirePermission(account, "submissions.submit");
  const tenantId = tid(account);
  const db = getDb();
  const now = new Date();

  const quiz = await getQuiz(account, quizId);
  const settings = parseQuizSettings(quiz.settings);

  const completedCount = await db.quizAttempt.count({
    where: {
      quizId,
      userId: account.user.id,
      tenantId,
      status: {
        in: [QuizAttemptStatus.SUBMITTED, QuizAttemptStatus.TIMED_OUT, QuizAttemptStatus.GRADED],
      },
    },
  });

  const existing = await db.quizAttempt.findFirst({
    where: {
      quizId,
      userId: account.user.id,
      tenantId,
      status: QuizAttemptStatus.IN_PROGRESS,
    },
    include: ATTEMPT_INCLUDE,
  });

  const eligibility = checkAttemptEligibility({
    settings,
    quizStatus: quiz.status.toLowerCase() as "draft" | "published" | "archived",
    availableFrom: quiz.availableFrom,
    availableUntil: quiz.availableUntil,
    completedAttemptCount: completedCount,
    hasInProgressAttempt: Boolean(existing),
    now,
  });

  if (!eligibility.eligible) {
    throw new PermissionDeniedError(eligibility.reason);
  }

  if (existing) {
    if (isPastDeadline(existing.deadlineAt, now)) {
      return finaliseAttempt(account, existing.id, "timed_out");
    }
    return buildAttemptView(existing, quiz.releasedAt, quiz.availableUntil, settings);
  }

  // ------------------------------------------------------------------
  // Create a new attempt in a transaction.
  // ------------------------------------------------------------------
  const extraMinutes = settings.extraTimeMinutes[account.user.id] ?? 0;
  const deadline = computeDeadline({
    startedAt: now,
    timeLimitMinutes: settings.timeLimitMinutes,
    extraMinutes,
  });

  const attemptNumber = completedCount + 1;
  const pointsPossible = quiz.questions.reduce((sum, ref) => {
    const points = fromDecimal(ref.pointsOverride) ?? fromDecimal(ref.question.points) ?? 1;
    return sum + points;
  }, 0);

  const seed = `${quizId}::${account.user.id}::${attemptNumber}`;
  const orderedRefs = settings.shuffleQuestions
    ? shuffleForAttempt(quiz.questions, seed)
    : [...quiz.questions].sort((a, b) => a.position - b.position);

  const attempt = await db.$transaction(async (tx) => {
    const newAttempt = await tx.quizAttempt.create({
      data: {
        tenantId,
        quizId,
        userId: account.user.id,
        attemptNumber,
        status: QuizAttemptStatus.IN_PROGRESS,
        startedAt: now,
        deadlineAt: deadline,
        pointsPossible: toDecimal(pointsPossible),
        version: quiz.version,
      },
    });

    for (let i = 0; i < orderedRefs.length; i++) {
      const ref = orderedRefs[i]!;
      const version = await tx.questionVersion.findFirst({
        where: {
          questionId: ref.questionId,
          version: ref.question.currentVersion,
          tenantId,
        },
      });
      if (!version) {
        throw new ConflictError(
          `Question "${ref.question.title}" has no published version. Re-publish it.`,
        );
      }

      const pointsForItem = fromDecimal(ref.pointsOverride) ?? fromDecimal(version.points) ?? 1;
      const optionIds = promptOptions(version.promptJson).map((option) => option.id);
      const optionOrder =
        settings.shuffleOptions && optionIds.length > 0
          ? shuffleForAttempt(optionIds, `${seed}::${ref.questionId}`)
          : optionIds;

      const item = await tx.quizAttemptItem.create({
        data: {
          tenantId,
          attemptId: newAttempt.id,
          questionVersionId: version.id,
          position: i + 1,
          optionOrder: optionOrder as Prisma.InputJsonValue,
          pointsPossible: toDecimal(pointsForItem),
        },
      });

      // Pre-create an empty answer row (makes autosave an update, not an insert).
      await tx.quizAnswer.create({
        data: {
          tenantId,
          attemptItemId: item.id,
          answerJson: {} as Prisma.InputJsonValue,
          savedAt: null,
        },
      });
    }

    await tx.quizEvent.create({
      data: {
        tenantId,
        attemptId: newAttempt.id,
        actorUserId: account.user.id,
        type: QuizEventType.STARTED,
        metadata: { attemptNumber } as Prisma.InputJsonValue,
      },
    });

    return tx.quizAttempt.findUniqueOrThrow({
      where: { id: newAttempt.id },
      include: ATTEMPT_INCLUDE,
    });
  });

  await recordAuditEvent(db, {
    tenantId,
    actorUserId: account.user.id,
    action: "quiz_attempt_started",
    resourceType: "quiz_attempt",
    resourceId: attempt.id,
    after: { quizId, attemptNumber } as Prisma.InputJsonValue,
  });

  return buildAttemptView(attempt, quiz.releasedAt, quiz.availableUntil, settings);
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/**
 * Save one or more answers. Rejected after the deadline, which finalises the
 * attempt as timed out instead.
 */
export async function autosave(
  account: AccountContext,
  attemptId: string,
  answers: AutosaveAnswerInput[],
): Promise<{ saved: number; timedOut: boolean }> {
  requirePermission(account, "submissions.submit");
  const tenantId = tid(account);
  const db = getDb();
  const now = new Date();

  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, userId: account.user.id, tenantId },
  });
  if (!attempt) throw new ResourceNotFoundError("Attempt not found.");

  if (!autosaveAllowed(attemptStatusKey(attempt.status), attempt.deadlineAt, now)) {
    if (
      isPastDeadline(attempt.deadlineAt, now) &&
      attempt.status === QuizAttemptStatus.IN_PROGRESS
    ) {
      await finaliseAttempt(account, attemptId, "timed_out");
      return { saved: 0, timedOut: true };
    }
    throw new ConflictError("This attempt is no longer accepting answers.");
  }

  const itemIds = new Set(
    (
      await db.quizAttemptItem.findMany({
        where: { attemptId, tenantId },
        select: { id: true },
      })
    ).map((item) => item.id),
  );

  let saved = 0;
  await db.$transaction(async (tx) => {
    for (const answer of answers) {
      if (!itemIds.has(answer.attemptItemId)) continue;
      await tx.quizAnswer.update({
        where: { attemptItemId: answer.attemptItemId },
        data: { answerJson: answer.answerJson as Prisma.InputJsonValue, savedAt: now },
      });
      saved++;
    }

    await tx.quizEvent.create({
      data: {
        tenantId,
        attemptId,
        actorUserId: account.user.id,
        type: QuizEventType.AUTOSAVED,
        metadata: { savedCount: saved } as Prisma.InputJsonValue,
        occurredAt: now,
      },
    });
  });

  return { saved, timedOut: false };
}

// ---------------------------------------------------------------------------
// Finalise (submit or timeout) — idempotent
// ---------------------------------------------------------------------------

/**
 * Finalise an attempt. Called by the student's submit, or by the engine when
 * the deadline has passed. Already-terminal attempts return their stored state
 * without being re-scored.
 */
export async function finaliseAttempt(
  account: AccountContext,
  attemptId: string,
  trigger: "submitted" | "timed_out",
): Promise<AttemptView> {
  requirePermission(account, "submissions.submit");
  const tenantId = tid(account);
  const db = getDb();
  const now = new Date();

  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, userId: account.user.id, tenantId },
    include: ATTEMPT_INCLUDE,
  });
  if (!attempt) throw new ResourceNotFoundError("Attempt not found.");

  const settings = parseQuizSettings(attempt.quiz.settings);

  if (attempt.status !== QuizAttemptStatus.IN_PROGRESS) {
    return buildAttemptView(
      attempt,
      attempt.quiz.releasedAt,
      attempt.quiz.availableUntil,
      settings,
    );
  }

  const scorePatch: { id: string; score: Prisma.Decimal | null }[] = [];

  for (const item of attempt.items) {
    const version = item.questionVersion;
    const answerJson = (item.answer?.answerJson ?? {}) as StudentAnswer;
    const keyJson = version.answerKeyJson as AnswerKey;

    const result = scoreItem({
      type: questionTypeToKey(version.type),
      key: keyJson,
      answer: answerJson,
      pointsPossible: fromDecimal(item.pointsPossible) ?? 1,
      settings,
    });

    scorePatch.push({
      id: item.answer?.id ?? "",
      score: result.score !== null ? toDecimal(result.score) : null,
    });
  }

  const aggregate = aggregateScore(
    attempt.items.map((item, index) => ({
      score: scorePatch[index]?.score != null ? fromDecimal(scorePatch[index]!.score) : null,
      pointsPossible: fromDecimal(item.pointsPossible) ?? 1,
    })),
  );

  const updated = await db.$transaction(async (tx) => {
    const updateResult = await tx.quizAttempt.updateMany({
      where: { id: attemptId, status: QuizAttemptStatus.IN_PROGRESS },
      data: {
        status: trigger === "submitted" ? QuizAttemptStatus.SUBMITTED : QuizAttemptStatus.TIMED_OUT,
        submittedAt: now,
        score: toDecimal(aggregate.score),
      },
    });

    if (updateResult.count === 0) return null;

    for (const patch of scorePatch) {
      if (!patch.id) continue;
      await tx.quizAnswer.update({
        where: { id: patch.id },
        data: { score: patch.score },
      });
    }

    await tx.quizEvent.create({
      data: {
        tenantId,
        attemptId,
        actorUserId: account.user.id,
        type: trigger === "submitted" ? QuizEventType.SUBMITTED : QuizEventType.TIMED_OUT,
        metadata: {
          score: aggregate.score,
          unscoredCount: aggregate.unscoredCount,
        } as Prisma.InputJsonValue,
        occurredAt: now,
      },
    });

    return tx.quizAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: ATTEMPT_INCLUDE,
    });
  });

  await recordAuditEvent(db, {
    tenantId,
    actorUserId: account.user.id,
    action: "quiz_attempt_finalised",
    resourceType: "quiz_attempt",
    resourceId: attemptId,
    after: { quizId: attempt.quizId, trigger, score: aggregate.score } as Prisma.InputJsonValue,
  });

  const finalAttempt =
    updated ??
    (await db.quizAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: ATTEMPT_INCLUDE,
    }));

  return buildAttemptView(
    finalAttempt,
    attempt.quiz.releasedAt,
    attempt.quiz.availableUntil,
    settings,
  );
}

// ---------------------------------------------------------------------------
// Manual essay grading
// ---------------------------------------------------------------------------

export async function gradeEssayItem(
  account: AccountContext,
  attemptId: string,
  input: GradeEssayInput,
) {
  requirePermission(account, "submissions.grade");
  const tenantId = tid(account);
  const db = getDb();

  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, tenantId },
    include: {
      items: { where: { id: input.attemptItemId }, include: { questionVersion: true } },
    },
  });
  if (!attempt) throw new ResourceNotFoundError("Attempt not found.");
  if (attempt.status === QuizAttemptStatus.IN_PROGRESS) {
    throw new ConflictError("Cannot grade an in-progress attempt.");
  }

  const item = attempt.items[0];
  if (!item) throw new ResourceNotFoundError("Attempt item not found.");
  if (
    item.questionVersion.type !== QuestionType.ESSAY &&
    item.questionVersion.type !== QuestionType.SHORT_ANSWER
  ) {
    throw new ConflictError("Only essay and short-answer items can be manually graded.");
  }

  const maxPoints = fromDecimal(item.pointsPossible) ?? 0;
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > maxPoints) {
    throw new ConflictError(`Score must be between 0 and ${maxPoints}.`);
  }

  const aggregate = await db.$transaction(async (tx) => {
    await tx.quizAnswer.update({
      where: { attemptItemId: item.id },
      data: {
        score: toDecimal(input.score),
        feedback: input.feedback?.trim() || null,
      },
    });

    const allAnswers = await tx.quizAnswer.findMany({
      where: { tenantId, item: { attemptId } },
      include: { item: { select: { pointsPossible: true } } },
    });

    const totals = aggregateScore(
      allAnswers.map((answer) => ({
        score: fromDecimal(answer.score),
        pointsPossible: fromDecimal(answer.item.pointsPossible) ?? 1,
      })),
    );

    // Once every item has a mark the attempt is fully graded.
    if (totals.unscoredCount === 0) {
      await tx.quizAttempt.update({
        where: { id: attemptId },
        data: { status: QuizAttemptStatus.GRADED, score: toDecimal(totals.score) },
      });

      await tx.quizEvent.create({
        data: {
          tenantId,
          attemptId,
          actorUserId: account.user.id,
          type: QuizEventType.GRADED,
          metadata: { score: totals.score } as Prisma.InputJsonValue,
        },
      });
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "quiz_essay_graded",
      resourceType: "quiz_attempt",
      resourceId: attemptId,
      after: { attemptItemId: input.attemptItemId, score: input.score } as Prisma.InputJsonValue,
    });

    return totals;
  });

  return { score: input.score, aggregate };
}

// ---------------------------------------------------------------------------
// Read attempt (learner)
// ---------------------------------------------------------------------------

export async function getAttemptForLearner(
  account: AccountContext,
  attemptId: string,
): Promise<AttemptView> {
  requirePermission(account, "submissions.submit");
  const tenantId = tid(account);
  const db = getDb();

  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, userId: account.user.id, tenantId },
    include: ATTEMPT_INCLUDE,
  });
  if (!attempt) throw new ResourceNotFoundError("Attempt not found.");

  const settings = parseQuizSettings(attempt.quiz.settings);
  return buildAttemptView(attempt, attempt.quiz.releasedAt, attempt.quiz.availableUntil, settings);
}

/** The learner's most recent attempt of one quiz, or null when none exists. */
export async function findLatestAttempt(
  account: AccountContext,
  quizId: string,
): Promise<AttemptView | null> {
  requirePermission(account, "submissions.submit");
  const tenantId = tid(account);
  const db = getDb();

  const attempt = await db.quizAttempt.findFirst({
    where: { quizId, userId: account.user.id, tenantId },
    orderBy: { attemptNumber: "desc" },
    include: ATTEMPT_INCLUDE,
  });
  if (!attempt) return null;

  const settings = parseQuizSettings(attempt.quiz.settings);
  return buildAttemptView(attempt, attempt.quiz.releasedAt, attempt.quiz.availableUntil, settings);
}

// ---------------------------------------------------------------------------
// Grading queue (faculty) — essays needing a manual mark
// ---------------------------------------------------------------------------

export async function listUngradedEssays(account: AccountContext, quizId: string) {
  requireGrading(account);
  const tenantId = tid(account);
  const db = getDb();

  return db.quizAttempt.findMany({
    where: {
      quizId,
      tenantId,
      status: { in: [QuizAttemptStatus.SUBMITTED, QuizAttemptStatus.TIMED_OUT] },
      items: {
        some: {
          answer: { score: null },
          questionVersion: { type: { in: [QuestionType.ESSAY, QuestionType.SHORT_ANSWER] } },
        },
      },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      items: {
        where: {
          answer: { score: null },
          questionVersion: { type: { in: [QuestionType.ESSAY, QuestionType.SHORT_ANSWER] } },
        },
        orderBy: { position: "asc" },
        include: {
          questionVersion: { select: { type: true, promptJson: true } },
          answer: { select: { id: true, answerJson: true, score: true, feedback: true } },
        },
      },
    },
    orderBy: { submittedAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Internal view builder
// ---------------------------------------------------------------------------

function buildAttemptView(
  attempt: AttemptWithItems,
  releasedAt: Date | null,
  availableUntil: Date | null,
  settings: QuizSettings,
): AttemptView {
  const visibility = getResultVisibility({
    releasePolicy: settings.releasePolicy,
    releasedAt,
    availableUntil,
    attemptStatus: attemptStatusKey(attempt.status),
    now: new Date(),
  });

  const items: AttemptItemView[] = attempt.items.map((item) => {
    const version = item.questionVersion;
    const allOptions = promptOptions(version.promptJson);
    const byId = new Map(allOptions.map((option) => [option.id, option.text]));
    const order = Array.isArray(item.optionOrder)
      ? (item.optionOrder as string[]).filter((id) => byId.has(id))
      : [];
    const optionOrder = order.length > 0 ? order : allOptions.map((option) => option.id);

    const view: AttemptItemView = {
      id: item.id,
      position: item.position,
      promptJson: (version.promptJson ?? {}) as object,
      type: questionTypeToKey(version.type),
      pointsPossible: fromDecimal(item.pointsPossible) ?? 1,
      optionOrder,
      options: optionOrder.map((id) => ({ id, text: byId.get(id) ?? id })),
      answer: (item.answer?.answerJson ?? {}) as StudentAnswer,
    };

    if (visibility.showResults) {
      view.score = fromDecimal(item.answer?.score ?? null);
      view.feedback = item.answer?.feedback ?? null;
    }

    return view;
  });

  return {
    id: attempt.id,
    quizId: attempt.quizId,
    attemptNumber: attempt.attemptNumber,
    status: attemptStatusKey(attempt.status),
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt ?? null,
    score: visibility.showResults ? fromDecimal(attempt.score) : null,
    pointsPossible: fromDecimal(attempt.pointsPossible) ?? 0,
    items,
    showResults: visibility.showResults,
    showAnswerKey: visibility.showAnswerKey,
  };
}
