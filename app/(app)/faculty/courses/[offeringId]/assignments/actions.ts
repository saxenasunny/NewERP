"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  createAssignment,
  deleteAssignment,
  saveRubric,
  setAssignmentStatus,
  updateAssignment,
} from "@/modules/assignments/assignment-service";
import { releaseAllGrades, releaseGrade, saveGrade } from "@/modules/assignments/grading-service";
const PREFIXES = ["/faculty/courses", "/faculty/assignments"] as const;

function path(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/faculty/assignments");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function checked(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function assignmentFields(formData: FormData) {
  return {
    offeringId: text(formData, "offeringId"),
    assignmentId: text(formData, "assignmentId") || undefined,
    title: text(formData, "title"),
    instructions: text(formData, "instructions"),
    submissionType: text(formData, "submissionType") || "TEXT",
    pointsPossible: text(formData, "pointsPossible") || "10",
    dueAt: text(formData, "dueAt"),
    availableFrom: text(formData, "availableFrom"),
    availableUntil: text(formData, "availableUntil"),
    allowLateSubmission: checked(formData, "allowLateSubmission"),
    allowResubmission: checked(formData, "allowResubmission"),
    maxAttempts: text(formData, "maxAttempts") || "1",
  };
}

export async function createAssignmentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createAssignment(account, assignmentFields(formData), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Assignment created as a draft.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateAssignmentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateAssignment(account, assignmentFields(formData), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Assignment saved.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function setAssignmentStatusAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const status = text(formData, "status");

  const outcome = await attempt(async () =>
    setAssignmentStatus(
      account,
      {
        assignmentId: text(formData, "assignmentId"),
        status: status === "PUBLISHED" ? "PUBLISHED" : status === "ARCHIVED" ? "ARCHIVED" : "DRAFT",
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", `Assignment is now ${status.toLowerCase()}.`)
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function deleteAssignmentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    deleteAssignment(account, text(formData, "assignmentId"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Draft assignment deleted.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function saveRubricAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const titles = formData.getAll("criterionTitle").map(String);
  const points = formData.getAll("criterionPoints").map(String);
  const descriptions = formData.getAll("criterionDescription").map(String);

  const criteria = titles
    .map((title, index) => ({
      title: title.trim(),
      pointsPossible: points[index]?.trim() || "1",
      description: descriptions[index]?.trim() ?? "",
    }))
    .filter((criterion) => criterion.title.length > 0);

  const outcome = await attempt(async () =>
    saveRubric(
      account,
      { assignmentId: text(formData, "assignmentId"), criteria },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Rubric saved.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function saveGradeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const rubricScores: Array<{ criterionId: string; score: string; feedback: string }> = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("criterionScore_")) {
      const criterionId = key.slice("criterionScore_".length);
      rubricScores.push({
        criterionId,
        score: String(value),
        feedback: String(formData.get(`criterionFeedback_${criterionId}`) ?? ""),
      });
    }
  }

  const outcome = await attempt(async () =>
    saveGrade(
      account,
      {
        submissionId: text(formData, "submissionId"),
        rawScore: text(formData, "rawScore"),
        feedback: text(formData, "feedback"),
        reason: text(formData, "reason"),
        rubricScores,
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(
          returnTo,
          "notice",
          "Grade saved as a draft. Release it when you are ready for the learner to see it.",
        )
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function releaseGradeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    releaseGrade(account, text(formData, "gradeId"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Grade released. The learner has been notified.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function releaseAllGradesAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    releaseAllGrades(account, text(formData, "assignmentId"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", `Released ${outcome.value.released} grade(s).`)
      : withMessage(returnTo, "error", outcome.message),
  );
}
