"use server";

import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  createBank,
  createQuestion,
  deleteBank,
  deleteQuestion,
  parseQuestionForm,
  publishQuestion,
  questionFormToCreateInput,
  type QuestionFormData,
} from "@/modules/quizzes/bank-service";

const PREFIXES = ["/faculty/courses"] as const;

function path(fd: FormData): string {
  return safeReturnTo(fd.get("returnTo"), PREFIXES, "/faculty/courses");
}

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Builds the typed add-question payload from the raw form fields. */
function readQuestionForm(formData: FormData): QuestionFormData {
  const questionType = text(formData, "questionType") as QuestionFormData["questionType"];

  const options: { id: string; text: string }[] = [];
  for (let index = 1; index <= 5; index++) {
    const value = text(formData, `option${index}`);
    if (value) options.push({ id: `opt_${index - 1}`, text: value });
  }

  const correctOptionIds = text(formData, "correctOptionIds")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const acceptedAnswers = text(formData, "acceptedAnswers")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const points = Number(text(formData, "points"));

  return {
    questionType,
    title: text(formData, "title"),
    points: Number.isFinite(points) && points > 0 ? Math.round(points) : 1,
    stem: text(formData, "stem") || undefined,
    options: options.length > 0 ? options : undefined,
    correctOptionId: text(formData, "correctOptionId") || undefined,
    correctOptionIds: correctOptionIds.length > 0 ? correctOptionIds : undefined,
    acceptedAnswers: acceptedAnswers.length > 0 ? acceptedAnswers : undefined,
  };
}

export async function createBankAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const base = `/faculty/courses/${offeringId}/question-banks`;

  const outcome = await attempt(() =>
    createBank(account, { title: text(formData, "title"), courseOfferingId: offeringId }),
  );

  if (!outcome.ok) redirect(withMessage(base, "error", outcome.message));
  redirect(withMessage(`${base}/${outcome.value.id}`, "notice", "Bank created."));
}

export async function deleteBankAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const base = `/faculty/courses/${offeringId}/question-banks`;

  const outcome = await attempt(() => deleteBank(account, text(formData, "bankId")));
  if (!outcome.ok) redirect(withMessage(base, "error", outcome.message));
  redirect(withMessage(base, "notice", "Bank deleted."));
}

export async function createQuestionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const bankId = text(formData, "bankId");

  const parsed = parseQuestionForm(readQuestionForm(formData));
  if (!parsed.ok) redirect(withMessage(returnTo, "error", parsed.message));

  const input = questionFormToCreateInput(parsed.data, bankId);

  const outcome = await attempt(() => createQuestion(account, input));
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Question created as a draft."));
}

export async function publishQuestionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(() => publishQuestion(account, text(formData, "questionId")));
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Question published."));
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(() => deleteQuestion(account, text(formData, "questionId")));
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Question deleted."));
}
