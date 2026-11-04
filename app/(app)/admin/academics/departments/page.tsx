import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import {
  getStructureOptions,
  listDepartments,
  type DepartmentSummary,
} from "@/modules/academics/structure-service";

import { createDepartmentAction, updateDepartmentAction } from "../actions";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { edit, notice, error } = await searchParams;

  if (!account.permissions.has("academic_structure.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Departments" />
        <PermissionDenied message="Your role cannot manage academic structure." />
      </div>
    );
  }

  const [departments, options] = await Promise.all([
    listDepartments(account),
    getStructureOptions(account),
  ]);

  const editing: DepartmentSummary | undefined = edit
    ? departments.find((department) => department.id === edit)
    : undefined;
  const returnTo = "/admin/academics/departments";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "Academic setup", href: "/admin/academics" },
          { label: "Departments" },
        ]}
      />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="Departments"
        description="Departments own programmes. A department may sit under another department; cycles are refused."
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
        action={editing ? updateDepartmentAction : createDepartmentAction}
        className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        <Input
          id="department-name"
          name="name"
          label={editing ? "Edit department" : "Department name"}
          defaultValue={editing?.name}
          required
        />
        <Input
          id="department-code"
          name="code"
          label="Code"
          hint="Letters, digits, hyphens."
          defaultValue={editing?.code}
          required
        />
        <Select
          id="department-parent"
          name="parentDepartmentId"
          label="Parent department"
          defaultValue={editing?.parentDepartmentId ?? ""}
        >
          <option value="">No parent</option>
          {departments
            .filter((department) => department.id !== editing?.id)
            .map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
        </Select>
        <Button type="submit">{editing ? "Save department" : "Create department"}</Button>
        {editing ? (
          <Link
            href={returnTo}
            className="text-ink-muted self-center text-sm font-medium hover:underline"
          >
            Cancel edit
          </Link>
        ) : null}
      </form>

      {departments.length === 0 ? (
        <EmptyState
          title="No departments yet"
          description="Create a department before adding programmes to it."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Departments</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Name
                </th>
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
                  Parent
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Programmes
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => (
                <tr key={department.id} className="border-border border-t">
                  <td className="text-ink px-3 py-3 text-sm font-medium">{department.name}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{department.code}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {department.parentName ?? "—"}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{department.programmeCount}</td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`${returnTo}?edit=${department.id}`}
                      className="text-brand-800 text-sm font-medium hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-ink-muted text-sm">
        Next: add{" "}
        <Link
          href="/admin/academics/programmes"
          className="text-brand-800 font-medium hover:underline"
        >
          programmes
        </Link>{" "}
        inside these departments. Options: {options.departments.length} department(s).
      </p>
    </div>
  );
}
