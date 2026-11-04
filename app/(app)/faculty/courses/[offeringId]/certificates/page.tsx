import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getOfferingCertificatesWorkspace } from "@/modules/certificates/certificate-service";

import {
  issueCertificateAction,
  reissueCertificateAction,
  revokeCertificateAction,
  saveCompletionRulesAction,
} from "./actions";

export const metadata: Metadata = { title: "Certificates" };

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

export default async function CourseCertificatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let workspace;
  try {
    workspace = await getOfferingCertificatesWorkspace(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Certificates" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "This course could not be opened. Try again."}
        </Alert>
      </div>
    );
  }

  const { access, rules, ruleSummary, rows } = workspace;
  const returnTo = `/faculty/courses/${access.offeringId}/certificates`;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Faculty", href: "/faculty" },
          { label: "My courses", href: "/faculty/courses" },
          { label: access.courseCode, href: `/faculty/courses/${access.offeringId}` },
          { label: "Certificates" },
        ]}
      />
      <PageHeader
        eyebrow={`${access.courseCode} · ${access.termName}`}
        title="Certificates"
        description="Completion rules decide eligibility. Rules never hide course material, and a certificate is issued once per learner unless it is explicitly reissued."
        actions={<StatusBadge tone="info">{rows.length} enrolled</StatusBadge>}
      />

      {notice ? (
        <Alert tone="success" title="Saved">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not complete that action">
          {error}
        </Alert>
      ) : null}

      <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
        <h2 id="rules-heading" className="text-ink text-lg font-semibold">
          Completion rules
        </h2>
        <form
          action={saveCompletionRulesAction}
          className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:p-6"
        >
          <input type="hidden" name="offeringId" value={access.offeringId} />
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="requireAllContent"
                defaultChecked={rules.requireAllPublishedContent}
                className="mt-1"
              />
              <span>
                <span className="text-ink font-medium">Require every published lesson</span>
                <span className="text-ink-muted block text-xs">
                  Draft and unpublished items never count.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="requireAssignments"
                defaultChecked={rules.requirePublishedAssignments}
                className="mt-1"
              />
              <span>
                <span className="text-ink font-medium">Require every published assignment</span>
                <span className="text-ink-muted block text-xs">
                  A draft submission does not count; submitting once is enough.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="requireQuizzes"
                defaultChecked={rules.requirePublishedQuizzes}
                className="mt-1"
              />
              <span>
                <span className="text-ink font-medium">Require every published quiz</span>
                <span className="text-ink-muted block text-xs">
                  Any submitted attempt counts, regardless of score.
                </span>
              </span>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="minContentPercent"
              name="minContentPercent"
              label="Minimum lesson completion (%)"
              type="number"
              min={0}
              max={100}
              defaultValue={rules.minContentPercent ?? ""}
              hint="Optional. Leave blank to rely on the checkbox above."
            />
            <Input
              id="minGradePercent"
              name="minGradePercent"
              label="Minimum released grade (%)"
              type="number"
              min={0}
              max={100}
              defaultValue={rules.minReleasedGradePercent ?? ""}
              hint="Optional. Uses released grades only; unreleased work is not guessed."
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-ink-muted text-sm">A learner is eligible when all of these hold:</p>
            <ul className="text-ink-muted list-disc pl-5 text-sm">
              {ruleSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <Button type="submit" size="sm">
              Save completion rules
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="roster-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="roster-heading" className="text-ink text-lg font-semibold">
            Eligibility and awards
          </h2>
          <p className="text-ink-muted max-w-3xl text-sm">
            Missing evidence is listed as a gap, never read as a pass. A revoked certificate keeps
            its number and audit trail, and its public status shows as revoked.
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nobody is enrolled"
            description="Enrol learners in the course before issuing certificates."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const percent = row.evaluation.contentPercent;
              return (
                <li
                  key={row.learnerUserId}
                  className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <p className="text-ink text-sm font-medium">{row.learnerName}</p>
                      <p className="text-ink-muted text-xs">{row.learnerEmail}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={row.enrolmentStatus === "ACTIVE" ? "success" : "neutral"}
                        >
                          enrolment {row.enrolmentStatus.toLowerCase()}
                        </StatusBadge>
                        <StatusBadge tone={row.evaluation.eligible ? "success" : "warning"}>
                          {row.evaluation.eligible ? "eligible" : "not eligible"}
                        </StatusBadge>
                        {row.certificate ? (
                          <StatusBadge tone="info">
                            certificate {row.certificate.status.toLowerCase()}
                          </StatusBadge>
                        ) : null}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-ink-muted uppercase">Lessons</dt>
                        <dd className="text-ink font-semibold">
                          {row.facts.completedContentItems}/{row.facts.publishedContentItems}
                          {percent === null ? "" : ` · ${percent}%`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted uppercase">Assignments</dt>
                        <dd className="text-ink font-semibold">
                          {row.facts.submittedAssignments}/{row.facts.publishedAssignments}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted uppercase">Quizzes</dt>
                        <dd className="text-ink font-semibold">
                          {row.facts.submittedQuizzes}/{row.facts.publishedQuizzes}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted uppercase">Released grade</dt>
                        <dd className="text-ink font-semibold">
                          {row.facts.releasedGradePercent === null
                            ? "not released"
                            : `${row.facts.releasedGradePercent}%`}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {row.evaluation.gaps.length > 0 ? (
                    <ul className="text-ink-muted list-disc pl-5 text-sm">
                      {row.evaluation.gaps.map((gap) => (
                        <li key={gap.code}>{gap.message}</li>
                      ))}
                    </ul>
                  ) : null}

                  {row.certificate ? (
                    <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-ink font-medium">
                          {row.certificate.certificateNumber}
                        </span>
                        <span className="text-ink-muted text-xs">
                          Issued {formatDate(row.certificate.issuedAt)} ·{" "}
                          <a
                            href={`/verify/${row.certificate.verificationToken}`}
                            className="text-brand-800 font-medium hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            verification page
                          </a>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <form
                          action={reissueCertificateAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="offeringId" value={access.offeringId} />
                          <input type="hidden" name="certificateId" value={row.certificate.id} />
                          <input type="hidden" name="learnerName" value={row.learnerName} />
                          <Input
                            id={`reissue-reason-${row.learnerUserId}`}
                            name="reason"
                            label="Correction reason"
                            required
                            minLength={3}
                          />
                          <Button type="submit" variant="secondary" size="sm">
                            Reissue
                          </Button>
                        </form>
                        <form
                          action={revokeCertificateAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="offeringId" value={access.offeringId} />
                          <input type="hidden" name="certificateId" value={row.certificate.id} />
                          <Input
                            id={`revoke-reason-${row.learnerUserId}`}
                            name="reason"
                            label="Revocation reason"
                            required
                            minLength={3}
                          />
                          <Button type="submit" variant="secondary" size="sm">
                            Revoke
                          </Button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <form
                      action={issueCertificateAction}
                      className="flex flex-wrap items-center gap-3"
                    >
                      <input type="hidden" name="offeringId" value={access.offeringId} />
                      <input type="hidden" name="learnerUserId" value={row.learnerUserId} />
                      <Button type="submit" size="sm" disabled={!row.evaluation.eligible}>
                        Issue certificate
                      </Button>
                      <span className="text-ink-muted text-xs">
                        Issuing is refused until every rule above is met.
                      </span>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-ink-muted text-sm">
        Signed-in learners see their own awards at{" "}
        <a href="/student/certificates" className="text-brand-800 font-medium hover:underline">
          /student/certificates
        </a>
        . Return to the{" "}
        <a
          href={returnTo.replace("/certificates", "")}
          className="text-brand-800 font-medium hover:underline"
        >
          course editor
        </a>
        .
      </p>
    </div>
  );
}
