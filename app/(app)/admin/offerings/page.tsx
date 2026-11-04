import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import {
  getOfferingOptions,
  listOfferings,
  type OfferingSummary,
} from "@/modules/academics/course-service";

import { createOfferingAction, updateOfferingAction } from "./actions";

export const metadata: Metadata = { title: "Course offerings" };

const STATUS_TONES: Record<OfferingSummary["status"], BadgeTone> = {
  DRAFT: "info",
  PUBLISHED: "success",
  CLOSED: "warning",
};

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function OfferingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    course?: string;
    term?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const account = await requireAccountContext();
  const { edit, course, term, notice, error } = await searchParams;

  if (!account.permissions.has("courses.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course offerings" />
        <PermissionDenied message="Your role cannot view course offerings." />
      </div>
    );
  }

  const [offerings, options] = await Promise.all([
    listOfferings(account),
    getOfferingOptions(account),
  ]);

  const filtered = offerings.filter(
    (offering) => (!course || offering.courseId === course) && (!term || offering.termId === term),
  );
  const editing: OfferingSummary | undefined = edit
    ? offerings.find((offering) => offering.id === edit)
    : undefined;
  const canCreate = account.permissions.has("courses.create");
  const canUpdate = account.permissions.has("courses.update");

  const query = new URLSearchParams();
  if (course) query.set("course", course);
  if (term) query.set("term", term);
  const returnTo = `/admin/offerings${query.size ? `?${query.toString()}` : ""}`;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Overview", href: "/admin" }, { label: "Course offerings" }]} />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="Course offerings"
        description="An offering schedules a catalogue course into a term, optionally for one section. Instructors and learner enrolments belong here, not in the catalogue."
        actions={
          <Link
            href="/admin/courses"
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Course catalogue
          </Link>
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

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Select
          id="offering-course-filter"
          name="course"
          label="Course"
          defaultValue={course ?? ""}
          className="min-w-56"
        >
          <option value="">All courses</option>
          {options.courses.map((option) => (
            <option key={option.id} value={option.id}>
              {option.code} · {option.title}
            </option>
          ))}
        </Select>
        <Select
          id="offering-term-filter"
          name="term"
          label="Term"
          defaultValue={term ?? ""}
          className="min-w-48"
        >
          <option value="">All terms</option>
          {options.terms.map((option) => (
            <option key={option.id} value={option.id}>
              {option.academicYearName} · {option.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        {course || term ? (
          <Link
            href="/admin/offerings"
            className="text-ink-muted pb-2 text-sm font-medium hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {options.courses.length === 0 || options.terms.length === 0 ? (
        <Alert tone="warning" title="Set up before scheduling">
          Create a{" "}
          <Link href="/admin/courses" className="font-medium underline">
            catalogue course
          </Link>{" "}
          and at least one{" "}
          <Link href="/admin/academics" className="font-medium underline">
            term
          </Link>{" "}
          first.
        </Alert>
      ) : null}

      {(canCreate || editing) && options.courses.length > 0 && options.terms.length > 0 ? (
        <form
          action={editing ? updateOfferingAction : createOfferingAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="returnTo" value={returnTo} />
          <Select
            id="offering-course"
            name="courseId"
            label={editing ? "Edit offering course" : "Course"}
            defaultValue={editing?.courseId ?? course ?? ""}
            required
          >
            <option value="">Choose a course</option>
            {options.courses.map((option) => (
              <option key={option.id} value={option.id}>
                {option.code} · {option.title}
              </option>
            ))}
          </Select>
          <Select
            id="offering-term"
            name="termId"
            label="Term"
            defaultValue={editing?.termId ?? term ?? ""}
            required
          >
            <option value="">Choose a term</option>
            {options.terms.map((option) => (
              <option key={option.id} value={option.id}>
                {option.academicYearName} · {option.name}
              </option>
            ))}
          </Select>
          <Select
            id="offering-section"
            name="sectionId"
            label="Section"
            defaultValue={editing?.sectionId ?? ""}
          >
            <option value="">Whole cohort / none</option>
            {options.sections.map((option) => (
              <option key={option.id} value={option.id}>
                {option.programmeName} · {option.cohortName} · {option.name}
              </option>
            ))}
          </Select>
          <Select
            id="offering-status"
            name="status"
            label="Status"
            defaultValue={editing?.status ?? "DRAFT"}
          >
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="CLOSED">Closed</option>
          </Select>
          <Input
            id="offering-start"
            name="startsOn"
            type="date"
            label="Starts on"
            hint="Optional; must be inside the term."
            defaultValue={formatDate(editing?.startsOn ?? null) || undefined}
          />
          <Input
            id="offering-end"
            name="endsOn"
            type="date"
            label="Ends on"
            hint="Optional; must be inside the term."
            defaultValue={formatDate(editing?.endsOn ?? null) || undefined}
          />
          <Button type="submit">{editing ? "Save offering" : "Create offering"}</Button>
          {editing ? (
            <Link
              href={returnTo}
              className="text-ink-muted self-center text-sm font-medium hover:underline"
            >
              Cancel edit
            </Link>
          ) : null}
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title={course || term ? "No offerings match these filters" : "No course offerings yet"}
          description="Scheduling a catalogue course into a term creates an offering that can hold instructors and learners."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Course offerings</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Offering
                </th>
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
                  Section
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Instructors
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Enrolled
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
              {filtered.map((offering) => (
                <tr key={offering.id} className="border-border border-t align-top">
                  <td className="px-3 py-3 text-sm">
                    <p className="text-ink font-medium">
                      {offering.courseCode} · {offering.courseTitle}
                    </p>
                    {offering.startsOn ? (
                      <p className="text-ink-muted mt-1 text-xs">
                        {formatDate(offering.startsOn)} → {formatDate(offering.endsOn)}
                      </p>
                    ) : null}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {offering.academicYearName} · {offering.termName}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {offering.sectionName ?? "—"}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {offering.instructorNames.length === 0
                      ? "Unassigned"
                      : offering.instructorNames.join(", ")}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{offering.enrolmentCount}</td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={STATUS_TONES[offering.status]}>
                      {offering.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {canUpdate ? (
                        <Link
                          href={`${returnTo}${returnTo.includes("?") ? "&" : "?"}edit=${offering.id}`}
                          className="text-brand-800 text-sm font-medium hover:underline"
                        >
                          Edit
                        </Link>
                      ) : null}
                      <Link
                        href={`/admin/offerings/${offering.id}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Instructors and roster
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
