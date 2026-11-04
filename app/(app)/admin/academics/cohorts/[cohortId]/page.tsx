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
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import {
  listCohortMembers,
  listCohorts,
  listSections,
  type SectionSummary,
} from "@/modules/academics/structure-service";

import {
  addCohortMemberAction,
  createSectionAction,
  removeCohortMemberAction,
  updateSectionAction,
} from "../../actions";

export const metadata: Metadata = { title: "Cohort" };

export default async function CohortDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<{ section?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ cohortId }, { section, notice, error }] = await Promise.all([params, searchParams]);

  if (!account.permissions.has("academic_structure.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Cohort" />
        <PermissionDenied message="Your role cannot manage academic structure." />
      </div>
    );
  }

  const cohorts = await listCohorts(account);
  const cohort = cohorts.find((candidate) => candidate.id === cohortId);
  if (!cohort) notFound();

  const [sections, members] = await Promise.all([
    listSections(account, { cohortId: cohort.id }),
    listCohortMembers(account, cohort.id),
  ]);

  const editingSection: SectionSummary | undefined = section
    ? sections.find((candidate) => candidate.id === section)
    : undefined;
  const returnTo = `/admin/academics/cohorts/${cohort.id}`;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "Academic setup", href: "/admin/academics" },
          { label: "Cohorts", href: "/admin/academics/cohorts" },
          { label: cohort.name },
        ]}
      />
      <PageHeader
        eyebrow={`${cohort.programmeName} · ${cohort.academicYearName}`}
        title={cohort.name}
        description="Sections are class groups inside this cohort. Members are the learners assigned to it."
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

      <section aria-labelledby="sections-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="sections-heading" className="text-ink text-lg font-semibold">
            Sections
          </h2>
          <p className="text-ink-muted text-sm">
            Capacity limits active enrolments when a course offering uses the section.
          </p>
        </div>

        <form
          action={editingSection ? updateSectionAction : createSectionAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          {editingSection ? <input type="hidden" name="id" value={editingSection.id} /> : null}
          <input type="hidden" name="cohortId" value={cohort.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input
            id="section-name"
            name="name"
            label={editingSection ? "Edit section" : "Section name"}
            placeholder="A"
            defaultValue={editingSection?.name}
            required
          />
          <Input
            id="section-capacity"
            name="capacity"
            type="number"
            min={1}
            max={1000}
            label="Capacity"
            hint="Optional."
            defaultValue={editingSection?.capacity ?? undefined}
          />
          <Button type="submit">{editingSection ? "Save section" : "Add section"}</Button>
          {editingSection ? (
            <Link
              href={returnTo}
              className="text-ink-muted self-center text-sm font-medium hover:underline"
            >
              Cancel edit
            </Link>
          ) : null}
        </form>

        {sections.length === 0 ? (
          <EmptyState
            title="No sections yet"
            description="Sections are optional: an offering can target the whole cohort."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Sections in {cohort.name}</caption>
              <thead className="bg-surface-muted">
                <tr>
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
                    Capacity
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Offerings
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sections.map((item) => (
                  <tr key={item.id} className="border-border border-t">
                    <td className="text-ink px-3 py-3 text-sm font-medium">{item.name}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">{item.capacity ?? "—"}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">{item.offeringCount}</td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`${returnTo}?section=${item.id}`}
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

      <section aria-labelledby="members-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="members-heading" className="text-ink text-lg font-semibold">
            Cohort members
          </h2>
          <p className="text-ink-muted text-sm">
            Membership records the learner&apos;s intake. Enrolment into a course offering is
            separate and happens on the offering.
          </p>
        </div>

        <form
          action={addCohortMemberAction}
          className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="cohortId" value={cohort.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="flex-1">
            <Input
              id="cohort-member-email"
              name="email"
              type="email"
              label="Add an active member"
              placeholder="student@institution.edu"
              hint="They must already be active in this institution."
              required
            />
          </div>
          <Button type="submit">Add to cohort</Button>
        </form>

        {members.length === 0 ? (
          <EmptyState
            title="No members yet"
            description="Add learners by email, or import them and place them in a cohort."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Members of {cohort.name}</caption>
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
                    Institutional ID
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Email
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-border border-t">
                    <td className="text-ink px-3 py-3 text-sm font-medium">{member.name}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {member.institutionalId ?? "—"}
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">{member.email}</td>
                    <td className="px-3 py-3 text-right">
                      <form action={removeCohortMemberAction} className="inline-flex">
                        <input type="hidden" name="id" value={member.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <Button variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/admin/academics/cohorts"
          className="text-brand-800 text-sm font-medium hover:underline"
        >
          Back to cohorts
        </Link>
        <Link
          href="/admin/offerings"
          className="text-brand-800 text-sm font-medium hover:underline"
        >
          View course offerings
        </Link>
        <StatusBadge tone="info">{members.length} member(s)</StatusBadge>
      </div>
    </div>
  );
}
