import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  listAssignments,
  type AssignmentStatus,
  type AssignmentSummary,
} from "@/modules/assignments/assignment-service";

import { createAssignmentAction } from "./actions";

export const metadata: Metadata = { title: "Course assignments" };

const STATUS_TONES: Record<AssignmentStatus, BadgeTone> = {
  DRAFT: "info",
  PUBLISHED: "success",
  ARCHIVED: "warning",
};

const TYPE_LABELS: Record<AssignmentSummary["submissionType"], string> = {
  TEXT: "Text answer",
  FILE: "File upload",
  LINK: "Web link",
  TEXT_AND_FILE: "Text and file",
};

function formatDate(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "No due date";
}

export default async function CourseAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  const returnTo = `/faculty/courses/${offeringId}/assignments`;

  let workspace;
  try {
    workspace = await listAssignments(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assignments" description="This course is not available to you." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "The course could not be opened. Try again."}{" "}
          <Link href="/faculty/assignments" className="font-medium underline">
            Back to assignments
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const { access, assignments } = workspace;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Faculty", href: "/faculty" },
          { label: "My courses", href: "/faculty/courses" },
          { label: access.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Assignments" },
        ]}
      />
      <PageHeader
        eyebrow={`${access.academicYearName} · ${access.termName}`}
        title={`${access.courseCode} · Assignments`}
        description="Create assignments, publish them, and grade submissions. A grade is visible to a learner only after you release it."
        actions={
          <Link
            href={`/faculty/courses/${offeringId}`}
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Back to course content
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

      {assignments.length === 0 ? (
        <EmptyState
          title="No assignments yet"
          description="Add the first assignment below. It starts as a draft, so learners see nothing until you publish it."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="rounded-card border-border bg-surface shadow-card flex flex-col gap-2 border p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="text-ink text-base font-semibold">
                    <Link href={`${returnTo}/${assignment.id}`} className="hover:underline">
                      {assignment.title}
                    </Link>
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={STATUS_TONES[assignment.status]}>
                      {assignment.status.toLowerCase()}
                    </StatusBadge>
                    <StatusBadge tone="neutral">
                      {TYPE_LABELS[assignment.submissionType]}
                    </StatusBadge>
                    <span className="text-ink-muted text-xs">
                      {assignment.pointsPossible} points · due {formatDate(assignment.dueAt)}
                    </span>
                  </div>
                </div>
                <div className="text-ink-muted flex flex-wrap gap-4 text-sm">
                  <span>{assignment.submissionCount} submission(s)</span>
                  <span>{assignment.releasedCount} released</span>
                  <Link
                    href={`${returnTo}/${assignment.id}`}
                    className="text-brand-800 font-medium hover:underline"
                  >
                    Open grading
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="create-assignment" className="flex flex-col gap-3">
        <h2 id="create-assignment" className="text-ink text-lg font-semibold">
          New assignment
        </h2>
        <details className="rounded-card border-border bg-surface shadow-card border">
          <summary className="text-ink cursor-pointer px-4 py-3 text-sm font-medium">
            Add an assignment
          </summary>
          <form
            action={createAssignmentAction}
            className="border-border flex flex-col gap-3 border-t p-4"
          >
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="returnTo" value={returnTo} />

            <Input id="assignment-title" name="title" label="Title" required maxLength={200} />
            <Textarea
              id="assignment-instructions"
              name="instructions"
              label="Instructions"
              hint="What learners must do, and how the work is judged."
              rows={6}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                id="assignment-type"
                name="submissionType"
                label="Submission type"
                defaultValue="TEXT"
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input
                id="assignment-points"
                name="pointsPossible"
                type="number"
                step="0.5"
                min="0.5"
                max="1000"
                label="Points possible"
                defaultValue="10"
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input id="assignment-due" name="dueAt" type="datetime-local" label="Due" />
              <Input
                id="assignment-opens"
                name="availableFrom"
                type="datetime-local"
                label="Opens"
              />
              <Input
                id="assignment-closes"
                name="availableUntil"
                type="datetime-local"
                label="Closes"
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-ink text-sm font-medium">Submission policy</legend>
              <label className="text-ink flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="allowLateSubmission"
                  defaultChecked
                  className="h-4 w-4"
                />
                Accept late work after the due date (flagged as late)
              </label>
              <label className="text-ink flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowResubmission" className="h-4 w-4" />
                Allow resubmission
              </label>
              <Input
                id="assignment-attempts"
                name="maxAttempts"
                type="number"
                min="1"
                max="10"
                label="Maximum attempts"
                defaultValue="2"
                hint="Only used when resubmission is allowed."
              />
            </fieldset>

            <div>
              <Button type="submit" size="sm">
                Create draft
              </Button>
            </div>
          </form>
        </details>
      </section>
    </div>
  );
}
