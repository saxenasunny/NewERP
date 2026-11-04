"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import {
  createAssessmentMapping,
  createCourseOutcome,
  removeAssessmentMapping,
  removeOutcomeMapping,
  setCourseOutcomeStatus,
  updateCourseOutcome,
  upsertOutcomeMapping,
} from "@/modules/obe/outcome-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function base(offeringId: string): string {
  return `/faculty/courses/${offeringId}/outcomes`;
}

export async function createCourseOutcomeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    createCourseOutcome(
      account,
      offeringId,
      {
        code: text(formData, "code"),
        title: text(formData, "title"),
        description: text(formData, "description"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Course outcome created.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function updateCourseOutcomeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    updateCourseOutcome(
      account,
      text(formData, "id"),
      {
        code: text(formData, "code"),
        title: text(formData, "title"),
        description: text(formData, "description"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Course outcome updated.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function archiveCourseOutcomeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    setCourseOutcomeStatus(account, text(formData, "id"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Course outcome status updated.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function setCorrelationAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const level = text(formData, "correlationLevel");
  const mappingId = text(formData, "mappingId");

  const outcome = await attempt(async () => {
    if (!level) {
      if (!mappingId) return;
      await removeOutcomeMapping(account, offeringId, mappingId, {
        requestId: await currentRequestId(),
      });
      return;
    }
    await upsertOutcomeMapping(
      account,
      offeringId,
      {
        courseOutcomeId: text(formData, "courseOutcomeId"),
        programmeOutcomeId: text(formData, "programmeOutcomeId"),
        correlationLevel: level,
      },
      { requestId: await currentRequestId() },
    );
  });

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Mapping saved.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function createAssessmentMappingAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const ref = text(formData, "ref");
  const separator = ref.indexOf(":");
  const prefix = separator === -1 ? "" : ref.slice(0, separator);
  const refId = separator === -1 ? "" : ref.slice(separator + 1);
  const kind = prefix === "QUESTION" ? "QUESTION" : "ASSIGNMENT";

  const outcome = await attempt(async () =>
    createAssessmentMapping(
      account,
      offeringId,
      {
        courseOutcomeId: text(formData, "courseOutcomeId"),
        kind,
        assignmentId: kind === "ASSIGNMENT" ? refId : undefined,
        questionId: kind === "QUESTION" ? refId : undefined,
        weight: text(formData, "weight") || "1",
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Assessment mapped.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function removeAssessmentMappingAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    removeAssessmentMapping(account, offeringId, text(formData, "mappingId"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Assessment mapping removed.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}
