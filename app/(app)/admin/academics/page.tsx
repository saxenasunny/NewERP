import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { listAcademicYears, type AcademicYearSummary } from "@/modules/academics/structure-service";

import { createYearAction, setYearStatusAction } from "./actions";

export const metadata: Metadata = { title: "Academic setup" };

const STATUS_TONES: Record<AcademicYearSummary["status"], BadgeTone> = {
  PLANNED: "info",
  ACTIVE: "success",
  ARCHIVED: "warning",
};

const LINKS = [
  {
    href: "/admin/academics/departments",
    title: "Departments",
    description: "Faculties and departments, with optional parent departments.",
  },
  {
    href: "/admin/academics/programmes",
    title: "Programmes",
    description: "Degrees and diplomas that cohorts belong to.",
  },
  {
    href: "/admin/academics/cohorts",
    title: "Cohorts and sections",
    description: "Intakes, class groups, capacity, and cohort membership.",
  },
  {
    href: "/admin/courses",
    title: "Course catalogue",
    description: "Course codes, credits, and catalogue status.",
  },
  {
    href: "/admin/offerings",
    title: "Course offerings",
    description: "Schedule a catalogue course into a term and section.",
  },
  {
    href: "/admin/imports",
    title: "CSV imports",
    description: "Preview and commit people, enrolments, and instructor lists.",
  },
] as const;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function AcademicSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { notice, error } = await searchParams;

  if (!account.permissions.has("academic_structure.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={account.tenant?.institutionName ?? "Institution"}
          title="Academic setup"
          description="Configure the institution's academic structure."
        />
        <PermissionDenied message="Your role cannot manage academic structure. Ask an institution administrator for access." />
      </div>
    );
  }

  const years = await listAcademicYears(account);

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Overview", href: "/admin" }, { label: "Academic setup" }]} />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="Academic setup"
        description="Build the structure first: years and terms, then departments, programmes, cohorts, and sections. Courses and offerings come after."
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

      <nav
        aria-label="Academic setup sections"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-card border-border bg-surface shadow-card focus-visible:outline-brand-700 hover:border-brand-700 flex flex-col gap-1 border p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="text-ink font-semibold">{link.title}</span>
            <span className="text-ink-muted text-sm">{link.description}</span>
          </Link>
        ))}
      </nav>

      <section aria-labelledby="years-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="years-heading" className="text-ink text-lg font-semibold">
            Academic years
          </h2>
          <p className="text-ink-muted text-sm">
            Terms must fall inside their academic year. Archive a year instead of deleting it, so
            historical offerings keep their context.
          </p>
        </div>

        <form
          action={createYearAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <input type="hidden" name="returnTo" value="/admin/academics" />
          <Input id="year-name" name="name" label="Name" placeholder="2026/27" required />
          <Input id="year-start" name="startsOn" type="date" label="Starts on" required />
          <Input id="year-end" name="endsOn" type="date" label="Ends on" required />
          <Button type="submit">Create academic year</Button>
        </form>

        {years.length === 0 ? (
          <EmptyState
            title="No academic years yet"
            description="Create the first year above, then add its terms."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Academic years</caption>
              <thead className="bg-surface-muted">
                <tr>
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
                    Dates
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Terms
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
                {years.map((year) => (
                  <tr key={year.id} className="border-border border-t align-top">
                    <td className="text-ink px-3 py-3 text-sm font-medium">{year.name}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {formatDate(year.startsOn)} → {formatDate(year.endsOn)}
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {year.terms.length === 0
                        ? "None yet"
                        : year.terms.map((term) => term.name).join(", ")}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge tone={STATUS_TONES[year.status]}>
                        {year.status.toLowerCase()}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={`/admin/academics/years/${year.id}`}
                          className="text-brand-800 text-sm font-medium hover:underline"
                        >
                          Edit and terms
                        </Link>
                        <form action={setYearStatusAction} className="inline-flex">
                          <input type="hidden" name="id" value={year.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={year.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED"}
                          />
                          <input
                            type="hidden"
                            name="returnTo"
                            value={`/admin/academics?edit=${year.id}`}
                          />
                          <Button variant="ghost" size="sm">
                            {year.status === "ARCHIVED" ? "Restore" : "Archive"}
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
      </section>
    </div>
  );
}
