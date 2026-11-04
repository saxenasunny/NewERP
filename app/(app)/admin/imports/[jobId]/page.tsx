import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { getImportJob } from "@/modules/imports/import-service";

import { commitImportAction } from "../actions";

export const metadata: Metadata = { title: "Import report" };

const ROW_TONES: Record<string, BadgeTone> = {
  VALID: "info",
  INVALID: "danger",
  CREATED: "success",
  UPDATED: "info",
  SKIPPED: "warning",
  FAILED: "danger",
};

const KIND_LABELS = {
  USERS: "People",
  ENROLMENTS: "Learner enrolments",
  INSTRUCTORS: "Instructor assignments",
} as const;

export default async function ImportJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ jobId }, { notice, error }] = await Promise.all([params, searchParams]);

  const canImportPeople = account.permissions.has("users.import");
  const canImportEnrolments = account.permissions.has("enrolments.manage");
  if (!canImportPeople && !canImportEnrolments) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Import report" />
        <PermissionDenied message="Your role cannot view imports." />
      </div>
    );
  }

  const job = await getImportJob(account, jobId).catch(() => null);
  if (!job) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Import report" description="This import is not available." />
        <Alert tone="warning" title="Not found">
          It may belong to another institution.{" "}
          <Link href="/admin/imports" className="font-medium underline">
            Back to imports
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const canCommit =
    job.status === "PREVIEW" &&
    (job.kind === "USERS" ? canImportPeople : canImportEnrolments) &&
    job.rows.some((row) => row.status === "VALID");

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "CSV imports", href: "/admin/imports" },
          { label: job.fileName },
        ]}
      />
      <PageHeader
        eyebrow={KIND_LABELS[job.kind]}
        title={job.fileName}
        description={`Uploaded ${job.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC${job.createdBy?.name ? ` by ${job.createdBy.name}` : ""}.`}
        actions={
          <StatusBadge
            tone={
              job.status === "COMMITTED" ? "success" : job.status === "FAILED" ? "danger" : "info"
            }
          >
            {job.status.toLowerCase()}
          </StatusBadge>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not commit">
          {error}
        </Alert>
      ) : null}
      {job.error ? (
        <Alert tone="danger" title="This file could not be validated">
          {job.error}
        </Alert>
      ) : null}

      <section aria-labelledby="summary-heading" className="flex flex-col gap-3">
        <h2 id="summary-heading" className="sr-only">
          Summary
        </h2>
        <dl className="grid gap-3 sm:grid-cols-4">
          {[
            ["Rows", job.totalRows],
            ["Valid", job.validRows],
            ["Invalid", job.invalidRows],
            ["Committed", job.committedAt ? job.committedAt.toISOString().slice(0, 10) : "—"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-card border-border bg-surface shadow-card border px-4 py-3"
            >
              <dt className="text-ink-muted text-xs font-semibold uppercase">{label}</dt>
              <dd className="text-ink mt-1 text-xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {job.status === "PREVIEW" ? (
        <section aria-labelledby="commit-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="commit-heading" className="text-ink text-lg font-semibold">
              Commit
            </h2>
            <p className="text-ink-muted text-sm">
              Only rows marked valid are applied. Invalid rows are skipped; correct them and upload
              the file again. Re-importing the same identifiers updates existing records instead of
              creating duplicates.
            </p>
          </div>
          <form action={commitImportAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="returnTo" value={`/admin/imports/${job.id}`} />
            <Button type="submit" disabled={!canCommit}>
              Commit {job.validRows} valid row(s)
            </Button>
            {!canCommit ? (
              <span className="text-ink-muted text-sm">
                {job.rows.some((row) => row.status === "VALID")
                  ? "Your role cannot commit this kind of import."
                  : "There are no valid rows to apply."}
              </span>
            ) : null}
          </form>
        </section>
      ) : null}

      <section aria-labelledby="rows-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="rows-heading" className="text-ink text-lg font-semibold">
            Row report
          </h2>
          <Link
            href={`/admin/imports/${job.id}/report`}
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Download report (CSV)
          </Link>
        </div>

        {job.rows.length === 0 ? (
          <EmptyState
            title="No rows to show"
            description="The file was rejected before any row could be checked. See the error above."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Rows in {job.fileName}</caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Row
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Identifier
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row) => (
                  <tr key={row.id} className="border-border border-t align-top">
                    <td className="text-ink-muted px-3 py-3 text-sm">{row.rowNumber}</td>
                    <td className="px-3 py-3">
                      <StatusBadge tone={ROW_TONES[row.status] ?? "info"}>
                        {row.status.toLowerCase()}
                      </StatusBadge>
                    </td>
                    <td className="text-ink px-3 py-3 text-sm break-all">
                      {row.identifier ?? "—"}
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {row.message ?? (row.status === "VALID" ? "Ready to apply." : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
