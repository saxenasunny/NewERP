import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import type { AssignmentStatus } from "@/modules/assignments/assignment-service";
import { getAssignmentDetail } from "@/modules/assignments/assignment-service";
import { getGradingWorkspace, type GradingEntry } from "@/modules/assignments/grading-service";

import {
  deleteAssignmentAction,
  releaseAllGradesAction,
  releaseGradeAction,
  saveGradeAction,
  saveRubricAction,
  setAssignmentStatusAction,
  updateAssignmentAction,
} from "../actions";

export const metadata: Metadata = { title: "Assignment and grading" };

const STATUS_TONES: Record<AssignmentStatus, BadgeTone> = {
  DRAFT: "info",
  PUBLISHED: "success",
  ARCHIVED: "warning",
};

function toLocalInput(date: Date | null): string {
  return date ? date.toISOString().slice(0, 16) : "";
}

function formatDateTime(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

function submissionLabel(entry: GradingEntry): string {
  if (entry.status === "DRAFT") return "draft only";
  if (entry.late) return "late";
  return entry.status.toLowerCase();
}

export default async function AssignmentDetailPage({
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
  const returnTo = `/faculty/courses/${offeringId}/assignments/${assignmentId}`;

  let detail;
  let workspace;
  try {
    detail = await getAssignmentDetail(account, assignmentId);
    workspace = await getGradingWorkspace(account, assignmentId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assignment" description="This assignment is not available to you." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The assignment could not be opened."}{" "}
          <Link href="/faculty/assignments" className="font-medium underline">
            Back to assignments
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const { entries, summary } = workspace;
  const canRelease = account.permissions.has("grades.publish");

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Faculty", href: "/faculty" },
          { label: "Assignments", href: "/faculty/assignments" },
          { label: detail.courseCode, href: `/faculty/courses/${offeringId}/assignments` },
          { label: detail.title },
        ]}
      />
      <PageHeader
        eyebrow={`${detail.courseCode} · ${detail.termName}`}
        title={detail.title}
        description={`${detail.pointsPossible} points · due ${formatDateTime(detail.dueAt)} · ${summary.submitted} of ${summary.learners} learner(s) submitted`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONES[detail.status]}>
              {detail.status.toLowerCase()}
            </StatusBadge>
            <Link
              href={`/faculty/courses/${offeringId}/assignments`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              All assignments
            </Link>
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

      <section aria-labelledby="status-heading" className="flex flex-col gap-3">
        <h2 id="status-heading" className="text-ink text-lg font-semibold">
          Publication and release
        </h2>
        <div className="rounded-card border-border bg-surface shadow-card flex flex-wrap items-center gap-2 border p-4">
          <form action={setAssignmentStatusAction}>
            <input type="hidden" name="assignmentId" value={detail.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="status" value="PUBLISHED" />
            <Button type="submit" size="sm" disabled={detail.status === "PUBLISHED"}>
              Publish to learners
            </Button>
          </form>
          <form action={setAssignmentStatusAction}>
            <input type="hidden" name="assignmentId" value={detail.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="status" value="DRAFT" />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={detail.status === "DRAFT"}
            >
              Return to draft
            </Button>
          </form>
          <form action={setAssignmentStatusAction}>
            <input type="hidden" name="assignmentId" value={detail.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="status" value="ARCHIVED" />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={detail.status === "ARCHIVED"}
            >
              Archive
            </Button>
          </form>
          {canRelease ? (
            <form action={releaseAllGradesAction}>
              <input type="hidden" name="assignmentId" value={detail.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" size="sm" variant="primary">
                Release all scored grades
              </Button>
            </form>
          ) : null}
          {detail.status === "DRAFT" ? (
            <form action={deleteAssignmentAction}>
              <input type="hidden" name="assignmentId" value={detail.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" size="sm" variant="danger">
                Delete draft
              </Button>
            </form>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="settings-heading" className="flex flex-col gap-3">
        <h2 id="settings-heading" className="text-ink text-lg font-semibold">
          Settings
        </h2>
        <details className="rounded-card border-border bg-surface shadow-card border">
          <summary className="text-ink cursor-pointer px-4 py-3 text-sm font-medium">
            Edit assignment
          </summary>
          <form
            action={updateAssignmentAction}
            className="border-border flex flex-col gap-3 border-t p-4"
          >
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="assignmentId" value={detail.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Input
              id="edit-title"
              name="title"
              label="Title"
              defaultValue={detail.title}
              required
              maxLength={200}
            />
            <Textarea
              id="edit-instructions"
              name="instructions"
              label="Instructions"
              defaultValue={detail.instructions ?? ""}
              rows={6}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                id="edit-type"
                name="submissionType"
                label="Submission type"
                defaultValue={detail.submissionType}
              >
                <option value="TEXT">Text answer</option>
                <option value="FILE">File upload</option>
                <option value="LINK">Web link</option>
                <option value="TEXT_AND_FILE">Text and file</option>
              </Select>
              <Input
                id="edit-points"
                name="pointsPossible"
                type="number"
                step="0.5"
                min="0.5"
                max="1000"
                label="Points possible"
                defaultValue={String(detail.pointsPossible)}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                id="edit-due"
                name="dueAt"
                type="datetime-local"
                label="Due"
                defaultValue={toLocalInput(detail.dueAt)}
              />
              <Input
                id="edit-opens"
                name="availableFrom"
                type="datetime-local"
                label="Opens"
                defaultValue={toLocalInput(detail.availableFrom)}
              />
              <Input
                id="edit-closes"
                name="availableUntil"
                type="datetime-local"
                label="Closes"
                defaultValue={toLocalInput(detail.availableUntil)}
              />
            </div>
            <label className="text-ink flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allowLateSubmission"
                defaultChecked={detail.settings.allowLateSubmission}
                className="h-4 w-4"
              />
              Accept late work after the due date
            </label>
            <label className="text-ink flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allowResubmission"
                defaultChecked={detail.settings.allowResubmission}
                className="h-4 w-4"
              />
              Allow resubmission
            </label>
            <Input
              id="edit-attempts"
              name="maxAttempts"
              type="number"
              min="1"
              max="10"
              label="Maximum attempts"
              defaultValue={String(detail.settings.maxAttempts)}
            />
            <div>
              <Button type="submit" size="sm">
                Save settings
              </Button>
            </div>
          </form>
        </details>
      </section>

      <section aria-labelledby="rubric-heading" className="flex flex-col gap-3">
        <h2 id="rubric-heading" className="text-ink text-lg font-semibold">
          Rubric
        </h2>
        <form
          action={saveRubricAction}
          className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4"
        >
          <input type="hidden" name="assignmentId" value={detail.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p className="text-ink-muted text-sm">
            Criteria are scored per learner. A rubric cannot be changed once grades exist, because
            the old scores would be lost.
          </p>
          {[...detail.rubric, null, null].map((criterion, index) => (
            <div
              key={criterion?.id ?? `blank-${index}`}
              className="grid gap-2 sm:grid-cols-[2fr_1fr_3fr]"
            >
              <Input
                id={`criterion-title-${index}`}
                name="criterionTitle"
                label="Criterion"
                defaultValue={criterion?.title ?? ""}
                maxLength={160}
              />
              <Input
                id={`criterion-points-${index}`}
                name="criterionPoints"
                type="number"
                step="0.5"
                min="0.5"
                label="Points"
                defaultValue={criterion ? String(criterion.pointsPossible) : "1"}
              />
              <Input
                id={`criterion-description-${index}`}
                name="criterionDescription"
                label="Description"
                defaultValue={criterion?.description ?? ""}
              />
            </div>
          ))}
          <div>
            <Button type="submit" size="sm">
              Save rubric
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="grading-heading" className="flex flex-col gap-3">
        <h2 id="grading-heading" className="text-ink text-lg font-semibold">
          Grading queue
        </h2>
        <p className="text-ink-muted text-sm">
          {summary.submitted} submitted · {summary.awaitingGrading} awaiting grading ·{" "}
          {summary.released} released. Saving a grade keeps it in draft; release it when the learner
          should see it.
        </p>

        {entries.length === 0 ? (
          <p className="text-ink-muted text-sm">No learner has started this assignment yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => (
              <li
                key={entry.submissionId}
                className="rounded-card border-border bg-surface shadow-card border p-4"
              >
                <details>
                  <summary className="text-ink flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-medium">
                    <span>
                      {entry.learnerName} · {entry.learnerEmail}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={entry.status === "GRADED" ? "success" : "info"}>
                        {submissionLabel(entry)}
                      </StatusBadge>
                      <span className="text-ink-muted text-xs">
                        {entry.grade
                          ? `${entry.grade.rawScore ?? "—"}/${entry.grade.pointsPossible} · ${entry.grade.status.toLowerCase()}`
                          : "not graded"}
                      </span>
                    </span>
                  </summary>

                  <div className="mt-4 flex flex-col gap-4">
                    <div className="text-ink-muted flex flex-wrap gap-4 text-xs">
                      <span>Submitted {formatDateTime(entry.submittedAt)}</span>
                      <span>Attempt {entry.attemptNumber}</span>
                    </div>

                    {entry.body ? (
                      <pre className="border-border bg-surface-muted text-ink max-h-64 overflow-auto rounded-lg border p-3 text-sm whitespace-pre-wrap">
                        {entry.body}
                      </pre>
                    ) : (
                      <p className="text-ink-muted text-sm">No text answer.</p>
                    )}

                    {entry.files.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-sm">
                        {entry.files.map((file) => (
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

                    <form action={saveGradeAction} className="flex flex-col gap-3">
                      <input type="hidden" name="submissionId" value={entry.submissionId} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                        <Input
                          id={`score-${entry.submissionId}`}
                          name="rawScore"
                          type="number"
                          step="0.5"
                          min="0"
                          max={detail.pointsPossible}
                          label="Score"
                          defaultValue={
                            entry.grade?.rawScore !== null
                              ? String(entry.grade?.rawScore ?? "")
                              : ""
                          }
                        />
                        <Input
                          id={`reason-${entry.submissionId}`}
                          name="reason"
                          label="Audit reason"
                          hint="Required when changing a grade the learner has already seen."
                        />
                      </div>
                      <Textarea
                        id={`feedback-${entry.submissionId}`}
                        name="feedback"
                        label="Feedback"
                        rows={3}
                        defaultValue={entry.grade?.feedback ?? ""}
                      />

                      {detail.rubric.length > 0 ? (
                        <fieldset className="flex flex-col gap-2">
                          <legend className="text-ink text-sm font-medium">Rubric scores</legend>
                          {detail.rubric.map((criterion) => {
                            const saved = entry.grade?.rubricScores.find(
                              (score) => score.criterionId === criterion.id,
                            );
                            return (
                              <div
                                key={criterion.id}
                                className="grid gap-2 sm:grid-cols-[1fr_100px_2fr]"
                              >
                                <span className="text-ink self-center text-sm">
                                  {criterion.title} (max {criterion.pointsPossible})
                                </span>
                                <Input
                                  id={`score-${entry.submissionId}-${criterion.id}`}
                                  name={`criterionScore_${criterion.id}`}
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  max={criterion.pointsPossible}
                                  label="Points"
                                  defaultValue={
                                    saved?.score !== null && saved ? String(saved.score) : ""
                                  }
                                />
                                <Input
                                  id={`cf-${entry.submissionId}-${criterion.id}`}
                                  name={`criterionFeedback_${criterion.id}`}
                                  label="Criterion feedback"
                                  defaultValue={saved?.feedback ?? ""}
                                />
                              </div>
                            );
                          })}
                        </fieldset>
                      ) : null}

                      <div>
                        <Button type="submit" size="sm">
                          Save grade (draft)
                        </Button>
                      </div>
                    </form>

                    {entry.grade && entry.grade.status !== "RELEASED" && canRelease ? (
                      <form action={releaseGradeAction}>
                        <input type="hidden" name="gradeId" value={entry.grade.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <Button type="submit" size="sm" variant="secondary">
                          Release this grade
                        </Button>
                      </form>
                    ) : null}

                    {entry.grade?.history.length ? (
                      <details className="text-ink-muted text-xs">
                        <summary className="cursor-pointer font-medium">Grade history</summary>
                        <ul className="mt-2 flex flex-col gap-1">
                          {entry.grade.history.map((event) => (
                            <li key={event.id}>
                              {formatDateTime(event.createdAt)} · {event.actorName ?? "system"} ·{" "}
                              {event.oldRawScore ?? "—"} → {event.newRawScore ?? "—"} (
                              {event.oldStatus ?? "new"} → {event.newStatus ?? "—"})
                              {event.reason ? ` · ${event.reason}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
