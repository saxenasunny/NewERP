/**
 * Question Bank Service — Phase 7
 *
 * Manages question banks and individual questions with versioning.
 * Publishing a question writes an immutable question_versions row; subsequent
 * edits to the question create a new version and leave historical attempts untouched.
 *
 * Permission requirements (caller must hold):
 *   - assessments.manage  — create/update/delete/publish banks and questions
 *   - courses.read        — list/read questions (read-only faculty/TA)
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";
import { Prisma, QuestionStatus, QuestionType } from "../../generated/prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenantId(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

/** The rules layer and the add-question form use lower-case machine names. */
export type QuestionTypeKey =
  "single_choice" | "multi_select" | "true_false" | "short_answer" | "fill_blank" | "essay";

const QUESTION_TYPE_BY_KEY: Record<QuestionTypeKey, QuestionType> = {
  single_choice: QuestionType.SINGLE_CHOICE,
  multi_select: QuestionType.MULTI_SELECT,
  true_false: QuestionType.TRUE_FALSE,
  short_answer: QuestionType.SHORT_ANSWER,
  fill_blank: QuestionType.FILL_BLANK,
  essay: QuestionType.ESSAY,
};

/** Prisma stores UPPER_CASE members; the database keeps the lower-case names. */
export function questionTypeToKey(type: QuestionType): QuestionTypeKey {
  return type.toLowerCase() as QuestionTypeKey;
}

export function questionTypeFromKey(key: QuestionTypeKey): QuestionType {
  return QUESTION_TYPE_BY_KEY[key];
}

const QUESTION_TYPE_KEYS = Object.keys(QUESTION_TYPE_BY_KEY) as [
  QuestionTypeKey,
  ...QuestionTypeKey[],
];

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateBankInput {
  title: string;
  courseOfferingId?: string | null;
}

export interface UpdateBankInput {
  title?: string;
  courseOfferingId?: string | null;
}

export interface CreateQuestionInput {
  bankId: string;
  type: QuestionTypeKey;
  title: string;
  promptJson: object;
  answerKeyJson: object;
  points?: number;
}

export interface UpdateQuestionInput {
  title?: string;
  promptJson?: object;
  answerKeyJson?: object;
  points?: number;
}

export type Bank = Awaited<ReturnType<typeof getBank>>;
export type Question = Awaited<ReturnType<typeof listQuestions>>[number];

// ---------------------------------------------------------------------------
// Typed question form (used by the add-question page and Server Actions)
// ---------------------------------------------------------------------------

/** Normalized prompt + answer key produced by the add-question form.
 * The seed stores the same normalized shape, so the bank, the form, and the
 * attempt engine all agree on what a question contains. */
export interface QuestionFormFields {
  points: number;
  prompt: QuestionPrompt;
  answerKey: AnswerKey;
}

export type QuestionPrompt =
  | { type: "stem_only" }
  | { type: "stem_with_options"; stem: string; options: { id: string; text: string }[] }
  | { type: "short_answer_text" }
  | { type: "essay_text" };

export type AnswerKey =
  { correctOptionId?: string } | { correctOptionIds?: string[] } | { acceptedAnswers?: string[] };

const questionFormSchema = z
  .object({
    questionType: z.enum(QUESTION_TYPE_KEYS),
    title: z.string().trim().min(1, "Give the question a title."),
    points: z.number().int().positive().default(1),
    stem: z.string().trim().min(1).optional(),
    options: z
      .array(z.object({ id: z.string().trim().min(1), text: z.string().trim().min(1) }))
      .min(2, "A question with options needs at least two options.")
      .optional(),
    correctOptionId: z.string().trim().min(1).optional(),
    correctOptionIds: z
      .array(z.string().trim().min(1))
      .min(1, "Select at least one correct option.")
      .optional(),
    acceptedAnswers: z
      .array(z.string().trim().min(1))
      .min(1, "Add at least one accepted answer.")
      .optional(),
  })
  .refine(
    (data) => {
      const type = data.questionType;
      if (type === "single_choice" || type === "true_false") {
        const options = data.options ?? [];
        return Boolean(data.correctOptionId) && options.length >= 2;
      }
      if (type === "multi_select") {
        const options = data.options ?? [];
        return Boolean(data.correctOptionIds?.length) && options.length >= 2;
      }
      if (type === "fill_blank" || type === "short_answer") {
        return Boolean(data.acceptedAnswers?.length);
      }
      if (type === "essay") {
        return true;
      }
      return false;
    },
    { message: "This question type needs the matching answer field filled in." },
  );

