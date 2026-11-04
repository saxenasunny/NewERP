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
  getOffering,
  listEnrolments,
  type OfferingDetail,
} from "@/modules/academics/course-service";

import {
  addInstructorAction,
  enrolStudentAction,
  removeInstructorAction,
  setEnrolmentStatusAction,
} from "../actions";

export const metadata: Metadata = { title: "Course offering" };

const STATUS_TONES: Record<OfferingDetail["status"], BadgeTone> = {
  DRAFT: "info",
  PUBLISHED: "success",
  CLOSED: "warning",
};

const ROLE_LABELS = {
  PRIMARY: "Primary instructor",
  CO_INSTRUCTOR: "Co-instructor",
  TEACHING_ASSISTANT: "Teaching assistant",
} as const;

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

export default async function OfferingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  if (!account.permissions.has("courses.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course offering" />
        <PermissionDenied message="Your role cannot view course offerings." />
      </div>
    );
  }

  const offering = await getOffering(account, offeringId).catch(() => null);
  if (!offering) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course offering" description="This offering is not available." />
        <Alert tone="warning" title="Not found">
          It may belong to another institution or have been removed.{" "}
          <Link href="/admin/offerings" className="font-medium underline">
            Back to offerings
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const enrolments = await listEnrolments(account, offering.id);
  const canManage = account.permissions.has("enrolments.manage");
  const canEdit = account.permissions.has("courses.update");
  const returnTo = `/admin/offerings/${offering.id}`;
  const activeCount = enrolments.filter((enrolment) => enrolment.status === "ACTIVE").length;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "Course offerings", href: "/admin/offerings" },
          { label: `${offering.courseCode} · ${offering.termName}` },
        ]}
      />
      <PageHeader
        eyebrow={`${offering.academicYearName} · ${offering.termName}`}
        title={`${offering.courseCode} · ${offering.courseTitle}`}
        description={`${offering.sectionName ? `Section ${offering.sectionName}` : "No section"} · ${formatDate(offering.startsOn)} → ${formatDate(offering.endsOn)}${offering.capacity !== null ? ` · capacity ${offering.capacity}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={STATUS_TONES[offering.status]}>
              {offering.status.toLowerCase()}
            </StatusBadge>
            {canEdit ? (
              <Link
                href={`/admin/offerings?edit=${offering.id}`}
                className="text-brand-800 text-sm font-medium hover:underline"
              >
                Edit offering
              </Link>
            ) : null}
          </div>
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

      <section aria-labelledby="instructors-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="instructors-heading" className="text-ink text-lg font-semibold">
            Instructors
          </h2>
          <p className="text-ink-muted text-sm">
            Only active members of this institution can be assigned. Assigning an existing person
            updates their role instead of creating a duplicate.
          </p>
        </div>

        {canManage ? (
          <form
            action={addInstructorAction}
            className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="courseOfferingId" value={offering.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="flex-1">
              <Input
                id="instructor-email"
                name="email"
                type="email"
                label="Instructor email"
                placeholder="faculty@institution.edu"
                required
              />
            </div>
            <div className="sm:w-56">
              <Select
                id="instructor-role"
                name="assignmentRole"
                label="Role"
                defaultValue="PRIMARY"
              >
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">Assign instructor</Button>
          </form>
        ) : null}

        {offering.instructors.length === 0 ? (
          <EmptyState
            title="No instructors assigned"
            description="Learners can be enrolled, but teaching staff should be assigned before publishing."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Instructors</caption>
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
                    Email
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Role
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {offering.instructors.map((instructor) => (
                  <tr key={instructor.id} className="border-border border-t">
                    <td className="text-ink px-3 py-3 text-sm font-medium">{instructor.name}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">{instructor.email}</td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {ROLE_LABELS[instructor.assignmentRole]}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {canManage ? (
                        <form action={removeInstructorAction} className="inline-flex">
                          <input type="hidden" name="id" value={instructor.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <Button variant="ghost" size="sm">
                            Remove
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="roster-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="roster-heading" className="text-ink text-lg font-semibold">
            Roster ({activeCount} active)
          </h2>
          <p className="text-ink-muted text-sm">
            Learners are enrolled in this offering. Withdrawing keeps the record for audit; it does
            not delete the person. Bulk imports are available under{" "}
            <Link href="/admin/imports" className="text-brand-800 font-medium hover:underline">
              CSV imports
            </Link>
            .
          </p>
        </div>

        {canManage ? (
          <form
            action={enrolStudentAction}
            className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="courseOfferingId" value={offering.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="flex-1">
              <Input
                id="enrol-email"
                name="email"
                type="email"
                label="Learner email"
                placeholder="student@institution.edu"
                hint="Must be an active member of this institution."
                required
              />
            </div>
            <Button type="submit">Enrol learner</Button>
          </form>
        ) : null}

        {enrolments.length === 0 ? (
          <EmptyState
            title="The roster is empty"
            description="Enrol learners one by one, or import a CSV of enrolments."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Roster</caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Learner
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
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Enrolled
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {enrolments.map((enrolment) => (
                  <tr key={enrolment.id} className="border-border border-t">
                    <td className="px-3 py-3 text-sm">
                      <p className="text-ink font-medium">{enrolment.name}</p>
                      <p className="text-ink-muted">{enrolment.email}</p>
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {enrolment.institutionalId ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        tone={
                          enrolment.status === "ACTIVE"
                            ? "success"
                            : enrolment.status === "COMPLETED"
                              ? "info"
                              : "warning"
                        }
                      >
                        {enrolment.status.toLowerCase()}
                      </StatusBadge>
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {enrolment.enrolledAt.toISOString().slice(0, 10)}
                      <span className="text-ink-muted/80"> · {enrolment.source.toLowerCase()}</span>
                    </td>
                    <td className="px-3 py-3">
                      {canManage ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {(["ACTIVE", "WITHDRAWN", "COMPLETED"] as const)
                            .filter((status) => status !== enrolment.status)
                            .map((status) => (
                              <form
                                key={status}
                                action={setEnrolmentStatusAction}
                                className="inline-flex"
                              >
                                <input type="hidden" name="id" value={enrolment.id} />
                                <input type="hidden" name="status" value={status} />
                                <input type="hidden" name="returnTo" value={returnTo} />
                                <Button variant="ghost" size="sm">
                                  {status === "WITHDRAWN"
                                    ? "Withdraw"
                                    : status === "COMPLETED"
                                      ? "Complete"
                                      : "Reactivate"}
                                </Button>
                              </form>
                            ))}
                        </div>
                      ) : null}
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
