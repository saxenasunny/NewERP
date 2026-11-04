"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import { commitImport, previewImport, type ImportKind } from "@/modules/imports/import-service";

const PREFIXES = ["/admin/imports"] as const;

function backTo(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/admin/imports");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function previewImportAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = backTo(formData);
  const kind = text(formData, "kind") as ImportKind;

  const file = formData.get("file");
  const pasted = text(formData, "csvText");
  let csvText = pasted;
  let fileName = "pasted.csv";

  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) {
      redirect(withMessage(returnTo, "error", "The file is larger than 2 MB."));
    }
    csvText = await file.text();
    fileName = file.name || "upload.csv";
  }

  if (!csvText.trim()) {
    redirect(withMessage(returnTo, "error", "Choose a CSV file or paste its contents."));
  }

  const outcome = await attempt(async () =>
    previewImport(account, { kind, fileName, csvText }, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }

  redirect(`/admin/imports/${outcome.value.id}`);
}

export async function commitImportAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const jobId = text(formData, "jobId");
  const returnTo = `/admin/imports/${jobId}`;

  const outcome = await attempt(async () =>
    commitImport(account, jobId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }

  const { created, updated, skipped, failed } = outcome.value;
  redirect(
    withMessage(
      returnTo,
      "notice",
      `Import committed: ${created} created, ${updated} updated, ${skipped} already present, ${failed} failed.`,
    ),
  );
}