export type QuestionFormData = z.infer<typeof questionFormSchema>;

/** Validates an add-question submission, returning a user-facing message on failure. */
export function parseQuestionForm(
  input: unknown,
): { ok: true; data: QuestionFormData } | { ok: false; message: string } {
  const parsed = questionFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the question fields." };
  }
  return { ok: true, data: parsed.data };
}

export function normalizeQuestionForm(form: QuestionFormData): QuestionFormFields {
  const type = form.questionType;
  const options = form.options ?? [];

  let prompt: QuestionPrompt;
  if (type === "fill_blank") {
    prompt = { type: "stem_only" };
  } else {
    prompt = { type: "stem_with_options", stem: form.stem ?? "", options };
  }

  let answerKey: AnswerKey;
  if (type === "single_choice" || type === "true_false") {
    answerKey = form.correctOptionId ? { correctOptionId: form.correctOptionId } : {};
  } else if (type === "multi_select") {
    answerKey = { correctOptionIds: form.correctOptionIds ?? [] };
  } else if (type === "fill_blank" || type === "short_answer") {
    answerKey = { acceptedAnswers: form.acceptedAnswers ?? [] };
  } else {
    answerKey = {};
  }

  return { points: form.points, prompt, answerKey };
}

export function questionFormToCreateInput(
  form: QuestionFormData,
  bankId: string,
): CreateQuestionInput {
  const normalized = normalizeQuestionForm(form);
  return {
    bankId,
    type: form.questionType,
    title: form.title,
    points: normalized.points,
    promptJson: normalizePromptJson(normalized.prompt),
    answerKeyJson: normalizeAnswerKeyJson(normalized.answerKey),
  };
}

function normalizePromptJson(prompt: QuestionPrompt): object {
  if (prompt.type === "stem_with_options") {
    return { stem: prompt.stem, options: prompt.options };
  }
  return { stem: "" };
}

function normalizeAnswerKeyJson(key: AnswerKey): object {
  if ("correctOptionId" in key) return { correctOptionId: key.correctOptionId ?? undefined };
  if ("correctOptionIds" in key) return { correctOptionIds: key.correctOptionIds ?? undefined };
  if ("acceptedAnswers" in key) return { acceptedAnswers: key.acceptedAnswers ?? undefined };
  return {};
}

// ---------------------------------------------------------------------------
// Banks
// ---------------------------------------------------------------------------

/** Question banks of one course offering (or every bank the tenant owns). */
export async function listBanks(
  account: AccountContext,
  opts: { courseOfferingId?: string | null } = {},
  db: DatabaseClient = getDb(),
) {
  requirePermission(account, "courses.read");
  const tenant = tenantId(account);

  return db.questionBank.findMany({
    where: {
      tenantId: tenant,
      ...(opts.courseOfferingId ? { offeringId: opts.courseOfferingId } : {}),
    },
    include: { _count: { select: { questions: true } } },
    orderBy: { title: "asc" },
  });
}

export async function getBank(
  account: AccountContext,
  bankId: string,
  db: DatabaseClient = getDb(),
) {
  requirePermission(account, "courses.read");
  const tenant = tenantId(account);

  const bank = await db.questionBank.findFirst({
    where: { id: bankId, tenantId: tenant },
    include: { _count: { select: { questions: true } } },
  });
  if (!bank) throw new ResourceNotFoundError("Question bank not found.");
  return bank;
}

