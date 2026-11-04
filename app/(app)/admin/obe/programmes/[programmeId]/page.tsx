import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getProgrammeOutcomes, type ProgrammeOutcomeView } from "@/modules/obe/outcome-service";

import {
  archiveProgrammeOutcomeAction,
  createProgrammeOutcomeAction,
  updateProgrammeOutcomeAction,
} from "../../actions";

export const metadata: Metadata = { title: "Programme outcomes" };

const TYPES = [
  ["PEO", "Programme educational objective"],
  ["PO", "Programme outcome"],
  ["PSO", "Programme specific outcome"],
] as const;

export default async function ProgrammeOutcomesPage({
  params,
  searchParams,
}: {
  params: Promise<{ programmeId: string }>;
  searchParams: Promise<{ edit?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ programmeId }, { edit, notice, error }] = await Promise.all([params, searchParams]);

  if (!account.permissions.has("obe.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Programme outcomes" />
        <PermissionDenied message="Your role cannot manage outcomes." />
      </div>
    );
  }

  let workspace;
  try {
    workspace = await getProgrammeOutcomes(account, programmeId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Programme outcomes" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "This programme could not be opened."}
        </Alert>
      </div>
    );
  }

  const editing: ProgrammeOutcomeView | undefined = edit
    ? workspace.outcomes.find((outcome) => outcome.id === edit)
    : undefined;
  const returnTo = `/admin/obe/programmes/${programmeId}`;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "OBE", href: "/admin/obe" },
          { label: workspace.programme.code },
        ]}
      />
      <PageHeader
        eyebrow={workspace.programme.departmentName}
        title={`${workspace.programme.code} · ${workspace.programme.name}`}
        description="PEOs describe graduate aims. POs and PSOs are what course outcomes map to. Faculty cannot change this list from a course."
      />

      {notice ? (
        <Alert tone="success" title="Saved">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not save">
          {error}
        </Alert>
      ) : null}

      <form
        action={editing ? updateProgrammeOutcomeAction : createProgrammeOutcomeAction}
        className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        <input type="hidden" name="programmeId" value={programmeId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Select
          id="outcome-type"
          name="type"
          label="Type"
          defaultValue={editing?.type ?? "PO"}
          required
        >
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {value} — {label}
            </option>
          ))}
        </Select>
        <Input id="outcome-code" name="code" label="Code" defaultValue={editing?.code} required />
        <Input
          id="outcome-title"
          name="title"
          label="Title"
          defaultValue={editing?.title}
          required
        />
        <div className="sm:col-span-2">
          <Textarea
            id="outcome-description"
            name="description"
            label="Description"
            defaultValue={editing?.description ?? ""}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button type="submit">{editing ? "Save outcome" : "Add outcome"}</Button>
          {editing ? (
            <Link href={returnTo} className="text-ink-muted text-sm font-medium hover:underline">
              Cancel edit
            </Link>
          ) : null}
        </div>
      </form>

      {workspace.outcomes.length === 0 ? (
        <EmptyState
          title="No outcomes yet"
          description="Add PEOs, POs, and PSOs before faculty can map course outcomes."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Programme outcomes</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Code
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Type
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Title
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {workspace.outcomes.map((outcome) => (
                <tr key={outcome.id} className="border-border border-t align-top">
                  <td className="text-ink px-3 py-3 text-sm font-medium">{outcome.code}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{outcome.type}</td>
                  <td className="px-3 py-3 text-sm">
                    <p className="text-ink">{outcome.title}</p>
                    {outcome.description ? (
                      <p className="text-ink-muted mt-1">{outcome.description}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={outcome.status === "ACTIVE" ? "success" : "warning"}>
                      {outcome.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Link
                        href={`${returnTo}?edit=${outcome.id}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Edit
                      </Link>
                      <form action={archiveProgrammeOutcomeAction} className="inline-flex">
                        <input type="hidden" name="id" value={outcome.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <Button variant="ghost" size="sm">
                          {outcome.status === "ARCHIVED" ? "Restore" : "Archive"}
                        </Button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
