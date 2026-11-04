import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getLearnerAssignment } from "@/modules/assignments/submission-service";

import { saveDraftAction, submitAssignmentAction } from "../../../../assignments/actions";

export const metadata: Metadata = { title: "Assignment" };

function formatDateTime(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

const STATE_TONES: Record<string, BadgeTone> = {
  not_open: "info",
  open: "warning",
  submitted: "success",
  late: "warning",
  graded: "success",
  closed: "neutral",
};

export default async function StudentAssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; assignmentId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, assignmentId }, { notice, error }] = await Promise.all([
    params,
    searchParams,
  ]);
  const returnTo = `/student/courses/${offeringId}/assignments/${assignmentId}`;

  let assignment;
  try {
    assignment = await getLearnerAssignment(account, assignmentId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assignment" description="This assignment is not available to you." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The assignment could not be opened."}{" "}
          <Link href="/student/assignments" className="font-medium underline">
            Back to assignments
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const submission = assignment.submission;
  const showBodyField =
    assignment.submissionType === "TEXT" || assignment.submissionType === "TEXT_AND_FILE";
  const showFileField =
    assignment.submissionType === "FILE" || assignment.submissionType === "TEXT_AND_FILE";
  const showLinkField = assignment.submissionType === "LINK";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "My learning", href: "/student" },
          { label: "Assignments", href: "/student/assignments" },
          { label: assignment.title },
        ]}
      />
      <PageHeader
        eyebrow={`${assignment.courseCode} · ${assignment.termName}`}
        title={assignment.title}
        description={`${assignment.pointsPossible} points · due ${formatDateTime(assignment.dueAt)}`}
        actions={
          <StatusBadge tone={STATE_TONES[assignment.state] ?? "neutral"}>
            {assignment.state.replace("_", " ")}
          </StatusBadge>
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

      {assignment.mode === "preview" ? (
        <Alert tone="info" title="Preview mode">
          You are teaching staff, so this is the learner view. Submitting is disabled.
        </Alert>
      ) : null}

      <section aria-labelledby="brief" className="flex flex-col gap-3">
        <h2 id="brief" className="text-ink text-lg font-semibold">
          Brief
        </h2>
        <div className="rounded-card border-border bg-surface shadow-card border p-4 sm:p-6">
          {assignment.instructions ? (
            <p className="text-ink text-sm whitespace-pre-wrap">{assignment.instructions}</p>
          ) : (
            <p className="text-ink-muted text-sm">Your teacher has not added instructions.</p>
          )}
          <dl className="text-ink-muted mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase">Opens</dt>
              <dd>{formatDateTime(assignment.availableFrom)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase">Due</dt>
              <dd>{formatDateTime(assignment.dueAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase">Closes</dt>
              <dd>{formatDateTime(assignment.availableUntil)}</dd>
            </div>
          </dl>
          {assignment.settings.allowLateSubmission ? (
            <p className="text-ink-muted mt-3 text-xs">
              Late work is accepted after the due date and flagged to your teacher.
            </p>
          ) : null}
        </div>
      </section>

      {submission && submission.status !== "DRAFT" ? (
        <section aria-labelledby="receipt" className="flex flex-col gap-3">
          <h2 id="receipt" className="text-ink text-lg font-semibold">
            Submission receipt
          </h2>
          <div className="rounded-card border-border bg-surface shadow-card border p-4">
            <p className="text-ink text-sm">
              Received {formatDateTime(submission.submittedAt)} · attempt {submission.attemptNumber}
              {submission.late ? " · marked late" : ""}
            </p>
            {submission.files.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {submission.files.map((file) => (
                  <li key={file.id}>
                    <a
                      href={`/api/v1/submissions/${file.id}/file`}
                      className="text-brand-800 font-medium underline"
                    >
                      {file.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {submission.history.length > 1 ? (
              <details className="text-ink-muted mt-3 text-xs">
                <summary className="cursor-pointer font-medium">Submission history</summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {submission.history.map((version) => (
                    <li key={version.createdAt.toISOString()}>
                      <span className="text-ink-muted">{formatDateTime(version.createdAt)}</span>
                      <pre className="text-ink mt-1 whitespace-pre-wrap">{version.body}</pre>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="your-work" className="flex flex-col gap-3">
        <h2 id="your-work" className="text-ink text-lg font-semibold">
          Your work
        </h2>
        {assignment.mode === "preview" ? (
          <p className="text-ink-muted text-sm">
            This is the form a learner would see for a {assignment.submissionType.toLowerCase()}{" "}
            submission.
          </p>
        ) : assignment.canSubmit ? (
          <form
            action={submitAssignmentAction}
            className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-6"
          >
            <input type="hidden" name="assignmentId" value={assignment.id} />
            <input type="hidden" name="returnTo" value={returnTo} />

            {showBodyField ? (
              <Textarea
                id="submission-body"
                name="body"
                label="Your answer"
                rows={10}
                defaultValue={submission?.body ?? ""}
                hint="Saving a draft does not submit. Submit when you are ready to send it."
              />
            ) : null}
            {showLinkField ? (
              <Input
                id="submission-link"
                name="body"
                type="url"
                label="Link to your work"
                defaultValue={submission?.body ?? ""}
                hint="Must start with http:// or https://."
              />
            ) : null}
            {showFileField ? (
              <Input
                id="submission-file"
                name="file"
                type="file"
                label={
                  submission?.files[0]
                    ? `Replace file (current: ${submission.files[0].fileName})`
                    : "Attach a file"
                }
                hint="Up to 25 MB. Stored privately."
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" formAction={submitAssignmentAction} size="sm">
                Submit for grading
              </Button>
              <Button type="submit" formAction={saveDraftAction} variant="secondary" size="sm">
                Save draft
              </Button>
            </div>
            {submission?.status === "DRAFT" ? (
              <p className="text-ink-muted text-xs">
                A draft is saved but not submitted. Your teacher cannot see it until you submit.
              </p>
            ) : null}
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            {assignment.blockedReason ? (
              <Alert tone="warning" title="Submission closed">
                {assignment.blockedReason}
              </Alert>
            ) : null}
            {submission?.body ? (
              <div className="rounded-card border-border bg-surface shadow-card border p-4">
                <p className="text-ink-muted text-xs uppercase">Your submitted answer</p>
                <pre className="text-ink mt-2 text-sm whitespace-pre-wrap">{submission.body}</pre>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {assignment.grade ? (
        <section aria-labelledby="feedback" className="flex flex-col gap-3">
          <h2 id="feedback" className="text-ink text-lg font-semibold">
            Feedback
          </h2>
          <div className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-6">
            <p className="text-ink text-2xl font-semibold">
              {assignment.grade.rawScore ?? "—"}
              <span className="text-ink-muted text-base font-normal">
                {" "}
                / {assignment.grade.pointsPossible}
                {assignment.grade.percent !== null ? ` · ${assignment.grade.percent}%` : ""}
              </span>
            </p>
            <p className="text-ink-muted text-xs">
              Released {formatDateTime(assignment.grade.releasedAt)}
            </p>
            {assignment.grade.feedback ? (
              <p className="text-ink text-sm whitespace-pre-wrap">{assignment.grade.feedback}</p>
            ) : (
              <p className="text-ink-muted text-sm">No written feedback was added.</p>
            )}
            {assignment.rubric.length > 0 ? (
              <dl className="flex flex-col gap-2">
                {assignment.rubric.map((criterion) => {
                  const score = assignment.grade?.rubricScores.find(
                    (entry) => entry.criterionId === criterion.id,
                  );
                  return (
                    <div key={criterion.id} className="border-border border-t pt-2">
                      <dt className="text-ink text-sm font-medium">
                        {criterion.title} · {score?.score ?? "—"} / {criterion.pointsPossible}
                      </dt>
                      {score?.feedback ? (
                        <dd className="text-ink-muted text-sm">{score.feedback}</dd>
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
