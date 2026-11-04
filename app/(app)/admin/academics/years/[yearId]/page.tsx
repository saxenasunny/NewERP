import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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

import {
  createTermAction,
  setYearStatusAction,
  updateTermAction,
  updateYearAction,
} from "../../actions";

export const metadata: Metadata = { title: "Academic year" };

const STATUS_TONES: Record<AcademicYearSummary["status"], BadgeTone> = {
  PLANNED: "info",
  ACTIVE: "success",
  ARCHIVED: "warning",
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function AcademicYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ yearId: string }>;
  searchParams: Promise<{ edit?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ yearId }, { edit, notice, error }] = await Promise.all([params, searchParams]);

  if (!account.permissions.has("academic_structure.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Academic year" />
        <PermissionDenied message="Your role cannot manage academic structure." />
      </div>
    );
  }

  const years = await listAcademicYears(account);
  const year = years.find((candidate) => candidate.id === yearId);
  if (!year) notFound();

  const termToEdit = edit ? year.terms.find((term) => term.id === edit) : undefined;
  const returnTo = `/admin/academics/years/${year.id}`;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "Academic setup", href: "/admin/academics" },
          { label: year.name },
        ]}
      />
      <PageHeader
        eyebrow={year.status.toLowerCase()}
        title={year.name}
        description="Edit the year's dates, set its status, and manage the terms inside it."
        actions={
          <StatusBadge tone={STATUS_TONES[year.status]}>{year.status.toLowerCase()}</StatusBadge>
        }
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

      <section aria-labelledby="year-details" className="flex flex-col gap-4">
        <h2 id="year-details" className="text-ink text-lg font-semibold">
          Dates and status
        </h2>
        <form
          action={updateYearAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <input type="hidden" name="id" value={year.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input id="year-name" name="name" label="Name" defaultValue={year.name} required />
          <Input
            id="year-start"
            name="startsOn"
            type="date"
            label="Starts on"
            defaultValue={formatDate(year.startsOn)}
            required
          />
          <Input
            id="year-end"
            name="endsOn"
            type="date"
            label="Ends on"
            defaultValue={formatDate(year.endsOn)}
            required
          />
          <Button type="submit">Save changes</Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {(["PLANNED", "ACTIVE", "ARCHIVED"] as const).map((status) => (
            <form key={status} action={setYearStatusAction} className="inline-flex">
              <input type="hidden" name="id" value={year.id} />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button
                variant={year.status === status ? "secondary" : "ghost"}
                size="sm"
                disabled={year.status === status}
              >
                Mark {status.toLowerCase()}
              </Button>
            </form>
          ))}
        </div>
      </section>

      <section aria-labelledby="terms-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="terms-heading" className="text-ink text-lg font-semibold">
            Terms
          </h2>
          <p className="text-ink-muted text-sm">
            Terms must fall inside {formatDate(year.startsOn)} → {formatDate(year.endsOn)}. Course
            offerings are scheduled into terms.
          </p>
        </div>

        <form
          action={termToEdit ? updateTermAction : createTermAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          {termToEdit ? <input type="hidden" name="id" value={termToEdit.id} /> : null}
          <input type="hidden" name="academicYearId" value={year.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input
            id="term-name"
            name="name"
            label={termToEdit ? "Edit term name" : "Term name"}
            placeholder="Semester 1"
            defaultValue={termToEdit?.name}
            required
          />
          <Input
            id="term-start"
            name="startsOn"
            type="date"
            label="Starts on"
            defaultValue={termToEdit ? formatDate(termToEdit.startsOn) : undefined}
            required
          />
          <Input
            id="term-end"
            name="endsOn"
            type="date"
            label="Ends on"
            defaultValue={termToEdit ? formatDate(termToEdit.endsOn) : undefined}
            required
          />
          <Button type="submit">{termToEdit ? "Save term" : "Add term"}</Button>
          {termToEdit ? (
            <Link
              href={returnTo}
              className="text-ink-muted self-center text-sm font-medium hover:underline"
            >
              Cancel edit
            </Link>
          ) : null}
        </form>

        {year.terms.length === 0 ? (
          <EmptyState
            title="No terms yet"
            description="Add at least one term before creating course offerings."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Terms in {year.name}</caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Term
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Dates
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {year.terms.map((term) => (
                  <tr key={term.id} className="border-border border-t">
                    <td className="text-ink px-3 py-3 text-sm font-medium">{term.name}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {formatDate(term.startsOn)} → {formatDate(term.endsOn)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`${returnTo}?edit=${term.id}`}
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
      </section>
    </div>
  );
}
