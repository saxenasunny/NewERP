import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import type { LearnerAssignmentState } from "@/modules/assignments/rules";
import { listLearnerAssignments as loadAssignments } from "@/modules/assignments/submission-service";

export const metadata: Metadata = { title: "Assignments" };

const STATE_LABELS: Record<LearnerAssignmentState, { label: string; tone: BadgeTone }> = {
  not_open: { label: "not open yet", tone: "info" },
  open: { label: "to do", tone: "warning" },
  submitted: { label: "submitted", tone: "success" },
  late: { label: "submitted late", tone: "warning" },
  graded: { label: "graded", tone: "success" },
  closed: { label: "closed", tone: "neutral" },
};

function formatDate(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "No due date";
}

export default async function StudentAssignmentsPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  if (!account.permissions.has("courses.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assignments" />
        <PermissionDenied message="Your role cannot view assignments." />
      </div>
    );
  }

  const assignments = await loadAssignments(account);

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "My learning", href: "/student" }, { label: "Assignments" }]} />
      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="Assignments"
        description="Everything due in your enrolled courses. Marks appear only after your teacher releases them."
      />

      {assignments.length === 0 ? (
        <EmptyState
          title="Nothing assigned yet"
          description="When a teacher publishes an assignment in one of your enrolled courses, it appears here with its deadline."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {assignments.map((assignment) => {
            const state = STATE_LABELS[assignment.state];
            return (
              <li
                key={assignment.id}
                className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-ink text-lg font-semibold">
                      <Link
                        href={`/student/courses/${assignment.offeringId}/assignments/${assignment.id}`}
                        className="hover:underline"
                      >
                        {assignment.title}
                      </Link>
                    </h2>
                    <p className="text-ink-muted text-sm">
                      {assignment.courseCode} · {assignment.courseTitle}
                    </p>
                  </div>
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                </div>
                <p className="text-ink-muted text-sm">
                  Due {formatDate(assignment.dueAt)} · {assignment.pointsPossible} points
                  {assignment.percent !== null ? ` · scored ${assignment.percent}%` : ""}
                </p>
                <Link
                  href={`/student/courses/${assignment.offeringId}/assignments/${assignment.id}`}
                  className="text-brand-800 text-sm font-medium hover:underline"
                >
                  {assignment.state === "graded" ? "View feedback" : "Open assignment"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
