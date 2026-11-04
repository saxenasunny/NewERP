"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  activateAttainmentPolicy,
  archiveProgrammeOutcome,
  createAttainmentPolicyDraft,
  createProgrammeOutcome,
  updateAttainmentPolicyDraft,
  updateProgrammeOutcome,
} from "@/modules/obe/outcome-service";

const PREFIXES = ["/admin/obe"] as const;

function path(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/admin/obe");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function createProgrammeOutcomeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const programmeId = text(formData, "programmeId");

  const outcome = await attempt(async () =>
    createProgrammeOutcome(
      account,
      programmeId,
      {
        type: text(formData, "type"),
        code: text(formData, "code"),
        title: text(formData, "title"),
        description: text(formData, "description"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Outcome created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateProgrammeOutcomeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateProgrammeOutcome(
      account,
      text(formData, "id"),
      {
        type: text(formData, "type"),
        code: text(formData, "code"),
        title: text(formData, "title"),
        description: text(formData, "description"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Outcome updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function archiveProgrammeOutcomeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    archiveProgrammeOutcome(account, text(formData, "id"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Outcome status updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

function policyInput(formData: FormData) {
  return {
    name: text(formData, "name"),
    notes: text(formData, "notes"),
    rounding: text(formData, "rounding") || "2",
    courseOutcomeThreshold: text(formData, "courseOutcomeThreshold"),
    programmeOutcomeThreshold: text(formData, "programmeOutcomeThreshold"),
    directMethodNotes: text(formData, "directMethodNotes"),
    indirectMethodNotes: text(formData, "indirectMethodNotes"),
  };
}

export async function createPolicyDraftAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createAttainmentPolicyDraft(account, policyInput(formData), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", `Draft policy v${outcome.value.version} created.`)
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updatePolicyDraftAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateAttainmentPolicyDraft(account, text(formData, "id"), policyInput(formData), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Draft policy updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function activatePolicyAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    activateAttainmentPolicy(account, text(formData, "id"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(
          returnTo,
          "notice",
          outcome.value.formulaConfigured
            ? "Policy activated."
            : "Policy activated. Attainment is still not calculated until a formula is confirmed.",
        )
      : withMessage(returnTo, "error", outcome.message),
  );
}
