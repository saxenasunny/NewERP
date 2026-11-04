"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, withMessage } from "@/lib/forms/server-action";
import {
  issueCertificate,
  reissueCertificate,
  revokeCertificate,
  saveCompletionRules,
} from "@/modules/certificates/certificate-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function base(offeringId: string): string {
  return `/faculty/courses/${offeringId}/certificates`;
}

export async function saveCompletionRulesAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    saveCompletionRules(
      account,
      offeringId,
      {
        requireAllContent: formData.get("requireAllContent"),
        requireAssignments: formData.get("requireAssignments"),
        requireQuizzes: formData.get("requireQuizzes"),
        minContentPercent: text(formData, "minContentPercent"),
        minGradePercent: text(formData, "minGradePercent"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Completion rules saved.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function issueCertificateAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    issueCertificate(account, offeringId, text(formData, "learnerUserId"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(
          base(offeringId),
          "notice",
          outcome.value.created
            ? "Certificate issued."
            : "That learner already holds a current certificate.",
        )
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function reissueCertificateAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    reissueCertificate(
      account,
      text(formData, "certificateId"),
      {
        learnerName: text(formData, "learnerName"),
        reason: text(formData, "reason"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(
          base(offeringId),
          "notice",
          "Certificate reissued; the previous one is superseded.",
        )
      : withMessage(base(offeringId), "error", outcome.message),
  );
}

export async function revokeCertificateAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const offeringId = text(formData, "offeringId");

  const outcome = await attempt(async () =>
    revokeCertificate(
      account,
      text(formData, "certificateId"),
      { reason: text(formData, "reason") },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(base(offeringId), "notice", "Certificate revoked.")
      : withMessage(base(offeringId), "error", outcome.message),
  );
}
