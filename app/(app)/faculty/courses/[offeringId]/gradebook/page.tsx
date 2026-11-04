import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCourseGradebook, getReleasePreview } from "@/modules/gradebook/gradebook-service";

import {
  excuseAssessmentAction,
  releaseOfferingAction,
  removeExcusalAction,
  saveSchemeAction,
} from "./actions";

export const metadata: Metadata = { title: "Gradebook" };

const OUTCOME_TONES: Record<string, BadgeTone> = {
  passed: "success",
  failed: "danger",
  incomplete: "warning",
  no_result: "neutral",
};

const OUTCOME_LABELS: Record<string, string> = {
  passed: "Passed",
  failed: "Failed",
  incomplete: "Incomplete",
  no_result: "No result",
};

function markLabel(cell: { state: string; score?: number | null } | undefined): string {
  if (!cell) return "Missing";
  if (cell.state === "scored") return String(cell.score ?? "—");
  if (cell.state === "ungraded") return "Not graded";
  if (cell.state === "excused") return "Excused";
  return "Missing";
}

export default async function CourseGradebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string; q?: string; page?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error, q, page }] = await Promise.all([params, searchParams]);

  const search = q?.trim() ?? "";
  const pageNumber = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;

  let gradebook;
  let preview;
  try {
    [gradebook, preview] = await Promise.all([
      getCourseGradebook(account, offeringId, { search, page: pageNumber }),
      getReleasePreview(account, offeringId),
    ]);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Gradebook" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The gradebook could not be loaded."}
        </Alert>
      </div>
    );
  }

  const scheme = gradebook.scheme;
  const columnTitles = new Map(gradebook.columns.map((column) => [column.id, column.title]));
  const learnerNames = new Map(
    gradebook.learnerOptions.map((learner) => [learner.userId, learner.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Courses", href: "/faculty/courses" },
          { label: gradebook.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Gradebook" },
        ]}
      />

      <PageHeader
        title={`${gradebook.courseCode} gradebook`}
        description={`${gradebook.courseTitle} · ${gradebook.termName} · ${gradebook.academicYearName}`}
        actions={
          <Link href={`/faculty/courses/${offeringId}/gradebook/export`}>
            <Button variant="secondary" size="sm">
              Export CSV
            </Button>
          </Link>
        }
      />

      {notice && (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      )}

      <Alert tone="info" title="How this is calculated">
        {scheme.mode === "weighted"
          ? "Weighted: each counted assessment contributes its weight times the percentage scored."
          : "Points: earned points divided by the points still available."}{" "}
        Work that is not submitted is reported as <strong>Missing</strong> and{" "}
        {scheme.treatMissingAsZero ? "counts as zero by this scheme" : "left out of the total"}.
        Work that is not marked is <strong>Not graded</strong> and left out, so the result stays{" "}
        <strong>Incomplete</strong> until every assessment is marked. Quizzes use the highest
        finished attempt. {gradebook.incompleteCount} learner(s) have an outstanding mark.
      </Alert>

      {/* Grading scheme */}
      <section className="rounded-lg border p-5">
        <h2 className="mb-1 text-base font-semibold">Grading scheme</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Saving recalculates every learner on the next read. Stored marks are never rewritten.
          {gradebook.schemeVersion > 0 ? ` Version ${gradebook.schemeVersion}.` : ""}
        </p>
        <form action={saveSchemeAction} className="flex flex-col gap-4">
          <input type="hidden" name="offeringId" value={offeringId} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select id="scheme-mode" label="Mode" name="mode" defaultValue={scheme.mode}>
              <option value="points">Points</option>
              <option value="weighted">Weighted</option>
            </Select>
            <Input
              id="scheme-pass-mark"
              label="Pass mark (%)"
              name="passMark"
              type="number"
              min={0}
              max={100}
              defaultValue={scheme.passMark ?? ""}
              hint="Leave blank for no pass/fail outcome."
            />
            <Input
              id="scheme-rounding"
              label="Rounding (decimals)"
              name="rounding"
              type="number"
              min={0}
              max={2}
              defaultValue={scheme.rounding ?? 2}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="treatMissingAsZero"
              defaultChecked={scheme.treatMissingAsZero ?? false}
            />
            Count missing work as zero
          </label>

          {gradebook.columns.length > 0 ? (
            <fieldset className="rounded-lg border p-4">
              <legend className="text-sm font-medium">
                Weights (used in weighted mode; blank means 1)
              </legend>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {gradebook.columns.map((column) => (
                  <div key={column.id} className="flex flex-col gap-1">
                    <input type="hidden" name="columnId" value={column.id} />
                    <Input
                      id={`weight-${column.id}`}
                      label={`${column.title} (${column.kind})`}
                      name={`weight_${column.id}`}
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={column.weight ?? ""}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit">Save scheme</Button>
          </div>
        </form>
      </section>

      {/* Table */}
      {gradebook.columns.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="Publish an assignment or a quiz to see it as a gradebook column."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <form className="flex flex-wrap items-end gap-3">
            <Input
              id="gradebook-search"
              label="Find a learner"
              name="q"
              defaultValue={search}
              placeholder="Name or email"
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
            {search ? (
              <Link href={`/faculty/courses/${offeringId}/gradebook`} className="text-sm underline">
                Clear
              </Link>
            ) : null}
          </form>

          {gradebook.learners.length === 0 ? (
            <EmptyState
              title="No matching learners"
              description="No enrolled learner matches this search."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 pr-4 font-medium">Learner</th>
                    {gradebook.columns.map((column) => (
                      <th key={column.id} className="py-2 pr-4 font-medium">
                        <span className="block">{column.title}</span>
                        <span className="text-xs font-normal">
                          {column.kind} · /{column.pointsPossible}
                          {column.weight && column.weight !== 1 ? ` · ×${column.weight}` : ""}
                          {column.released ? "" : " · unreleased"}
                        </span>
                      </th>
                    ))}
                    <th className="py-2 pr-4 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {gradebook.learners.map((learner) => (
                    <tr key={learner.userId} className="border-b align-top">
                      <td className="py-2 pr-4">
                        <span className="block font-medium">{learner.name}</span>
                        <span className="text-muted-foreground text-xs">{learner.email}</span>
                      </td>
                      {gradebook.columns.map((column) => (
                        <td key={column.id} className="py-2 pr-4 tabular-nums">
                          {markLabel(learner.cells[column.id])}
                        </td>
                      ))}
                      <td className="py-2 pr-4">
                        <span className="block tabular-nums">
                          {learner.result.percentage === null
                            ? "—"
                            : `${learner.result.percentage}%`}
                          {learner.result.letter ? ` (${learner.result.letter})` : ""}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {learner.result.earned} / {learner.result.possible} counted
                        </span>
                        <span className="mt-1 block">
                          <StatusBadge tone={OUTCOME_TONES[learner.result.outcome] ?? "neutral"}>
                            {OUTCOME_LABELS[learner.result.outcome] ?? learner.result.outcome}
                          </StatusBadge>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {gradebook.paging.totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Page {gradebook.paging.page} of {gradebook.paging.totalPages} ·{" "}
                {gradebook.paging.total} learner(s)
              </span>
              <span className="flex gap-3">
                {gradebook.paging.page > 1 ? (
                  <Link
                    href={`/faculty/courses/${offeringId}/gradebook?${new URLSearchParams({
                      ...(search ? { q: search } : {}),
                      page: String(gradebook.paging.page - 1),
                    }).toString()}`}
                    className="underline"
                  >
                    Previous
                  </Link>
                ) : null}
                {gradebook.paging.page < gradebook.paging.totalPages ? (
                  <Link
                    href={`/faculty/courses/${offeringId}/gradebook?${new URLSearchParams({
                      ...(search ? { q: search } : {}),
                      page: String(gradebook.paging.page + 1),
                    }).toString()}`}
                    className="underline"
                  >
                    Next
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : null}
        </div>
      )}

      {/* Release controls */}
      <section className="rounded-lg border p-5">
        <h2 className="mb-1 text-base font-semibold">Release grades</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Check what publishing would do before learners see it. Releasing publishes every mark that
          already has a score; work without a mark stays ungraded, so nothing empty can be released.
        </p>

        {preview.columns.length === 0 ? (
          <p className="text-muted-foreground text-sm">No assessments to release yet.</p>
        ) : (
          <>
            <ul className="mb-4 flex flex-col divide-y rounded border">
              {preview.columns.map((column) => (
                <li
                  key={column.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>
                    {column.title} ({column.kind})
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {column.released ? (
                      <StatusBadge tone="success">Released</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">Not released</StatusBadge>
                    )}
                    {column.batched ? (
                      <span className="text-muted-foreground">
                        {column.ready} ready · {column.awaitingMark} awaiting a mark
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Release from the quiz page</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mb-4 text-sm">
              <strong>{preview.readyTotal}</strong> mark(s) ready to publish ·{" "}
              <strong>{preview.awaitingMarkTotal}</strong> submission(s) still waiting for a mark ·{" "}
              {preview.releasedColumns} of {preview.columns.length} column(s) released.
            </p>

            {account.permissions.has("grades.publish") && preview.readyTotal > 0 ? (
              <form action={releaseOfferingAction} className="flex flex-col gap-3">
                <input type="hidden" name="offeringId" value={offeringId} />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="confirm" required className="mt-1" />
                  <span>
                    I have checked the marks above and want to publish all {preview.readyTotal} of
                    them to learners now.
                  </span>
                </label>
                <div className="flex justify-end">
                  <Button type="submit">Release {preview.readyTotal} mark(s)</Button>
                </div>
              </form>
            ) : (
              <p className="text-muted-foreground text-sm">
                {preview.readyTotal === 0
                  ? "Every scored mark is already published. Mark the remaining work, then come back to release it."
                  : "You do not have permission to publish grades."}
              </p>
            )}
          </>
        )}
      </section>

      {/* Excusals */}
      {gradebook.columns.length > 0 && gradebook.learnerOptions.length > 0 ? (
        <section className="rounded-lg border p-5">
          <h2 className="mb-1 text-base font-semibold">Excused work</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Excused work is removed from both earned and available points. An audit event records
            who excused it and why.
          </p>

          {gradebook.excusals.length > 0 ? (
            <ul className="mb-4 flex flex-col gap-2">
              {gradebook.excusals.map((excusal) => (
                <li
                  key={excusal.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                >
                  <span>
                    {learnerNames.get(excusal.userId) ?? excusal.userId} ·{" "}
                    {columnTitles.get(excusal.columnId) ?? excusal.columnId}
                    {excusal.reason ? ` — ${excusal.reason}` : ""}
                  </span>
                  <form action={removeExcusalAction}>
                    <input type="hidden" name="offeringId" value={offeringId} />
                    <input type="hidden" name="excusalId" value={excusal.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={excuseAssessmentAction} className="flex flex-col gap-4">
            <input type="hidden" name="offeringId" value={offeringId} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Select id="excuse-learner" label="Learner" name="userId">
                {gradebook.learnerOptions.map((learner) => (
                  <option key={learner.userId} value={learner.userId}>
                    {learner.name}
                  </option>
                ))}
              </Select>
              <Select id="excuse-assessment" label="Assessment" name="columnId">
                {gradebook.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.title} ({column.kind})
                  </option>
                ))}
              </Select>
              <Input
                id="excuse-reason"
                label="Reason"
                name="reason"
                required
                minLength={3}
                placeholder="e.g. Medical leave"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary">
                Excuse this assessment
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <p className="text-muted-foreground text-xs">
        A learner sees only columns whose marks have been released. Publish an assignment grade, or
        release quiz results, to make its column visible.
      </p>
    </div>
  );
}
