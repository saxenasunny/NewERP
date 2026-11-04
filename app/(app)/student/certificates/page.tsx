import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  listLearnerCertificates,
  listLearnerCompletion,
} from "@/modules/certificates/certificate-service";

export const metadata: Metadata = { title: "Certificates" };

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

export default async function StudentCertificatesPage() {
  const account = await requireAccountContext();

  if (!account.tenant) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Certificates" />
        <Alert tone="warning" title="Choose an institution">
          Select the institution you are studying in first.
        </Alert>
      </div>
    );
  }

  let certificates;
  let completion;
  try {
    [certificates, completion] = await Promise.all([
      listLearnerCertificates(account),
      listLearnerCompletion(account),
    ]);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Certificates" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Your certificates could not be loaded."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[{ label: "My learning", href: "/student" }, { label: "Certificates" }]}
      />
      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="Certificates"
        description="Awards issued to you, plus how close each enrolled course is to eligibility. Certificates are issued by your institution; nothing here is generated automatically."
      />

      <section aria-labelledby="issued-heading" className="flex flex-col gap-3">
        <h2 id="issued-heading" className="text-ink text-lg font-semibold">
          Issued to you
        </h2>
        {certificates.length === 0 ? (
          <EmptyState
            title="No certificates yet"
            description="When you meet a course's completion rules, your instructor can issue one."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {certificates.map((certificate) => (
              <li
                key={certificate.id}
                className="rounded-card border-border bg-surface shadow-card flex flex-col gap-2 border p-4 sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="text-ink text-base font-semibold">
                      {certificate.courseCode} · {certificate.courseTitle}
                    </p>
                    <p className="text-ink-muted text-xs">
                      {certificate.certificateNumber} · issued {formatDate(certificate.issuedAt)}
                      {certificate.reissuedFromId ? " · replaces an earlier certificate" : ""}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      certificate.status === "ISSUED"
                        ? "success"
                        : certificate.status === "REVOKED"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {certificate.status.toLowerCase()}
                  </StatusBadge>
                </div>
                <p className="text-ink-muted text-sm">
                  Issuer: {certificate.issuerName}. Completion rules at issue:{" "}
                  {certificate.completionSummary}.
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <Link
                    href={certificate.verificationPath}
                    className="text-brand-800 font-medium hover:underline"
                  >
                    Public verification page
                  </Link>
                  {certificate.status === "REVOKED" ? (
                    <span className="text-ink-muted text-xs">
                      Revoked awards stay visible so a shared link explains itself.
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="progress-heading" className="flex flex-col gap-3">
        <h2 id="progress-heading" className="text-ink text-lg font-semibold">
          Completion progress
        </h2>
        {completion.length === 0 ? (
          <EmptyState
            title="No active enrolments"
            description="Enrol in a course to see its completion requirements."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {completion.map((card) => (
              <li
                key={card.offeringId}
                className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/student/courses/${card.offeringId}`}
                      className="text-ink text-base font-semibold hover:underline"
                    >
                      {card.courseCode} · {card.courseTitle}
                    </Link>
                    <span className="text-ink-muted text-xs">{card.termName}</span>
                  </div>
                  <StatusBadge
                    tone={
                      card.certificate ? "success" : card.evaluation.eligible ? "info" : "neutral"
                    }
                  >
                    {card.certificate
                      ? `certificate ${card.certificate.status.toLowerCase()}`
                      : card.evaluation.eligible
                        ? "eligible"
                        : "in progress"}
                  </StatusBadge>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-muted uppercase">Lessons</dt>
                    <dd className="text-ink font-semibold">
                      {card.facts.completedContentItems}/{card.facts.publishedContentItems}
                      {card.evaluation.contentPercent === null
                        ? ""
                        : ` · ${card.evaluation.contentPercent}%`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted uppercase">Assignments</dt>
                    <dd className="text-ink font-semibold">
                      {card.facts.submittedAssignments}/{card.facts.publishedAssignments}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted uppercase">Quizzes</dt>
                    <dd className="text-ink font-semibold">
                      {card.facts.submittedQuizzes}/{card.facts.publishedQuizzes}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted uppercase">Released grade</dt>
                    <dd className="text-ink font-semibold">
                      {card.facts.releasedGradePercent === null
                        ? "not released"
                        : `${card.facts.releasedGradePercent}%`}
                    </dd>
                  </div>
                </dl>
                {card.evaluation.gaps.length > 0 ? (
                  <ul className="text-ink-muted list-disc pl-5 text-sm">
                    {card.evaluation.gaps.map((gap) => (
                      <li key={gap.code}>{gap.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-muted text-sm">
                    Every configured requirement is met. Your institution can now issue the
                    certificate.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
