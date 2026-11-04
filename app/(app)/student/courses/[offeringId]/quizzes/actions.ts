"use server";

import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  autosave,
  finaliseAttempt,
  getAttemptForLearner,
  startAttempt,
  type AttemptView,
  type AutosaveAnswerInput,
} from "@/modules/quizzes/attempt-engine";
import type { StudentAnswer } from "@/modules/quizzes/rules";

const PREFIXES = ["/student/courses"] as const;

function path(fd: FormData): string {
  return safeReturnTo(fd.get("returnTo"), PREFIXES, "/student/courses");
}

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "");
}

/**
 * Reads the posted `answer_<itemId>` fields into the stored answer shape.
 * The stored shape depends on the question type, so the attempt's own item
 * list decides how each field is interpreted.
 */
function collectAnswers(formData: FormData, view: AttemptView): AutosaveAnswerInput[] {
  const answers: AutosaveAnswerInput[] = [];

  for (const item of view.items) {
    const key = `answer_${item.id}`;
    const values = formData
      .getAll(key)
      .map((value) => (typeof value === "string" ? value : ""))
      .filter((value) => value.length > 0);

    let answerJson: StudentAnswer | null = null;
    if (item.type === "multi_select") {
      if (values.length > 0) answerJson = { selectedOptionIds: values };
    } else if (item.type === "single_choice" || item.type === "true_false") {
      const [value] = values;
      if (value) answerJson = { selectedOptionId: value };
    } else if (values.length > 0) {
      answerJson = { text: values.join("\n") };
    }

    if (answerJson) answers.push({ attemptItemId: item.id, answerJson });
  }

  return answers;
}

export async function startAttemptAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const quizId = text(formData, "quizId");
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(() => startAttempt(account, quizId));

  if (!outcome.ok) {
    redirect(withMessage(`/student/courses/${offeringId}/quizzes`, "error", outcome.message));
  }
  redirect(`/student/courses/${offeringId}/quizzes/${quizId}/attempt/${outcome.value.id}`);
}

/** Saves the current answers and returns to the same attempt page. */
export async function autosaveAttemptAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const attemptId = text(formData, "attemptId");

  const outcome = await attempt(async () => {
    const view = await getAttemptForLearner(account, attemptId);
    const answers = collectAnswers(formData, view);
    return autosave(account, attemptId, answers);
  });

  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(
    outcome.value.timedOut
      ? withMessage(returnTo, "error", "Time expired. Your saved answers were submitted.")
      : withMessage(returnTo, "notice", "Progress saved."),
  );
}

export async function submitAttemptAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const attemptId = text(formData, "attemptId");

  const outcome = await attempt(async () => {
    const view = await getAttemptForLearner(account, attemptId);
    // Persist the final answers first so nothing typed at the end is lost.
    await autosave(account, attemptId, collectAnswers(formData, view));
    return finaliseAttempt(account, attemptId, "submitted");
  });

  if (!outcome.ok) redirect(withMessage(returnTo, "error", outcome.message));
  redirect(
    withMessage(returnTo, "notice", "Quiz submitted. Your results will appear when released."),
  );
}
