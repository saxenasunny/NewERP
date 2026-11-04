import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCourseObeWorkspace } from "@/modules/obe/outcome-service";

import {
  archiveCourseOutcomeAction,
  createAssessmentMappingAction,
  createCourseOutcomeAction,
  removeAssessmentMappingAction,
  setCorrelationAction,
  updateCourseOutcomeAction,
} from "./actions";

export const metadata: Metadata = { title: "Course outcomes and OBE mapping" };

export default async function CourseOutcomesPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  if (!account.permissions.has("obe.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course outcomes" />
        <PermissionDenied message="Your role cannot manage course outcomes." />
      </div>
    );
  }

  let workspace;
  try {
    workspace = await getCourseObeWorkspace(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course outcomes" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "This course could not be opened."}{" "}
          <Link href="/faculty/courses" className="font-medium underline">
            Back to my courses
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const {
    access,
    programme,
    policy,
    courseOutcomes,
    programmeOutcomes,
    mappings,
    assessmentMappings,
  } = workspace;
  const returnTo = `/faculty/courses/${offeringId}/outcomes`;
  const mappingFor = (courseOutcomeId: string, programmeOutcomeId: string) =>
    mappings.find(
      (mapping) =>
        mapping.courseOutcomeId === courseOutcomeId &&
        mapping.programmeOutcomeId === programmeOutcomeId,
    );
  const outcomeCode = new Map(courseOutcomes.map((outcome) => [outcome.id, outcome.code]));
  const assignmentTitle = new Map(workspace.assignments.map((row) => [row.id, row.title]));
  const questionTitle = new Map(workspace.questions.map((row) => [row.id, row.title]));
  const warningCount = workspace.warnings.length;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Faculty", href: "/faculty" },
          { label: "My courses", href: "/faculty/courses" },
          {
            label: `${access.courseCode} · ${access.termName}`,
            href: `/faculty/courses/${offeringId}`,
          },
          { label: "Outcomes" },
        ]}
      />
      <PageHeader
        eyebrow={`${access.academicYearName} · ${access.termName}`}
        title={`Outcomes · ${access.courseCode}`}
        description="Course outcomes, their correlation to programme outcomes, and the assessments that supply evidence. Mapping is recorded here; attainment is not calculated until this institution confirms a formula."
        actions={
          <Link
            href={`${returnTo}/export`}
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Export evidence (CSV)
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

      <section
        aria-labelledby="policy-heading"
        className="rounded-card border-border bg-surface shadow-card border p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="policy-heading" className="text-ink text-lg font-semibold">
              Policy used for this mapping
            </h2>
            <p className="text-ink-muted mt-1 text-sm">
              Correlation scale{" "}
              {policy.correlationScale.map((entry) => `${entry.level}=${entry.label}`).join(", ")};
              rounding to {policy.rounding.decimalPlaces} decimal place
              {policy.rounding.decimalPlaces === 1 ? "" : "s"}.
            </p>
          </div>
          <StatusBadge tone={policy.formulaConfigured ? "success" : "warning"}>
            {policy.formulaConfigured ? "formula recorded" : "formula unconfigured"}
          </StatusBadge>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-ink-muted text-xs font-medium tracking-wide uppercase">
              Course outcome threshold
            </dt>
            <dd className="text-ink mt-1">
              {policy.thresholds.courseOutcome === null
                ? "not configured"
                : `${policy.thresholds.courseOutcome}%`}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted text-xs font-medium tracking-wide uppercase">
              Programme outcome threshold
            </dt>
            <dd className="text-ink mt-1">
              {policy.thresholds.programmeOutcome === null
                ? "not configured"
                : `${policy.thresholds.programmeOutcome}%`}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted text-xs font-medium tracking-wide uppercase">
              Direct method
            </dt>
            <dd className="text-ink mt-1 capitalize">{policy.directMethod.status}</dd>
          </div>
          <div>
            <dt className="text-ink-muted text-xs font-medium tracking-wide uppercase">
              Indirect method
            </dt>
            <dd className="text-ink mt-1 capitalize">{policy.indirectMethod.status}</dd>
          </div>
        </dl>
        {!policy.formulaConfigured ? (
          <div className="mt-4">
            <Alert tone="warning" title="No attainment numbers">
              Missing evidence stays missing, never zero. This page records mappings and coverage
              warnings; a computed attainment report waits for the institution&apos;s confirmed
              formula.
            </Alert>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="course-outcomes-heading" className="flex flex-col gap-3">
        <h2 id="course-outcomes-heading" className="text-ink text-lg font-semibold">
          Course outcomes
        </h2>
        {courseOutcomes.length === 0 ? (
          <EmptyState
            title="No course outcomes yet"
            description="Add the outcomes this course is taught against, then map each one to programme outcomes and to the assessments that supply evidence."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Course outcomes, their evidence, and their status
              </caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Code
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Outcome
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Evidence items
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
                {courseOutcomes.map((outcome) => {
                  const evidenceCount = assessmentMappings.filter(
                    (mapping) => mapping.courseOutcomeId === outcome.id,
                  ).length;
                  return (
                    <tr key={outcome.id} className="border-border border-t">
                      <td className="text-ink px-3 py-3 text-sm font-medium">{outcome.code}</td>
                      <td className="px-3 py-3 text-sm">
                        <p className="text-ink">{outcome.title}</p>
                        {outcome.description ? (
                          <p className="text-ink-muted mt-1 text-xs">{outcome.description}</p>
                        ) : null}
                      </td>
                      <td className="text-ink-muted px-3 py-3 text-sm tabular-nums">
                        {evidenceCount}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge tone={outcome.status === "ACTIVE" ? "success" : "warning"}>
                          {outcome.status.toLowerCase()}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <form action={archiveCourseOutcomeAction}>
                          <input type="hidden" name="offeringId" value={offeringId} />
                          <input type="hidden" name="id" value={outcome.id} />
                          <button
                            type="submit"
                            className="text-brand-800 text-sm font-medium hover:underline"
                          >
                            {outcome.status === "ARCHIVED" ? "Restore" : "Archive"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <form
          action={createCourseOutcomeAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-3"
        >
          <input type="hidden" name="offeringId" value={offeringId} />
          <Input id="co-code" name="code" label="Code" placeholder="CO1" required />
          <Input id="co-title" name="title" label="Outcome" required />
          <Textarea id="co-description" name="description" label="Description (optional)" />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <button
              type="submit"
              className="bg-brand-800 text-surface rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
            >
              Add course outcome
            </button>
            <span className="text-ink-muted text-xs">
              Codes are upper-cased and unique within this offering.
            </span>
          </div>
        </form>

        {courseOutcomes.length > 0 ? (
          <details className="rounded-card border-border bg-surface shadow-card border p-4">
            <summary className="text-ink cursor-pointer text-sm font-medium">
              Edit an existing outcome
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              {courseOutcomes.map((outcome) => (
                <form
                  key={outcome.id}
                  action={updateCourseOutcomeAction}
                  className="border-border grid gap-3 border-t pt-4 first:border-t-0 first:pt-0 sm:grid-cols-4"
                >
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="id" value={outcome.id} />
                  <Input
                    id={`edit-co-code-${outcome.id}`}
                    name="code"
                    label="Code"
                    defaultValue={outcome.code}
                    required
                  />
                  <Input
                    id={`edit-co-title-${outcome.id}`}
                    name="title"
                    label="Outcome"
                    defaultValue={outcome.title}
                    required
                  />
                  <Textarea
                    id={`edit-co-description-${outcome.id}`}
                    name="description"
                    label="Description"
                    defaultValue={outcome.description ?? ""}
                  />
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="text-brand-800 text-sm font-medium hover:underline"
                    >
                      Save {outcome.code}
                    </button>
                  </div>
                </form>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="correlation-heading" className="flex flex-col gap-3">
        <h2 id="correlation-heading" className="text-ink text-lg font-semibold">
          Correlation to programme outcomes
        </h2>
        {!programme ? (
          <Alert tone="warning" title="No programme attached">
            This offering has no section, so it has no programme. Attach a section in academic setup
            before mapping course outcomes to POs or PSOs.
          </Alert>
        ) : programmeOutcomes.length === 0 ? (
          <EmptyState
            title="No programme outcomes"
            description={`${programme.programmeCode} has no active POs or PSOs. An institution administrator defines them under OBE.`}
          />
        ) : courseOutcomes.length === 0 ? (
          <EmptyState
            title="Add course outcomes first"
            description="Correlations are recorded per course outcome."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Course outcome to programme outcome correlation for {programme.programmeCode}
              </caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Course outcome
                  </th>
                  {programmeOutcomes.map((outcome) => (
                    <th
                      key={outcome.id}
                      scope="col"
                      className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                      title={outcome.title}
                    >
                      {outcome.code}
                      <span className="text-ink-muted block text-[10px] font-normal normal-case">
                        {outcome.type}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courseOutcomes
                  .filter((outcome) => outcome.status !== "ARCHIVED")
                  .map((outcome) => (
                    <tr key={outcome.id} className="border-border border-t">
                      <th scope="row" className="px-3 py-3 text-left text-sm font-medium">
                        <span className="text-ink">{outcome.code}</span>
                        <span className="text-ink-muted block text-xs font-normal">
                          {outcome.title}
                        </span>
                      </th>
                      {programmeOutcomes.map((programmeOutcome) => {
                        const existing = mappingFor(outcome.id, programmeOutcome.id);
                        const fieldId = `correlation-${outcome.id}-${programmeOutcome.id}`;
                        return (
                          <td key={programmeOutcome.id} className="px-3 py-3">
                            <form action={setCorrelationAction} className="flex items-center gap-1">
                              <input type="hidden" name="offeringId" value={offeringId} />
                              <input type="hidden" name="courseOutcomeId" value={outcome.id} />
                              <input
                                type="hidden"
                                name="programmeOutcomeId"
                                value={programmeOutcome.id}
                              />
                              {existing ? (
                                <input type="hidden" name="mappingId" value={existing.id} />
                              ) : null}
                              <label htmlFor={fieldId} className="sr-only">
                                Correlation of {outcome.code} to {programmeOutcome.code}
                              </label>
                              <select
                                id={fieldId}
                                name="correlationLevel"
                                defaultValue={existing ? String(existing.correlationLevel) : ""}
                                className="border-border-strong bg-surface text-ink w-24 rounded-lg border px-2 py-1 text-sm"
                              >
                                <option value="">—</option>
                                {policy.correlationScale.map((entry) => (
                                  <option key={entry.level} value={entry.level}>
                                    {entry.code} · {entry.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="text-brand-800 text-xs font-medium hover:underline"
                              >
                                Save
                              </button>
                            </form>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-ink-muted text-xs">
          Choosing “—” removes a correlation. PEOs are not correlation targets; they sit above
          programme outcomes.
        </p>
      </section>

      <section aria-labelledby="evidence-heading" className="flex flex-col gap-3">
        <h2 id="evidence-heading" className="text-ink text-lg font-semibold">
          Assessment evidence
        </h2>
        {assessmentMappings.length === 0 ? (
          <EmptyState
            title="No assessment evidence mapped"
            description="Map a published assignment or quiz question to each course outcome, so attainment can later be traced to a mark rather than asserted."
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Assessments mapped to course outcomes</caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Course outcome
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Kind
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Assessment
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                  >
                    Weight
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {assessmentMappings.map((mapping) => (
                  <tr key={mapping.id} className="border-border border-t">
                    <td className="text-ink px-3 py-3 text-sm font-medium">
                      {outcomeCode.get(mapping.courseOutcomeId) ?? "—"}
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {mapping.kind === "ASSIGNMENT" ? "Assignment" : "Question"}
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm">
                      {mapping.kind === "ASSIGNMENT"
                        ? (assignmentTitle.get(mapping.assignmentId ?? "") ?? "Removed assessment")
                        : (questionTitle.get(mapping.questionId ?? "") ?? "Removed question")}
                    </td>
                    <td className="text-ink-muted px-3 py-3 text-sm tabular-nums">
                      {mapping.weight}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <form action={removeAssessmentMappingAction}>
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="mappingId" value={mapping.id} />
                        <button
                          type="submit"
                          className="text-brand-800 text-sm font-medium hover:underline"
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {courseOutcomes.length > 0 ? (
          <form
            action={createAssessmentMappingAction}
            className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-4"
          >
            <input type="hidden" name="offeringId" value={offeringId} />
            <Select id="evidence-co" name="courseOutcomeId" label="Course outcome" required>
              {courseOutcomes
                .filter((outcome) => outcome.status !== "ARCHIVED")
                .map((outcome) => (
                  <option key={outcome.id} value={outcome.id}>
                    {outcome.code} · {outcome.title}
                  </option>
                ))}
            </Select>
            <Select id="evidence-ref" name="ref" label="Assessment" required>
              <option value="">Choose an assessment</option>
              {workspace.assignments.length > 0 ? (
                <optgroup label="Assignments">
                  {workspace.assignments.map((assignment) => (
                    <option key={assignment.id} value={`ASSIGNMENT:${assignment.id}`}>
                      {assignment.title} ({assignment.status.toLowerCase()})
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {workspace.questions.length > 0 ? (
                <optgroup label="Quiz questions">
                  {workspace.questions.map((question) => (
                    <option key={question.id} value={`QUESTION:${question.id}`}>
                      {question.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
            <Input
              id="evidence-weight"
              name="weight"
              label="Weight"
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              defaultValue={1}
            />
            <div className="flex items-end">
              <button type="submit" className="text-brand-800 text-sm font-medium hover:underline">
                Map evidence
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="warnings-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="warnings-heading" className="text-ink text-lg font-semibold">
            Coverage warnings
          </h2>
          <p className="text-ink-muted text-sm tabular-nums">{warningCount} open</p>
        </div>
        {warningCount === 0 ? (
          <Alert tone="success" title="Mapping complete">
            Every active course outcome has a programme outcome and at least one piece of evidence,
            and every active programme outcome is covered by this offering.
          </Alert>
        ) : (
          <ul className="rounded-card border-border bg-surface shadow-card divide-border divide-y border">
            {workspace.warnings.map((warning) => (
              <li
                key={`${warning.code}-${warning.resourceId}`}
                className="flex flex-wrap items-baseline gap-2 px-4 py-3 text-sm"
              >
                <StatusBadge tone="warning">{warning.code}</StatusBadge>
                <span className="text-ink">{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
