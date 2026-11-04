import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { verifyCertificate } from "@/modules/certificates/certificate-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Certificate verification",
  description: "Confirm a certificate issued by this institution.",
  robots: { index: false, follow: false },
};

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

/**
 * Public verification. No sign-in, no account data, and no learning records are
 * exposed: the token confirms the name, course, issuer, dates, and status only.
 */
export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const certificate = await verifyCertificate(token);
  if (!certificate) notFound();

  const statusLabel =
    certificate.status === "ISSUED"
      ? "Valid"
      : certificate.status === "REVOKED"
        ? "Revoked"
        : "Replaced by a newer certificate";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-2">
        <p className="text-ink-muted text-xs tracking-wide uppercase">
          {certificate.institutionName}
        </p>
        <h1 className="text-ink text-2xl font-semibold">Certificate verification</h1>
        <p className="text-ink-muted text-sm">
          This page confirms an award recorded by the issuing institution. It intentionally shows
          only the minimum needed to verify it.
        </p>
      </div>

      <section className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-ink text-lg font-semibold">{certificate.learnerName}</h2>
          <StatusBadge
            tone={
              certificate.status === "ISSUED"
                ? "success"
                : certificate.status === "REVOKED"
                  ? "danger"
                  : "neutral"
            }
          >
            {statusLabel}
          </StatusBadge>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted text-xs uppercase">Course</dt>
            <dd className="text-ink font-medium">
              {certificate.courseCode} · {certificate.courseTitle}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted text-xs uppercase">Certificate number</dt>
            <dd className="text-ink font-medium">{certificate.certificateNumber}</dd>
          </div>
          <div>
            <dt className="text-ink-muted text-xs uppercase">Issued</dt>
            <dd className="text-ink font-medium">{formatDate(certificate.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted text-xs uppercase">Issuer</dt>
            <dd className="text-ink font-medium">{certificate.issuerName}</dd>
          </div>
          {certificate.revokedAt ? (
            <div>
              <dt className="text-ink-muted text-xs uppercase">Revoked</dt>
              <dd className="text-ink font-medium">{formatDate(certificate.revokedAt)}</dd>
            </div>
          ) : null}
        </dl>
        {certificate.status === "REVOKED" ? (
          <p className="text-ink-muted text-sm">
            This certificate is no longer valid. The institution keeps the record so a shared link
            explains the current status. Revocation reasons stay internal.
          </p>
        ) : null}
        {certificate.status === "REISSUED" ? (
          <p className="text-ink-muted text-sm">
            A corrected certificate has replaced this one. Ask the holder for their current
            certificate if you need to verify the award.
          </p>
        ) : null}
      </section>

      <p className="text-ink-muted text-xs">
        To check a different certificate, open the link printed on it.
      </p>
    </main>
  );
}
