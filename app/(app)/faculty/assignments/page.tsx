import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import {
  listManagedAssignments,
  type AssignmentStatus,
} from "@/modules/assignments/assignment-service";

export const metadata: Metadata = { title: "Assignments" };

const STATUS_TONES: Record<AssignmentStatus, BadgeTone> = {
  DRAFT: "info",
  PUBLISHED: "success",
  ARCHIVED: "warning",
};

function formatDate(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "No due date";
}

export default async function FacultyAssignmentsPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  if (!account.permissions.has("assessments.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assignments" />
        <PermissionDenied message="Your role cannot create or grade assignments." />
      </div>
    );
  }

  const assignments = await listManagedAssignments(account);

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Faculty", href: "/faculty" }, { label: "Assignments" }]} />
      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="Assignments"
        description="Every assignment in the courses you teach, with its draft queue. Grades stay hidden from learners until you release them."
      />

      {assignments.length === 0 ? (
        <EmptyState
          title="No assignments yet"
          description="Open one of your courses, choose Assignments, and create the first task. Nothing is visible to learners until you publish it."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Assignments in your courses</caption>
            <thead className="bg-surface-muted">
              <tr>
                {[
                  "Assignment",
                  "Course",
                  "Due",
                  "Points",
                  "Submitted",
                  "Released",
                  "Status",
                  "",
                ].map((heading) => (
                  <th
                    key={heading || "open"}
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    {heading || <span className="sr-only">Open</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id} className="border-border border-t">
                  <td className="px-3 py-3 text-sm">
                    <Link
                      href={`/faculty/courses/${assignment.offeringId}/assignments/${assignment.id}`}
                      className="text-brand-800 font-medium hover:underline"
                    >
                      {assignment.title}
                    </Link>
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {assignment.courseCode} · {assignment.termName}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {formatDate(assignment.dueAt)}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{assignment.pointsPossible}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{assignment.submissionCount}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{assignment.releasedCount}</td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={STATUS_TONES[assignment.status]}>
                      {assignment.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/faculty/courses/${assignment.offeringId}/assignments/${assignment.id}`}
                      className="text-brand-800 text-sm font-medium hover:underline"
                    >
                      Open
                    </Link>
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