export async function createBank(account: AccountContext, input: CreateBankInput) {
  requirePermission(account, "assessments.manage");
  const tenant = tenantId(account);
  const title = input.title.trim();
  if (!title) throw new ConflictError("A question bank needs a title.");

  const db = getDb();
  return db.$transaction(async (tx) => {
    const bank = await tx.questionBank.create({
      data: {
        tenantId: tenant,
        offeringId: input.courseOfferingId ?? null,
        title,
        ownerUserId: account.user.id,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: tenant,
      actorUserId: account.user.id,
      action: "question_bank_created",
      resourceType: "question_bank",
      resourceId: bank.id,
      after: { title: bank.title },
    });
    return bank;
  });
}

export async function updateBank(account: AccountContext, bankId: string, input: UpdateBankInput) {
  requirePermission(account, "assessments.manage");
  const tenant = tenantId(account);
  const db = getDb();
  const existing = await getBank(account, bankId, db);

  return db.$transaction(async (tx) => {
    const bank = await tx.questionBank.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.courseOfferingId !== undefined ? { offeringId: input.courseOfferingId } : {}),
      },
    });
    await recordAuditEvent(tx, {
      tenantId: tenant,
      actorUserId: account.user.id,
      action: "question_bank_updated",
      resourceType: "question_bank",
      resourceId: bank.id,
      before: { title: existing.title },
      after: { title: bank.title },
    });
    return bank;
  });
}

/**
 * A bank that still backs questions used by a quiz, or that has attempt
 * history, cannot be deleted: the foreign keys are restrictive on purpose.
 */
export async function deleteBank(account: AccountContext, bankId: string) {
  requirePermission(account, "assessments.manage");
  const tenant = tenantId(account);
  const db = getDb();
  const existing = await getBank(account, bankId, db);

  try {
    await db.$transaction(async (tx) => {
      await tx.questionBank.delete({ where: { id: existing.id } });
      await recordAuditEvent(tx, {
        tenantId: tenant,
        actorUserId: account.user.id,
        action: "question_bank_deleted",
        resourceType: "question_bank",
        resourceId: bankId,
        before: { title: existing.title },
      });
    });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2003") {
      throw new ConflictError(
        "This bank holds questions that a quiz or a past attempt still uses. Remove them from the quiz first.",
      );
    }
    throw caught;
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function listQuestions(
  account: AccountContext,
  bankId: string,
  opts: { status?: "draft" | "published" } = {},
  db: DatabaseClient = getDb(),
) {
  requirePermission(account, "courses.read");
  const tenant = tenantId(account);

  return db.question.findMany({
    where: {
      tenantId: tenant,
      bankId,
      ...(opts.status === "draft"
        ? { status: QuestionStatus.DRAFT }
        : opts.status === "published"
          ? { status: QuestionStatus.PUBLISHED }
          : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function getQuestion(account: AccountContext, questionId: string) {
  requirePermission(account, "courses.read");
  const tenant = tenantId(account);
  const db = getDb();

  const question = await db.question.findFirst({
    where: { id: questionId, tenantId: tenant },
  });
  if (!question) throw new ResourceNotFoundError("Question not found.");
  return question;
}

export async function createQuestion(account: AccountContext, input: CreateQuestionInput) {
  requirePermission(account, "assessments.manage");
  const tenant = tenantId(account);
  const db = getDb();
  // Resolves the bank inside the tenant (404 for another institution).
  const bank = await getBank(account, input.bankId, db);

  return db.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        tenantId: tenant,
        bankId: bank.id,
        type: questionTypeFromKey(input.type),
        title: input.title.trim(),
        promptJson: input.promptJson as Prisma.InputJsonValue,
        answerKeyJson: input.answerKeyJson as Prisma.InputJsonValue,
        points: input.points ?? 1,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: tenant,
      actorUserId: account.user.id,
      action: "quiz_question_created",
      resourceType: "question",
      resourceId: question.id,
      after: { bankId: bank.id, type: question.type, title: question.title },
    });
    return question;
  });
}

export async function updateQuestion(
  account: AccountContext,
  questionId: string,
  input: UpdateQuestionInput,
) {
  requirePermission(account, "assessments.manage");
  const tenant = tenantId(account);
  const db = getDb();
  const existing = await getQuestion(account, questionId);

  return db.$transaction(async (tx) => {
    const question = await tx.question.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.promptJson !== undefined
          ? { promptJson: input.promptJson as Prisma.InputJsonValue }
          : {}),
        ...(input.answerKeyJson !== undefined
          ? { answerKeyJson: input.answerKeyJson as Prisma.InputJsonValue }
          : {}),
        ...(input.points !== undefined ? { points: input.points } : {}),
      },
    });
    await recordAuditEvent(tx, {
      tenantId: tenant,
      actorUserId: account.user.id,
      action: "quiz_question_updated",
      resourceType: "question",
      resourceId: question.id,
      before: { title: existing.title },
      after: { title: question.title },
    });
    return question;
  });
}

