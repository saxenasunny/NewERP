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
  listCohorts,
  type CohortSummary,
} from "@/modules/academics/structure-service";

import { createCohortAction, updateCohortAction } from "../actions";

export const metadata: Metadata = { title: "Cohorts" };

export default async function CohortsPage({
  searchParams,
}: {
  searchParams: Promise<{ programme?: string; edit?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { programme, edit, notice, error } = await searchParams;

  if (!account.permissions.has("academic_structure.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Cohorts" />
        <PermissionDenied message="Your role cannot manage academic structure." />
      </div>
    );
  }

  const [cohorts, options] = await Promise.all([
    listCohorts(account, programme ? { programmeId: programme } : {}),
    getStructureOptions(account),
  ]);

  const editing: CohortSummary | undefined = edit
    ? cohorts.find((cohort) => cohort.id === edit)
    : undefined;
  const returnTo = programme
    ? `/admin/academics/cohorts?programme=${encodeURIComponent(programme)}`
    : "/admin/academics/cohorts";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "Academic setup", href: "/admin/academics" },
          { label: "Cohorts" },
        ]}
      />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="Cohorts and sections"
        description="A cohort is an intake of a programme in an academic year. Sections are class groups inside it."
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

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Select
          id="cohort-programme-filter"
          name="programme"
          label="Filter by programme"
          defaultValue={programme ?? ""}
          className="min-w-56"
        >
          <option value="">All programmes</option>
          {options.programmes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.code} · {option.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Apply filter
        </Button>
        {programme ? (
          <Link
            href="/admin/academics/cohorts"
            className="text-ink-muted pb-2 text-sm font-medium hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {options.programmes.length === 0 || options.years.length === 0 ? (
        <Alert tone="warning" title="Programme and academic year needed">
          Create a{" "}
          <Link href="/admin/academics/programmes" className="font-medium underline">
            programme
          </Link>{" "}
          and an{" "}
          <Link href="/admin/academics" className="font-medium underline">
            academic year
          </Link>{" "}
          before adding cohorts.
        </Alert>
      ) : (
        <form
          action={editing ? updateCohortAction : createCohortAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input
            id="cohort-name"
            name="name"
            label={editing ? "Edit cohort" : "Cohort name"}
            placeholder="2026 intake"
            defaultValue={editing?.name}
            required
          />
          <Select
            id="cohort-programme"
            name="programmeId"
            label="Programme"
            defaultValue={editing?.programmeId ?? programme ?? ""}
            required
          >
            <option value="">Choose a programme</option>
            {options.programmes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.code} · {option.name}
              </option>
            ))}
          </Select>
          <Select
            id="cohort-year"
            name="academicYearId"
            label="Academic year"
            defaultValue={editing?.academicYearId ?? ""}
            required
          >
            <option value="">Choose a year</option>
            {options.years.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
          <Button type="submit">{editing ? "Save cohort" : "Create cohort"}</Button>
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

      {cohorts.length === 0 ? (
        <EmptyState
          title="No cohorts yet"
          description="Create a cohort to group the intake, then add sections and members."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Cohorts</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Cohort
                </th>
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
                  Year
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Sections
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Members
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => (
                <tr key={cohort.id} className="border-border border-t">
                  <td className="text-ink px-3 py-3 text-sm font-medium">{cohort.name}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{cohort.programmeName}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{cohort.academicYearName}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{cohort.sectionCount}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{cohort.memberCount}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Link
                        href={`${returnTo}?edit=${cohort.id}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/academics/cohorts/${cohort.id}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Sections and members
                      </Link>
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
