"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import {
  excuseAssessment,
  releaseOfferingMarks,
  removeExcusal,
  saveGradingScheme,
} from "@/modules/gradebook/gradebook-service";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function base(offeringId: string): string {
  return `/faculty/courses/${offeringId}/gradebook`;
}

/** Reads `weight_<columnId>` for every assessment; column ids are `kind:id`. */
function readWeights(formData: FormData, columnIds: string[]) {
  const weights: { kind: "assignment" | "quiz"; refId: string; weight: number }[] = [];

  for (const columnId of columnIds) {
    const raw = text(formData, `weight_${columnId}`);
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;

    const [kind, ...rest] = columnId.split(":");
    const refId = rest.join(":");
    if ((kind !== "assignment" && kind !== "quiz") || !refId) continue;
    weights.push({ kind, refId, weight: value });
  }

  return weights;
}

export async function saveSchemeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const mode = text(formData, "mode") === "weighted" ? "weighted" : "points";
  const passMarkText = text(formData, "passMark");
  const passMark = Number(passMarkText);
  const rounding = Number(text(formData, "rounding") || "2");

  const columnIds = formData
    .getAll("columnId")
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);

  const outcome = await attempt(() =>
    saveGradingScheme(account, offeringId, {
      mode,
      passMark:
        passMarkText && Number.isFinite(passMark) && passMark >= 0 && passMark <= 100
          ? passMark
          : null,
      rounding: Number.isFinite(rounding) ? Math.min(2, Math.max(0, Math.trunc(rounding))) : 2,
      treatMissingAsZero: formData.get("treatMissingAsZero") === "on",
      ...(mode === "weighted" ? { weights: readWeights(formData, columnIds) } : {}),
    }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(withMessage(base(offeringId), "notice", "Grading scheme saved and recalculated."));
}

export async function excuseAssessmentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");
  const columnId = text(formData, "columnId");
  const [kind, ...rest] = columnId.split(":");
  const refId = rest.join(":");

  const outcome = await attempt(() =>
    excuseAssessment(account, offeringId, {
      userId: text(formData, "userId"),
      kind: kind === "quiz" ? "quiz" : "assignment",
      refId,
      reason: text(formData, "reason"),
    }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(withMessage(base(offeringId), "notice", "Assessment excused for that learner."));
}

/**
 * Releases every scored draft mark in the offering. The form must carry the
 * confirmation checkbox, so a stray submit cannot publish a whole cohort.
 */
export async function releaseOfferingAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  if (formData.get("confirm") !== "on") {
    redirect(
      withMessage(base(offeringId), "error", "Tick the confirmation box to release grades."),
    );
  }

  const outcome = await attempt(async () =>
    releaseOfferingMarks(account, offeringId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }

  const { released, learners } = outcome.value;
  redirect(
    withMessage(
      base(offeringId),
      "notice",
      released === 0
        ? "Nothing to release: every scored mark is already published."
        : `Released ${released} mark(s) to ${learners} learner(s).`,
    ),
  );
}

export async function removeExcusalAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(() =>
    removeExcusal(account, offeringId, text(formData, "excusalId")),
  );

  if (!outcome.ok) {
    redirect(withMessage(base(offeringId), "error", outcome.message));
  }
  redirect(withMessage(base(offeringId), "notice", "Excusal removed."));
}