/**
 * Publish the current working copy as a new immutable version.
 * Attempts point at question_versions rows, so a later edit cannot rewrite
 * what a learner already answered.
 */
export async function publishQuestion(account: AccountContext, questionId: string) {
  requirePermission(account, "assessments.manage");
  const tenant = tenantId(account);
  const db = getDb();
  const existing = await getQuestion(account, questionId);

  return db.$transaction(async (tx) => {
    const nextVersion = existing.currentVersion + 1;
    const question = await tx.question.update({
      where: { id: existing.id },
      data: { status: QuestionStatus.PUBLISHED, currentVersion: nextVersion },
    });

    await tx.questionVersion.create({
      data: {
        tenantId: tenant,
        questionId: question.id,
        version: nextVersion,
        type: question.type,
        promptJson: question.promptJson as Prisma.InputJsonValue,
        answerKeyJson: question.answerKeyJson as Prisma.InputJsonValue,
        points: question.points,
      },
    });

    await recordAuditEvent(tx, {
      tenantId: tenant,
      actorUserId: account.user.id,
      action: "quiz_question_published",
      resourceType: "question",
      resourceId: question.id,
      after: { version: nextVersion },
    });
    return question;
  });
}

export async function deleteQuestion(account: AccountContext, questionId: string) {
  requirePermission(account, "assessments.manage");
  const tenant = tenantId(account);
  const db = getDb();
  const existing = await getQuestion(account, questionId);

  try {
    await db.$transaction(async (tx) => {
      await tx.question.delete({ where: { id: existing.id } });
      await recordAuditEvent(tx, {
        tenantId: tenant,
        actorUserId: account.user.id,
        action: "quiz_question_deleted",
        resourceType: "question",
        resourceId: questionId,
        before: { title: existing.title },
      });
    });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2003") {
      throw new ConflictError(
        "This question is used by a quiz or a past attempt and cannot be deleted.",
      );
    }
    throw caught;
  }
}

/**
 * The published snapshot that attempts should copy. Used when a question is
 * added to a quiz, so an unpublished question can never be delivered.
 */
export async function getCurrentVersion(tenant: string, questionId: string) {
  const db = getDb();
  const question = await db.question.findFirst({
    where: { id: questionId, tenantId: tenant },
    select: { id: true, title: true, status: true, currentVersion: true },
  });
  if (!question) throw new ResourceNotFoundError("Question not found.");
  if (question.status !== QuestionStatus.PUBLISHED) {
    throw new ConflictError(`Publish "${question.title}" before adding it to a quiz.`);
  }

  const version = await db.questionVersion.findFirst({
    where: { questionId, tenantId: tenant, version: question.currentVersion },
  });
  if (!version) {
    throw new ConflictError(`"${question.title}" has no published version. Publish it again.`);
  }
  return version;
}
