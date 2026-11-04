"use server";

import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  addQuestionRef,
  archiveQuiz,
  createQuiz,
  deleteQuiz,
  publishQuiz,
  releaseResults,
  removeQuestionRef,
  updateQuiz,
} from "@/modules/quizzes/quiz-service";
import type { QuizSettings } from "@/modules/quizzes/rules";

const PREFIXES = ["/faculty/courses"] as const;

function path(fd: FormData): string {
  return safeReturnTo(fd.get("returnTo"), PREFIXES, "/faculty/courses");
}
function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "");
}
function optDate(fd: FormData, key: string): Date | null {
  const v = text(fd, key);
  return v ? new Date(v) : null;
}

export async function createQuizAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const settings: Partial<QuizSettings> = {};
  const tl = Number(text(formData, "timeLimitMinutes"));
  if (tl > 0) settings.timeLimitMinutes = tl;
  const al = Number(text(formData, "attemptLimit"));
  if (al >= 1) settings.attemptLimit = al;

  const outcome = await attempt(() =>
    createQuiz(account, {
      courseOfferingId: offeringId,
      title: text(formData, "title"),
      instructions: text(formData, "instructions") || undefined,
      availableFrom: optDate(formData, "availableFrom"),
      availableUntil: optDate(formData, "availableUntil"),
      settings,
    }),
  );

  if (!outcome.ok) {
    redirect(withMessage(`/faculty/courses/${offeringId}/quizzes`, "error", outcome.message));
  }
  redirect(
    withMessage(
      `/faculty/courses/${offeringId}/quizzes/${outcome.value.id}`,
      "notice",
      "Quiz created. Add questions to get started.",
    ),
  );
}

export async function updateQuizAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const quizId = text(formData, "quizId");

  const settings: Partial<QuizSettings> = {};
  const tl = Number(text(formData, "timeLimitMinutes"));
  settings.timeLimitMinutes = tl > 0 ? tl : null;
  const al = Number(text(formData, "attemptLimit"));
  if (al >= 1) settings.attemptLimit = al;

  const gm = text(formData, "gradingMethod");
  if (gm === "highest" || gm === "latest" || gm === "first") settings.gradingMethod = gm;
  const rp = text(formData, "releasePolicy");
  if (rp === "never" || rp === "on_submit" || rp === "after_until" || rp === "manual") {
    settings.releasePolicy = rp;
  }
  const passMarkText = text(formData, "passMark");
  const passMark = Number(passMarkText);
  settings.passMark =
    passMarkText && Number.isFinite(passMark) && passMark >= 0 && passMark <= 100 ? passMark : null;

  settings.shuffleQuestions = formData.get("shuffleQuestions") === "on";
  settings.shuffleOptions = formData.get("shuffleOptions") === "on";

  const outcome = await attempt(() =>
    updateQuiz(account, quizId, {
      title: text(formData, "title") || undefined,
      instructions: text(formData, "instructions") || null,
      availableFrom: optDate(formData, "availableFrom"),
      availableUntil: optDate(formData, "availableUntil"),
      settings,
    }),
  );

  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Quiz updated."));
}

export async function publishQuizAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const outcome = await attempt(() => publishQuiz(account, text(formData, "quizId")));
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Quiz published and visible to students."));
}

export async function archiveQuizAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const outcome = await attempt(() => archiveQuiz(account, text(formData, "quizId")));
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Quiz archived."));
}

export async function deleteQuizAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const outcome = await attempt(() => deleteQuiz(account, text(formData, "quizId")));
  const base = `/faculty/courses/${offeringId}/quizzes`;
  if (!outcome.ok) redirect(withMessage(base, "error", outcome.message));
  redirect(withMessage(base, "notice", "Quiz deleted."));
}

export async function releaseResultsAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const outcome = await attempt(() => releaseResults(account, text(formData, "quizId")));
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Results released to students."));
}

export async function addQuestionRefAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const po = Number(text(formData, "pointsOverride"));
  const outcome = await attempt(() =>
    addQuestionRef(account, text(formData, "quizId"), {
      questionId: text(formData, "questionId"),
      pointsOverride: po > 0 ? po : null,
    }),
  );
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Question added."));
}

export async function removeQuestionRefAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const outcome = await attempt(() =>
    removeQuestionRef(account, text(formData, "quizId"), text(formData, "questionId")),
  );
  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(withMessage(returnTo, "notice", "Question removed."));
}
