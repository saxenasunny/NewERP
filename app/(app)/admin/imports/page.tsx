import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { listImportJobs, type ImportJobSummary } from "@/modules/imports/import-service";

import { previewImportAction } from "./actions";

export const metadata: Metadata = { title: "CSV imports" };

const STATUS_TONES: Record<ImportJobSummary["status"], BadgeTone> = {
  PREVIEW: "info",
  COMMITTED: "success",
  FAILED: "danger",
};

const KIND_LABELS = {
  USERS: "People (students and faculty)",
  ENROLMENTS: "Learner enrolments",
  INSTRUCTORS: "Instructor assignments",
} as const;

const KIND_COLUMNS = {
  USERS: "email, name, role (student | faculty), institutional_id (optional)",
  ENROLMENTS: "email, course_code, term, academic_year, section (optional)",
  INSTRUCTORS: "email, course_code, term, academic_year, section (optional), role (optional)",
} as const;

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { notice, error } = await searchParams;

  const canImportPeople = account.permissions.has("users.import");
  const canImportEnrolments = account.permissions.has("enrolments.manage");
  if (!canImportPeople && !canImportEnrolments) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="CSV imports" />
        <PermissionDenied message="Your role cannot import people or enrolments." />
      </div>
    );
  }

  const jobs = await listImportJobs(account);
  const kinds = [
    ...(canImportPeople ? (["USERS"] as const) : []),
    ...(canImportEnrolments ? (["ENROLMENTS", "INSTRUCTORS"] as const) : []),
  ];
  const defaultKind = kinds[0] ?? "USERS";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Overview", href: "/admin" }, { label: "CSV imports" }]} />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="CSV imports"
        description="Upload a file to check every row before anything is written. Only valid rows can be committed, and re-running a corrected file updates existing records instead of duplicating them."
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not import">
          {error}
        </Alert>
      ) : null}

      <section aria-labelledby="upload-heading" className="flex flex-col gap-4">
        <h2 id="upload-heading" className="text-ink text-lg font-semibold">
          Check a file
        </h2>
        <form
          action={previewImportAction}
          className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:p-6"
        >
          <input type="hidden" name="returnTo" value="/admin/imports" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="import-kind"
              name="kind"
              label="What are you importing?"
              defaultValue={defaultKind}
            >
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </Select>
            <Input
              id="import-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              label="CSV file"
              hint="Up to 2 MB and 2000 rows."
            />
          </div>
          <Textarea
            id="import-paste"
            name="csvText"
            label="Or paste CSV"
            hint="The header row is required. Use the templates below."
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Validate and preview</Button>
            <span className="text-ink-muted text-sm">
              Nothing is written until you review the report and commit.
            </span>
          </div>
        </form>

        <div className="rounded-card border-border bg-surface shadow-card border p-4">
          <h3 className="text-ink text-sm font-semibold">Required columns</h3>
          <ul className="text-ink-muted mt-2 flex flex-col gap-2 text-sm">
            {kinds.map((kind) => (
              <li key={kind} className="flex flex-col gap-1">
                <span className="text-ink font-medium">{KIND_LABELS[kind]}</span>
                <code className="text-xs break-words">{KIND_COLUMNS[kind]}</code>
                <Link
                  href={`/admin/imports/template?kind=${kind}`}
                  className="text-brand-800 w-fit text-xs font-medium hover:underline"
                >
                  Download {kind.toLowerCase()} template
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-ink-muted mt-3 text-xs">
            Institutional IDs are treated as text, so leading zeros and letters are preserved.
            Enrolments and instructor assignments need an existing course offering.
          </p>
        </div>
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <h2 id="history-heading" className="text-ink text-lg font-semibold">
          Import history
        </h2>
        {jobs.length === 0 ? (
          <EmptyState
            title="No imports yet"
            description="Validated files appear here with their per-row result, and can be downloaded again later."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Import history</caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    File
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Kind
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Rows
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
                    Uploaded
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-border border-t">
                    <td className="text-ink px-3 py-3 text-sm font-medium">{job.fileName}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">{KIND_LABELS[job.kind]}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {job.totalRows} total · {job.validRows} valid · {job.invalidRows} invalid
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge tone={STATUS_TONES[job.status]}>
                        {job.status.toLowerCase()}
                      </StatusBadge>
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {job.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                      {job.createdByName ? ` · ${job.createdByName}` : ""}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/admin/imports/${job.id}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Open report
                      </Link>
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
