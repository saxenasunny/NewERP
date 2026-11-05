import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import {
  getStructureOptions,
  listProgrammes,
  type ProgrammeSummary,
} from "@/modules/academics/structure-service";

import { createProgrammeAction, setProgrammeStatusAction, updateProgrammeAction } from "../actions";

export const metadata: Metadata = { title: "Programmes" };

const LEVELS = [
  ["CERTIFICATE", "Certificate"],
  ["DIPLOMA", "Diploma"],
  ["BACHELOR", "Bachelor"],
  ["MASTER", "Master"],
  ["DOCTORATE", "Doctorate"],
  ["OTHER", "Other"],
] as const;

export default async function ProgrammesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { edit, notice, error } = await searchParams;

  if (!account.permissions.has("academic_structure.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Programmes" />
        <PermissionDenied message="Your role cannot manage academic structure." />
      </div>
    );
  }

  const [programmes, options] = await Promise.all([
    listProgrammes(account),
    getStructureOptions(account),
  ]);

  const editing: ProgrammeSummary | undefined = edit
    ? programmes.find((programme) => programme.id === edit)
    : undefined;
  const returnTo = "/admin/academics/programmes";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "Academic setup", href: "/admin/academics" },
          { label: "Programmes" },
        ]}
      />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="Programmes"
        description="A programme belongs to one department and groups cohorts for an academic year."
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

      {options.departments.length === 0 ? (
        <Alert tone="warning" title="Create a department first">
          Programmes need a department.{" "}
          <Link href="/admin/academics/departments" className="font-medium underline">
            Add a department
          </Link>
          .
        </Alert>
      ) : (
        <form
          action={editing ? updateProgrammeAction : createProgrammeAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input
            id="programme-name"
            name="name"
            label={editing ? "Edit programme" : "Programme name"}
            placeholder="e.g. Bachelor of Technology in CS"
            defaultValue={editing?.name}
            required
          />
          <Input
            id="programme-code"
            name="code"
            label="Code"
            placeholder="e.g. BTECH-CS or B.Tech"
            defaultValue={editing?.code}
            hint="Letters, digits, hyphens, dots, underscores"
            required
          />
          <Select
            id="programme-department"
            name="departmentId"
            label="Department"
            defaultValue={editing?.departmentId ?? ""}
            required
          >
            <option value="">Choose a department</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
          <Select
            id="programme-level"
            name="level"
            label="Level"
            defaultValue={editing?.level ?? "BACHELOR"}
            required
          >
            {LEVELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Button type="submit">{editing ? "Save programme" : "Create programme"}</Button>
          {editing ? (
            <Link
              href={returnTo}
              className="text-ink-muted self-center text-sm font-medium hover:underline"
            >
              Cancel edit
            </Link>
          ) : null}
        </form>
      )}

      {programmes.length === 0 ? (
        <EmptyState
          title="No programmes yet"
          description="Create a programme once at least one department exists."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Programmes</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Programme
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Department
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Level
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Cohorts
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
              {programmes.map((programme) => (
                <tr key={programme.id} className="border-border border-t align-top">
                  <td className="px-3 py-3 text-sm">
                    <p className="text-ink font-medium">{programme.name}</p>
                    <p className="text-ink-muted">{programme.code}</p>
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{programme.departmentName}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {programme.level.toLowerCase()}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{programme.cohortCount}</td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={programme.status === "ACTIVE" ? "success" : "warning"}>
                      {programme.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Link
                        href={`${returnTo}?edit=${programme.id}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/academics/cohorts?programme=${programme.id}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Cohorts
                      </Link>
                      <form action={setProgrammeStatusAction} className="inline-flex">
                        <input type="hidden" name="id" value={programme.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={programme.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED"}
                        />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <Button variant="ghost" size="sm">
                          {programme.status === "ARCHIVED" ? "Restore" : "Archive"}
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
